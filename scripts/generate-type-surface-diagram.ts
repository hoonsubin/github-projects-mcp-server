// =============================================================================
// scripts/generate-type-surface-diagram.ts
//
// Generates a namespaced Mermaid class diagram for the MCP tool surface,
// mapping types from src/domain/, src/schemas/, and src/tools/ into three
// distinct namespace blocks.
//
// Usage:
//   deno run -A scripts/generate-type-surface-diagram.ts [options]
//
// Options:
//   --output, -o <path>   Output .mermaid file (default: ./docs/type-surface.mermaid)
//   --src <path>          Source root (default: ./src)
//   --help, -h
//
// Design notes:
//   The generator runs in two passes to resolve cross-type relationships:
//     Pass 1 — collect class names from all three namespaces
//     Pass 2 — re-run extractors with the full name set to emit arrows only to
//              classes that actually appear in the diagram
// =============================================================================

import * as path from "@std/path";
import { extractDomainTypes } from "./diagram/tool-surface/DomainTypeExtractor.ts";
import { extractZodSchemas } from "./diagram/tool-surface/ZodSchemaExtractor.ts";
import { extractToolRegistrations } from "./diagram/tool-surface/ToolRegistrationExtractor.ts";
import {
  NamespacedDiagramGenerator,
  twoPassExtract,
  type ExtractorFn,
} from "./diagram/tool-surface/NamespacedDiagramGenerator.ts";

// ── Configuration ─────────────────────────────────────────────────────────────
//
// Adjust these to match your project layout.  Paths are relative to the
// project root (the directory from which you run the script).

const CONFIG = {
  // ── TypeScriptTypes namespace ──────────────────────────────────────────────
  domainTypeFiles: [
    "src/domain/types.ts",
  ],

  // ── ZodSchemas namespace ───────────────────────────────────────────────────
  zodSchemaFiles: [
    "src/schemas/scrum.ts",
    "src/schemas/inputs.ts",
  ],

  // Map exported schema variable names to the class names used in the diagram.
  // Any name NOT in this map gets the default treatment: strip "Schema" → add "Args".
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

  // ── ToolSurface namespace ──────────────────────────────────────────────────
  toolFiles: [
    "src/tools/scrum-read.ts",
    "src/tools/scrum-write.ts",
  ],

  // Manual map: tool name → response class name(s).
  // The ToolRegistrationExtractor cannot infer these automatically because
  // response types are determined by the use-case layer, not the tool handler.
  toolResponseMap: {
    "scrum_orient":           ["OrientResponse"],
    "scrum_get_item_detail":  ["ItemDetailResponse"],
    "scrum_find_items":       ["FindItemsResponse"],
    "scrum_get_analytics":    ["AnalyticsResponse"],
    "scrum_get_board_health": ["BoardHealthResponse"],
    "scrum_create_story":     ["Story"],
    "scrum_update_story":     ["Story", "PartialFailureResponse"],
    "scrum_set_field":        ["Story", "PartialFailureResponse"],
    "scrum_plan_sprint":      ["PlanSprintResponse"],
    "scrum_log_impediment":   ["LogImpedimentResponse"],
    "scrum_update_impediment":["Story"],
    "scrum_add_vocabulary":   ["Story"],
  } as Record<string, string[]>,
} as const;

// ── CLI ────────────────────────────────────────────────────────────────────────

function parseArgs(): { output: string; src: string; help: boolean } {
  const args = Deno.args;
  let output = "./docs/type-surface.mermaid";
  let src = "./src";
  let help = false;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--output": case "-o": output = args[++i] ?? output; break;
      case "--src":               src    = args[++i] ?? src;    break;
      case "--help":  case "-h":  help = true;                  break;
    }
  }
  return { output, src, help };
}

