// =============================================================================
// scripts/diagram/ToolRegistrationExtractor.ts
//
// Extracts tool registrations from src/tools/scrum-*.ts files.
// Uses an already-parsed ParsedModule — no duplicate ts.createSourceFile().
// =============================================================================

import * as ts from "typescript";
import type { ParsedModule } from "./ParsedModule.ts";
import type { ExtractedClass, ExtractedRelationship, NamespaceName } from "./types.ts";

// ── Public API ────────────────────────────────────────────────────────────────

export interface ToolExtractorResult {
  classes: ExtractedClass[];
  relationships: ExtractedRelationship[];
}

/**
 * Parse a tool registration source file (already loaded as a ParsedModule) and
 * return one ExtractedClass per `server.registerTool(...)` call found.
 *
 * @param module    Already-parsed module instance.
 * @param namespace Which Mermaid namespace to assign the classes to.
 * @param knownNames  All class names in the diagram — used to emit arrows.
 * @param schemaNameToClassName  Same map used in ZodSchemaExtractor.
 * @param responseMap Manual map from tool name to its Mermaid response class.
 */
export const extractToolRegistrations = (
  module: ParsedModule,
  namespace: NamespaceName,
  knownNames: Set<string> = new Set(),
  schemaNameToClassName: Record<string, string> = {},
  responseMap: Record<string, string[]> = {},
): ToolExtractorResult => {
  const sourceFile = module.getModuleSource();
  const filePath = module.filePathName;
  const classes: ExtractedClass[] = [];
  const relationships: ExtractedRelationship[] = [];

  walkNode(sourceFile, (node) => {
    if (!ts.isCallExpression(node)) return;

    const callee = node.expression;
    if (!ts.isPropertyAccessExpression(callee)) return;
    if (callee.name.text !== "registerTool") return;

    const args = node.arguments;
    if (args.length < 2) return;

    const nameArg = args[0];
    if (!ts.isStringLiteral(nameArg)) return;
    const toolName = nameArg.text;

    const optionsArg = args[1];
    if (!ts.isObjectLiteralExpression(optionsArg)) return;

    const stereotype = detectStereotype(toolName, optionsArg);

    const schemaRef = extractInputSchemaRef(optionsArg);

    classes.push({
      name: toolName,
      stereotype,
      members: [],
      namespace,
      sourceFile: filePath,
    });

    // "accepts" arrow
    if (schemaRef) {
      const argsClass = schemaNameToClassName[schemaRef] ?? schemaRef.replace(/Schema$/, "Args");
      if (knownNames.has(argsClass)) {
        relationships.push({ from: toolName, to: argsClass, arrow: "..>", label: "accepts" });
      }
    }

    // "returns" arrows
    for (const responseClass of responseMap[toolName] ?? []) {
      if (knownNames.has(responseClass)) {
        relationships.push({ from: toolName, to: responseClass, arrow: "..>", label: "returns" });
      }
    }
  });

  return { classes, relationships };
};

// ── Stereotype detection ──────────────────────────────────────────────────────

function detectStereotype(
  _toolName: string,
  optionsObj: ts.ObjectLiteralExpression,
): string {
  const annotationsProp = findObjProp(optionsObj, "annotations");
  if (!annotationsProp || !ts.isObjectLiteralExpression(annotationsProp)) {
    return "LegacyTool";
  }

  const readOnlyProp = findObjProp(annotationsProp, "readOnlyHint");
  if (readOnlyProp === null) return "WriteTool";

  if (
    ts.isExpression(readOnlyProp) &&
    readOnlyProp.kind === ts.SyntaxKind.TrueKeyword
  ) {
    return "ReadTool";
  }

  return "WriteTool";
}

// ── inputSchema reference extraction ─────────────────────────────────────────

function extractInputSchemaRef(optionsObj: ts.ObjectLiteralExpression): string | null {
  const inputSchemaProp = findObjProp(optionsObj, "inputSchema");
  if (!inputSchemaProp) return null;

  if (
    ts.isPropertyAccessExpression(inputSchemaProp) &&
    ts.isIdentifier(inputSchemaProp.expression)
  ) {
    return inputSchemaProp.expression.text;
  }

  if (ts.isIdentifier(inputSchemaProp)) {
    return inputSchemaProp.text;
  }

  return null;
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function findObjProp(
  obj: ts.ObjectLiteralExpression,
  propName: string,
): ts.Expression | null {
  for (const prop of obj.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    const name = ts.isIdentifier(prop.name) ? prop.name.text : prop.name.getText();
    if (name === propName) return prop.initializer;
  }
  return null;
}

function walkNode(root: ts.Node, visitor: (node: ts.Node) => void): void {
  visitor(root);
  ts.forEachChild(root, (child) => walkNode(child, visitor));
}
