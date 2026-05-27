// =============================================================================
// scripts/diagram/DiagramStyler.ts — Abstract base class for Mermaid styling
// =============================================================================

import type { NamespaceDef } from "./types.ts";

/**
 * Abstract styling strategy for a Mermaid classDiagram.
 * Concrete subclasses define node coloring, classDef declarations,
 * and namespace grouping for their specific diagram type.
 */
export abstract class DiagramStyler<T> {
  /** Return all `classDef` lines to append at the end of the diagram. */
  abstract getClassDefs(): string[];

  /**
   * Partition nodes into namespace groups in the order they should appear
   * in the diagram.  Each NamespaceDef maps to a `namespace Name { ... }` block.
   */
  abstract getNamespaceDefs(): NamespaceDef<T>[];

  /**
   * Return the Mermaid style-class name for a given node.
   * Used inline as `class Name:::styleName` in the class declaration.
   * The returned key must match one of the `classDef` keys from getClassDefs().
   */
  abstract getNodeStyle(node: T): string;
}
