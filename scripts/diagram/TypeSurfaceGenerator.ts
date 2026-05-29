// =============================================================================
// scripts/diagram/TypeSurfaceGenerator.ts - Type-surface Mermaid diagram generator
// =============================================================================

import type { ClassBodyResult, ExtractedClass, ExtractedRelationship } from "./types.ts";
import { ClassDiagramGenerator } from "./ClassDiagramGenerator.ts";
import type { TypeSurfaceStyler } from "./TypeSurfaceStyler.ts";

/**
 * Generates the type-surface Mermaid classDiagram from ExtractedClass
 * and ExtractedRelationship data.
 */
export class TypeSurfaceGenerator extends ClassDiagramGenerator<ExtractedClass> {
  constructor(
    private readonly classes: ExtractedClass[],
    private readonly relationships: ExtractedRelationship[],
    styler: TypeSurfaceStyler,
  ) {
    super(styler);
  }

  protected getHeaderLines(): string[] {
    return ["classDiagram"];
  }

  protected getClassBody(cls: ExtractedClass): ClassBodyResult {
    return { name: cls.name, members: cls.members, stereotype: cls.stereotype };
  }

  protected getRelationshipLines(): string[] {
    const lines: string[] = [];
    const seen = new Set<string>();

    const knownClassNames = new Set(this.classes.map((c) => c.name));

    for (const rel of this.relationships) {
      // Skip arrows to/from classes not in the diagram
      if (!knownClassNames.has(rel.from) || !knownClassNames.has(rel.to)) continue;

      const key = `${rel.from}${rel.arrow}${rel.to}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const label = rel.label ? ` : ${rel.label}` : "";
      lines.push(`    ${rel.from} ${rel.arrow} ${rel.to}${label}`);
    }

    return lines;
  }
}
