// =============================================================================
// scripts/generate-project-diagram.ts - Generate class diagrams from TypeScript exports
//
// Scans .ts files in /src, extracts exports with type info via TS Compiler API,
// detects dependencies, and outputs three Mermaid classDiagram artifacts:
//   1. module-imports.mermaid  - module-per-class import dependency diagram
//   2. type-surface.mermaid    - namespaced type-surface diagram (Zod schemas + tools)
//   3. layer-surface.mermaid   - use-case + adapter layer class diagram with relationships
// =============================================================================

// ── Imports: diagram utilities ─────────────────────────────────────────────────
import * as path from "@std/path";
import type { ClassDiagramOptions, UnusedExport } from "./diagram/types.ts";
import { ParsedModule } from "./diagram/ParsedModule.ts";
import * as helper from "./diagram/helpers.ts";

// Module-import generators
import { ModuleImportStyler } from "./diagram/ModuleImportStyler.ts";
import { ModuleImportGenerator } from "./diagram/ModuleImportGenerator.ts";

// Type-surface generators
import { TypeSurfaceStyler } from "./diagram/TypeSurfaceStyler.ts";
import { TypeSurfaceGenerator } from "./diagram/TypeSurfaceGenerator.ts";
import { type ExtractorFn, twoPassExtract } from "./diagram/twoPassExtract.ts";

// Type-surface extractors
import { extractDomainTypes } from "./diagram/DomainTypeExtractor.ts";
import { extractZodSchemas } from "./diagram/ZodSchemaExtractor.ts";
import { extractToolRegistrations } from "./diagram/ToolRegistrationExtractor.ts";

// Layer-surface generators
import { LayerSurfaceStyler } from "./diagram/LayerSurfaceStyler.ts";
import { LayerSurfaceGenerator } from "./diagram/LayerSurfaceGenerator.ts";
import { extractLayerTypes } from "./diagram/LayerTypeExtractor.ts";

// ── Defaults ───────────────────────────────────────────────────────────────────
const DEFAULT_OUTPUT_DIR = "./docs/";
const DEFAULT_ROOT_DIR = "./src";
const DEFAULT_EXCLUSIONS = ["**/generated/**", "graphql/**", "**/*test.ts"];

// ── Type-surface CONFIG ────────────────────────────────────────────────────────

const CONFIG = {
  domainTypeFiles: [
    "src/domain/types.ts",
  ],
  zodSchemaFiles: [
    "src/schemas/scrum.ts",
    "src/schemas/inputs.ts",
  ],
  schemaNameOverrides: {
    GetStorySchema: "GetItemDetailArgs",
    FindItemsSchema: "FindItemsArgs",
    GetAnalyticsSchema: "GetAnalyticsArgs",
    GetBoardHealthSchema: "GetBoardHealthArgs",
    CreateStorySchema: "CreateStoryArgs",
    UpdateStorySchema: "UpdateStoryArgs",
    SetFieldSchema: "SetFieldArgs",
    PlanSprintSchema: "PlanSprintArgs",
    LogImpedimentSchema: "LogImpedimentArgs",
    UpdateImpedimentSchema: "UpdateImpedimentArgs",
    AddVocabularySchema: "AddVocabularyArgs",
    GraphQLQuerySchema: "GraphQLQueryArgs",
  } as Record<string, string>,
  toolFiles: [
    "src/tools/scrum-read.ts",
    "src/tools/scrum-write.ts",
  ],
  toolResponseMap: {
    "scrum_orient": ["OrientResponse"],
    "scrum_get_item_detail": ["ItemDetailResponse"],
    "scrum_find_items": ["FindItemsResponse"],
    "scrum_get_analytics": ["AnalyticsResponse"],
    "scrum_get_board_health": ["BoardHealthResponse"],
    "scrum_create_story": ["Story"],
    "scrum_update_story": ["Story", "PartialFailureResponse"],
    "scrum_set_field": ["Story", "PartialFailureResponse"],
    "scrum_plan_sprint": ["PlanSprintResponse"],
    "scrum_log_impediment": ["LogImpedimentResponse"],
    "scrum_update_impediment": ["Story"],
    "scrum_add_vocabulary": ["Story"],
  } as Record<string, string[]>,
} as const;

