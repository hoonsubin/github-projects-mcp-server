// =============================================================================
// scripts/diagram/ClassDiagramGenerator.ts — Orchestrate class diagram generation
// =============================================================================

import { ParsedModule } from "./ParsedModule.ts";
import { ExportInfo, ExportKind, UnusedExport } from "./types.ts";
import { formatClassNameFromPath, resolveImport } from "./helpers.ts";
import { DiagramStyler } from "./DiagramStyler.ts";

// ── Options ────────────────────────────────────────────────────────────────────

export interface ClassDiagramOptions {
  showUnusedExports?: boolean;
  showDependencyArrows?: boolean;
  colorPalette?: readonly string[];
  showNameSpaces?: boolean;
}

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

    lines.push(...["classDiagram", "    direction LR"]);
    lines.push("");
    lines.push(...this.generateClasses());
    lines.push("");
    lines.push(...this.generateRelationships());
    lines.push("");
    lines.push(...folderClassDefs);

    return lines.join("\n");
  }

  private generateClasses(): string[] {
    const lines: string[] = [];
    // todo: add grouping classes into name spaces based on the project architectural layers
    /**
    ```mermaid
    flowchart TD

      subgraph Framework["FRAMEWORK LAYER src/tools/ + src/schemas/"]
        direction TB
        FW["MCP tool registration thin handlers Zod param parsing"]
      end

      subgraph UseCase["USE-CASE LAYER src/scrum/ + src/domain/ + src/services/"]
        direction TB
        UC["Scrum orchestration domain rules pure computation"]
        PB["interface ProjectBackend (src/scrum/ports.ts)"]
      end

      subgraph Adapter["ADAPTER LAYER src/adapters/ + src/generated/"]
        direction TB
        AD["GitHubProjectBackend implements ProjectBackend"]
        SVC["internal/ services (LabelResolver, FieldValueMutator, etc.)"]
        AD -->|delegates to| SVC
      end

      FW -->|calls use-case functions| UC
      UC -->|depends on focused port| PB
      AD -.->|implements Dependency Inversion| PB
    ```
    */

    for (const mod of this.modules) {
      const className = mod.filePathName.split("/").pop()!;

      // Compute folder name from path (same logic as in original)
      const pathParts = mod.filePathName.split("/");
      const folder = pathParts.length > 1 ? pathParts[pathParts.length - 2] : "root";
      //const sanitizedFolder = sanitizeId(folder);

      // todo: this will result in a curly brace even if there is no export member at all
      // Use the folder's classDef for styling
      lines.push(`    class ${className}:::${folder} {`);

      for (const exp of mod.getExports()) {
        const memberLine = formatExportAsMember(exp);
        lines.push(`        ${memberLine}`);
      }

      if (this.options?.showUnusedExports) {
        const unused = this.unusedExports.filter(
          (e) => e.modulePath === mod.filePathName,
        );
        if (unused.length > 0) {
          lines.push(
            `        %% Unused: ${unused.map((u) => u.name).join(", ")}`,
          );
        }
      }
      // todo: this will result in a curly brace even if there is no export member at all
      lines.push("    }");
      lines.push("");
    }

    return lines;
  }

  private generateRelationships(): string[] {
    const lines: string[] = [];
    if (!(this.options?.showDependencyArrows ?? true)) return lines;

    const relationList = new Set<string>();

    for (const mod of this.modules) {
      for (const imp of mod.getImports()) {
        const resolved = resolveImport(mod.filePathName, imp.name);
        if (!resolved) continue;

        const srcFile = mod.filePathName.split("/").pop()!;
        const tgtFile = resolved.split("/").pop()!;

        if (srcFile === tgtFile) continue;

        const srcClass = formatClassNameFromPath(srcFile);
        const tgtClass = formatClassNameFromPath(tgtFile);

        const relKey = `${srcClass} -> ${tgtClass}`;
        if (!relationList.has(relKey)) {
          relationList.add(relKey);
          lines.push(`    ${srcClass} --> ${tgtClass} : "imports"`);
        }
      }
    }

    return lines;
  }
}
