export interface UnusedExport extends ExportInfo {
  modulePathName: string;
}

export interface ExportInfo {
  name: string;
  kind: ExportKind;
  type?: string;
  returnType?: string;
}

export interface ImportInfo {
  name: string;
  kind: ImportKind;
  path: string;
  alias?: string;
}

export type ExportKind =
  | "class"
  | "function"
  | "interface"
  | "type"
  | "enum"
  | "const"
  | "let"
  | "var"
  | "module";

export type ImportKind =
  | "named"
  | "default"
  | "namespace"
  | "type";

/**
 * Represents the architectural layers of the system.
 */
export enum Layer {
  FRAMEWORK = "Framework",
  USE_CASE = "Use-Case",
  ADAPTER = "Adapter",
  OTHER = "Other",
}

/**
 * Configuration for mapping directory prefixes to architectural layers.
 */
export interface LayerMapping {
  [prefix: string]: Layer;
}

// ── Shared diagram contracts ───────────────────────────────────────────────────

/**
 * Shared contract between DiagramStyler and ClassDiagramGenerator.
 * A named group of nodes that maps to one `namespace Name { ... }` block.
 * Defined here (not in DiagramStyler.ts) because it flows between the styler
 * and the generator - both depend on it, neither owns it.
 */
export interface NamespaceDef<T> {
  name: string;
  children: T[];
}

/**
 * Per-node data returned by ClassDiagramGenerator.getClassBody().
 * Carries `name` so the base class emitNode() can write `class Name:::style`
 * without a separate abstract getNodeName() method - keeping the node
 * contract in a single place.
 */
export interface ClassBodyResult {
  name: string; // identifier used in `class Name:::style`
  members: string[];
  stereotype: string | null;
}

// ── Module-import generator options ───────────────────────────────────────────

export interface ClassDiagramOptions {
  showUnusedExports?: boolean;
  showDependencyArrows?: boolean;
}

// ── Type-surface types ─────────────────────────────────────────────────────────

/** One class node in the Mermaid diagram. */
export interface ExtractedClass {
  /** The class name as it will appear in Mermaid. */
  name: string;

  /**
   * Mermaid stereotype label placed inside << >> under the class name.
   * Examples: "interface", "enumeration", "union", "branded",
   *           "Arguments", "Response", "ReadTool", "WriteTool", "LegacyTool"
   * null → no stereotype line is emitted.
   */
  stereotype: string | null;

  /**
   * Formatted member lines emitted inside the class body.
   * Each entry is a ready-to-emit string like "+id : string" or "bug".
   */
  members: string[];

  /** Which Mermaid namespace block this class belongs to. */
  namespace: NamespaceName;

  /** Absolute path of the source file this class was extracted from. */
  sourceFile: string;
}

/** One relationship arrow between two class nodes. */
export interface ExtractedRelationship {
  from: string;
  to: string;
  arrow: RelationshipArrow;
  /** Optional label placed after the colon, e.g. "ref" or "id-variant". */
  label?: string;
}

export type RelationshipArrow =
  | "-->" // association / field reference
  | "--|>" // inheritance / "same shape as"
  | "--*" // composition
  | "..>" // dependency / usage
  | "..|>"; // implementation (class implements interface)

export type NamespaceName =
  | "TypeScriptTypes"
  | "ZodSchemas"
  | "ToolSurface"
  | "UseCaseLayer"
  | "AdapterLayer";
