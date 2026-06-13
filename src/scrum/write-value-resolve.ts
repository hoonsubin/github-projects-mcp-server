// =============================================================================
// src/scrum/write-value-resolve.ts - Canonical keys → display labels for writes
// =============================================================================

import type { ScrumConfig } from "../domain/config.ts";
import type { ScrumField } from "../domain/types.ts";

/** Resolve status/priority canonical keys to board display names. */
export const resolveWriteFieldValue = (
  scrumConfig: ScrumConfig,
  field: ScrumField,
  value: string | number | null | undefined,
): string | number | null | undefined => {
  if (typeof value !== "string") return value;

  if (field === "status") {
    return scrumConfig.status_display?.[value] ?? value;
  }
  if (field === "priority") {
    return scrumConfig.priority_display?.[value] ?? value;
  }
  return value;
};
