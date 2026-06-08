// =============================================================================
// src/scrum/get-sprint-data.ts - getSprintDataUseCase
//
// Raw sprint data (no aggregation). Delegates to SprintDataPort.
// The adapter must implement getSprintData() to return SprintRawData.
// =============================================================================

import type { SprintDataPort, SprintDataQuery, SprintRawData } from "./ports.ts";
import type { UseCaseResult } from "../domain/types.ts";

/**
 * Return raw sprint items with completion timestamps for the given sprint.
 *
 * This use-case is a thin bridge - it passes through to the adapter.
 * The adapter is responsible for collecting items, resolving completion
 * timestamps, and returning them as SprintRawData.
 */
export const getSprintDataUseCase = async (
  backend: SprintDataPort,
  query: SprintDataQuery,
): Promise<UseCaseResult<SprintRawData>> => {
  const data = await backend.getSprintData(query);
  return { data, warnings: [] };
};
