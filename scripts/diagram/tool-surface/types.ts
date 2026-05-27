// =============================================================================
// scripts/diagram/tool-surface/types.ts
//
// Shared data model for the type-surface diagram generator.
// Each extractor produces ExtractedClass + ExtractedRelationship objects;
// the generator consumes them to emit Mermaid classDiagram syntax.
// =============================================================================

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
  | "-->"   // association / field reference
  | "--|>"  // inheritance / "same shape as"
  | "--*"   // composition
  | "..>";  // dependency / usage

export type NamespaceName = "TypeScriptTypes" | "ZodSchemas" | "ToolSurface";

/**
 * Configuration that tells the pipeline which source files to parse for each
 * namespace. Paths are matched as substrings of the absolute file path.
 */
export interface NamespaceConfig {
  typeScriptTypes: string[];  // e.g. ["src/domain/types.ts"]
  zodSchemas: string[];       // e.g. ["src/schemas/scrum.ts"]
  toolSurface: string[];      // e.g. ["src/tools/scrum-read.ts", "src/tools/scrum-write.ts"]
}
