// =============================================================================
// scripts/diagram/DiagramStyler.ts — Generate Mermaid classDef style declarations
// =============================================================================

import { ParsedModule } from "./ParsedModule.ts";
import { Layer, LayerMapping } from "./types.ts";
// ── Options ──────────────────────────────────────────────────────────────────────

interface StylerOptions {
  colorPalette?: readonly string[];
  layerMapping?: LayerMapping;
}

interface NamespaceDef {
  name: Layer;
  children: ParsedModule[]; // mermaid class name
}
// ── Color Palette ──────────────────────────────────────────────────────────────

const MODULE_COLOR_PALETTE = [
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

/**
 * Default layer mapping based on the project structure.
 */
const DEFAULT_LAYER_MAPPING: LayerMapping = {
  "src/tools/": Layer.FRAMEWORK,
  "src/schemas/": Layer.FRAMEWORK,
  "src/scrum/": Layer.USE_CASE,
  "src/domain/": Layer.USE_CASE,
  "src/services/": Layer.USE_CASE,
  "src/adapters/": Layer.ADAPTER,
  "src/generated/": Layer.ADAPTER,
};

// ── DiagramStyler ──────────────────────────────────────────────────────────────

/**
 * Generate Mermaid classDef style declarations and manage color palette.
 */
export class DiagramStyler {
  private readonly palette: readonly string[];

  private classDefs: string[] = [];
  private namespaceDefs: NamespaceDef[] = [];

  private namespaceLayerMap: LayerMapping;

  constructor(private modules: ParsedModule[], private readonly options?: StylerOptions) {
    this.palette = options?.colorPalette ?? MODULE_COLOR_PALETTE;

    if (!modules) {
      throw new Error("No modules passed to the styler!");
    }

    this.namespaceLayerMap = options?.layerMapping ?? DEFAULT_LAYER_MAPPING;

    this.generateClassDefs();
    this.generateNamespaces();
  }

  public getClassDefs() {
    return this.classDefs;
  }
  public getNamespaceDefs() {
    return this.namespaceDefs;
  }

  private detectNamespace(moduleNode: ParsedModule): Layer {
    for (const [prefix, layer] of Object.entries(this.namespaceLayerMap)) {
      if (moduleNode.filePathName.match(prefix)) {
        return layer;
      }
    }
    return Layer.OTHER;
  }

  private generateNamespaces() {
    const namespaceToModule = new Map<Layer, ParsedModule[]>();

    for (const mod of this.modules) {
      const layer = this.detectNamespace(mod);

      if (!namespaceToModule.has(layer)) {
        // initialize the list
        namespaceToModule.set(layer, []);
      }
      // push the current item
      namespaceToModule.get(layer)!.push(mod);
    }

    for (const layer of namespaceToModule.keys()) {
      this.namespaceDefs.push({
        name: layer,
        children: namespaceToModule.get(layer)!,
      });
    }
  }

  private generateClassDefs(): void {
    // Group modules by their parent folder
    const folderToClassName = new Map<string, string[]>();

    for (const mod of this.modules) {
      // Get the parent folder (second-to-last part) or root if it's at root level
      const folder = mod.getParentFolderName();

      if (!folderToClassName.has(folder)) {
        folderToClassName.set(folder, []);
      }
      folderToClassName.get(folder)!.push(mod.getMermaidClassName());
    }

    let colorIndex = 0;
    for (const [folder, _className] of folderToClassName.entries()) {
      const color = this.palette[colorIndex % this.palette.length];

      // Create module styles for each module in this folder
      this.classDefs.push(
        `    classDef ${folder} fill:${color},stroke:#333,stroke-width:2px,color:#000;`,
      );

      colorIndex++;
    }
  }
}
