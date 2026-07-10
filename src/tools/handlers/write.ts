// =============================================================================
// src/tools/handlers/write.ts - Extracted scrum_* write tool handlers
// =============================================================================

import type {
  CreateEpicInput,
  CreateStoryInput,
  EpicUpdates,
  ProjectBackend,
  StoryUpdates,
} from "../../scrum/ports.ts";
import type { EpicRef, SprintRef, Story, StoryRef } from "../../domain/types.ts";
import type { ScrumConfig } from "../../domain/config.ts";
import { createEpicUseCase } from "../../scrum/create-epic.ts";
import { updateEpicUseCase } from "../../scrum/update-epic.ts";
import { updateImpedimentUseCase } from "../../scrum/update-impediment.ts";
import {
  AddVocabularySchema,
  CreateEpicSchema,
  CreateStorySchema,
  LogImpedimentSchema,
  PlanSprintSchema,
  SetFieldSchema,
  UpdateEpicSchema,
  UpdateImpedimentSchema,
  UpdateStorySchema,
} from "../../schemas/scrum.ts";
import { catchBackend } from "../../services/error-enrichment.ts";
import { pickDefined } from "../../services/pick-defined.ts";
import { resolveSprintQuery } from "../../scrum/sprint-filter.ts";
import { resolveWriteFieldValue } from "../../scrum/write-value-resolve.ts";
import { assertAddVocabularyAllowed } from "../../scrum/validate-add-vocabulary.ts";
import { stripReservedLabels } from "../../scrum/validate-labels.ts";
import type { SessionCache } from "../../services/session-cache.ts";
import type { z } from "zod";
import { type McpTextResult, toMcpTextResult } from "../_mcp_result.ts";
import { toToolErrorResult } from "../handler-errors.ts";

type PartialFailureFields = Array<{ field: string; reason: string }>;

const storyRefId = (ref: StoryRef): string => "id" in ref ? ref.id : String(ref.number);

const writeAck = (
  ref: StoryRef,
  field?: string,
  warnings: readonly string[] = [],
): Record<string, unknown> => ({
  ref: { id: storyRefId(ref) },
  applied: true as const,
  ...(field ? { field } : {}),
  ...(warnings.length > 0 ? { warnings: [...warnings] } : {}),
});

/** Map MCP tool params (snake_case) to backend CreateStoryInput (camelCase). */
export const toCreateStoryInput = (
  params: z.infer<typeof CreateStorySchema>,
): CreateStoryInput => ({
  title: params.title,
  body: params.body,
  type: params.type,
  ...(params.priority !== undefined ? { priority: params.priority } : {}),
  ...(params.story_points !== undefined ? { storyPoints: params.story_points } : {}),
  ...(params.labels !== undefined ? { labels: params.labels } : {}),
  ...(params.epic !== undefined ? { epic: params.epic } : {}),
  ...(params.assignees !== undefined ? { assignees: params.assignees } : {}),
  ...(params.sprint !== undefined ? { sprint: params.sprint as SprintRef } : {}),
});

export const resolveP0PriorityDisplay = (scrumConfig: ScrumConfig): string =>
  scrumConfig.priority_display?.[scrumConfig.scrum.priority?.[0]?.key ?? "p0"] ?? "Must";

const resolveRaisedBy = (scrumConfig: ScrumConfig, raisedBy?: string): string | null => {
  if (raisedBy) return raisedBy;
  const sm = scrumConfig.project.team?.find((m) => m.role === "scrum_master");
  return sm?.name ?? null;
};

export const handleAddVocabulary = async (
  backend: ProjectBackend,
  scrumConfig: ScrumConfig,
  sessionCache: SessionCache,
  params: z.infer<typeof AddVocabularySchema>,
): Promise<McpTextResult> => {
  if (params.kind !== "label") {
    const { value: state } = await backend.getPlatformState({
      canonicalStatusKeys: Object.keys(scrumConfig.scrum.status),
      canonicalPriorityKeys: scrumConfig.scrum.priority.map((p) => p.key),
    });
    if (!state) {
      throw new Error("getPlatformState returned null without throwing");
    }
    try {
      assertAddVocabularyAllowed(
        scrumConfig,
        params.kind,
        params.value,
        state.fields.status.missingOptions,
        state.fields.priority.missingOptions,
      );
    } catch (err) {
      return toToolErrorResult(err);
    }
  }

  let result: Awaited<ReturnType<typeof backend.addVocabulary>>;
  try {
    result = await backend.addVocabulary(params.kind, params.value);
  } catch (err) {
    return toToolErrorResult(err);
  }
  sessionCache.invalidateOrient();
  return toMcpTextResult({ ...result, kind: params.kind, value: params.value });
};

