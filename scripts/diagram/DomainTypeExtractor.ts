// =============================================================================
// scripts/diagram/DomainTypeExtractor.ts
//
// Extracts class/relationship info from plain TypeScript source files.
// Handles: interface, type alias (union, branded, object), enum, const tuple.
//
// Uses the TypeScript Compiler API (ts.*) at the AST node level - no type
// checker required, so we don't need to build a full Program.
// =============================================================================

import * as ts from "typescript";
import type { ParsedModule } from "./ParsedModule.ts";
import type { ExtractedClass, ExtractedRelationship, NamespaceName } from "./types.ts";
import { collectTypeRefs, formatTypeNode, getNodeText, sanitizeForMermaid } from "./helpers.ts";

// ── Public API ────────────────────────────────────────────────────────────────

export interface DomainExtractorResult {
  classes: ExtractedClass[];
  relationships: ExtractedRelationship[];
  warnings: string[];
  warningNodes: Set<string>;
}

/**
 * Parse a TypeScript source file (already loaded as a ParsedModule) and return
 * all types it declares as ExtractedClass objects, plus the relationships between them.
 *
 * @param module    Already-parsed module instance (avoids duplicate ts.createSourceFile).
 * @param namespace Which Mermaid namespace to assign all extracted classes to.
 * @param knownNames Optional set of type names already collected from other
 *                   files - used to suppress relationship arrows to unknowns.
 */
export const extractDomainTypes = (
  module: ParsedModule,
  namespace: NamespaceName,
  knownNames: Set<string> = new Set(),
): DomainExtractorResult => {
  const sourceFile = module.getModuleSource();
  const filePath = module.filePathName;

  const classes: ExtractedClass[] = [];
  const relationships: ExtractedRelationship[] = [];
  const warnings: string[] = [];
  const warningNodes = new Set<string>();

  ts.forEachChild(sourceFile, (node) => {
    if (!isExported(node)) return;

    if (ts.isInterfaceDeclaration(node)) {
      const { cls, rels } = extractInterface(
        node,
        namespace,
        filePath,
        knownNames,
        warnings,
        warningNodes,
      );
      classes.push(cls);
      relationships.push(...rels);
    } else if (ts.isTypeAliasDeclaration(node)) {
      const result = extractTypeAlias(
        node,
        namespace,
        filePath,
        knownNames,
        warnings,
        warningNodes,
      );
      if (result) {
        classes.push(result.cls);
        relationships.push(...result.rels);
      }
    } else if (ts.isEnumDeclaration(node)) {
      classes.push(extractEnum(node, namespace, filePath));
    } else if (ts.isVariableStatement(node)) {
      const result = extractConstTuple(node, namespace, filePath);
      if (result) classes.push(result);
    }
  });

  return { classes, relationships, warnings, warningNodes };
};

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

  // Union type
  if (ts.isUnionTypeNode(node.type)) {
    const members = node.type.types.map((t) => formatTypeNode(t, warnings, name, warningNodes));

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

  // Branded string
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

  // Simple type reference alias
  if (ts.isTypeReferenceNode(node.type)) {
    const target = node.type.typeName.getText();
    if (known.has(target)) {
      rels.push({ from: name, to: target, arrow: "--|>", label: "same shape" });
    }
    return null;
  }

  // Template literal type → skip
  if (ts.isTemplateLiteralTypeNode(node.type)) {
    return null;
  }

  // Object type literal → treat as minimal class
  if (ts.isTypeLiteralNode(node.type)) {
    const members: string[] = [];
    for (const member of node.type.members) {
      if (ts.isPropertySignature(member) && member.type) {
        const mName = getNodeText(member.name);
        const optional = member.questionToken ? " opt" : "";
        members.push(
          `+${mName} : ${
            formatTypeNode(member.type, warnings, `${name}.${mName}`, warningNodes)
          }${optional}`,
        );
      }
    }
    return {
      cls: { name, stereotype: null, members, namespace, sourceFile },
      rels,
    };
  }

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

function extractConstTuple(
  node: ts.VariableStatement,
  namespace: NamespaceName,
  sourceFile: string,
): ExtractedClass | null {
  for (const decl of node.declarationList.declarations) {
    const name = decl.name.getText();
    const init = decl.initializer;

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
