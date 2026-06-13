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
import type { SessionCache } from "../../services/session-cache.ts";
import { type McpTextResult, toMcpTextResult } from "../_mcp_result.ts";
import { toToolErrorResult } from "../handler-errors.ts";

const mergeWarnings = <T extends object>(
  data: T,
  warnings: readonly string[],
): T & { warnings?: string[] } => warnings.length > 0 ? { ...data, warnings: [...warnings] } : data;

/**
 * Recursively strip null values and empty arrays/objects from the orient payload
 * before text serialization. Keeps false, 0, and empty strings — only structural
 * "absence" markers (null, []) are removed so agents never see noise like
 * `team: null` or `missing_options: []`.
 *
 * structuredContent retains the full unpruned payload for machine readers.
 */
const pruneOrientOutput = (value: unknown): unknown => {
  if (value === null) return undefined;
  if (Array.isArray(value)) {
    const pruned = (value as unknown[]).map(pruneOrientOutput).filter((v) => v !== undefined);
    return pruned.length === 0 ? undefined : pruned;
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const pruned = pruneOrientOutput(child);
      if (pruned !== undefined) out[key] = pruned;
    }
    return Object.keys(out).length === 0 ? undefined : out;
  }
  return value;
};

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

  const fullPayload = mergeWarnings(data, mergedWarnings);
  // Text channel: pruned for agent clarity (no nulls, no empty arrays).
  // structuredContent: full payload retained for machine readers.
  return toMcpTextResult(fullPayload, { textPayload: pruneOrientOutput(fullPayload) });
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
    // Attach fields_mode so clients can discriminate which item projection was applied.
    const fields_mode = (params.fields ?? "compact") as "compact" | "standard" | "full";
    return toMcpTextResult(mergeWarnings({ ...data, fields_mode }, warnings));
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
    return toMcpTextResult(mergeWarnings(formatted, warnings));
  } catch (err) {
    return toToolErrorResult(err);
  }
};
