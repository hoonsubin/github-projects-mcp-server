// =============================================================================
// scripts/diagram/LayerTypeExtractor.ts
//
// Extracts class/relationship info from use-case and adapter layer source files.
// Handles: class (abstract + concrete), interface, type alias, enum, const tuple.
//
// Adds class support (extends, implements, constructors, methods, properties) on
// top of the existing DomainTypeExtractor constructs.
//
// Uses shared TypeNodeHelpers from helpers.ts for type-node formatting.
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
 * Parse a TypeScript source file (use-case or adapter layer) and return all
 * classes, interfaces, types, and enums as ExtractedClass objects, plus the
 * relationships between them.
 *
 * Handles class declarations (constructor, methods, properties, extends,
 * implements) in addition to all constructs from extractDomainTypes().
 */
export const extractLayerTypes = (
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

    if (ts.isClassDeclaration(node)) {
      const { cls, rels } = extractClass(
        node,
        namespace,
        filePath,
        knownNames,
        warnings,
        warningNodes,
      );
      if (cls) {
        classes.push(cls);
        relationships.push(...rels);
      }
    } else if (ts.isInterfaceDeclaration(node)) {
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

const isExported = (node: ts.Node): boolean => {
  const mods = (node as { modifiers?: ts.NodeArray<ts.Modifier> }).modifiers;
  return mods?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
};

const isAbstract = (node: ts.ClassDeclaration): boolean => {
  const mods = node.modifiers;
  return mods?.some((m) => m.kind === ts.SyntaxKind.AbstractKeyword) ?? false;
};

// ── Class extraction ──────────────────────────────────────────────────────────

const extractClass = (
  node: ts.ClassDeclaration,
  namespace: NamespaceName,
  sourceFile: string,
  known: Set<string>,
  warnings: string[],
  warningNodes: Set<string>,
): { cls: ExtractedClass | null; rels: ExtractedRelationship[] } => {
  if (!node.name) return { cls: null, rels: [] };

  const name = node.name.text;
  const members: string[] = [];
  const rels: ExtractedRelationship[] = [];
  const abstract = isAbstract(node);

  // ── heritage clauses: extends + implements ─────────────────────────────
  for (const clause of node.heritageClauses ?? []) {
    const isExtends = clause.token === ts.SyntaxKind.ExtendsKeyword;
    const isImplements = clause.token === ts.SyntaxKind.ImplementsKeyword;

    for (const type of clause.types) {
      const targetName = type.expression.getText();
      if (!known.has(targetName)) continue;

      if (isExtends) {
        rels.push({ from: name, to: targetName, arrow: "--|>", label: "extends" });
      } else if (isImplements) {
        rels.push({ from: name, to: targetName, arrow: "..|>", label: "implements" });
      }
    }
  }

  // ── Member extraction ─────────────────────────────────────────────────
  for (const member of node.members) {
    if (ts.isConstructorDeclaration(member)) {
      // Render as: +constructor(param1: Type, param2: Type)
      const params = member.parameters
        .map((p) => formatParameter(p, warnings, `${name}.constructor`, warningNodes))
        .join(", ");
      members.push(`+constructor(${params})`);

      // Collect type refs from parameter types
      for (const p of member.parameters) {
        if (p.type) {
          for (const ref of collectTypeRefs(p.type)) {
            if (known.has(ref) && ref !== name) {
              rels.push({ from: name, to: ref, arrow: "-->", label: "constructor" });
            }
          }
        }
      }
    } else if (ts.isMethodDeclaration(member)) {
      if (!ts.isIdentifier(member.name)) continue;

      const methodName = member.name.text;
      const params = member.parameters
        .map((p) => formatParameter(p, warnings, `${name}.${methodName}`, warningNodes))
        .join(", ");

      if (member.type) {
        const returnType = formatTypeNode(
          member.type,
          warnings,
          `${name}.${methodName}`,
          warningNodes,
        );
        members.push(`+${methodName}(${params}) : ${returnType}`);

        // Collect type refs from return type
        for (const ref of collectTypeRefs(member.type)) {
          if (known.has(ref) && ref !== name) {
            rels.push({ from: name, to: ref, arrow: "-->", label: methodName });
          }
        }
      } else {
        members.push(`+${methodName}(${params})`);
      }

      // Collect type refs from parameter types
      for (const p of member.parameters) {
        if (p.type) {
          for (const ref of collectTypeRefs(p.type)) {
            if (known.has(ref) && ref !== name) {
              rels.push({ from: name, to: ref, arrow: "-->", label: methodName });
            }
          }
        }
      }
    } else if (ts.isPropertyDeclaration(member)) {
      const propName = getNodeText(member.name);
      const optional = member.questionToken ? " opt" : "";

      if (member.type) {
        const typeStr = formatTypeNode(
          member.type,
          warnings,
          `${name}.${propName}`,
          warningNodes,
        );
        members.push(`+${propName} : ${typeStr}${optional}`);

        for (const ref of collectTypeRefs(member.type)) {
          if (known.has(ref) && ref !== name) {
            rels.push({ from: name, to: ref, arrow: "-->", label: propName });
          }
        }
      } else {
        // Property without type annotation (has initializer)
        members.push(`+${propName}`);
      }
    }
  }

  return {
    cls: {
      name,
      stereotype: abstract ? "abstract" : "class",
      members,
      namespace,
      sourceFile,
    },
    rels,
  };
};

// ── Interface extraction ──────────────────────────────────────────────────────

const extractInterface = (
  node: ts.InterfaceDeclaration,
  namespace: NamespaceName,
  sourceFile: string,
  known: Set<string>,
  warnings: string[],
  warningNodes: Set<string>,
): { cls: ExtractedClass; rels: ExtractedRelationship[] } => {
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
};

// ── Type alias extraction ─────────────────────────────────────────────────────

const extractTypeAlias = (
  node: ts.TypeAliasDeclaration,
  namespace: NamespaceName,
  sourceFile: string,
  known: Set<string>,
  warnings: string[],
  warningNodes: Set<string>,
): { cls: ExtractedClass; rels: ExtractedRelationship[] } | null => {
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
      cls: { name, stereotype: "branded", members: [text], namespace, sourceFile },
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
};

// ── Enum extraction ───────────────────────────────────────────────────────────

const extractEnum = (
  node: ts.EnumDeclaration,
  namespace: NamespaceName,
  sourceFile: string,
): ExtractedClass => {
  const name = node.name.text;
  const members = node.members.map((m) => getNodeText(m.name));
  return { name, stereotype: "enumeration", members, namespace, sourceFile };
};

// ── Const tuple extraction ────────────────────────────────────────────────────

const extractConstTuple = (
  node: ts.VariableStatement,
  namespace: NamespaceName,
  sourceFile: string,
): ExtractedClass | null => {
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
};

// ── Parameter formatting ──────────────────────────────────────────────────────

/**
 * Format a single TS parameter node for display.
 *   `name: Type` for typed params, `name` for untyped, `name?` for optional.
 */
const formatParameter = (
  param: ts.ParameterDeclaration,
  warnings: string[],
  context: string,
  warningNodes: Set<string>,
): string => {
  const name = getNodeText(param.name);
  const optional = param.questionToken ? "?" : "";
  if (param.type) {
    const typeStr = formatTypeNode(param.type, warnings, context, warningNodes);
    return `${name}${optional}: ${typeStr}`;
  }
  return `${name}${optional}`;
};