export const handleSetField = async (
  backend: ProjectBackend,
  scrumConfig: ScrumConfig,
  params: z.input<typeof SetFieldSchema>,
): Promise<McpTextResult> => {
  const ref = params.ref as StoryRef;
  if (params.field === "sprint" && params.value === "all") {
    throw new Error(
      '"all" is not a valid sprint target. Use "current", "next", a sprint name, or null.',
    );
  }

  const value = resolveWriteFieldValue(scrumConfig, params.field, params.value) as
    | string
    | number
    | SprintRef
    | null;

  const { warnings } = await catchBackend(
    () => backend.setField(ref, params.field, value),
  );

  if ((params.response ?? "ack") === "ack") {
    return toMcpTextResult(writeAck(ref, params.field, warnings));
  }

  const { value: composeResult, warnings: composeWarnings } = await catchBackend(
    () => backend.composeStoryAfterSetField(ref, params.field, value),
  );
  const story = composeResult?.value ?? null;
  const allWarnings = [...warnings, ...composeWarnings, ...(composeResult?.warnings ?? [])];
  const response = allWarnings.length > 0 ? { ...story, warnings: allWarnings } : story;
  return toMcpTextResult(response);
};

export const handleUpdateStory = async (
  backend: ProjectBackend,
  scrumConfig: ScrumConfig,
  params: z.input<typeof UpdateStorySchema>,
): Promise<McpTextResult> => {
  const ref = params.ref as StoryRef;
  const rawUpdates = pickDefined(params, [
    "title",
    "body",
    "labels",
    "assignees",
    "epic",
    "blocked_by",
  ]);
  const updates = rawUpdates.labels !== undefined
    ? {
      ...rawUpdates,
      labels: stripReservedLabels(rawUpdates.labels as readonly string[], scrumConfig),
    }
    : rawUpdates;
  const allWarnings: string[] = [];

  const { warnings: w1 } = await catchBackend(
    () => backend.updateStory(ref, updates as StoryUpdates),
  );
  allWarnings.push(...w1);

  if (params.comment !== undefined) {
    const { warnings: w2 } = await catchBackend(
      () => backend.addComment(ref, params.comment!),
    );
    allWarnings.push(...w2);
  }

  if ((params.response ?? "ack") === "ack") {
    return toMcpTextResult(writeAck(ref, undefined, allWarnings));
  }

  const { value: composeResult, warnings: w3 } = await catchBackend(
    () => backend.composeStoryAfterStoryUpdate(ref, updates as StoryUpdates),
  );
  allWarnings.push(...w3, ...(composeResult?.warnings ?? []));
  const story = composeResult?.value ?? null;
  const response = allWarnings.length > 0 ? { ...story, warnings: allWarnings } : story;
  return toMcpTextResult(response);
};

export const handleCreateStory = async (
  backend: ProjectBackend,
  scrumConfig: ScrumConfig,
  params: z.infer<typeof CreateStorySchema>,
): Promise<McpTextResult> => {
  const failedFields: PartialFailureFields = [];

  const rawInput = toCreateStoryInput(params);
  const input = rawInput.labels
    ? { ...rawInput, labels: stripReservedLabels(rawInput.labels, scrumConfig) }
    : rawInput;

  const { value: storyRef, warnings: createWarnings } = await catchBackend(
    () => backend.createStory(input),
  );

  if (!storyRef) {
    return toMcpTextResult({
      partialFailure: true as const,
      failedFields: [{ field: "create", reason: createWarnings.join("; ") }],
    });
  }

  if (params.sprint !== undefined) {
    const { warnings: w } = await catchBackend(
      () => backend.setField(storyRef, "sprint", params.sprint!),
    );
    for (const reason of w) failedFields.push({ field: "sprint", reason });
  }

  const { value: composeResult, warnings: readWarnings } = await catchBackend(
    () => backend.composeStorySnapshot(storyRef),
  );
  for (const reason of readWarnings) failedFields.push({ field: "read", reason });
  for (const reason of composeResult?.warnings ?? []) {
    failedFields.push({ field: "read", reason });
  }
  const storyDetail = composeResult?.value ?? null;

  if (failedFields.length > 0) {
    return toMcpTextResult({
      ...(storyDetail as Story),
      partialFailure: true as const,
      failedFields,
    });
  }

  return toMcpTextResult(storyDetail);
};

