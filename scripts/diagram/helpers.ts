// =============================================================================
// scripts/diagram/helpers.ts - Shared diagram utilities
//
//   - Import-path resolution (resolveImport)
//   - Unused-export detection (findUnusedExports)
//   - Type-node formatting helpers (formatTypeNode, collectTypeRefs, etc.)
// =============================================================================

import * as ts from "typescript";
import { UnusedExport } from "./types.ts";
import { ParsedModule } from "./ParsedModule.ts";

/**
 * Resolve a relative import path to a module path (relative to src/).
 *
 * Examples:
 *   resolveImport("tools/scrum-read.ts", "./mappers")       → "tools/mappers.ts"
 *   resolveImport("tools/scrum-read.ts", "../types")        → "types.ts"
 *   resolveImport("tools/scrum-read.ts", "./github")        → "github/server.ts"
 */
export const resolveImport = (
  fromPath: string,
  importPath: string,
): string | null => {
  // don't resolve external imports
  if (!importPath.startsWith(".")) return importPath;

  const dir = fromPath.split("/").slice(0, -1);
  const segs = importPath.split("/");
  const result: string[] = [];
  let i = 0;

  // Count leading ../
  while (i < segs.length && segs[i] === "..") {
    dir.pop();
    i++;
  }
  // Skip single .
  if (i < segs.length && segs[i] === ".") i++;
  // Remaining segments
  while (i < segs.length) {
    result.push(segs[i]);
    i++;
  }

  const candidate = [...dir, ...result].join("/");
  if (candidate.endsWith(".ts")) return candidate;
  return `${candidate}/server.ts`;
};

/**
 * Identifies exports within the provided modules that are not referenced by any imports in those modules.
 */
export const findUnusedExports = (modules: ParsedModule[]): UnusedExport[] => {
  const moduleMap = new Map<string, ParsedModule>();
  const usedNamesByModule = new Map<string, Set<string>>();

  // Initialize maps
  for (const mod of modules) {
    moduleMap.set(mod.filePathName, mod);
    usedNamesByModule.set(mod.filePathName, new Set());
  }

  // Track usage
  for (const mod of modules) {
    for (const imp of mod.getImports()) {
      const resolved = resolveImport(mod.filePathName, imp.path);
      if (!resolved || !moduleMap.has(resolved)) continue;

      const targetMod = moduleMap.get(resolved)!;
      const usedSet = usedNamesByModule.get(resolved)!;

      if (imp.kind === "named" || imp.kind === "type") {
        // For named/type imports, the 'name' property is the exported name in the target module
        usedSet.add(imp.name);
      } else if (imp.kind === "namespace") {
        // Namespace import (* as Foo) implies all exports are potentially used
        for (const exp of targetMod.getExports()) {
          usedSet.add(exp.name);
        }
      } else if (imp.kind === "default") {
        // Best effort for default imports: use the local name as a fallback
        usedSet.add(imp.name);
      }
    }
  }

  const unreferencedExports: UnusedExport[] = [];

  // Identify unused
  for (const mod of modules) {
    const usedSet = usedNamesByModule.get(mod.filePathName)!;
    for (const exp of mod.getExports()) {
      if (!usedSet.has(exp.name)) {
        unreferencedExports.push({
          ...exp,
          modulePathName: mod.filePathName,
        });
      }
    }
  }

  return unreferencedExports;
};

// ── Shared type-node helpers (used by DomainTypeExtractor + LayerTypeExtractor) ──

/**
 * Render a TypeScript type node as a Mermaid-compatible display string.
 *
 * Handles: type references (with generics), primitives, arrays, unions,
 * intersections, literals, parenthesized types, inline object types,
 * tuples, template literals, and fallback raw text.
 */
