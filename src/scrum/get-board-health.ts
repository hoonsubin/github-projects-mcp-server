// =============================================================================
// src/scrum/get-board-health.ts — getBoardHealthUseCase
//
// Board health dashboard (no item lists). Delegates to BoardHealthPort.
// The adapter must implement getBoardHealth() (P7) before this returns real data;
// until then the adapter stub will throw.
// =============================================================================

import type { BoardHealthPort } from "./ports.ts";
import type { BacklogHealth } from "../domain/types.ts";

/**
 * Return board health metrics for the given sprint scope.
 *
 * This use-case is a thin bridge — it passes through to the adapter.
 * The adapter computes health metrics behind the BoardHealthPort interface.
 */
export const getBoardHealthUseCase = (
  backend: BoardHealthPort,
  sprintScope: string,
): Promise<BacklogHealth> => {
  return backend.getBoardHealth(sprintScope);
};