export const handlePlanSprint = async (
  backend: ProjectBackend,
  params: z.infer<typeof PlanSprintSchema>,
): Promise<McpTextResult> => {
  if (params.sprint === "all") {
    throw new Error(
      '"all" is not a valid plan_sprint target. Use "current", "next", or a sprint name.',
    );
  }

  const assigned: StoryRef[] = [];
  const cleared: StoryRef[] = [];
  const skipped: Array<{ ref: StoryRef; reason: string }> = [];

  if (params.replace) {
    const sprintArg = typeof params.sprint === "string" ? params.sprint : "current";
    const { scope, sprint_ref } = resolveSprintQuery(sprintArg);
    const { value: sprintItems } = await backend.findItems({
      scope,
      sprint_ref,
      keys: [],
      search: "",
      types: [],
      statuses: [],
      priority: "",
      epic_id: "",
      labels: [],
      assignee: "",
      estimated: undefined,
      has_blockers: undefined,
      include_dependencies: false,
      fields: "compact",
      limit: 500,
    });
    if (!sprintItems) {
      throw new Error("findItems returned null value without throwing");
    }
    for (const item of sprintItems.items) {
      const { warnings: w } = await catchBackend(
        () => backend.setField(item.ref, "sprint", null),
      );
      if (w.length > 0) {
        for (const reason of w) skipped.push({ ref: item.ref, reason });
      } else {
        cleared.push(item.ref);
      }
    }
  }

  for (const ref of params.stories) {
    const { warnings: w } = await catchBackend(
      () => backend.setField(ref, "sprint", params.sprint),
    );
    if (w.length > 0) {
      for (const reason of w) skipped.push({ ref, reason });
    } else {
      assigned.push(ref);
    }
  }

  // Enrich the assigned list with number+title so agents can verify which items
  // were moved without a follow-up find_items call.
  //
  // We do one sprint_board scan after all setField calls complete (not per-item)
  // then join on PVTI project item ID. Items not yet visible in the board scan
  // (e.g. added to a future sprint) fall back to the bare ref with no enrichment.
  let enrichedAssigned: Array<Record<string, unknown>> = assigned.map((ref) => ({ ...ref }));
  if (assigned.length > 0) {
    const { scope: boardScope, sprint_ref: boardSprintRef } = resolveSprintQuery(
      typeof params.sprint === "string" ? params.sprint : "current",
    );
    const { value: boardItems } = await backend.findItems({
      scope: boardScope,
      sprint_ref: boardSprintRef,
      keys: [],
      search: "",
      types: [],
      statuses: [],
      priority: "",
      epic_id: "",
      labels: [],
      assignee: "",
      estimated: undefined,
      has_blockers: undefined,
      include_dependencies: false,
      fields: "compact",
      limit: 500,
    });

    if (boardItems) {
      const idToItem = new Map(boardItems.items.map((item) => [item.ref.id, item]));
      enrichedAssigned = assigned.map((ref) => {
        const id = "id" in ref ? ref.id : undefined;
        const boardItem = id ? idToItem.get(id) : undefined;
        if (boardItem) {
          // Use ref.key (string issue number) consistent with BacklogItemListing.
          // key is "" for Draft Issues — omit it rather than emit a misleading "".
          return {
            id: boardItem.ref.id,
            ...(boardItem.ref.key ? { key: boardItem.ref.key } : {}),
            title: boardItem.title,
          };
        }
        return { ...ref };
      });
    }
  }

  const result: Record<string, unknown> = {
    sprint: params.sprint,
    assigned: enrichedAssigned,
    skipped,
  };
  if (cleared.length > 0) result.cleared = cleared;
  if (params.goal !== undefined) result.goal = params.goal;

  return toMcpTextResult(result);
};

