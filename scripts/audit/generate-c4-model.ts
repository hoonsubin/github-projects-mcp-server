// =============================================================================
// scripts/audit/generate-c4-model.ts — TypeScript AST parser for C4 diagrams
//
// Extracts four C4 levels for read and write tool surfaces by tracing:
//   1. server.registerTool(name, meta, () => handler()) → tool name, call shape,
//      and handler mapping parsed together in one AST pass
//   2. Handler file imports (via ParsedModule) + body analysis → handler → use-case
//   3. ProjectReader / ProjectWriter sub-interfaces → port method inventory
//   4. src/adapters/*/backend.ts classes extending AbstractProjectBackend → backends
//
// Only elements that participate in at least one relationship are emitted.
// =============================================================================

import * as ts from "typescript";
import { ParsedModule } from "../diagram/ParsedModule.ts";
import type {
  C4DiagramResult,
  C4DiagramSlice,
  C4Element,
  C4Relationship,
  C4SliceLevel,
} from "./types.ts";

// ── Source file constants ──────────────────────────────────────────────────────

const REGISTRY: Record<"read" | "write", string> = {
  read: "src/tools/scrum-read.ts",
  write: "src/tools/scrum-write.ts",
};

const HANDLER_FILE: Record<"read" | "write", string> = {
  read: "src/tools/handlers/read.ts",
  write: "src/tools/handlers/write.ts",
};

const PORTS_FILE = "src/scrum/ports.ts";
// ProjectReader extends 7 sub-port interfaces; list them explicitly.
const PORT_INTERFACES: Record<"read" | "write", string[]> = {
  read: [
    "ProjectReader",
    "EpicPort",
    "StoryPort",
    "FindItemsPort",
    "AnalyticsPort",
    "BoardHealthPort",
    "ImpedimentPort",
    "FileReaderPort",
  ],
  write: ["ProjectWriter"],
};

// ── Intermediate data structures ───────────────────────────────────────────────

/** One MCP tool registration with its call-shape annotations. */
interface ToolMeta {
  toolName: string; // e.g. "scrum_orient"
  handlerFn: string; // e.g. "handleOrient"
  readOnly: boolean; // readOnlyHint annotation
  destructive: boolean; // destructiveHint annotation
  idempotent: boolean; // idempotentHint annotation
}

/** A handler function that delegates to a use-case function. */
interface UseCaseCall {
  handlerFn: string; // e.g. "handleOrient"
  useCaseFn: string; // e.g. "orientUseCase"
  sourceFile: string; // e.g. "../../scrum/orient.ts"
}

/** A discovered backend adapter implementation. */
interface BackendInfo {
  className: string; // e.g. "GitHubProjectBackend"
  filePath: string; // e.g. "src/adapters/github/backend.ts"
  adapterName: string; // e.g. "github"
}

// ── Public API ─────────────────────────────────────────────────────────────────

export const generateC4Diagram = async (srcDir: string): Promise<C4DiagramResult> => {
  const root = resolveRoot(srcDir);
  // Discover backends once — shared across both slices.
  const backends = await discoverBackends(root);
  const readSlice = await buildSlice("read", root, backends);
  const writeSlice = await buildSlice("write", root, backends);
  return { readTools: readSlice, writeTools: writeSlice };
};

// ── Slice builder ──────────────────────────────────────────────────────────────

const buildSlice = async (
  category: "read" | "write",
  root: string,
  backends: BackendInfo[],
): Promise<C4DiagramSlice> => {
  const registryFile = `${root}/${REGISTRY[category]}`;
  const handlerFile = `${root}/${HANDLER_FILE[category]}`;
  const portsFile = `${root}/${PORTS_FILE}`;

  const toolMetas = await extractToolMeta(registryFile);
  const useCaseCalls = await extractHandlerUseCaseCalls(handlerFile);
  const portMethods = await extractInterfaceMethods(portsFile, ...PORT_INTERFACES[category]);

  return {
    context: filterOrphans(buildContextLevel(toolMetas, backends)),
    container: filterOrphans(buildContainerLevel(category, toolMetas, useCaseCalls, backends)),
    component: filterOrphans(buildComponentLevel(toolMetas, useCaseCalls)),
    code: filterOrphans(buildCodeLevel(portMethods, backends)),
  };
};

