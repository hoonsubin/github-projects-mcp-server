// =============================================================================
// scripts/diagram/tool-surface/DomainTypeExtractor.ts
//
// Extracts class/relationship info from plain TypeScript source files.
// Handles: interface, type alias (union, branded, object), enum, const tuple.
//
// Uses the TypeScript Compiler API (ts.*) at the AST node level — no type
// checker required, so we don't need to build a full Program.
// =============================================================================

import * as ts from "typescript";
import type { ExtractedClass, ExtractedRelationship, NamespaceName } from "./types.ts";

// ── Public API ────────────────────────────────────────────────────────────────

export interface DomainExtractorResult {
  classes: ExtractedClass[];
  relationships: ExtractedRelationship[];
  /**
   * Warnings emitted during extraction.
   * Each entry describes an inline anonymous type that should be a named type
   * instead — anonymous object literals embedded in unions/intersections
   * violate the single-responsibility principle for types and also force
   * the diagram generator to invent ad-hoc bracket notation because Mermaid
   * cannot represent curly braces inside a class body.
   */
  warnings: string[];
  /**
   * Names of classes that triggered at least one clean-code warning.
   * The diagram generator uses this set to apply the "warning" colour style
   * (red text / red border) to those nodes.
   */
  warningNodes: Set<string>;
}

/**
 * Parse a TypeScript source file and return all types it declares as
 * ExtractedClass objects, plus the relationships between them.
 *
 * Call this once per file; aggregate results across files before generating.
 *
 * @param filePath  Absolute path (used as sourceFile label only — file is not
 *                  read from disk; pass the content separately).
 * @param source    Raw TypeScript source text.
 * @param namespace Which Mermaid namespace to assign all extracted classes to.
 * @param knownNames Optional set of type names already collected from other
 *                   files — used to suppress relationship arrows to unknowns.
 *                   Pass an empty set on the first pass; populate and re-run
 *                   on the second pass.
 */
export function extractDomainTypes(
  filePath: string,
  source: string,
  namespace: NamespaceName,
  knownNames: Set<string> = new Set(),
): DomainExtractorResult {
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);

  const classes: ExtractedClass[] = [];
  const relationships: ExtractedRelationship[] = [];
  const warnings: string[] = [];
  const warningNodes = new Set<string>();

  ts.forEachChild(sourceFile, (node) => {
    if (!isExported(node)) return;

    if (ts.isInterfaceDeclaration(node)) {
      const { cls, rels } = extractInterface(node, namespace, filePath, knownNames, warnings, warningNodes);
      classes.push(cls);
      relationships.push(...rels);
    } else if (ts.isTypeAliasDeclaration(node)) {
      const result = extractTypeAlias(node, namespace, filePath, knownNames, warnings, warningNodes);
      if (result) {
        classes.push(result.cls);
        relationships.push(...result.rels);
      }
    } else if (ts.isEnumDeclaration(node)) {
      classes.push(extractEnum(node, namespace, filePath));
    } else if (ts.isVariableStatement(node)) {
      // Handles:  export const ITEM_TYPES = ["bug", "feature", ...] as const
      const result = extractConstTuple(node, namespace, filePath);
      if (result) classes.push(result);
    }
  });

  return { classes, relationships, warnings, warningNodes };
}

// ── Helpers: node classification ──────────────────────────────────────────────

function isExported(node: ts.Node): boolean {
  const mods = (node as { modifiers?: ts.NodeArray<ts.Modifier> }).modifiers;
  return mods?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
}

// ── Interface extraction ──────────────────────────────────────────────────────

