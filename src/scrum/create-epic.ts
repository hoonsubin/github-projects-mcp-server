// =============================================================================
// src/scrum/create-epic.ts - createEpicUseCase
//
// Creates a new epic (GitHub: milestone) via the platform's REST API.
// Returns an EpicRef the agent can use immediately for story assignment.
// =============================================================================

import type { CreateEpicInput, ProjectWriter } from "./ports.ts";
import type { EpicRef } from "../domain/types.ts";

export const createEpicUseCase = (
  backend: ProjectWriter,
  input: CreateEpicInput,
): Promise<EpicRef> => {
  return backend.createEpic(input);
};
