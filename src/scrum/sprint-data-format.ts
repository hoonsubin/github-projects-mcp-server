// =============================================================================
// src/scrum/sprint-data-format.ts - Agent-facing sprint data shapes
// =============================================================================

import type { ScrumConfig } from "../domain/config.ts";
import type { SprintRawData } from "./ports.ts";
import { formatSprintInfo } from "./sprint-raw-format.ts";
import { buildSprintSummary, filterSprintItems, type SprintSummary } from "./sprint-summary.ts";
import { terminalStatusDisplayNames } from "./terminal-statuses.ts";

export type SprintDataView = "summary" | "items";

export interface FormattedSprintData {
  readonly sprint: ReturnType<typeof formatSprintInfo>;
  readonly summary?: SprintSummary;
  readonly items?: SprintRawData["items"];
}

export const formatSprintDataForAgent = (
  data: SprintRawData,
  scrumConfig: ScrumConfig,
  options: { view: SprintDataView; active_only: boolean },
): FormattedSprintData => {
  const terminal = terminalStatusDisplayNames(scrumConfig);
  const scoped = filterSprintItems(data.items, terminal, options.active_only);

  const formatted: FormattedSprintData = {
    sprint: formatSprintInfo(data.sprint),
    summary: buildSprintSummary(scoped, terminal),
  };

  if (options.view === "items") {
    return { ...formatted, items: scoped };
  }

  return formatted;
};
