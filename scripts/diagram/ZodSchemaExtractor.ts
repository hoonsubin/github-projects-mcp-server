// =============================================================================
// scripts/diagram/ZodSchemaExtractor.ts
//
// Extracts class/relationship info from Zod schema files (src/schemas/).
// Uses an already-parsed ParsedModule - no duplicate ts.createSourceFile().
// =============================================================================

import * as ts from "typescript";
import type { ParsedModule } from "./ParsedModule.ts";
import type { ExtractedClass, ExtractedRelationship, NamespaceName } from "./types.ts";

// ── Public API ────────────────────────────────────────────────────────────────

export interface ZodExtractorResult {
  classes: ExtractedClass[];
  relationships: ExtractedRelationship[];
}

/**
 * Parse a Zod schema source file (already loaded as a ParsedModule) and
 * return one ExtractedClass per exported `*Schema` variable.
 *
 * @param module    Already-parsed module instance.
 * @param namespace Which Mermaid namespace to assign the extracted classes to.
 * @param knownNames All class names known across all namespaces.
 * @param schemaNameToClassName  Optional override map from exported schema
 *                   variable name to desired diagram class name.
 */
export const extractZodSchemas = (
  module: ParsedModule,
  namespace: NamespaceName,
  knownNames: Set<string> = new Set(),
  schemaNameToClassName: Record<string, string> = {},
): ZodExtractorResult => {
  const sourceFile = module.getModuleSource();
  const filePath = module.filePathName;
  const classes: ExtractedClass[] = [];
  const relationships: ExtractedRelationship[] = [];

  ts.forEachChild(sourceFile, (node) => {
    if (!isExported(node) || !ts.isVariableStatement(node)) return;

    for (const decl of node.declarationList.declarations) {
      const varName = decl.name.getText();
      if (!varName.endsWith("Schema")) continue;

      const init = decl.initializer;
      if (!init) continue;

      const objectCall = findZodObjectCall(init);
      if (!objectCall) continue;

      const propBag = objectCall.arguments[0];
      if (!propBag || !ts.isObjectLiteralExpression(propBag)) continue;

      const className = schemaNameToClassName[varName] ?? deriveClassName(varName);

      const members: string[] = [];
      for (const prop of propBag.properties) {
        if (!ts.isPropertyAssignment(prop)) continue;

        const fieldName = getNodeText(prop.name);
        const { typeStr, optional, schemaRefs } = resolveZodType(prop.initializer);

        const optSuffix = optional ? " opt" : "";
        members.push(`+${fieldName} : ${typeStr}${optSuffix}`);

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
};

// ── Zod type resolver ─────────────────────────────────────────────────────────

interface ZodTypeResult {
  typeStr: string;
  optional: boolean;
  schemaRefs: string[];
}

function resolveZodType(expr: ts.Expression): ZodTypeResult {
  if (ts.isIdentifier(expr)) {
    const name = expr.text;
    if (name.endsWith("Schema")) {
      return {
        typeStr: schemaRefToClassName(name),
        optional: false,
        schemaRefs: [name],
      };
    }
    return { typeStr: name, optional: false, schemaRefs: [] };
  }

  if (ts.isCallExpression(expr)) {
    const callee = expr.expression;

    if (
      ts.isPropertyAccessExpression(callee) &&
      ts.isIdentifier(callee.expression) &&
      callee.expression.text === "z"
    ) {
      return resolveZodBase(callee.name.text, expr.arguments);
    }

    if (ts.isPropertyAccessExpression(callee)) {
      const method = callee.name.text;
      const inner = resolveZodType(callee.expression);

      switch (method) {
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
          return inner;

        case "or": {
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
    case "string":
      return { typeStr: "string", optional: false, schemaRefs: [] };
    case "number":
      return { typeStr: "number", optional: false, schemaRefs: [] };
    case "boolean":
      return { typeStr: "boolean", optional: false, schemaRefs: [] };
    case "null":
      return { typeStr: "null", optional: false, schemaRefs: [] };
    case "any":
      return { typeStr: "any", optional: false, schemaRefs: [] };
    case "unknown":
      return { typeStr: "unknown", optional: false, schemaRefs: [] };
    case "void":
      return { typeStr: "void", optional: false, schemaRefs: [] };
    case "never":
      return { typeStr: "never", optional: false, schemaRefs: [] };

    case "literal": {
      const text = args[0]?.getText() ?? "unknown";
      return { typeStr: text.replace(/^["']|["']$/g, ""), optional: false, schemaRefs: [] };
    }

    case "enum": {
      if (args[0] && ts.isArrayLiteralExpression(args[0])) {
        const vals = args[0].elements
          .filter(ts.isStringLiteral)
          .map((el) => el.text);
        return { typeStr: vals.join(" or "), optional: false, schemaRefs: [] };
      }
      return empty;
    }

    case "nativeEnum": {
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
      if (!args[0] || !ts.isArrayLiteralExpression(args[0])) return empty;
      const parts = args[0].elements.map((e) => resolveZodType(e));
      return {
        typeStr: parts.map((p) => p.typeStr).join(" or "),
        optional: false,
        schemaRefs: parts.flatMap((p) => p.schemaRefs),
      };
    }

    case "discriminatedUnion": {
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

function deriveClassName(schemaVarName: string): string {
  return schemaVarName.replace(/Schema$/, "Args");
}

function schemaRefToClassName(schemaVarName: string): string {
  return schemaVarName.replace(/Schema$/, "");
}
