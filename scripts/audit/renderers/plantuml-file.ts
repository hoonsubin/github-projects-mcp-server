// =============================================================================
// scripts/audit/renderers/plantuml-file.ts — Write C4 diagram to .puml file
// =============================================================================

import type { C4DiagramResult } from "../types.ts";
import { renderC4Source } from "./plantuml.ts";

/**
 * Write the C4 diagram as a standalone `.puml` file.
 */
export const savePlantumlFile = async (
  result: C4DiagramResult,
  outputPath: string,
): Promise<void> => {
  const source = renderC4Source(result);
  await Deno.writeTextFile(outputPath, source);
};