// ── Context level ──────────────────────────────────────────────────────────────
// Shows every individual tool surface with its call shape (read-only/mutating/idempotent)
// and wires it to each discovered backend system.

const buildContextLevel = (
  toolMetas: ToolMeta[],
  backends: BackendInfo[],
): C4SliceLevel => {
  const elements: C4Element[] = [];
  const relationships: C4Relationship[] = [];

  elements.push({
    id: "agent",
    name: "AI Agent",
    type: "person",
    technology: "LLM",
    description: "External agent invoking MCP tools",
    layer: "context",
  });

  // One System element per tool, annotated with its call shape.
  for (const meta of toolMetas) {
    const toolId = sanitizeId(meta.toolName);
    elements.push({
      id: toolId,
      name: meta.toolName,
      type: "system",
      technology: `MCP — ${callShape(meta)}`,
      layer: "context",
    });
    relationships.push({
      from: "agent",
      to: toolId,
      label: "calls",
      technology: "MCP",
      direction: "forward",
    });
  }

  // One System_Ext per discovered backend; every tool connects to every backend.
  for (const backend of backends) {
    const backendId = sanitizeId(`backend_${backend.adapterName}`);
    elements.push({
      id: backendId,
      name: `${capitalize(backend.adapterName)} API`,
      type: "external_api",
      technology: "API",
      description: backend.filePath,
      layer: "context",
    });
    for (const meta of toolMetas) {
      relationships.push({
        from: sanitizeId(meta.toolName),
        to: backendId,
        label: meta.readOnly ? "queries" : "queries + mutates",
        technology: `${capitalize(backend.adapterName)} API`,
        direction: "forward",
      });
    }
  }

  return { elements, relationships };
};

// ── Container level ────────────────────────────────────────────────────────────
// Shows: MCP Server → tools → handlers → use-cases (if any) → Port ← Adapter(s)

const buildContainerLevel = (
  category: "read" | "write",
  toolMetas: ToolMeta[],
  useCaseCalls: UseCaseCall[],
  backends: BackendInfo[],
): C4SliceLevel => {
  const elements: C4Element[] = [];
  const relationships: C4Relationship[] = [];

  const systemId = category === "read" ? "mcp_server_read" : "mcp_server_write";
  elements.push({
    id: systemId,
    name: category === "read" ? "MCP Server (Read)" : "MCP Server (Write)",
    type: "container",
    technology: "TypeScript, MCP SDK",
    layer: "container",
  });

  const handlerToUseCase = new Map(useCaseCalls.map((c) => [c.handlerFn, c]));
  const seenUseCases = new Set<string>();

  for (const meta of toolMetas) {
    const toolId = sanitizeId(meta.toolName);
    const uc = handlerToUseCase.get(meta.handlerFn);

    elements.push({
      id: toolId,
      name: meta.toolName,
      type: "container",
      technology: `MCP Tool — ${callShape(meta)}`,
      toolName: meta.toolName,
      layer: "container",
    });
    relationships.push({ from: systemId, to: toolId, label: "exposes", direction: "forward" });

    const handlerId = sanitizeId(meta.handlerFn);
    elements.push({
      id: handlerId,
      name: meta.handlerFn,
      type: "container",
      technology: "TypeScript",
      layer: "container",
    });
    relationships.push({ from: toolId, to: handlerId, label: "delegates to", direction: "forward" });

    if (uc) {
      const ucId = sanitizeId(uc.useCaseFn);
      if (!seenUseCases.has(ucId)) {
        elements.push({
          id: ucId,
          name: uc.useCaseFn,
          type: "container",
          technology: "TypeScript",
          layer: "container",
        });
        seenUseCases.add(ucId);
        relationships.push({
          from: ucId,
          to: "project_backend_port",
          label: "calls via port",
          direction: "forward",
        });
      }
      relationships.push({ from: handlerId, to: ucId, label: "calls", direction: "forward" });
    } else {
      relationships.push({
        from: handlerId,
        to: "project_backend_port",
        label: "calls backend directly",
        direction: "forward",
      });
    }
  }

  elements.push({
    id: "project_backend_port",
    name: "ProjectBackend Port",
    type: "container",
    technology: "TypeScript Interface",
    layer: "container",
  });

  for (const backend of backends) {
    const adapterId = sanitizeId(`adapter_${backend.adapterName}`);
    elements.push({
      id: adapterId,
      name: backend.className,
      type: "container",
      technology: `TypeScript — ${backend.adapterName}`,
      description: backend.filePath,
      layer: "container",
    });
    relationships.push({
      from: adapterId,
      to: "project_backend_port",
      label: "implements",
      direction: "forward",
    });
  }

  return { elements, relationships };
};

