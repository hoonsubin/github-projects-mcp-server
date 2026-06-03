// =============================================================================
// scripts/audit/stages/unused-exports.ts — Unused export detection via TS Compiler API
//
// Reuses the existing ParsedModule scanner and findUnusedExports() from
// scripts/diagram/. This is the only stage that preserves the old code.
// =============================================================================

import type { AuditStage, UnusedExportResult } from "../types.ts";
import { ParsedModule } from "../../diagram/ParsedModule.ts";
import { findUnusedExports } from "../../diagram/helpers.ts";

const isExcluded = (filePath: string, excludedDirs: string[]): boolean => {
  for (const dir of excludedDirs) {
    if (filePath.includes(dir)) return true;
  }
  return false;
};

export const unusedExportsStage: AuditStage<UnusedExportResult> = {
  name: "unused-exports",

  run: async (config, _deps) => {
    const modules: ParsedModule[] = [];
    const { srcDir, excludedDirs } = config;

    for await (const entry of Deno.readDir(srcDir)) {
      if (entry.isDirectory) {
        await scanDirectory(`${srcDir}/${entry.name}`, modules, excludedDirs);
      } else {
        if (isExcluded(entry.name, excludedDirs)) continue;
        if (!entry.name.endsWith(".ts") || entry.name.endsWith(".d.ts")) continue;
        const content = await Deno.readTextFile(`${srcDir}/${entry.name}`);
        modules.push(new ParsedModule(entry.name, content));
      }
    }

    const unused = findUnusedExports(modules);

    return { exports: unused };
  },
};

// ── Helpers ────────────────────────────────────────────────────────────────────

const scanDirectory = async (
  dirPath: string,
  modules: ParsedModule[],
  excludedDirs: string[],
): Promise<void> => {
  for await (const entry of Deno.readDir(dirPath)) {
    const fullPath = `${dirPath}/${entry.name}`;

    if (entry.isDirectory) {
      await scanDirectory(fullPath, modules, excludedDirs);
      continue;
    }

    if (!entry.name.endsWith(".ts") || entry.name.endsWith(".d.ts")) continue;
    if (isExcluded(entry.name, excludedDirs)) continue;

    // Build path relative to src/ for ParsedModule
    const relativePath = fullPath.replace(/^\.?\/?/, "");
    const content = await Deno.readTextFile(fullPath);
    modules.push(new ParsedModule(relativePath, content));
  }
};
