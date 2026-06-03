// =============================================================================
// scripts/audit/generate-c4-model.ts — TypeScript AST parser for C4 diagrams
//
// Extracts four C4 levels for read and write tool surfaces by tracing:
//   1. SCRUM_*_TOOL_NAMES arrays  → tool name list
//   2. server.registerTool(name, …, () => handler(…)) → tool → handler mapping
//   3. Handler file imports from "…/scrum/…" + call-site analysis → handler → use-case
//   4. ProjectReader / ProjectWriter interfaces → port method inventory
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
// ProjectReader extends 7 sub-port interfaces; list them explicitly rather than
// traversing the extends chain at runtime.
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
const ADAPTER_CLASS = "GitHubProjectBackend";
const ADAPTER_FILE = "src/adapters/github/backend.ts";

// ── Intermediate data structures ───────────────────────────────────────────────

interface ToolRegistration {
  toolName: string; // e.g. "scrum_orient"
  handlerFn: string; // e.g. "handleOrient"
}

interface UseCaseCall {
  handlerFn: string; // e.g. "handleOrient"
  useCaseFn: string; // e.g. "orientUseCase"
  sourceFile: string; // e.g. "../../scrum/orient.ts"
}

// ── Public API ─────────────────────────────────────────────────────────────────

export const generateC4Diagram = async (srcDir: string): Promise<C4DiagramResult> => {
  const root = resolveRoot(srcDir);
  const readSlice = await buildSlice("read", root);
  const writeSlice = await buildSlice("write", root);
  return { readTools: readSlice, writeTools: writeSlice };
};

// ── Slice builder ──────────────────────────────────────────────────────────────

const buildSlice = async (
  category: "read" | "write",
  root: string,
): Promise<C4DiagramSlice> => {
  const registryFile = `${root}/${REGISTRY[category]}`;
  const handlerFile = `${root}/${HANDLER_FILE[category]}`;
  const portsFile = `${root}/${PORTS_FILE}`;

  // Gather all facts
  const toolNames = await extractToolNames(registryFile);
  const registrations = await extractRegisterToolCalls(registryFile);
  const useCaseCalls = await extractHandlerUseCaseCalls(handlerFile);
  const portMethods = await extractInterfaceMethods(portsFile, ...PORT_INTERFACES[category]);

  return {
    context: filterOrphans(buildContextLevel(category)),
    container: filterOrphans(buildContainerLevel(category, toolNames, registrations, useCaseCalls)),
    component: filterOrphans(buildComponentLevel(category, registrations, useCaseCalls)),
    code: filterOrphans(buildCodeLevel(portMethods)),
  };
};

// ── Context level (static) ─────────────────────────────────────────────────────

const buildContextLevel = (category: "read" | "write"): C4SliceLevel => {
  const systemId = category === "read" ? "mcp_server_read" : "mcp_server_write";
  const elements: C4Element[] = [
    {
      id: "agent",
      name: "AI Agent",
      type: "person",
      technology: "LLM",
      description: "External agent calling MCP tools",
      layer: "context",
    },
    {
      id: systemId,
      name: category === "read" ? "MCP Server (Read Tools)" : "MCP Server (Write Tools)",
      type: "system",
      technology: "TypeScript, MCP SDK",
      layer: "context",
    },
    {
      id: "github_backend",
      name: "GitHub Projects API",
      type: "external_api",
      technology: "GraphQL API",
      description: "External GitHub Projects backend",
      layer: "context",
    },
  ];
  const relationships: C4Relationship[] = [
    { from: "agent", to: systemId, label: "calls tools", technology: "MCP", direction: "forward" },
    {
      from: systemId,
      to: "github_backend",
      label: category === "write" ? "GraphQL queries + mutations" : "GraphQL queries",
      technology: "GitHub GraphQL API",
      direction: "forward",
    },
  ];
  return { elements, relationships };
};

// ── Container level ────────────────────────────────────────────────────────────
// Shows: MCP Server → individual tools → handlers → use-cases (if any) → Port ← Adapter

const buildContainerLevel = (
  category: "read" | "write",
  toolNames: string[],
  registrations: ToolRegistration[],
  useCaseCalls: UseCaseCall[],
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

  // Build a lookup: handlerFn → useCaseFn (if it has a use-case layer)
  const handlerToUseCase = new Map(useCaseCalls.map((c) => [c.handlerFn, c]));

  // Emit a container for each tool, its handler, and (optionally) its use-case
  const seenUseCases = new Set<string>();
  for (const toolName of toolNames) {
    const toolId = sanitizeId(toolName);
    const reg = registrations.find((r) => r.toolName === toolName);
    const handlerFn = reg?.handlerFn;
    const uc = handlerFn ? handlerToUseCase.get(handlerFn) : undefined;

    // Tool container
    elements.push({
      id: toolId,
      name: toolName,
      type: "container",
      technology: "MCP Tool",
      toolName,
      layer: "container",
    });
    relationships.push({ from: systemId, to: toolId, label: "exposes", direction: "forward" });

    if (!handlerFn) continue;

    // Handler — rendered at container level so use "container" type
    const handlerId = sanitizeId(handlerFn);
    elements.push({
      id: handlerId,
      name: handlerFn,
      type: "container",
      technology: "TypeScript",
      layer: "container",
    });
    relationships.push({ from: toolId, to: handlerId, label: "delegates to", direction: "forward" });

    if (uc) {
      // Use-case container
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
      // Direct backend call — wire handler straight to port
      relationships.push({
        from: handlerId,
        to: "project_backend_port",
        label: "calls backend directly",
        direction: "forward",
      });
    }
  }

  // Port interface
  elements.push({
    id: "project_backend_port",
    name: "ProjectBackend Port",
    type: "container",
    technology: "TypeScript Interface",
    layer: "container",
  });

  // Adapter
  elements.push({
    id: "github_adapter",
    name: ADAPTER_CLASS,
    type: "container",
    technology: "TypeScript, GitHub GraphQL",
    description: ADAPTER_FILE,
    layer: "container",
  });
  relationships.push({
    from: "github_adapter",
    to: "project_backend_port",
    label: "implements",
    direction: "forward",
  });

  return { elements, relationships };
};

