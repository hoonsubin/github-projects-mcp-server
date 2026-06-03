// =============================================================================
// scripts/audit/stages/c4-diagram.ts — C4 diagram generation stage
// =============================================================================

import type { AuditConfig, AuditStage, C4DiagramResult } from "../types.ts";
import { generateC4Diagram } from "../generate-c4-model.ts";

export const c4DiagramStage: AuditStage<C4DiagramResult> = {
  name: "c4-diagram",

  run: (config: AuditConfig): Promise<C4DiagramResult> => {
    return generateC4Diagram(config.srcDir);
  },
};
