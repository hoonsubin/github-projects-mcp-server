// =============================================================================
// scripts/audit/renderers/mermaid-file.ts — Write mermaid diagram to .mermaid file
//
// Uses renderMermaidFenced so the output includes ```mermaid...``` fences,
// making it compatible with GitHub's mermaid renderer and other tools that
// expect the markdown fence.
// =============================================================================

import type { LayerGraphResult } from "../types.ts";
import { renderMermaidFenced } from "./mermaid.ts";

/**
 * Write the layer dependency graph as a standalone `.mermaid` file.
 * The output includes the markdown code fence (```mermaid) so it can be
 * rendered directly by GitHub and other mermaid-aware tools.
 */
export const saveMermaidFile = async (
  result: LayerGraphResult,
  outputPath: string,
): Promise<void> => {
  const source = renderMermaidFenced(result);
  await Deno.writeTextFile(outputPath, source);
};