function extractInterface(
  node: ts.InterfaceDeclaration,
  namespace: NamespaceName,
  sourceFile: string,
  known: Set<string>,
  warnings: string[],
  warningNodes: Set<string>,
): { cls: ExtractedClass; rels: ExtractedRelationship[] } {
  const name = node.name.text;
  const members: string[] = [];
  const rels: ExtractedRelationship[] = [];

  // extends clauses → inheritance arrows
  for (const clause of node.heritageClauses ?? []) {
    for (const type of clause.types) {
      const baseName = type.expression.getText();
      if (known.has(baseName)) {
        rels.push({ from: name, to: baseName, arrow: "--|>", label: "extends" });
      }
    }
  }

  // Property members
  for (const member of node.members) {
    if (!ts.isPropertySignature(member)) continue;

    const memberName = getNodeText(member.name);
    const optional = member.questionToken ? " opt" : "";

    if (member.type) {
      const typeStr = formatTypeNode(member.type, warnings, `${name}.${memberName}`, warningNodes);
      members.push(`+${memberName} : ${typeStr}${optional}`);

      // Emit association arrows for each named type referenced in this member
      for (const ref of collectTypeRefs(member.type)) {
        if (known.has(ref) && ref !== name) {
          rels.push({ from: name, to: ref, arrow: "-->", label: memberName });
        }
      }
    } else {
      members.push(`+${memberName}`);
    }
  }

  return {
    cls: { name, stereotype: "interface", members, namespace, sourceFile },
    rels,
  };
}

// ── Type alias extraction ─────────────────────────────────────────────────────

function extractTypeAlias(
  node: ts.TypeAliasDeclaration,
  namespace: NamespaceName,
  sourceFile: string,
  known: Set<string>,
  warnings: string[],
  warningNodes: Set<string>,
): { cls: ExtractedClass; rels: ExtractedRelationship[] } | null {
  const name = node.name.text;
  const rels: ExtractedRelationship[] = [];

  // Union type: "current" | "next" | null | SprintName  →  <<union>>
  if (ts.isUnionTypeNode(node.type)) {
    const members = node.type.types.map((t) => formatTypeNode(t, warnings, name, warningNodes));

    // Add relationship arrows to named members that are in the known set
    for (const ref of collectTypeRefs(node.type)) {
      if (known.has(ref) && ref !== name) {
        rels.push({ from: name, to: ref, arrow: "-->", label: ref.toLowerCase() + "-variant" });
      }
    }

    return {
      cls: { name, stereotype: "union", members, namespace, sourceFile },
      rels,
    };
  }

  // Branded string: `string & { readonly _brand: "Foo" }`  →  <<branded>>
  if (ts.isIntersectionTypeNode(node.type)) {
    const text = sanitizeForMermaid(node.type.getText().replace(/\s+/g, " ").trim());
    return {
      cls: {
        name,
        stereotype: "branded",
        members: [text],
        namespace,
        sourceFile,
      },
      rels: [],
    };
  }

  // Simple type reference alias (e.g. `type EpicRef = EntityRef`)
  if (ts.isTypeReferenceNode(node.type)) {
    const target = node.type.typeName.getText();
    if (known.has(target)) {
      rels.push({ from: name, to: target, arrow: "--|>", label: "same shape" });
    }
    // Don't emit a separate class for a pure alias — the arrow is sufficient.
    // Return null to skip class emission.
    return null;
  }

  // Template literal type (e.g. `scrum://template/${ItemType}`)  →  skip
  if (ts.isTemplateLiteralTypeNode(node.type)) {
    return null;
  }

  // Object type literal: `{ readonly id: string }` → treat as minimal class
  if (ts.isTypeLiteralNode(node.type)) {
    const members: string[] = [];
    for (const member of node.type.members) {
      if (ts.isPropertySignature(member) && member.type) {
        const mName = getNodeText(member.name);
        const optional = member.questionToken ? " opt" : "";
        members.push(`+${mName} : ${formatTypeNode(member.type, warnings, `${name}.${mName}`, warningNodes)}${optional}`);
      }
    }
    return {
      cls: { name, stereotype: null, members, namespace, sourceFile },
      rels,
    };
  }

  // Conditional / mapped / utility types → skip (too complex to render usefully)
  return null;
}