// ── Component level ────────────────────────────────────────────────────────────
// Shows function-level detail: handler fns → use-case fns → port interface

const buildComponentLevel = (
  toolMetas: ToolMeta[],
  useCaseCalls: UseCaseCall[],
): C4SliceLevel => {
  const elements: C4Element[] = [];
  const relationships: C4Relationship[] = [];

  const handlerToUseCase = new Map(useCaseCalls.map((c) => [c.handlerFn, c]));
  const seenHandlers = new Set<string>();
  const seenUseCases = new Set<string>();

  elements.push({
    id: "port_interface",
    name: "ProjectBackend",
    type: "interface",
    technology: "TypeScript Interface",
    layer: "component",
  });

  for (const meta of toolMetas) {
    if (seenHandlers.has(meta.handlerFn)) continue;
    seenHandlers.add(meta.handlerFn);

    const handlerId = sanitizeId(meta.handlerFn);
    elements.push({
      id: handlerId,
      name: `${meta.handlerFn}()`,
      type: "function",
      technology: "TypeScript",
      layer: "component",
    });

    const uc = handlerToUseCase.get(meta.handlerFn);
    if (uc) {
      const ucId = sanitizeId(uc.useCaseFn);
      if (!seenUseCases.has(ucId)) {
        elements.push({
          id: ucId,
          name: `${uc.useCaseFn}()`,
          type: "function",
          technology: "TypeScript",
          layer: "component",
        });
        seenUseCases.add(ucId);
        relationships.push({
          from: ucId,
          to: "port_interface",
          label: "calls via port",
          direction: "forward",
        });
      }
      relationships.push({ from: handlerId, to: ucId, label: "calls", direction: "forward" });
    } else {
      relationships.push({
        from: handlerId,
        to: "port_interface",
        label: "calls directly",
        direction: "forward",
      });
    }
  }

  return { elements, relationships };
};

// ── Code level ─────────────────────────────────────────────────────────────────
// Shows port interface methods and each discovered backend that implements them

const buildCodeLevel = (portMethods: string[], backends: BackendInfo[]): C4SliceLevel => {
  const elements: C4Element[] = [];
  const relationships: C4Relationship[] = [];

  elements.push({
    id: "project_backend_iface",
    name: "ProjectBackend",
    type: "interface",
    technology: "TypeScript",
    layer: "code",
  });

  for (const method of portMethods) {
    const methodId = sanitizeId(`port_${method}`);
    elements.push({
      id: methodId,
      name: `${method}()`,
      type: "function",
      technology: "TypeScript",
      layer: "code",
    });
    relationships.push({
      from: "project_backend_iface",
      to: methodId,
      label: "declares",
      direction: "forward",
    });
  }

  for (const backend of backends) {
    const adapterId = sanitizeId(`impl_${backend.adapterName}`);
    elements.push({
      id: adapterId,
      name: backend.className,
      type: "class",
      technology: "TypeScript",
      description: backend.filePath,
      layer: "code",
    });
    if (portMethods.length > 0) {
      relationships.push({
        from: adapterId,
        to: "project_backend_iface",
        label: "implements",
        direction: "forward",
      });
    }
  }

  return { elements, relationships };
};