export const handleLogImpediment = async (
  backend: ProjectBackend,
  scrumConfig: ScrumConfig,
  params: z.infer<typeof LogImpedimentSchema>,
): Promise<McpTextResult> => {
  const p0PriorityDisplay = resolveP0PriorityDisplay(scrumConfig);
  const raisedBy = resolveRaisedBy(scrumConfig, params.raised_by);

  const bodyParts = [params.description];
  if (params.affects) {
    bodyParts.push("", "## Affects");
    if ("story" in params.affects) {
      const storyId = "id" in params.affects.story
        ? params.affects.story.id
        : `#${params.affects.story.number}`;
      bodyParts.push(`This impediment affects story with item ID: ${storyId}`);
    } else if ("sprint" in params.affects) {
      bodyParts.push(`This impediment affects sprint: ${params.affects.sprint}`);
    }
  }

  const impedimentInput: CreateStoryInput = {
    title: `Impediment: ${params.description.slice(0, 80)}`,
    body: bodyParts.join("\n"),
    type: "impediment",
    priority: params.priority ?? p0PriorityDisplay,
    // Force Draft → full Issue promotion so scrum_update_impediment and addComment
    // lifecycle ops work. Without a label the item stays a Draft Issue (no underlying
    // GitHub Issue) and any subsequent mutation will throw DRAFT_ISSUE_CONSTRAINT.
    // "scrum-managed" is a neutral promotion label — it is not a vocabulary term
    // (not a type key, status key, or priority key) so it will never be stripped.
    labels: ["scrum-managed"],
  };
  const { listing: impediment, itemRef } = await backend.createImpediment(impedimentInput);
  const impedimentOut = { ...impediment, raised_by: raisedBy ?? impediment.raised_by };

  if (params.affects) {
    if ("story" in params.affects) {
      const affectedComment = [
        ":warning: **Impediment logged**",
        "",
        params.description,
        "",
        `> Created by ${raisedBy ?? "agent"}`,
      ].join("\n");
      await backend.addComment(params.affects.story, affectedComment);

      const affectsRef = "id" in params.affects.story
        ? params.affects.story.id
        : `#${params.affects.story.number}`;
      await backend.addComment(
        itemRef,
        [
          ":link: This impediment affects story",
          `  - Story item ID: ${affectsRef}`,
        ].join("\n"),
      );
    } else if ("sprint" in params.affects) {
      await backend.addComment(
        itemRef,
        [
          ":link: This impediment affects sprint",
          `  - Sprint: ${params.affects.sprint}`,
        ].join("\n"),
      );
    }
  }

  return toMcpTextResult({ impediment: impedimentOut, affects: params.affects ?? null });
};

export const handleUpdateImpediment = async (
  backend: ProjectBackend,
  params: z.infer<typeof UpdateImpedimentSchema>,
): Promise<McpTextResult> => {
  try {
    const result = await updateImpedimentUseCase(
      backend,
      params.ref,
      params.status,
      params.resolution_notes,
    );
    return toMcpTextResult(result);
  } catch (err) {
    return toToolErrorResult(err);
  }
};

export const handleUpdateEpic = async (
  backend: ProjectBackend,
  _scrumConfig: ScrumConfig,
  sessionCache: SessionCache,
  params: z.infer<typeof UpdateEpicSchema>,
): Promise<McpTextResult> => {
  const ref: EpicRef = params.ref;
  const updates: EpicUpdates = pickDefined(
    { name: params.name, description: params.description, status: params.status },
    ["name", "description", "status"],
  ) as unknown as EpicUpdates;

  try {
    const listing = await updateEpicUseCase(backend, ref, updates);
    sessionCache.invalidateOrient();
    return toMcpTextResult(listing);
  } catch (err) {
    return toToolErrorResult(err);
  }
};

export const handleCreateEpic = async (
  backend: ProjectBackend,
  _scrumConfig: ScrumConfig,
  sessionCache: SessionCache,
  params: z.infer<typeof CreateEpicSchema>,
): Promise<McpTextResult> => {
  const input: CreateEpicInput = {
    name: params.name,
    ...(params.description !== undefined ? { description: params.description } : {}),
  };

  try {
    const epicRef = await createEpicUseCase(backend, input);
    sessionCache.invalidateOrient();
    return toMcpTextResult({ ref: { id: epicRef.id, number: epicRef.number } });
  } catch (err) {
    return toToolErrorResult(err);
  }
};
