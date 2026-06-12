// =============================================================================
// src/tools/handlers/read.ts - Extracted scrum_* read tool handlers
// =============================================================================

import type { ProjectBackend } from "../../scrum/ports.ts";
import type { ScrumConfig } from "../../domain/config.ts";
import {
  FindItemsSchema,
  GetSprintDataSchema,
  GetStorySchema,
  OrientSchema,
} from "../../schemas/scrum.ts";
import type { SprintRef } from "../../domain/types.ts";
import type { z } from "zod";
import { getItemDetailUseCase } from "../../scrum/get-item-detail.ts";
import { findItemsUseCase } from "../../scrum/find-items.ts";
import { getSprintDataUseCase } from "../../scrum/get-sprint-data.ts";
import { formatSprintRawData } from "../../scrum/sprint-raw-format.ts";
import type { SessionCache } from "../../services/session-cache.ts";
import { type McpTextResult, toMcpTextResult } from "../_mcp_result.ts";

const mergeWarnings = <T extends object>(
  data: T,
  warnings: readonly string[],
): T & { warnings?: string[] } => warnings.length > 0 ? { ...data, warnings: [...warnings] } : data;

export const handleOrient = async (
  backend: ProjectBackend,
  scrumConfig: ScrumConfig,
  sessionCache: SessionCache,
  params: z.infer<typeof OrientSchema> = { detail: "session", refresh: false },
): Promise<McpTextResult> => {
  const { data, warnings } = await sessionCache.orient(backend, scrumConfig, {
    detail: params.detail ?? "session",
    refresh: params.refresh ?? false,
  });
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
  params: z.input<typeof FindItemsSchema>,
): Promise<McpTextResult> => {
  const { data, warnings } = await findItemsUseCase(backend, params);
  return toMcpTextResult(mergeWarnings(data, warnings));
};

export const handleGetSprintData = async (
  backend: ProjectBackend,
  params: z.infer<typeof GetSprintDataSchema>,
): Promise<McpTextResult> => {
  const sprint = params.sprint === undefined ? "current" : params.sprint;
  if (sprint === null) {
    return toMcpTextResult({ sprint: null, items: [] });
  }

  const { data, warnings } = await getSprintDataUseCase(backend, {
    sprint_ref: sprint as SprintRef,
  });
  return toMcpTextResult(mergeWarnings(formatSprintRawData(data), warnings));
};
