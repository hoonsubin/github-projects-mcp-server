// =============================================================================
// scripts/diagram/tool-surface/ZodSchemaExtractor.ts
//
// Extracts class/relationship info from Zod schema files (src/schemas/).
//
// Strategy: find exported `const *Schema = z.object({...})...` variable
// declarations, walk the z.* method chain to recover field names and types,
// then emit one ExtractedClass per schema with "Arguments" stereotype.
//
// Zod chains are traversed bottom-up by peeling call expressions:
//
//   z.object({ ref: StoryRefSchema.describe("...") }).strict()
//   └── CallExpr(.strict)
//       └── CallExpr(z.object)        ← the "base" z.object call
//           └── ObjectLiteral         ← property bag
//               └── ref: CallExpr(.describe)
//                   └── Identifier(StoryRefSchema)  ← the leaf
//
// =============================================================================

import * as ts from "typescript";
import type { ExtractedClass, ExtractedRelationship, NamespaceName } from "./types.ts";

// ── Public API ────────────────────────────────────────────────────────────────

export interface ZodExtractorResult {
  classes: ExtractedClass[];
  relationships: ExtractedRelationship[];
}

/**
 * Parse a Zod schema source file and return one ExtractedClass per exported
 * `*Schema` variable that wraps a `z.object({...})`.
 *
 * @param filePath   Absolute path (for labelling only).
 * @param source     Raw TypeScript source text.
 * @param namespace  Which Mermaid namespace to assign the extracted classes to.
 * @param knownNames All class names known across all namespaces — used to emit
 *                   cross-namespace relationship arrows.
 * @param schemaNameToClassName  Optional override map from exported schema
 *                   variable name to desired diagram class name.
 *                   e.g. `{ GetStorySchema: "GetItemDetailArgs" }`
 *                   Defaults to stripping the "Schema" suffix and appending "Args".
 */
export function extractZodSchemas(
  filePath: string,
  source: string,
  namespace: NamespaceName,
  knownNames: Set<string> = new Set(),
  schemaNameToClassName: Record<string, string> = {},
): ZodExtractorResult {
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);
  const classes: ExtractedClass[] = [];
  const relationships: ExtractedRelationship[] = [];

  ts.forEachChild(sourceFile, (node) => {
    if (!isExported(node) || !ts.isVariableStatement(node)) return;

    for (const decl of node.declarationList.declarations) {
      const varName = decl.name.getText();
      if (!varName.endsWith("Schema")) continue;

      const init = decl.initializer;
      if (!init) continue;

      // Find the z.object() call buried in the chain
      const objectCall = findZodObjectCall(init);
      if (!objectCall) continue;

      // Get the first argument: the property bag
      const propBag = objectCall.arguments[0];
      if (!propBag || !ts.isObjectLiteralExpression(propBag)) continue;

      // Determine display name for the class
      const className = schemaNameToClassName[varName] ?? deriveClassName(varName);

      // Extract each property
      const members: string[] = [];
      for (const prop of propBag.properties) {
        if (!ts.isPropertyAssignment(prop)) continue;

        const fieldName = getNodeText(prop.name);
        const { typeStr, optional, schemaRefs } = resolveZodType(prop.initializer);

        const optSuffix = optional ? " opt" : "";
        members.push(`+${fieldName} : ${typeStr}${optSuffix}`);

        // Emit relationship arrows to other known schemas/types
        for (const ref of schemaRefs) {
          const targetClass = schemaNameToClassName[ref] ?? schemaRefToClassName(ref);
          if (knownNames.has(targetClass) && targetClass !== className) {
            relationships.push({
              from: className,
              to: targetClass,
              arrow: "-->",
              label: fieldName,
            });
          }
        }
      }

      // Infer stereotype from whether the schema is read-only (no write annotations)
      // Default to "Arguments" — callers can override via postprocessing if needed.
      classes.push({
        name: className,
        stereotype: "Arguments",
        members,
        namespace,
        sourceFile: filePath,
      });
    }
  });

  return { classes, relationships };
}

// ── Zod type resolver ─────────────────────────────────────────────────────────
//
// Traverses a Zod expression chain and returns:
//   typeStr    — human-readable type label for the Mermaid member line
//   optional   — whether .optional() or .nullish() appears in the chain
//   schemaRefs — names of other *Schema identifiers referenced (for arrows)

