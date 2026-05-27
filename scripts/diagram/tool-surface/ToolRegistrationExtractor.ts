// =============================================================================
// scripts/diagram/tool-surface/ToolRegistrationExtractor.ts
//
// Extracts tool registrations from src/tools/scrum-*.ts files.
//
// Looks for: server.registerTool("tool-name", { annotations: { readOnlyHint } }, handler)
//
// From each call it extracts:
//   - tool name (first string argument)
//   - stereotype (ReadTool / WriteTool / LegacyTool) from readOnlyHint
//   - inputSchema reference (to emit the "accepts" dependency arrow)
//
// The response type is NOT extracted automatically because it requires
// following the use-case layer. Callers can supply a manual responseMap.
// =============================================================================

import * as ts from "typescript";
import type { ExtractedClass, ExtractedRelationship, NamespaceName } from "./types.ts";

// ── Public API ────────────────────────────────────────────────────────────────

export interface ToolExtractorResult {
  classes: ExtractedClass[];
  relationships: ExtractedRelationship[];
}

/**
 * Parse a tool registration source file and return one ExtractedClass per
 * `server.registerTool(...)` call found.
 *
 * @param filePath    Absolute path (for labelling only).
 * @param source      Raw TypeScript source text.
 * @param namespace   Which Mermaid namespace to assign the classes to.
 * @param knownNames  All class names in the diagram — used to emit arrows.
 * @param schemaNameToClassName  Same map used in ZodSchemaExtractor — needed
 *                    to resolve inputSchema references to Mermaid class names.
 *                    e.g. `{ GetStorySchema: "GetItemDetailArgs" }`
 * @param responseMap Manual map from tool name to its Mermaid response class.
 *                    e.g. `{ scrum_orient: "OrientResponse" }`
 *                    The extractor cannot discover this automatically.
 */
export function extractToolRegistrations(
  filePath: string,
  source: string,
  namespace: NamespaceName,
  knownNames: Set<string> = new Set(),
  schemaNameToClassName: Record<string, string> = {},
  responseMap: Record<string, string[]> = {},
): ToolExtractorResult {
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);
  const classes: ExtractedClass[] = [];
  const relationships: ExtractedRelationship[] = [];

  // Walk the entire file looking for call expressions
  walkNode(sourceFile, (node) => {
    if (!ts.isCallExpression(node)) return;

    // Match: server.registerTool(...)  or  anyIdent.registerTool(...)
    const callee = node.expression;
    if (!ts.isPropertyAccessExpression(callee)) return;
    if (callee.name.text !== "registerTool") return;

    const args = node.arguments;
    if (args.length < 2) return;

    // First argument must be the tool name string literal
    const nameArg = args[0];
    if (!ts.isStringLiteral(nameArg)) return;
    const toolName = nameArg.text;

    // Second argument is the options object { title, description, inputSchema, annotations }
    const optionsArg = args[1];
    if (!ts.isObjectLiteralExpression(optionsArg)) return;

    // Determine ReadTool / WriteTool from annotations.readOnlyHint
    const stereotype = detectStereotype(toolName, optionsArg);

    // Extract inputSchema reference to emit "accepts" arrow
    const schemaRef = extractInputSchemaRef(optionsArg);

    classes.push({
      name: toolName,
      stereotype,
      members: [],   // tools are leaf nodes — no members needed in the diagram
      namespace,
      sourceFile: filePath,
    });

    // "accepts" arrow — tool → schema Args class
    if (schemaRef) {
      const argsClass = schemaNameToClassName[schemaRef] ?? schemaRef.replace(/Schema$/, "Args");
      if (knownNames.has(argsClass)) {
        relationships.push({ from: toolName, to: argsClass, arrow: "..>", label: "accepts" });
      }
    }

    // "returns" arrows — sourced from the manual responseMap
    for (const responseClass of responseMap[toolName] ?? []) {
      if (knownNames.has(responseClass)) {
        relationships.push({ from: toolName, to: responseClass, arrow: "..>", label: "returns" });
      }
    }
  });

  return { classes, relationships };
}

// ── Stereotype detection ──────────────────────────────────────────────────────
//
// Reads `annotations.readOnlyHint` from the options object.
// true  → ReadTool
// false → WriteTool
// absent → LegacyTool (e.g. scrum_graphql_query has no annotations block)

function detectStereotype(
  toolName: string,
  optionsObj: ts.ObjectLiteralExpression,
): string {
  const annotationsProp = findObjProp(optionsObj, "annotations");
  if (!annotationsProp || !ts.isObjectLiteralExpression(annotationsProp)) {
    return "LegacyTool";
  }

  const readOnlyProp = findObjProp(annotationsProp, "readOnlyHint");
  if (readOnlyProp === null) return "WriteTool";

  // readOnlyHint: true  → ReadTool
  if (
    ts.isExpression(readOnlyProp) &&
    readOnlyProp.kind === ts.SyntaxKind.TrueKeyword
  ) {
    return "ReadTool";
  }

  return "WriteTool";
}

// ── inputSchema reference extraction ─────────────────────────────────────────
//
// Finds the `inputSchema` property in the options object and returns the
// base identifier name (stripping `.shape` access if present).
//
// e.g.  inputSchema: GetStorySchema.shape  →  "GetStorySchema"
//       inputSchema: FindItemsSchema.shape  →  "FindItemsSchema"

function extractInputSchemaRef(optionsObj: ts.ObjectLiteralExpression): string | null {
  const inputSchemaProp = findObjProp(optionsObj, "inputSchema");
  if (!inputSchemaProp) return null;

  // inputSchema: SomeSchema.shape  →  PropertyAccessExpression
  if (
    ts.isPropertyAccessExpression(inputSchemaProp) &&
    ts.isIdentifier(inputSchemaProp.expression)
  ) {
    return inputSchemaProp.expression.text;  // "SomeSchema"
  }

  // inputSchema: SomeSchema  →  direct Identifier
  if (ts.isIdentifier(inputSchemaProp)) {
    return inputSchemaProp.text;
  }

  // inputSchema: z.object({...}).shape  →  too complex, skip
  return null;
}

// ── Utilities ─────────────────────────────────────────────────────────────────

/**
 * Find a named property inside an ObjectLiteralExpression and return its
 * initializer (the value expression), or null if not found.
 */
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

/** Depth-first walk of an AST node, calling visitor on every node. */
function walkNode(root: ts.Node, visitor: (node: ts.Node) => void): void {
  visitor(root);
  ts.forEachChild(root, (child) => walkNode(child, visitor));
}
