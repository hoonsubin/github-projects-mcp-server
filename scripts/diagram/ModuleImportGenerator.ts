// =============================================================================
// scripts/diagram/ModuleImportGenerator.ts — Module-per-class Mermaid diagram generator
// =============================================================================

import { ParsedModule } from "./ParsedModule.ts";
import type {
  ClassBodyResult,
  ClassDiagramOptions,
  ExportInfo,
  ExportKind,
  UnusedExport,
} from "./types.ts";
import { resolveImport } from "./helpers.ts";
import { ClassDiagramGenerator } from "./ClassDiagramGenerator.ts";
import type { ModuleImportStyler } from "./ModuleImportStyler.ts";
import * as path from "@std/path";

// ── Export Formatting (strategy map) ───────────────────────────────────────────

const exportFormatters: Record<ExportKind, (exp: ExportInfo) => string> = {
  class: (exp) => `class ${exp.name}`,
  interface: (exp) => `interface ${exp.name}`,
  enum: (exp) => `enum ${exp.name}`,
  function: (exp) => {
    if (exp.returnType) return `+${exp.name}() ${exp.returnType}`;
    return `+${exp.name}()`;
  },
  type: (exp) => `type ${exp.name}`,

  const: (exp) => {
    if (exp.type) return `+${exp.type} ${exp.name}`;
    return `+const ${exp.name}`;
  },
  let: (exp) => {
    if (exp.type) return `+${exp.type} ${exp.name}`;
    return `+let ${exp.name}`;
  },
  var: (exp) => {
    if (exp.type) return `+${exp.type} ${exp.name}`;
    return `+var ${exp.name}`;
  },
  module: (exp) => `Module ${exp.name}`,
};

const formatExportAsMember = (exp: ExportInfo): string => {
  return exportFormatters[exp.kind](exp);
};

// ── ModuleImportGenerator ──────────────────────────────────────────────────────

/**
 * Generates the module-import Mermaid classDiagram from ParsedModule instances.
 */
export class ModuleImportGenerator extends ClassDiagramGenerator<ParsedModule> {
  private nodeMap: Map<string, ParsedModule> | null = null;

  constructor(
    private readonly modules: ParsedModule[],
    private readonly unusedExports: UnusedExport[],
    styler: ModuleImportStyler,
    private readonly options?: ClassDiagramOptions,
  ) {
    super(styler);
  }

  protected getHeaderLines(): string[] {
    return ["classDiagram", "    direction LR"];
  }

  protected getClassBody(mod: ParsedModule): ClassBodyResult {
    const members: string[] = mod.getExports().map(formatExportAsMember);
    if (this.options?.showUnusedExports) {
      const unused = this.unusedExports.filter(
        (e) => e.modulePathName === mod.filePathName,
      );
      if (unused.length > 0) {
        members.push(`%% Unused: ${unused.map((u) => u.name).join(", ")}`);
      }
    }
    return { name: mod.getMermaidClassName(), members, stereotype: null };
  }

  protected getRelationshipLines(): string[] {
    const lines: string[] = [];
    if (!(this.options?.showDependencyArrows ?? true)) return lines;

    const relationList = new Set<string>();
    const nm = this.ensureNodeMap();

    for (const [moduleName, moduleObj] of nm.entries()) {
      for (const imports of moduleObj.getImports()) {
        const isExternal = !imports.path.startsWith(".");
        const resolved = resolveImport(moduleObj.filePathName, imports.path);
        if (!resolved) continue;

        const tgtClass = isExternal ? imports.name : path.basename(resolved);

        if (moduleName === tgtClass) continue;

        const relKey = `${moduleName} -> ${tgtClass}`;
        if (!relationList.has(relKey)) {
          relationList.add(relKey);
          lines.push(`    ${moduleName} --> ${tgtClass} : "imports"`);
        }
      }
    }

    return lines;
  }

  // ── Private ───────────────────────────────────────────────────────────────────

  private ensureNodeMap(): Map<string, ParsedModule> {
    if (this.nodeMap) return this.nodeMap;
    const map = new Map<string, ParsedModule>();
    for (const ns of this.styler.getNamespaceDefs()) {
      for (const mod of ns.children) {
        map.set(mod.getMermaidClassName(), mod);
      }
    }
    this.nodeMap = map;
    return map;
  }
}