// ── Enum extraction ───────────────────────────────────────────────────────────

function extractEnum(
  node: ts.EnumDeclaration,
  namespace: NamespaceName,
  sourceFile: string,
): ExtractedClass {
  const name = node.name.text;
  const members = node.members.map((m) => getNodeText(m.name));
  return { name, stereotype: "enumeration", members, namespace, sourceFile };
}

// ── Const tuple extraction ────────────────────────────────────────────────────
//
// Handles: export const ITEM_TYPES = ["bug", "feature", ...] as const
// These serve as enumerations in the codebase even though TS represents them
// as const assertions on array literals.

function extractConstTuple(
  node: ts.VariableStatement,
  namespace: NamespaceName,
  sourceFile: string,
): ExtractedClass | null {
  for (const decl of node.declarationList.declarations) {
    const name = decl.name.getText();
    const init = decl.initializer;

    // Look for: ... = [...] as const
    if (
      init &&
      ts.isAsExpression(init) &&
      ts.isArrayLiteralExpression(init.expression)
    ) {
      const members = init.expression.elements
        .filter(ts.isStringLiteral)
        .map((el) => el.text);

      if (members.length > 0) {
        return { name, stereotype: "const-tuple", members, namespace, sourceFile };
      }
    }
  }
  return null;
}

// ── Type node → display string ────────────────────────────────────────────────
//
// Converts a TypeScript AST TypeNode into a human-readable string suitable
// for Mermaid class member lines.  Does NOT need the type-checker.
//
// @param warnings  Collector for clean-code violations (inline anonymous types).
// @param context   Human-readable location for the warning message, e.g. "StoryRef.number".

function formatTypeNode(
  typeNode: ts.TypeNode,
  warnings: string[],
  context = "<unknown>",
  warningNodes = new Set<string>(),
): string {
  // Named reference (EntityRef, string, number, boolean, …)
  if (ts.isTypeReferenceNode(typeNode)) {
    const name = typeNode.typeName.getText();
    // Generic: Record<K, V>, Partial<T>, …
    if (typeNode.typeArguments?.length) {
      const args = typeNode.typeArguments
        .map((a) => formatTypeNode(a, warnings, context, warningNodes))
        .join(",");
      return `${name}~${args}~`; // Mermaid uses ~ for generics
    }
    return name;
  }

  // Primitive keywords
  switch (typeNode.kind) {
    case ts.SyntaxKind.StringKeyword:    return "string";
    case ts.SyntaxKind.NumberKeyword:    return "number";
    case ts.SyntaxKind.BooleanKeyword:   return "boolean";
    case ts.SyntaxKind.NullKeyword:      return "null";
    case ts.SyntaxKind.UndefinedKeyword: return "undefined";
    case ts.SyntaxKind.UnknownKeyword:   return "unknown";
    case ts.SyntaxKind.VoidKeyword:      return "void";
    case ts.SyntaxKind.AnyKeyword:       return "any";
  }

  // Array:  T[]
  if (ts.isArrayTypeNode(typeNode)) {
    return `${formatTypeNode(typeNode.elementType, warnings, context, warningNodes)}[]`;
  }

  // Union:  A | B | null  →  "A or B or null"
  if (ts.isUnionTypeNode(typeNode)) {
    return typeNode.types
      .map((t) => formatTypeNode(t, warnings, context, warningNodes))
      .join(" or ");
  }

  // Intersection:  A & B  →  "A and B"
  if (ts.isIntersectionTypeNode(typeNode)) {
    return typeNode.types
      .map((t) => formatTypeNode(t, warnings, context, warningNodes))
      .join(" and ");
  }

  // Literal:  "current"  →  current
  if (ts.isLiteralTypeNode(typeNode)) {
    const lit = typeNode.literal;
    if (ts.isStringLiteral(lit)) return lit.text;
    if (ts.isNumericLiteral(lit)) return lit.text;
    if (lit.kind === ts.SyntaxKind.NullKeyword)  return "null";
    if (lit.kind === ts.SyntaxKind.TrueKeyword)  return "true";
    if (lit.kind === ts.SyntaxKind.FalseKeyword) return "false";
  }

  // Parenthesized:  (A | B)
  if (ts.isParenthesizedTypeNode(typeNode)) {
    return `(${formatTypeNode(typeNode.type, warnings, context, warningNodes)})`;
  }

  // Object literal:  { foo: string }
  // ── Mermaid cannot represent curly braces inside a class body, so we use
  //    square brackets instead.  We also emit a warning because an inline
  //    anonymous object type is a clean-code violation: it should be extracted
  //    into a named type so it can be referenced, documented, and reused.
  if (ts.isTypeLiteralNode(typeNode)) {
    const raw = typeNode.getText().replace(/\s+/g, " ").trim();
    // Record the owning class so the generator can flag it with the warning style.
    warningNodes.add(context.split(".")[0]);
    warnings.push(
      `[clean-code] Inline anonymous object type at "${context}": ${raw}\n` +
      `  → Extract to a named type so it can be referenced, documented, and reused.`,
    );
    const props = typeNode.members
      .filter(ts.isPropertySignature)
      .map((m) => {
        const mName = getNodeText(m.name);
        const mType = m.type ? formatTypeNode(m.type, warnings, `${context}.${mName}`, warningNodes) : "unknown";
        return `${mName}: ${mType}`;
      });
    // Use [ ] — Mermaid has no escape sequence for { }
    return `[ ${props.join(", ")} ]`;
  }

  // Tuple:  [A, B]
  if (ts.isTupleTypeNode(typeNode)) {
    return `[${typeNode.elements
      .map((e) => formatTypeNode(e as ts.TypeNode, warnings, context, warningNodes))
      .join(", ")}]`;
  }

  // Template literal:  `scrum://template/${ItemType}`  →  abbreviated
  if (ts.isTemplateLiteralTypeNode(typeNode)) {
    return "string";
  }

  // Fallback: emit raw source text (may contain newlines — collapse and sanitize)
  return sanitizeForMermaid(typeNode.getText().replace(/\s+/g, " ").trim());
}

