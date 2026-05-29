// =============================================================================
// scripts/diagram/ModuleImportStyler.ts - Folder-based coloring for module-import diagrams
// =============================================================================

import { ParsedModule } from "./ParsedModule.ts";
import { Layer, LayerMapping, type NamespaceDef } from "./types.ts";
import { DiagramStyler } from "./DiagramStyler.ts";

// ── Options ──────────────────────────────────────────────────────────────────────

type ModuleImportStylerOptions = {
  colorPalette?: readonly string[];
  layerMapping?: LayerMapping;
};

// ── Color Palette ────────────────────────────────────────────────────────────────

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
};

// ── ModuleImportStyler ───────────────────────────────────────────────────────────

/**
 * Generate Mermaid classDef style declarations and manage color palette
 * for the module-import diagram.
 */
export class ModuleImportStyler extends DiagramStyler<ParsedModule> {
  private readonly palette: readonly string[];
  private readonly namespaceLayerMap: LayerMapping;
  private readonly classDefs: string[];
  private readonly namespaceDefs: NamespaceDef<ParsedModule>[];

  constructor(
    private readonly modules: ParsedModule[],
    options?: ModuleImportStylerOptions,
  ) {
    super();
    this.palette = options?.colorPalette ?? MODULE_COLOR_PALETTE;
    this.namespaceLayerMap = options?.layerMapping ?? DEFAULT_LAYER_MAPPING;

    if (!modules || modules.length === 0) {
      throw new Error("No modules passed to the styler!");
    }

    this.classDefs = this.generateClassDefs();
    this.namespaceDefs = this.generateNamespaces();
  }

  getClassDefs(): string[] {
    return this.classDefs;
  }

  getNamespaceDefs(): NamespaceDef<ParsedModule>[] {
    return this.namespaceDefs;
  }

  getNodeStyle(node: ParsedModule): string {
    return node.getParentFolderName();
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  private detectNamespace(moduleNode: ParsedModule): Layer {
    for (const [prefix, layer] of Object.entries(this.namespaceLayerMap)) {
      if (moduleNode.filePathName.match(prefix)) {
        return layer;
      }
    }
    return Layer.OTHER;
  }

  private generateNamespaces(): NamespaceDef<ParsedModule>[] {
    const namespaceToModule = new Map<Layer, ParsedModule[]>();

    for (const mod of this.modules) {
      const layer = this.detectNamespace(mod);

      if (!namespaceToModule.has(layer)) {
        namespaceToModule.set(layer, []);
      }
      namespaceToModule.get(layer)!.push(mod);
    }

    const result: NamespaceDef<ParsedModule>[] = [];
    for (const layer of namespaceToModule.keys()) {
      result.push({
        name: layer,
        children: namespaceToModule.get(layer)!,
      });
    }
    return result;
  }

  private generateClassDefs(): string[] {
    // Group modules by their parent folder
    const folderToClassName = new Map<string, string[]>();

    for (const mod of this.modules) {
      const folder = mod.getParentFolderName();

      if (!folderToClassName.has(folder)) {
        folderToClassName.set(folder, []);
      }
      folderToClassName.get(folder)!.push(mod.getMermaidClassName());
    }

    let colorIndex = 0;
    const classDefs: string[] = [];
    for (const [folder] of folderToClassName.entries()) {
      const color = this.palette[colorIndex % this.palette.length];

      classDefs.push(
        `    classDef ${folder} fill:${color},stroke:#333,stroke-width:2px,color:#000;`,
      );

      colorIndex++;
    }
    return classDefs;
  }
}
