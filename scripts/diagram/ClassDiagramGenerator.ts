// =============================================================================
// scripts/diagram/ClassDiagramGenerator.ts — Abstract base for Mermaid classDiagram generation
// =============================================================================

import type { ClassBodyResult } from "./types.ts";
import type { DiagramStyler } from "./DiagramStyler.ts";

/**
 * Abstract template-method generator for Mermaid classDiagram output.
 *
 * Subclasses provide:
 *   - getHeaderLines() → first lines of the output (e.g. "classDiagram", "direction LR")
 *   - getClassBody(node) → the name, members, and stereotype for one node
 *   - getRelationshipLines() → all relationship arrow lines
 *
 * The styler provides:
 *   - getNamespaceDefs() → grouping of nodes into namespace blocks
 *   - getNodeStyle(node) → the Mermaid style-class name for a node
 *   - getClassDefs() → classDef declarations appended at the end
 *
 * Subclasses may override `classIndent` and `memberIndent` to match the
 * indentation convention of their diagram type.
 */
export abstract class ClassDiagramGenerator<T> {
  /** Indentation prefix for `class Name {` (default: 8 spaces). */
  protected readonly classIndent = "        ";

  /** Indentation prefix for members and stereotype (default: 12 spaces). */
  protected readonly memberIndent = "            ";

  constructor(protected readonly styler: DiagramStyler<T>) {}

  /**
   * Template method — assembles the complete Mermaid diagram string.
   */
  generate(): string {
    const lines: string[] = [];
    lines.push(...this.getHeaderLines(), "");

    for (const ns of this.styler.getNamespaceDefs()) {
      lines.push(`    namespace ${ns.name} {`, "");
      for (const child of ns.children) {
        lines.push(...this.emitNode(child));
      }
      lines.push("    }", "");
    }

    lines.push(...this.getRelationshipLines(), "");
    lines.push(...this.styler.getClassDefs());

    return lines.join("\n");
  }

  /** First lines of the output, e.g. `["classDiagram", "    direction LR"]`. */
  protected abstract getHeaderLines(): string[];

  /**
   * All data needed to emit one node.
   * `name` is the identifier written into `class Name:::style`.
   * Returning `name` here (rather than via a separate abstract method) keeps
   * the node contract in a single place and avoids a redundant traversal.
   */
  protected abstract getClassBody(node: T): ClassBodyResult;

  /** All relationship lines, e.g. `"    A --> B : \"imports\""`. */
  protected abstract getRelationshipLines(): string[];

  // ── Private ───────────────────────────────────────────────────────────────────

  private emitNode(node: T): string[] {
    const { name, members, stereotype } = this.getClassBody(node);
    const style = this.styler.getNodeStyle(node);
    const lines: string[] = [];
    lines.push(`${this.classIndent}class ${name}:::${style} {`);
    if (stereotype) lines.push(`${this.memberIndent}<<${stereotype}>>`);
    for (const m of members) lines.push(`${this.memberIndent}${m}`);
    lines.push(`${this.classIndent}}`, "");
    return lines;
  }
}