export const formatTypeNode = (
  typeNode: ts.TypeNode,
  warnings: string[],
  context = "<unknown>",
  warningNodes = new Set<string>(),
): string => {
  if (ts.isTypeReferenceNode(typeNode)) {
    const name = typeNode.typeName.getText();
    if (typeNode.typeArguments?.length) {
      const args = typeNode.typeArguments
        .map((a) => formatTypeNode(a, warnings, context, warningNodes))
        .join(",");
      return `${name}~${args}~`;
    }
    return name;
  }

  switch (typeNode.kind) {
    case ts.SyntaxKind.StringKeyword:
      return "string";
    case ts.SyntaxKind.NumberKeyword:
      return "number";
    case ts.SyntaxKind.BooleanKeyword:
      return "boolean";
    case ts.SyntaxKind.NullKeyword:
      return "null";
    case ts.SyntaxKind.UndefinedKeyword:
      return "undefined";
    case ts.SyntaxKind.UnknownKeyword:
      return "unknown";
    case ts.SyntaxKind.VoidKeyword:
      return "void";
    case ts.SyntaxKind.AnyKeyword:
      return "any";
  }

  if (ts.isArrayTypeNode(typeNode)) {
    return `${formatTypeNode(typeNode.elementType, warnings, context, warningNodes)}[]`;
  }

  if (ts.isUnionTypeNode(typeNode)) {
    return typeNode.types
      .map((t) => formatTypeNode(t, warnings, context, warningNodes))
      .join(" or ");
  }

  if (ts.isIntersectionTypeNode(typeNode)) {
    return typeNode.types
      .map((t) => formatTypeNode(t, warnings, context, warningNodes))
      .join(" and ");
  }

  if (ts.isLiteralTypeNode(typeNode)) {
    const lit = typeNode.literal;
    if (ts.isStringLiteral(lit)) return lit.text;
    if (ts.isNumericLiteral(lit)) return lit.text;
    if (lit.kind === ts.SyntaxKind.NullKeyword) return "null";
    if (lit.kind === ts.SyntaxKind.TrueKeyword) return "true";
    if (lit.kind === ts.SyntaxKind.FalseKeyword) return "false";
  }

  if (ts.isParenthesizedTypeNode(typeNode)) {
    return `(${formatTypeNode(typeNode.type, warnings, context, warningNodes)})`;
  }

  if (ts.isTypeLiteralNode(typeNode)) {
    const raw = typeNode.getText().replace(/\s+/g, " ").trim();
    warningNodes.add(context.split(".")[0]);
    warnings.push(
      `[clean-code] Inline anonymous object type at "${context}": ${raw}\n` +
        `  → Extract to a named type so it can be referenced, documented, and reused.`,
    );
    const props = typeNode.members
      .filter(ts.isPropertySignature)
      .map((m) => {
        const mName = getNodeText(m.name);
        const mType = m.type
          ? formatTypeNode(m.type, warnings, `${context}.${mName}`, warningNodes)
          : "unknown";
        return `${mName}: ${mType}`;
      });
    return `[ ${props.join(", ")} ]`;
  }

  if (ts.isTupleTypeNode(typeNode)) {
    return `[${
      typeNode.elements
        .map((e) => formatTypeNode(e as ts.TypeNode, warnings, context, warningNodes))
        .join(", ")
    }]`;
  }

  if (ts.isTemplateLiteralTypeNode(typeNode)) {
    return "string";
  }

  return sanitizeForMermaid(typeNode.getText().replace(/\s+/g, " ").trim());
};

/**
 * Walk a type node recursively and collect all named type references.
 *
 * Handles: type references, unions, intersections, arrays, parenthesized types,
 * and inline type literals.
 */
export const collectTypeRefs = (typeNode: ts.TypeNode): string[] => {
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
};

/**
 * Replace Mermaid-incompatible characters in a text string.
 * Substitutes `{` → `[` and `}` → `]`.
 */
export const sanitizeForMermaid = (text: string): string => {
  return text.replace(/\{/g, "[").replace(/\}/g, "]");
};

/**
 * Extract a readable text name from a TS AST node.
 * Handles identifiers, string literals, numeric literals, and fallback raw text.
 */
export const getNodeText = (node: ts.Node): string => {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isStringLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return node.text;
  return node.getText().trim();
};
