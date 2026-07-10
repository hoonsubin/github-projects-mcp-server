// =============================================================================
// src/scrum/update-epic.ts - updateEpicUseCase
//
// Updates an epic's name, description, or closure status (open/done).
// Returns the full EpicListing after mutation so agents see the new state.
// =============================================================================

import type { EpicListing, EpicRef } from "../domain/types.ts";
import type { EpicUpdates, ProjectWriter } from "./ports.ts";

export const updateEpicUseCase = (
  backend: ProjectWriter,
  ref: EpicRef,
  updates: EpicUpdates,
): Promise<EpicListing> => {
  return backend.updateEpic(ref, updates);
};
