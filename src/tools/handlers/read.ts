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
import type { SprintRef, StoryRef } from "../../domain/types.ts";
import type { z } from "zod";
import { getItemDetailUseCase } from "../../scrum/get-item-detail.ts";
import { findItemsUseCase } from "../../scrum/find-items.ts";
import { getSprintDataUseCase } from "../../scrum/get-sprint-data.ts";
import { formatSprintDataForAgent } from "../../scrum/sprint-data-format.ts";
import { projectItemDetailForAgent } from "../../scrum/item-detail-projection.ts";
import { SCRUM_GLOSSARY_NOTE } from "../../scrum/server-instructions.ts";
import type { SessionCache } from "../../services/session-cache.ts";
import { type McpTextResult, toMcpTextResult } from "../_mcp_result.ts";
import { toToolErrorResult } from "../handler-errors.ts";

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
  const detail = params.detail ?? "session";
  const { data, warnings } = await sessionCache.orient(backend, scrumConfig, {
    detail,
    refresh: params.refresh ?? false,
  });

  const mergedWarnings = [...warnings];
  if (detail === "full") {
    mergedWarnings.push(
      'detail: "full" loads team/templates and uses more context — prefer "session" for routine Sprint Master work.',
    );
  }

  return toMcpTextResult(mergeWarnings({
    ...data,
    _scrum_glossary: SCRUM_GLOSSARY_NOTE,
  }, mergedWarnings));
};

export const handleGetItemDetail = async (
  backend: ProjectBackend,
  params: z.input<typeof GetStorySchema>,
): Promise<McpTextResult> => {
  try {
    const tier = (params.detail ?? "dor") as "dor" | "full";
    const { data, warnings } = await getItemDetailUseCase(backend, params.ref as StoryRef);
    const fullPayload = mergeWarnings(data, warnings);
    const textPayload = projectItemDetailForAgent(fullPayload, tier);
    return toMcpTextResult(fullPayload, { textPayload });
  } catch (err) {
    return toToolErrorResult(err);
  }
};

export const handleFindItems = async (
  backend: ProjectBackend,
  params: z.input<typeof FindItemsSchema>,
): Promise<McpTextResult> => {
  try {
    const { data, warnings } = await findItemsUseCase(backend, params);
    return toMcpTextResult(mergeWarnings(data, warnings));
  } catch (err) {
    return toToolErrorResult(err);
  }
};

export const handleGetSprintData = async (
  backend: ProjectBackend,
  scrumConfig: ScrumConfig,
  params: z.input<typeof GetSprintDataSchema>,
): Promise<McpTextResult> => {
  const sprint = params.sprint === undefined ? "current" : params.sprint;
  const view = (params.view ?? "summary") as "summary" | "items";
  const active_only = params.active_only ?? true;

  if (sprint === null) {
    return toMcpTextResult({ sprint: null, summary: null, items: [] });
  }

  try {
    const { data, warnings } = await getSprintDataUseCase(backend, {
      sprint_ref: sprint as SprintRef,
    });
    const formatted = formatSprintDataForAgent(data, scrumConfig, { view, active_only });
    return toMcpTextResult(mergeWarnings({
      ...formatted,
      _scrum_glossary: SCRUM_GLOSSARY_NOTE,
    }, warnings));
  } catch (err) {
    return toToolErrorResult(err);
  }
};