interface ZodTypeResult {
  typeStr: string;
  optional: boolean;
  schemaRefs: string[];
}

function resolveZodType(expr: ts.Expression): ZodTypeResult {
  // ── Identifier: SomeOtherSchema ───────────────────────────────────────────
  if (ts.isIdentifier(expr)) {
    const name = expr.text;
    if (name.endsWith("Schema")) {
      return {
        typeStr: schemaRefToClassName(name),
        optional: false,
        schemaRefs: [name],
      };
    }
    // Non-schema identifier (unlikely in Zod field context, but handle gracefully)
    return { typeStr: name, optional: false, schemaRefs: [] };
  }

  // ── Call expression ───────────────────────────────────────────────────────
  if (ts.isCallExpression(expr)) {
    const callee = expr.expression;

    // z.something(…) — base Zod type constructor
    if (
      ts.isPropertyAccessExpression(callee) &&
      ts.isIdentifier(callee.expression) &&
      callee.expression.text === "z"
    ) {
      return resolveZodBase(callee.name.text, expr.arguments);
    }

    // chain.method(…) — method called on a prior Zod expression
    if (ts.isPropertyAccessExpression(callee)) {
      const method = callee.name.text;
      const inner = resolveZodType(callee.expression);

      switch (method) {
        // Passthrough: metadata / validation constraints that don't change type
        case "describe":
        case "strict":
        case "min":
        case "max":
        case "int":
        case "positive":
        case "email":
        case "url":
        case "trim":
        case "regex":
        case "transform":
        case "refine":
        case "superRefine":
        case "catch":
        case "pipe":
          return inner;

        case "optional":
          return { ...inner, optional: true };

        case "nullish":
          return {
            typeStr: `${inner.typeStr} or null`,
            optional: true,
            schemaRefs: inner.schemaRefs,
          };

        case "default":
          // .default(value) removes the optional brand at runtime but
          // doesn't change the schema type — keep inner as-is.
          return inner;

        case "or": {
          // z.string().or(z.number())
          const other = resolveZodType(expr.arguments[0]);
          return {
            typeStr: `${inner.typeStr} or ${other.typeStr}`,
            optional: inner.optional || other.optional,
            schemaRefs: [...inner.schemaRefs, ...other.schemaRefs],
          };
        }

        default:
          return inner;
      }
    }
  }

  // Fallback — raw source text, collapsed to a single line
  return {
    typeStr: expr.getText().replace(/\s+/g, " ").trim().slice(0, 40),
    optional: false,
    schemaRefs: [],
  };
}

// ── Base Zod type constructors ────────────────────────────────────────────────