// ── AST: tool metadata + call-shape extraction ─────────────────────────────────
// Parses each server.registerTool(name, { annotations }, () => handler()) call
// to extract the tool name, readOnly/destructive/idempotent hints, and handler.

const extractToolMeta = async (filePath: string): Promise<ToolMeta[]> => {
  const sf = await parseFile(filePath);
  if (!sf) return [];

  const metas: ToolMeta[] = [];

  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "registerTool" &&
      node.arguments.length >= 3
    ) {
      const [toolNameNode, metaNode, callbackNode] = node.arguments;
      if (!ts.isStringLiteral(toolNameNode) || !ts.isArrowFunction(callbackNode)) {
        ts.forEachChild(node, visit);
        return;
      }

      const toolName = toolNameNode.text;
      const handlerFn = findFirstIdentifierCall(callbackNode.body) ?? "";

      let readOnly = false;
      let destructive = false;
      let idempotent = false;

      if (ts.isObjectLiteralExpression(metaNode)) {
        const annotationsProp = metaNode.properties.find(
          (p): p is ts.PropertyAssignment =>
            ts.isPropertyAssignment(p) &&
            ts.isIdentifier(p.name) &&
            p.name.text === "annotations",
        );
        if (annotationsProp && ts.isObjectLiteralExpression(annotationsProp.initializer)) {
          readOnly = getBoolProp(annotationsProp.initializer, "readOnlyHint") ?? false;
          destructive = getBoolProp(annotationsProp.initializer, "destructiveHint") ?? false;
          idempotent = getBoolProp(annotationsProp.initializer, "idempotentHint") ?? false;
        }
      }

      if (toolName && handlerFn) {
        metas.push({ toolName, handlerFn, readOnly, destructive, idempotent });
      }
    }
    ts.forEachChild(node, visit);
  };

  ts.forEachChild(sf, visit);
  return metas;
};

const getBoolProp = (obj: ts.ObjectLiteralExpression, name: string): boolean | undefined => {
  for (const prop of obj.properties) {
    if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name) && prop.name.text === name) {
      if (prop.initializer.kind === ts.SyntaxKind.TrueKeyword) return true;
      if (prop.initializer.kind === ts.SyntaxKind.FalseKeyword) return false;
    }
  }
  return undefined;
};

/** Walk a node tree to find the first bare identifier call, e.g. handleOrient(...). */
const findFirstIdentifierCall = (node: ts.Node): string | null => {
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
    return node.expression.text;
  }
  if (ts.isAwaitExpression(node)) return findFirstIdentifierCall(node.expression);
  let found: string | null = null;
  ts.forEachChild(node, (child) => {
    if (!found) found = findFirstIdentifierCall(child);
  });
  return found;
};

// ── AST: handler → use-case call extraction ────────────────────────────────────

const extractHandlerUseCaseCalls = async (filePath: string): Promise<UseCaseCall[]> => {
  const source = await Deno.readTextFile(filePath).catch(() => null);
  if (!source) return [];

  // Reuse ParsedModule for the import walk.
  const mod = new ParsedModule(filePath, source, false);
  const useCaseImports = new Map<string, string>(); // localName → sourcePath
  for (const imp of mod.getImports()) {
    if (imp.path.includes("/scrum/")) {
      useCaseImports.set(imp.name, imp.path);
    }
  }

  const sf = mod.getModuleSource();
  const calls: UseCaseCall[] = [];

  const visitStatement = (node: ts.Node): void => {
    if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.name.text.startsWith("handle")) {
          const handlerFn = decl.name.text;
          const uc = findFirstUseCaseCall(decl.initializer, useCaseImports);
          if (uc) {
            calls.push({ handlerFn, useCaseFn: uc.localName, sourceFile: uc.sourcePath });
          }
        }
      }
    }
    ts.forEachChild(node, visitStatement);
  };

  ts.forEachChild(sf, visitStatement);
  return calls;
};

