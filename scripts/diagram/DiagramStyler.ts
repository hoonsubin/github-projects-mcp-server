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
  "#f0f", // violet
  "#0f0", // lime green
  "#ff0", // yellow
  "#00f", // blue
  "#f00", // red
  "#0f0", // green
  "#800080", // purple
  "#808000", // olive
  "#008080", // teal
  "#ff8000", // orange
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

  /**
   * Generate Mermaid classDef style declarations grouped by folder.
   * Each folder gets a unique color from the palette, and each module
   * references its folder's classDef.
   */
  generateClassDefs(modules: ParsedModule[]): {
    classDefs: string[];
    folderToColor: Map<string, string>;
    moduleToFolder: Map<string, string>;
  } {
    // Group modules by their parent folder
    const folderToModules = new Map<string, ParsedModule[]>();
    const moduleToFolder = new Map<string, string>();

    for (const mod of modules) {
      const pathParts = mod.path.split("/");
      // Get the parent folder (second-to-last part) or root if it's at root level
      const folder = pathParts.length > 1 ? pathParts[pathParts.length - 2] : "root";

      moduleToFolder.set(mod.path, folder);

      if (!folderToModules.has(folder)) {
        folderToModules.set(folder, []);
      }
      folderToModules.get(folder)!.push(mod);
    }

    // Generate classDef entries for each folder
    const classDefs: string[] = [];
    const folderToColor = new Map<string, string>();

    let colorIndex = 0;
    for (const [folder] of folderToModules.entries()) {
      const color = this.palette[colorIndex % this.palette.length];
      folderToColor.set(folder, color);

      // Sanitize the folder name for use as a Mermaid ID
      const sanitizedFolder = sanitizeId(folder);
      classDefs.push(
        `    classDef ${sanitizedFolder} fill:${color},stroke:#333,stroke-width:2px,color:#000;`,
      );

      colorIndex++;
    }

    return { classDefs, folderToColor, moduleToFolder };
  }
}
