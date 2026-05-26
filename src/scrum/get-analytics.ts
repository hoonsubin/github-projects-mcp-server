// =============================================================================
// src/scrum/get-analytics.ts - getAnalyticsUseCase
//
// Unified sprint analytics (burndown + history). Delegates to AnalyticsPort.
// The adapter must implement getAnalytics() (P7) before this returns real data;
// until then the adapter stub will throw.
// =============================================================================

import type { AnalyticsPort, AnalyticsQuery } from "./ports.ts";
import type { AnalyticsResult, UseCaseResult } from "../domain/types.ts";

/**
 * Return unified sprint analytics for the given query.
 *
 * This use-case is a thin bridge - it passes through to the adapter.
 * The adapter merges burndown and history data behind the AnalyticsPort interface.
 */
export const getAnalyticsUseCase = async (
  backend: AnalyticsPort,
  query: AnalyticsQuery,
): Promise<UseCaseResult<AnalyticsResult>> => {
  const data = await backend.getAnalytics(query);
  return { data, warnings: [] };
};
