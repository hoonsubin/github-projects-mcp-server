// =============================================================================
// scripts/diagram/ClassDiagramGenerator.ts — Orchestrate class diagram generation
// =============================================================================

import { ParsedModule, UnusedExport } from "./DependencyGraph.ts";
import { ExportInfo, ExportKind } from "./ExportParser.ts";
import { formatClassNameFromPath, resolveImport, sanitizeId } from "./helpers.ts";
import { DiagramStyler } from "./DiagramStyler.ts";

// ── Options ────────────────────────────────────────────────────────────────────

export interface ClassDiagramOptions {
  showUnusedExports?: boolean;
  showDependencyArrows?: boolean;
  colorPalette?: readonly string[];
}

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

    // Call generateClassDefs once and share the result
    const styler = new DiagramStyler(this.options);
    const { folderClassDefs } = styler.generateClassDefs(this.modules);

    lines.push(...this.generateHeader());
    lines.push("");
    lines.push(...this.generateClasses());
    lines.push("");
    lines.push(...this.generateRelationships());
    lines.push("");
    lines.push(...folderClassDefs);

    return lines.join("\n");
  }

  private generateHeader(): string[] {
    return ["classDiagram", "    direction LR"];
  }

  private generateClasses(): string[] {
    const lines: string[] = [];

    // Since we're not passing moduleStyles anymore, we compute the folder name directly
    for (const mod of this.modules) {
      const fileName = mod.path.split("/").pop()!;
      const className = formatClassNameFromPath(fileName);

      // Compute folder name from path (same logic as in original)
      const pathParts = mod.path.split("/");
      const folder = pathParts.length > 1 ? pathParts[pathParts.length - 2] : "root";
      const sanitizedFolder = sanitizeId(folder);

      // Use the folder's classDef for styling
      lines.push(`    class ${className}:::${sanitizedFolder} {`);

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