function resolveZodBase(
  method: string,
  args: ts.NodeArray<ts.Expression>,
): ZodTypeResult {
  const empty: ZodTypeResult = { typeStr: method, optional: false, schemaRefs: [] };

  switch (method) {
    case "string":  return { typeStr: "string",  optional: false, schemaRefs: [] };
    case "number":  return { typeStr: "number",  optional: false, schemaRefs: [] };
    case "boolean": return { typeStr: "boolean", optional: false, schemaRefs: [] };
    case "null":    return { typeStr: "null",     optional: false, schemaRefs: [] };
    case "any":     return { typeStr: "any",      optional: false, schemaRefs: [] };
    case "unknown": return { typeStr: "unknown",  optional: false, schemaRefs: [] };
    case "void":    return { typeStr: "void",     optional: false, schemaRefs: [] };
    case "never":   return { typeStr: "never",    optional: false, schemaRefs: [] };

    case "literal": {
      const text = args[0]?.getText() ?? "unknown";
      // Strip quotes from string literals
      return { typeStr: text.replace(/^["']|["']$/g, ""), optional: false, schemaRefs: [] };
    }

    case "enum": {
      // z.enum(["a", "b"]) — first arg is an array literal of string literals
      if (args[0] && ts.isArrayLiteralExpression(args[0])) {
        const vals = args[0].elements
          .filter(ts.isStringLiteral)
          .map((el) => el.text);
        return { typeStr: vals.join(" or "), optional: false, schemaRefs: [] };
      }
      return empty;
    }

    case "nativeEnum": {
      // z.nativeEnum(SomeEnum) — reference to a TS enum
      const name = args[0]?.getText() ?? "enum";
      return { typeStr: name, optional: false, schemaRefs: [] };
    }

    case "array": {
      if (!args[0]) return { typeStr: "unknown[]", optional: false, schemaRefs: [] };
      const inner = resolveZodType(args[0]);
      return {
        typeStr: `${inner.typeStr}[]`,
        optional: false,
        schemaRefs: inner.schemaRefs,
      };
    }

    case "tuple": {
      if (!args[0] || !ts.isArrayLiteralExpression(args[0])) return empty;
      const items = args[0].elements.map((e) => resolveZodType(e).typeStr);
      return { typeStr: `[${items.join(", ")}]`, optional: false, schemaRefs: [] };
    }

    case "union": {
      // z.union([schemaA, schemaB, ...])
      if (!args[0] || !ts.isArrayLiteralExpression(args[0])) return empty;
      const parts = args[0].elements.map((e) => resolveZodType(e));
      return {
        typeStr: parts.map((p) => p.typeStr).join(" or "),
        optional: false,
        schemaRefs: parts.flatMap((p) => p.schemaRefs),
      };
    }

    case "discriminatedUnion": {
      // z.discriminatedUnion("kind", [...])
      if (!args[1] || !ts.isArrayLiteralExpression(args[1])) return empty;
      const parts = args[1].elements.map((e) => resolveZodType(e));
      return {
        typeStr: parts.map((p) => p.typeStr).join(" or "),
        optional: false,
        schemaRefs: parts.flatMap((p) => p.schemaRefs),
      };
    }

    case "intersection": {
      if (args.length < 2) return empty;
      const [a, b] = [resolveZodType(args[0]), resolveZodType(args[1])];
      return {
        typeStr: `${a.typeStr} and ${b.typeStr}`,
        optional: false,
        schemaRefs: [...a.schemaRefs, ...b.schemaRefs],
      };
    }

    case "object":
      // Nested z.object — don't recurse into it; just show "object"
      return { typeStr: "object", optional: false, schemaRefs: [] };

    case "record": {
      const keyType = args[0] ? resolveZodType(args[0]).typeStr : "string";
      const valType = args[1] ? resolveZodType(args[1]).typeStr : "unknown";
      return { typeStr: `Record~${keyType},${valType}~`, optional: false, schemaRefs: [] };
    }

    default:
      return empty;
  }
}

// ── Utilities ─────────────────────────────────────────────────────────────────

/** Find the innermost `z.object(...)` call in a possibly-chained expression. */
function findZodObjectCall(expr: ts.Expression): ts.CallExpression | null {
  if (ts.isCallExpression(expr)) {
    const callee = expr.expression;

    if (
      ts.isPropertyAccessExpression(callee) &&
      ts.isIdentifier(callee.expression) &&
      callee.expression.text === "z" &&
      callee.name.text === "object"
    ) {
      return expr;
    }

    // Method call on a prior expression — unwrap and keep looking
    if (ts.isPropertyAccessExpression(callee)) {
      return findZodObjectCall(callee.expression);
    }
  }

  return null;
}

function isExported(node: ts.Node): boolean {
  const mods = (node as { modifiers?: ts.NodeArray<ts.Modifier> }).modifiers;
  return mods?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
}

function getNodeText(node: ts.Node): string {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isStringLiteral(node)) return node.text;
  return node.getText().trim();
}

/**
 * Convert a *Schema variable name to a Mermaid class name.
 * GetStorySchema → GetStoryArgs
 * FindItemsSchema → FindItemsArgs
 *
 * Override via the schemaNameToClassName parameter for non-standard names.
 */
function deriveClassName(schemaVarName: string): string {
  return schemaVarName.replace(/Schema$/, "Args");
}

/**
 * Convert a *Schema reference to the corresponding Mermaid class name so that
 * relationship arrows target the right class.
 */
function schemaRefToClassName(schemaVarName: string): string {
  return schemaVarName.replace(/Schema$/, "");
}