// ── Layer-surface CONFIG (directory-prefix based) ──────────────────────────────

const LAYER_GRAPH_CONFIG = {
  useCasePrefixes: ["./src/scrum/", "./src/domain/"],
  adapterPrefixes: ["./src/adapters/"],
} as const;

// ── CLI ────────────────────────────────────────────────────────────────────────
const printHelp = (): void => {
  console.log(`
Usage: deno run -A scripts/generate-project-diagram.ts [options]

Options:
  --outputDir, -o <path>     Output folder path (default: ./docs/)
  --src <path>            Source directory to scan (default: ./src)
  --include-external      Include external imports (npm:, jsr:, @std/*)
  --help, -h              Show this help message

Output:
  Generates a project state report based on class relationships.
  Each module is represented as a class with its exported symbols.
  Unused exports are detected and reported.
  Also generates a namespaced type-surface diagram.
`);
};

const parseArgs = (): {
  output: string;
  src: string;
  includeExternal: boolean;
  help: boolean;
} => {
  const args = Deno.args;
  let output = DEFAULT_OUTPUT_DIR;
  let src = DEFAULT_ROOT_DIR;
  let includeExternal = false;
  let help = false;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--output":
      case "-o":
        output = args[++i] ?? output;
        break;
      case "--src":
        src = args[++i] ?? src;
        break;
      case "--include-external":
        includeExternal = false;
        break;
      case "--help":
      case "-h":
        help = true;
        break;
    }
  }

  return { output, src, includeExternal, help };
};

// ── Scanner ────────────────────────────────────────────────────────────────────

class GeneratedArtifact {
  constructor(private content: string, private nameExt: string, private saveDir: string) {
  }

  async saveArtifact() {
    try {
      await Deno.writeTextFile(path.join(this.saveDir, this.nameExt), this.content);
    } catch (err) {
      console.error(err);
    }
  }
}

const isExcluded = (relPath: string, patterns: string[]): boolean => {
  // Check if any path segment is an excluded directory (handles **/dir/** matching "foo/bar/dir")
  const segments = relPath.split("/");
  const hasExcludedDir = patterns.some((p) => {
    const regexCheck = p.match(/^(\*\*\/)?([^*]+)(\/\*\*)?$/);
    return regexCheck && segments.includes(regexCheck[2]);
  });
  if (hasExcludedDir) return true;

  // Convert glob to regex: ** → .* (any depth), * → [^/]* (single segment)
  const placeholder = "__GLOBSTAR__";
  return patterns.some((p) => {
    const regexStr = "^" +
      p
        .replace(/\*\*/g, placeholder)
        .replace(/\*/g, "[^/]*")
        .replace(new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), ".*") +
      "$";
    const re = new RegExp(regexStr);
    return re.test(relPath);
  });
};

