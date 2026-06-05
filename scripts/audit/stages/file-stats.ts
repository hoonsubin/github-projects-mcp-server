// =============================================================================
// scripts/audit/stages/file-stats.ts — File count and LOC per layer
//
// Walks the src/ directory, counts files and lines of code per architectural
// layer, and identifies the top-3 largest files per layer.
// =============================================================================

import type {
  AuditStage,
  FileStatEntry,
  FileStatsResult,
  LayerFileStats,
  LayerName,
} from "../types.ts";
import { classifyModule } from "../layer-classification.ts";
import { createExclusionFilter } from "../filters.ts";

/** Determine if a file is a TypeScript source file we should count. */
const isTsFile = (filePath: string): boolean => {
  return filePath.endsWith(".ts") && !filePath.endsWith(".d.ts");
};

export const fileStatsStage: AuditStage<FileStatsResult> = {
  name: "file-stats",

  run: async (config, _deps) => {
    const layerFiles = new Map<LayerName, FileStatEntry[]>();
    const { srcDir, excludedDirs } = config;
    const isExcluded = createExclusionFilter(excludedDirs);

    // Walk src/ recursively and collect stats
    await collectFiles(srcDir, srcDir, layerFiles, isExcluded);

    const layers: LayerFileStats[] = [...layerFiles.entries()]
      .map(([layer, files]) => {
        const sorted = files.sort((a, b) => b.lines - a.lines);
        const totalLines = sorted.reduce((sum, f) => sum + f.lines, 0);
        const topThreeLargest = sorted.slice(0, 3);

        return {
          layer,
          fileCount: files.length,
          totalLines,
          topThreeLargest,
        };
      })
      .sort((a, b) => b.totalLines - a.totalLines);

    return { layers };
  },
};

// ── Helpers ────────────────────────────────────────────────────────────────────

const collectFiles = async (
  baseDir: string,
  dirPath: string,
  layerFiles: Map<LayerName, FileStatEntry[]>,
  isExcluded: (path: string) => boolean,
): Promise<void> => {
  for await (const entry of Deno.readDir(dirPath)) {
    const fullPath = `${dirPath}/${entry.name}`;

    if (entry.isDirectory) {
      await collectFiles(baseDir, fullPath, layerFiles, isExcluded);
      continue;
    }

    if (!entry.isFile || !isTsFile(entry.name)) continue;

    // Convert to relative path from src/
    const relativePath = fullPath.startsWith("./") ? fullPath : fullPath;
    const srcRelative = relativePath.startsWith(baseDir)
      ? relativePath.slice(baseDir.length).replace(/^\//, "")
      : relativePath;

    if (isExcluded(srcRelative)) continue;

    const layer = classifyModule(srcRelative);
    const content = await Deno.readTextFile(fullPath);
    const lines = content.split("\n").length;

    const entry_stats: FileStatEntry = { path: srcRelative, lines };

    const existing = layerFiles.get(layer);
    if (existing) {
      existing.push(entry_stats);
    } else {
      layerFiles.set(layer, [entry_stats]);
    }
  }
};
