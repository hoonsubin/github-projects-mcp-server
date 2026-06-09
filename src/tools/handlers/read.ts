// =============================================================================
// src/tools/handlers/read.ts - Extracted scrum_* read tool handlers
// =============================================================================

import type { ProjectBackend } from "../../scrum/ports.ts";
import type { ScrumConfig } from "../../domain/config.ts";
import {
  FindItemsSchema,
  GetAnalyticsSchema,
  GetBoardHealthSchema,
  GetSprintDataSchema,
  GetStorySchema,
} from "../../schemas/scrum.ts";
import type { SprintRef } from "../../domain/types.ts";
import type { z } from "zod";
import { orientUseCase } from "../../scrum/orient.ts";
import { getItemDetailUseCase } from "../../scrum/get-item-detail.ts";
import { findItemsUseCase } from "../../scrum/find-items.ts";
import { getSprintDataUseCase } from "../../scrum/get-sprint-data.ts";
import { type McpTextResult, toMcpTextResult } from "../_mcp_result.ts";

const mergeWarnings = <T extends object>(
  data: T,
  warnings: readonly string[],
): T & { warnings?: string[] } => warnings.length > 0 ? { ...data, warnings: [...warnings] } : data;

const DEPRECATION_STUB = {
  deprecated: true as const,
  use: "scrum_get_sprint_data" as const,
};

export const handleOrient = async (
  backend: ProjectBackend,
  scrumConfig: ScrumConfig,
): Promise<McpTextResult> => {
  const { data, warnings } = await orientUseCase(backend, scrumConfig);
  return toMcpTextResult(mergeWarnings(data, warnings));
};

export const handleGetItemDetail = async (
  backend: ProjectBackend,
  params: z.infer<typeof GetStorySchema>,
): Promise<McpTextResult> => {
  const { data, warnings } = await getItemDetailUseCase(backend, params.ref);
  return toMcpTextResult(mergeWarnings(data, warnings));
};

export const handleFindItems = async (
  backend: ProjectBackend,
  params: z.infer<typeof FindItemsSchema>,
): Promise<McpTextResult> => {
  const { data, warnings } = await findItemsUseCase(backend, params);
  return toMcpTextResult(mergeWarnings(data, warnings));
};

export const handleGetAnalytics = (
  _backend: ProjectBackend,
  _params: z.infer<typeof GetAnalyticsSchema>,
): Promise<McpTextResult> => Promise.resolve(toMcpTextResult(DEPRECATION_STUB));

export const handleGetBoardHealth = (
  _backend: ProjectBackend,
  _params: z.infer<typeof GetBoardHealthSchema>,
): Promise<McpTextResult> => Promise.resolve(toMcpTextResult(DEPRECATION_STUB));

export const handleGetSprintData = async (
  backend: ProjectBackend,
  params: z.infer<typeof GetSprintDataSchema>,
): Promise<McpTextResult> => {
  // "all" is only meaningful for scrum_find_items — resolve to null here.
  const { data, warnings } = await getSprintDataUseCase(backend, {
    sprint_ref: (params.sprint_ref === "all" ? null : params.sprint_ref) as SprintRef,
  });
  return toMcpTextResult(mergeWarnings(data, warnings));
};
