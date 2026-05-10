// =============================================================================
// scripts/diagram/ClassDiagramGenerator.ts — Orchestrate class diagram generation
// =============================================================================

import { ParsedModule, UnusedExport } from "./DependencyGraph.ts";
import { ExportInfo, ExportKind } from "./ExportParser.ts";
import { formatClassNameFromPath } from "./NameFormatter.ts";
import { resolveImport } from "./resolveImport.ts";
import { DiagramStyler } from "./DiagramStyler.ts";

// ── Options ────────────────────────────────────────────────────────────────────

export interface ClassDiagramOptions {
  showUnusedExports?: boolean;
  showDependencyArrows?: boolean;
  colorPalette?: readonly string[];
}

// ── Export Formatting (strategy map) ───────────────────────────────────────────

const exportFormatters: Record<ExportKind, (exp: ExportInfo) => string> = {
  class: (exp) => `<<Class>> ${exp.name}`,
  interface: (exp) => `<<Interface>> ${exp.name}`,
  enum: (exp) => `<<Enum>> ${exp.name}`,
  function: (exp) => {
    if (exp.returnType) return `+${exp.name}() ${exp.returnType}`;
    return `+${exp.name}()`;
  },
  type: (exp) => {
    if (exp.type) return `<<type>> ${exp.name}`;
    return `<<type>> ${exp.name}`;
  },
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
  module: (exp) => `<<Module>> ${exp.name}`,
};

const formatExportAsMember = (exp: ExportInfo): string => {
  return exportFormatters[exp.kind](exp);
};

// ── ClassDiagramGenerator ──────────────────────────────────────────────────────

/**
 * Orchestrate class definitions and relationships.
 */
export class ClassDiagramGenerator {
  constructor(
    private readonly modules: ParsedModule[],
    private readonly unusedExports: UnusedExport[],
    private readonly options?: ClassDiagramOptions,
  ) {}

  generate(): string {
    const lines: string[] = [];

    lines.push(...this.generateHeader());
    lines.push("");
    lines.push(...this.generateStyles());
    lines.push("");
    lines.push(...this.generateClasses());
    lines.push("");
    lines.push(...this.generateRelationships());

    return lines.join("\n");
  }

  private generateHeader(): string[] {
    return ["classDiagram", "    direction LR"];
  }

  private generateStyles(): string[] {
    const styler = new DiagramStyler(this.options);
    return styler.generateClassDefs(this.modules);
  }

  private generateClasses(): string[] {
    const lines: string[] = [];

    for (const mod of this.modules) {
      const fileName = mod.path.split("/").pop()!;
      const className = formatClassNameFromPath(fileName);

      lines.push(`    class ${className} {`);

      for (const exp of mod.exports) {
        const memberLine = formatExportAsMember(exp);
        lines.push(`        ${memberLine}`);
      }

      if (this.options?.showUnusedExports) {
        const unused = this.unusedExports.filter(
          (e) => e.modulePath === mod.path,
        );
        if (unused.length > 0) {
          lines.push(
            `        %% Unused: ${unused.map((u) => u.exportName).join(", ")}`,
          );
        }
      }

      lines.push("    }");
      lines.push("");
    }

    return lines;
  }

  private generateRelationships(): string[] {
    const lines: string[] = [];
    if (!(this.options?.showDependencyArrows ?? true)) return lines;

    const seenRels = new Set<string>();

    for (const mod of this.modules) {
      for (const imp of mod.imports) {
        const resolved = resolveImport(mod.path, imp);
        if (!resolved) continue;

        const srcFile = mod.path.split("/").pop()!;
        const tgtFile = resolved.split("/").pop()!;

        if (srcFile === tgtFile) continue;

        const srcClass = formatClassNameFromPath(srcFile);
        const tgtClass = formatClassNameFromPath(tgtFile);

        const relKey = `${srcClass} -> ${tgtClass}`;
        if (!seenRels.has(relKey)) {
          seenRels.add(relKey);
          lines.push(`    ${srcClass} --> ${tgtClass} : "imports"`);
        }
      }
    }

    return lines;
  }
}