const scanModules = async (
  srcDir: string,
  includeExternal: boolean,
): Promise<ParsedModule[]> => {
  const modules: ParsedModule[] = [];
  const walk = async (dir: string, rel: string): Promise<void> => {
    try {
      for await (const entry of Deno.readDir(dir)) {
        const full = `${dir}/${entry.name}`;
        const relPath = rel ? `${rel}/${entry.name}` : entry.name;

        if (entry.isDirectory) {
          if (!isExcluded(relPath, DEFAULT_EXCLUSIONS)) {
            await walk(full, relPath);
          }
        } else if (entry.isFile && entry.name.endsWith(".ts")) {
          if (!isExcluded(relPath, DEFAULT_EXCLUSIONS)) {
            const content = await Deno.readTextFile(full);
            const currentMod = new ParsedModule(full, content, includeExternal);
            modules.push(currentMod);
          }
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Error reading ${dir}:`, msg);
    }
  };

  await walk(srcDir, "");
  return modules;
};

// ── Module-import diagram generation ───────────────────────────────────────────

const generateModuleImportDiagram = (
  modules: ParsedModule[],
  unusedExports: UnusedExport[],
): string => {
  const options: ClassDiagramOptions = {
    showUnusedExports: true,
    showDependencyArrows: true,
  };

  const styler = new ModuleImportStyler(modules);
  const generator = new ModuleImportGenerator(modules, unusedExports, styler, options);
  return generator.generate();
};

// ── Type-surface diagram generation ────────────────────────────────────────────

const generateTypeSurfaceDiagram = (
  modules: ParsedModule[],
): { diagram: string; warnings: string[] } => {
  const domainModules = modules.filter((m) =>
    CONFIG.domainTypeFiles.some((p) => m.filePathName.endsWith(p))
  );
  const zodModules = modules.filter((m) =>
    CONFIG.zodSchemaFiles.some((p) => m.filePathName.endsWith(p))
  );
  const toolModules = modules.filter((m) =>
    CONFIG.toolFiles.some((p) => m.filePathName.endsWith(p))
  );

  const extractors: ExtractorFn[] = [
    ...domainModules.map((mod) => (known: Set<string>) =>
      extractDomainTypes(mod, "TypeScriptTypes", known)
    ),
    ...zodModules.map((mod) => (known: Set<string>) =>
      extractZodSchemas(mod, "ZodSchemas", known, CONFIG.schemaNameOverrides)
    ),
    ...toolModules.map((mod) => (known: Set<string>) =>
      extractToolRegistrations(
        mod,
        "ToolSurface",
        known,
        CONFIG.schemaNameOverrides,
        CONFIG.toolResponseMap,
      )
    ),
  ];

  const { classes, relationships, warnings, warningNodes } = twoPassExtract(extractors);

  const styler = new TypeSurfaceStyler(classes, warningNodes);
  const generator = new TypeSurfaceGenerator(classes, relationships, styler);
  const diagram = generator.generate();

  return { diagram, warnings };
};

// ── Layer-surface diagram generation ───────────────────────────────────────────

const generateLayerSurfaceDiagram = (
  modules: ParsedModule[],
): { diagram: string; warnings: string[] } => {
  const useCaseModules = modules.filter((m) =>
    LAYER_GRAPH_CONFIG.useCasePrefixes.some((p) => m.filePathName.startsWith(p))
  );
  const adapterModules = modules.filter((m) =>
    LAYER_GRAPH_CONFIG.adapterPrefixes.some((p) => m.filePathName.startsWith(p))
  );

  console.log(`  Use-case layer: ${useCaseModules.length} modules`);
  console.log(`  Adapter layer: ${adapterModules.length} modules`);

  const extractors: ExtractorFn[] = [
    ...useCaseModules.map((mod) => (known: Set<string>) =>
      extractLayerTypes(mod, "UseCaseLayer", known)
    ),
    ...adapterModules.map((mod) => (known: Set<string>) =>
      extractLayerTypes(mod, "AdapterLayer", known)
    ),
  ];

  const { classes, relationships, warnings, warningNodes } = twoPassExtract(extractors);

  console.log(
    `  Extracted ${classes.length} classes/types and ${relationships.length} relationships`,
  );

  const styler = new LayerSurfaceStyler(classes, warningNodes);
  const generator = new LayerSurfaceGenerator(classes, relationships, styler);
  const diagram = generator.generate();

  return { diagram, warnings };
};

// ── Report generation ──────────────────────────────────────────────────────────

const generateMarkdownReport = (
  unusedExports: UnusedExport[],
  moduleImportDiagram: string,
  outputDir: string,
): string => {
  let unusedExportsSection = "";
  if (unusedExports.length > 0) {
    const unusedRows = unusedExports
      .map(
        (i) =>
          `| [\`${i.modulePathName}\`](${
            path.relative(path.dirname(outputDir), i.modulePathName)
          }) | \`${i.name}\` | \`${i.kind}\` |`,
      )
      .join("\n");

    unusedExportsSection = `
## Unused Exports

The following exports are never directly imported by other modules in the codebase:

| Module | Export | Kind |
|---|---|---|
${unusedRows}
`;
  }

  return `# Current Structure Report

Generated by [generate-project-diagram.ts](../scripts/generate-project-diagram.ts)

This diagram shows the class structure of the codebase, with each module as a class containing its exported symbols, and relationships showing import dependencies.

---

## Module Overview

\`\`\`mermaid
${moduleImportDiagram}
\`\`\`

${unusedExportsSection}

## Notes

- Each class represents a TypeScript module
- Members are the exported symbols with their types
- Relationships show which modules import which
- Test files are excluded by default
- Generated code and GraphQL operations are excluded
- External imports (npm:, jsr:, @std/*) are filtered out

---

*Auto-generated - do not edit manually*
`;
};

// ── Main ───────────────────────────────────────────────────────────────────────
const main = async (): Promise<void> => {
  const args = parseArgs();

  if (args.help) {
    printHelp();
    return;
  }

  console.log(`Scanning ${args.src}...`);
  const modules = await scanModules(args.src, args.includeExternal);
  console.log(`Found ${modules.length} modules`);

  console.log("Building dependency graph...");
  const unusedExports = helper.findUnusedExports(modules);
  console.log(`Found ${unusedExports.length} unused exports`);

  // ── Module-import diagram ────────────────────────────────────────────────
  console.log("Generating module-import diagram...");
  const moduleImportDiagram = generateModuleImportDiagram(modules, unusedExports);

  // ── Type-surface diagram ─────────────────────────────────────────────────
  console.log("Generating type-surface diagram...");
  const { diagram: typeSurfaceDiagram, warnings: tsWarnings } = generateTypeSurfaceDiagram(modules);

  if (tsWarnings.length > 0) {
    console.log(`\n⚠  ${tsWarnings.length} clean-code warning(s):`);
    for (const w of tsWarnings) {
      console.warn(`\n  ${w}`);
    }
  }

  // ── Layer-surface diagram ────────────────────────────────────────────────
  console.log("Generating layer-surface diagram...");
  const { diagram: layerSurfaceDiagram, warnings: lsw } = generateLayerSurfaceDiagram(modules);

  if (lsw.length > 0) {
    console.log(`\n⚠  ${lsw.length} clean-code warning(s):`);
    for (const w of lsw) {
      console.warn(`\n  ${w}`);
    }
  }

  console.log("Generating report...");
  const mdReportBody = generateMarkdownReport(unusedExports, moduleImportDiagram, args.output);

  const outputDir = args.output.split("/").slice(0, -1).join("/");
  try {
    await Deno.mkdir(outputDir, { recursive: true });
  } catch {
    /* exists */
    console.log(outputDir, " already exists. Skipping folder creation...");
  }

  const reportObj = new GeneratedArtifact(mdReportBody, "report.md", args.output);
  const moduleDiagramObj = new GeneratedArtifact(
    moduleImportDiagram,
    "module-imports.mermaid",
    args.output,
  );
  const typeSurfaceObj = new GeneratedArtifact(
    typeSurfaceDiagram,
    "type-surface.mermaid",
    args.output,
  );
  const layerSurfaceObj = new GeneratedArtifact(
    layerSurfaceDiagram,
    "layer-surface.mermaid",
    args.output,
  );

  await reportObj.saveArtifact();
  await moduleDiagramObj.saveArtifact();
  await typeSurfaceObj.saveArtifact();
  await layerSurfaceObj.saveArtifact();
  console.log(`Saved to ${args.output}`);
};

main().catch((err) => {
  console.error("Failed:", err.message);
  Deno.exit(1);
});