// ── Component level ────────────────────────────────────────────────────────────
// Shows function-level detail: handler fns → use-case fns → port interface

const buildComponentLevel = (
  _category: "read" | "write",
  registrations: ToolRegistration[],
  useCaseCalls: UseCaseCall[],
): C4SliceLevel => {
  const elements: C4Element[] = [];
  const relationships: C4Relationship[] = [];

  const handlerToUseCase = new Map(useCaseCalls.map((c) => [c.handlerFn, c]));
  const seenHandlers = new Set<string>();
  const seenUseCases = new Set<string>();

  // Port interface node
  elements.push({
    id: "port_interface",
    name: "ProjectBackend",
    type: "interface",
    technology: "TypeScript Interface",
    layer: "component",
  });

  for (const reg of registrations) {
    const { handlerFn } = reg;
    if (seenHandlers.has(handlerFn)) continue;
    seenHandlers.add(handlerFn);

    const handlerId = sanitizeId(handlerFn);
    elements.push({
      id: handlerId,
      name: `${handlerFn}()`,
      type: "function",
      technology: "TypeScript",
      layer: "component",
    });

    const uc = handlerToUseCase.get(handlerFn);
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
// Shows port interface methods and the adapter that implements them

const buildCodeLevel = (portMethods: string[]): C4SliceLevel => {
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

  elements.push({
    id: "github_adapter_impl",
    name: ADAPTER_CLASS,
    type: "class",
    technology: "TypeScript",
    layer: "code",
  });

  if (portMethods.length > 0) {
    relationships.push({
      from: "github_adapter_impl",
      to: "project_backend_iface",
      label: "implements",
      direction: "forward",
    });
  }

  return { elements, relationships };
};

// ── AST: tool name extraction ──────────────────────────────────────────────────

const extractToolNames = async (filePath: string): Promise<string[]> => {
  const sf = await parseFile(filePath);
  if (!sf) return [];

  const names: string[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isArrayLiteralExpression(node)) {
      // Walk up through optional "as const" AsExpression to reach VariableDeclaration
      const parent = node.parent;
      const varDecl = ts.isAsExpression(parent)
        ? (ts.isVariableDeclaration(parent.parent) ? parent.parent : undefined)
        : (ts.isVariableDeclaration(parent) ? parent : undefined);

      if (varDecl && ts.isIdentifier(varDecl.name) && varDecl.name.text.includes("TOOL_NAMES")) {
        for (const el of node.elements) {
          if (ts.isStringLiteral(el)) names.push(el.text);
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  ts.forEachChild(sf, visit);
  return names;
};

// ── AST: registerTool call extraction ─────────────────────────────────────────

const extractRegisterToolCalls = async (filePath: string): Promise<ToolRegistration[]> => {
  const sf = await parseFile(filePath);
  if (!sf) return [];

  const regs: ToolRegistration[] = [];

  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "registerTool" &&
      node.arguments.length >= 3
    ) {
      const toolNameNode = node.arguments[0];
      const callbackNode = node.arguments[2];

      if (ts.isStringLiteral(toolNameNode) && ts.isArrowFunction(callbackNode)) {
        const handlerFn = findFirstIdentifierCall(callbackNode.body);
        if (handlerFn) {
          regs.push({ toolName: toolNameNode.text, handlerFn });
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  ts.forEachChild(sf, visit);
  return regs;
};

/** Walk an expression tree to find the first direct identifier call (e.g. handleOrient(...)). */
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

  // Use ParsedModule for import parsing (avoids duplicating the import walk)
  const mod = new ParsedModule(filePath, source, false);
  const useCaseImports = new Map<string, string>(); // localName → sourcePath
  for (const imp of mod.getImports()) {
    if (imp.path.includes("/scrum/")) {
      useCaseImports.set(imp.name, imp.path);
    }
  }

  const sf = mod.getModuleSource();
  const calls: UseCaseCall[] = [];

  // Walk handler variable declarations and find which use-case function each calls
  const visitStatement = (node: ts.Node): void => {
    if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.name.text.startsWith("handle")) {
          const handlerFn = decl.name.text;
          const useCaseFn = findFirstUseCaseCall(decl.initializer, useCaseImports);
          if (useCaseFn) {
            calls.push({
              handlerFn,
              useCaseFn: useCaseFn.localName,
              sourceFile: useCaseFn.sourcePath,
            });
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
    const name = node.expression.text;
    const path = useCaseImports.get(name);
    if (path) return { localName: name, sourcePath: path };
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

// ── Post-processing: filter orphan elements ────────────────────────────────────

const filterOrphans = (level: C4SliceLevel): C4SliceLevel => {
  const referenced = new Set<string>();
  for (const rel of level.relationships) {
    referenced.add(rel.from);
    referenced.add(rel.to);
  }
  const elements = level.elements.filter((e) => referenced.has(e.id));
  return { elements, relationships: level.relationships };
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

/** Derive project root from the srcDir value (e.g. "./src" → "."). */
const resolveRoot = (srcDir: string): string =>
  srcDir.replace(/\/src$/, "").replace(/\\src$/, "") || ".";

const sanitizeId = (id: string): string =>
  id
    .replace(/[/\\]/g, "_")
    .replace(/\./g, "_")
    .replace(/-/g, "_")
    .replace(/[()]/g, "");
