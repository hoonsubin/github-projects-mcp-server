// =============================================================================
// scripts/diagram/DiagramStyler.ts — Generate Mermaid classDef style declarations
// =============================================================================

import type { ExportInfo } from "./ExportParser.ts";
import { sanitizeId } from "./NameFormatter.ts";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ParsedModule {
  path: string;
  imports: string[];
  exports: ExportInfo[];
  content?: string;
}

interface StylerOptions {
  colorPalette?: readonly string[];
}

// ── Color Palette ──────────────────────────────────────────────────────────────

export const MODULE_COLOR_PALETTE = [
  "#f9f", // pink
  "#ccf", // light blue
  "#cfc", // light green
  "#ffc", // light yellow
  "#fcc", // light pink
  "#cff", // cyan
  "#fcf", // magenta
  "#0ff", // teal
] as const;

// ── DiagramStyler ──────────────────────────────────────────────────────────────

/**
 * Generate Mermaid classDef style declarations and manage color palette.
 */
export class DiagramStyler {
  private readonly palette: readonly string[];

  constructor(options?: StylerOptions) {
    this.palette = options?.colorPalette ?? MODULE_COLOR_PALETTE;
  }

  generateClassDefs(modules: ParsedModule[]): string[] {
    const lines: string[] = [];
    for (let i = 0; i < modules.length; i++) {
      const mod = modules[i];
      const fileName = mod.path.split("/").pop()!;
      const color = this.palette[i % this.palette.length];
      lines.push(
        `    classDef ${sanitizeId(fileName)} fill:${color},stroke:#333,stroke-width:2px;`,
      );
    }
    return lines;
  }
}