function printHelp(): void {
  console.log(`
Usage: deno run -A scripts/generate-type-surface-diagram.ts [options]

Options:
  --output, -o <path>   Output .mermaid file (default: ./docs/type-surface.mermaid)
  --src <path>          Source root (default: ./src)
  --help, -h            Show this help

Generates a Mermaid classDiagram with three namespaces:
  TypeScriptTypes  — interfaces/types from src/domain/types.ts
  ZodSchemas       — Zod z.object() schemas from src/schemas/
  ToolSurface      — server.registerTool() registrations from src/tools/
`);
}

// ── File reading ───────────────────────────────────────────────────────────────

async function readFile(filePath: string): Promise<string | null> {
  try {
    return await Deno.readTextFile(filePath);
  } catch {
    console.warn(`  [warn] Could not read ${filePath} — skipping`);
    return null;
  }
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs();
  if (args.help) { printHelp(); return; }

  const cwd = Deno.cwd();
  const resolve = (p: string) => path.resolve(cwd, p);

  // ── Build extractor functions ─────────────────────────────────────────────
  //
  // Each function accepts `knownNames` (populated on pass 2) and returns
  // classes + relationships.  We collect them all into an array so that
  // twoPassExtract() can run them twice with the correct known-names set.

  const extractors: ExtractorFn[] = [];

  // TypeScriptTypes extractors
  for (const relPath of CONFIG.domainTypeFiles) {
    const absPath = resolve(relPath);
    const source = await readFile(absPath);
    if (!source) continue;
    console.log(`  [domain] ${relPath}`);

    extractors.push((knownNames) =>
      extractDomainTypes(absPath, source, "TypeScriptTypes", knownNames)
    );
  }

  // ZodSchemas extractors
  for (const relPath of CONFIG.zodSchemaFiles) {
    const absPath = resolve(relPath);
    const source = await readFile(absPath);
    if (!source) continue;
    console.log(`  [schema] ${relPath}`);

    extractors.push((knownNames) =>
      extractZodSchemas(
        absPath,
        source,
        "ZodSchemas",
        knownNames,
        CONFIG.schemaNameOverrides,
      )
    );
  }

  // ToolSurface extractors
  for (const relPath of CONFIG.toolFiles) {
    const absPath = resolve(relPath);
    const source = await readFile(absPath);
    if (!source) continue;
    console.log(`  [tool]   ${relPath}`);

    extractors.push((knownNames) =>
      extractToolRegistrations(
        absPath,
        source,
        "ToolSurface",
        knownNames,
        CONFIG.schemaNameOverrides,
        CONFIG.toolResponseMap,
      )
    );
  }

  // ── Two-pass extraction ───────────────────────────────────────────────────
  console.log("\nRunning two-pass extraction...");
  const { classes, relationships, warnings, warningNodes } = twoPassExtract(extractors);

  console.log(`  Found ${classes.length} classes`);
  console.log(`  Found ${relationships.length} relationships`);

  // ── Diagnostic: report classes per namespace ──────────────────────────────
  for (const ns of ["TypeScriptTypes", "ZodSchemas", "ToolSurface"] as const) {
    const count = classes.filter((c) => c.namespace === ns).length;
    console.log(`    ${ns}: ${count}`);
  }

  // ── Clean-code warnings ───────────────────────────────────────────────────
  if (warnings.length > 0) {
    console.log(`\n⚠  ${warnings.length} clean-code warning(s):`);
    for (const w of warnings) {
      console.warn(`\n  ${w}`);
    }
  }

  // ── Generate Mermaid output ───────────────────────────────────────────────
  console.log("\nGenerating diagram...");
  const generator = new NamespacedDiagramGenerator(classes, relationships, warningNodes);
  const diagram = generator.generate();

  // ── Write output ──────────────────────────────────────────────────────────
  const outputPath = resolve(args.output);
  const outputDir = path.dirname(outputPath);
  try { await Deno.mkdir(outputDir, { recursive: true }); } catch { /* exists */ }

  await Deno.writeTextFile(outputPath, diagram);
  console.log(`\nSaved to ${outputPath}`);
  console.log(`Preview: https://mermaid.live (paste file contents)`);
}

main().catch((err) => {
  console.error("Failed:", err instanceof Error ? err.message : String(err));
  Deno.exit(1);
});