const findFirstUseCaseCall = (
  node: ts.Node | undefined,
  useCaseImports: Map<string, string>,
): { localName: string; sourcePath: string } | null => {
  if (!node) return null;
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
    const path = useCaseImports.get(node.expression.text);
    if (path) return { localName: node.expression.text, sourcePath: path };
  }
  let found: { localName: string; sourcePath: string } | null = null;
  ts.forEachChild(node, (child) => {
    if (!found) found = findFirstUseCaseCall(child, useCaseImports);
  });
  return found;
};

// ── AST: port interface method extraction ─────────────────────────────────────

const extractInterfaceMethods = async (
  filePath: string,
  ...interfaceNames: string[]
): Promise<string[]> => {
  const sf = await parseFile(filePath);
  if (!sf) return [];

  const methods: string[] = [];
  const nameSet = new Set(interfaceNames);

  const visit = (node: ts.Node): void => {
    if (ts.isInterfaceDeclaration(node) && nameSet.has(node.name.text)) {
      for (const member of node.members) {
        if (ts.isMethodSignature(member) && ts.isIdentifier(member.name)) {
          methods.push(member.name.text);
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  ts.forEachChild(sf, visit);
  return methods;
};

// ── Backend discovery ──────────────────────────────────────────────────────────
// Scans src/adapters/*/backend.ts for classes that extend AbstractProjectBackend.
// New adapters are picked up automatically without changing this file.

const discoverBackends = async (root: string): Promise<BackendInfo[]> => {
  const adaptersDir = `${root}/src/adapters`;
  const backends: BackendInfo[] = [];

  try {
    for await (const entry of Deno.readDir(adaptersDir)) {
      if (!entry.isDirectory) continue;
      const backendFile = `${adaptersDir}/${entry.name}/backend.ts`;
      const className = await extractBackendClassName(backendFile);
      if (className) {
        backends.push({
          className,
          filePath: `src/adapters/${entry.name}/backend.ts`,
          adapterName: entry.name,
        });
      }
    }
  } catch {
    // adapters directory missing or unreadable — return empty
  }

  return backends;
};

/** Return the name of the class that extends AbstractProjectBackend, or null. */
const extractBackendClassName = async (filePath: string): Promise<string | null> => {
  const sf = await parseFile(filePath);
  if (!sf) return null;

  let found: string | null = null;
  ts.forEachChild(sf, (node) => {
    if (found || !ts.isClassDeclaration(node) || !node.heritageClauses) return;
    for (const clause of node.heritageClauses) {
      if (clause.token !== ts.SyntaxKind.ExtendsKeyword) continue;
      for (const type of clause.types) {
        if (
          ts.isExpressionWithTypeArguments(type) &&
          ts.isIdentifier(type.expression) &&
          type.expression.text === "AbstractProjectBackend"
        ) {
          found = node.name?.text ?? null;
        }
      }
    }
  });

  return found;
};

// ── Post-processing ────────────────────────────────────────────────────────────

const filterOrphans = (level: C4SliceLevel): C4SliceLevel => {
  const referenced = new Set<string>();
  for (const rel of level.relationships) {
    referenced.add(rel.from);
    referenced.add(rel.to);
  }
  return {
    elements: level.elements.filter((e) => referenced.has(e.id)),
    relationships: level.relationships,
  };
};

// ── Utilities ──────────────────────────────────────────────────────────────────

const parseFile = async (filePath: string): Promise<ts.SourceFile | null> => {
  try {
    const source = await Deno.readTextFile(filePath);
    return ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);
  } catch {
    return null;
  }
};

const resolveRoot = (srcDir: string): string =>
  srcDir.replace(/\/src$/, "").replace(/\\src$/, "") || ".";

const callShape = (meta: ToolMeta): string => {
  if (meta.readOnly) return meta.idempotent ? "read-only, idempotent" : "read-only";
  return meta.destructive ? "mutating" : "read-write";
};

const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

const sanitizeId = (id: string): string =>
  id
    .replace(/[/\\]/g, "_")
    .replace(/\./g, "_")
    .replace(/-/g, "_")
    .replace(/[()]/g, "");