// ── Type reference collector ──────────────────────────────────────────────────
//
// Walks a TypeNode recursively and returns all TypeReferenceNode names found.
// Used to decide which association arrows to emit.

function collectTypeRefs(typeNode: ts.TypeNode): string[] {
  const refs: string[] = [];

  const walk = (n: ts.TypeNode): void => {
    if (ts.isTypeReferenceNode(n)) {
      refs.push(n.typeName.getText());
      n.typeArguments?.forEach(walk);
    } else if (ts.isUnionTypeNode(n) || ts.isIntersectionTypeNode(n)) {
      n.types.forEach(walk);
    } else if (ts.isArrayTypeNode(n)) {
      walk(n.elementType);
    } else if (ts.isParenthesizedTypeNode(n)) {
      walk(n.type);
    } else if (ts.isTypeLiteralNode(n)) {
      n.members.forEach((m) => {
        if (ts.isPropertySignature(m) && m.type) walk(m.type);
      });
    }
  };

  walk(typeNode);
  return refs;
}

// ── Utilities ─────────────────────────────────────────────────────────────────

/**
 * Replace characters that Mermaid cannot represent inside a class body.
 * Mermaid has no escape sequence for curly braces — they are syntax tokens
 * used to delimit the class body itself.  Square brackets are safe and
 * visually convey "object shape" well enough for diagram purposes.
 */
function sanitizeForMermaid(text: string): string {
  return text.replace(/\{/g, "[").replace(/\}/g, "]");
}

function getNodeText(node: ts.Node): string {
  // PropertyName can be Identifier, StringLiteral, NumericLiteral, ComputedPropertyName
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isStringLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return node.text;
  return node.getText().trim();
}
