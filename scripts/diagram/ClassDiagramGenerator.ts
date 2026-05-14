// =============================================================================
// scripts/diagram/ClassDiagramGenerator.ts — Orchestrate class diagram generation
// =============================================================================

import { ParsedModule } from "./ParsedModule.ts";
import { ExportInfo, ExportKind, UnusedExport } from "./types.ts";
import { resolveImport } from "./helpers.ts";
import { DiagramStyler } from "./DiagramStyler.ts";
import * as path from "@std/path";

// ── Options ────────────────────────────────────────────────────────────────────

export interface ClassDiagramOptions {
  showUnusedExports?: boolean;
  showDependencyArrows?: boolean;
}

type MermaidClassNode = Map<string, ParsedModule>;

// ── Export Formatting (strategy map) ───────────────────────────────────────────

const exportFormatters: Record<ExportKind, (exp: ExportInfo) => string> = {
  // todo if the export is a class, then there should be another diagram node for that class
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

// ── ClassDiagramGenerator ──────────────────────────────────────────────────────

/**
 * Orchestrate class definitions and relationships.
 */
export class ClassDiagramGenerator {
  private readonly styler: DiagramStyler;
  private readonly unusedExports: UnusedExport[];
  private readonly options?: ClassDiagramOptions;
  private readonly diagramNodeMap: MermaidClassNode = new Map<string, ParsedModule>();

  constructor(
    modules: ParsedModule[],
    unusedExports: UnusedExport[],
    options?: ClassDiagramOptions,
  ) {
    this.unusedExports = unusedExports;
    this.options = options;
    this.styler = new DiagramStyler(modules);

    // initialize the node map
    for (const ns of this.styler.getNamespaceDefs()) {
      for (const mod of ns.children) {
        this.diagramNodeMap.set(mod.getMermaidClassName(), mod);
      }
    }
  }

  generate(): string {
    const lines: string[] = [];

    lines.push(...["classDiagram", "    direction LR"]);
    lines.push("");
    lines.push(...this.generateClasses());
    lines.push("");
    lines.push(...this.generateRelationships());
    lines.push("");
    this.styler.getClassDefs().forEach((classDef) => {
      lines.push(classDef);
    });

    return lines.join("\n");
  }

  private generateClasses(): string[] {
    const lines: string[] = [];

    const test = this.styler.getNamespaceDefs().map((i) => {
      return {
        name: i.name,
        modules: i.children.map((j) => {
          return j.getMermaidClassName();
        }),
      };
    });

    console.log(test);

    for (const namespaceDef of this.styler.getNamespaceDefs()) {
      lines.push(`    namespace ${namespaceDef.name} {`);

      for (const namespaceChild of namespaceDef.children) {
        const hasExports = !!namespaceChild.getExports();

        if (hasExports) {
          lines.push(
            `            class ${namespaceChild.getMermaidClassName()}:::${namespaceChild.getParentFolderName()} {`,
          );

          for (const exp of namespaceChild.getExports()) {
            const memberLine = formatExportAsMember(exp);
            lines.push(`                ${memberLine}`);
          }

          if (this.options?.showUnusedExports) {
            const unused = this.unusedExports.filter(
              (e) => e.modulePathName === namespaceChild.filePathName,
            );
            if (unused.length > 0) {
              lines.push(
                `                %% Unused: ${unused.map((u) => u.name).join(", ")}`,
              );
            }
          }

          lines.push("            }");
        } else {
          lines.push(
            `            class ${namespaceChild.getMermaidClassName()}:::${namespaceChild.getParentFolderName()}`,
          );
        }
      }

      lines.push("    }");
    }

    return lines;
  }

  private generateRelationships(): string[] {
    const lines: string[] = [];
    if (!(this.options?.showDependencyArrows ?? true)) return lines;

    const relationList = new Set<string>();

    for (const [moduleName, moduleObj] of this.diagramNodeMap.entries()) {
      for (const imports of moduleObj.getImports()) {
        const isExternal = !imports.path.startsWith(".");
        const resolved = resolveImport(moduleObj.filePathName, imports.path);
        if (!resolved) continue;

        // need a way to get the target module class name
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

  public findUnusedExports(): UnusedExport[] {
    const usedNamesByModule = new Map<string, Set<string>>();
    const unreferencedExports: UnusedExport[] = [];
    // Track usage
    for (const mod of this.diagramNodeMap.values()) {
      for (const imp of mod.getImports()) {
        const resolved = resolveImport(mod.filePathName, imp.path);
        if (!resolved || !this.diagramNodeMap.has(resolved)) continue;

        const targetMod = this.diagramNodeMap.get(resolved)!;
        const usedSet = usedNamesByModule.get(resolved)!;

        if (imp.kind === "named" || imp.kind === "type") {
          // For named/type imports, the 'name' property is the exported name in the target module
          usedSet.add(imp.name);
        } else if (imp.kind === "namespace") {
          // Namespace import (* as Foo) implies all exports are potentially used
          for (const exp of targetMod.getExports()) {
            usedSet.add(exp.name);
          }
        } else if (imp.kind === "default") {
          // Best effort for default imports: use the local name as a fallback
          usedSet.add(imp.name);
        }
      }

      const usedSet = usedNamesByModule.get(mod.filePathName)!;
      for (const exp of mod.getExports()) {
        if (!usedSet.has(exp.name)) {
          unreferencedExports.push({
            ...exp,
            modulePathName: mod.filePathName,
          });
        }
      }
    }

    return unreferencedExports;
  }
}
