// =============================================================================
// scripts/diagram/DiagramStyler.ts — Generate Mermaid classDef style declarations
// =============================================================================

import { formatClassNameFromPath, sanitizeId } from "./helpers.ts";
import type { ModuleStyle } from "./types.ts";
import { ParsedModule } from "./ParsedModule.ts";
// ── Options ──────────────────────────────────────────────────────────────────────

interface StylerOptions {
  colorPalette?: readonly string[];
  withNamespace?: boolean;
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
  private readonly withNamespace: boolean;
  constructor(options?: StylerOptions) {
    this.palette = options?.colorPalette ?? MODULE_COLOR_PALETTE;
    // Defaults to false
    this.withNamespace = !!options?.withNamespace;
  }

  /**
   * Generate Mermaid classDef style declarations and module styling data.
   * Each folder gets a unique color from the palette, and each module
   * references its folder's classDef.
   */
  generateClassDefs(modules: ParsedModule[]): {
    moduleStyles: ModuleStyle[];
    folderClassDefs: string[];
  } {
    // Group modules by their parent folder
    const folderToModules = new Map<string, ParsedModule[]>();

    for (const mod of modules) {
      const pathParts = mod.filePathName.split("/");
      // Get the parent folder (second-to-last part) or root if it's at root level
      const folder = pathParts.length > 1 ? pathParts[pathParts.length - 2] : "root";

      if (!folderToModules.has(folder)) {
        folderToModules.set(folder, []);
      }
      folderToModules.get(folder)!.push(mod);
    }

    // Generate classDef entries for each folder and module styles
    const folderClassDefs: string[] = [];
    const moduleStyles: ModuleStyle[] = [];
    const folderToColor = new Map<string, string>();

    let colorIndex = 0;
    for (const [folder, folderModules] of folderToModules.entries()) {
      const color = this.palette[colorIndex % this.palette.length];
      folderToColor.set(folder, color);

      // Sanitize the folder name for use as a Mermaid ID
      const sanitizedFolder = sanitizeId(folder);
      folderClassDefs.push(
        `    classDef ${sanitizedFolder} fill:${color},stroke:#333,stroke-width:2px,color:#000;`,
      );

      // Create module styles for each module in this folder
      for (const mod of folderModules) {
        const fileName = mod.filePathName.split("/").pop()!;
        const className = formatClassNameFromPath(fileName);

        moduleStyles.push({
          className,
          folder: sanitizedFolder,
          classDef:
            `    classDef ${sanitizedFolder} fill:${color},stroke:#333,stroke-width:2px,color:#000;`,
        });
      }

      colorIndex++;
    }

    return { moduleStyles, folderClassDefs };
  }
}
