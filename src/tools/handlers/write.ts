// =============================================================================
// src/tools/handlers/write.ts - Extracted scrum_* write tool handlers
// =============================================================================

import type { CreateStoryInput, ProjectBackend, StoryUpdates } from "../../scrum/ports.ts";
import type { Story, StoryRef } from "../../domain/types.ts";
import type { ScrumConfig } from "../../domain/config.ts";
import { updateImpedimentUseCase } from "../../scrum/update-impediment.ts";
import {
  AddVocabularySchema,
  CreateStorySchema,
  LogImpedimentSchema,
  PlanSprintSchema,
  SetFieldSchema,
  UpdateImpedimentSchema,
  UpdateStorySchema,
} from "../../schemas/scrum.ts";
import { catchBackend } from "../../services/error-enrichment.ts";
import { pickDefined } from "../../services/pick-defined.ts";
import type { z } from "zod";
import { type McpTextResult, toMcpTextResult } from "../_mcp_result.ts";

type PartialFailureFields = Array<{ field: string; reason: string }>;

export const resolveP0PriorityDisplay = (scrumConfig: ScrumConfig): string =>
  scrumConfig.priority_display?.[scrumConfig.scrum.priority?.[0]?.key ?? "p0"] ?? "Must";

export const handleAddVocabulary = async (
  backend: ProjectBackend,
  params: z.infer<typeof AddVocabularySchema>,
): Promise<McpTextResult> => {
  const result = await backend.addVocabulary(params.kind, params.value);
  return toMcpTextResult({ ...result, kind: params.kind, value: params.value });
};

export const handleSetField = async (
  backend: ProjectBackend,
  params: z.infer<typeof SetFieldSchema>,
): Promise<McpTextResult> => {
  const { warnings } = await catchBackend(
    () => backend.setField(params.ref, params.field, params.value),
  );
  const { value: story, warnings: readWarnings } = await backend.composeStoryAfterSetField(
    params.ref,
    params.field,
    params.value,
  );
  const allWarnings = [...warnings, ...readWarnings];
  const response = allWarnings.length > 0 ? { ...story, warnings: allWarnings } : story;
  return toMcpTextResult(response);
};

export const handleUpdateStory = async (
  backend: ProjectBackend,
  params: z.infer<typeof UpdateStorySchema>,
): Promise<McpTextResult> => {
  const updates = pickDefined(params, [
    "title",
    "body",
    "labels",
    "assignees",
    "epic",
    "blocked_by",
  ]);

  await backend.updateStory(params.ref, updates as StoryUpdates);

  if (params.comment !== undefined) {
    await backend.addComment(params.ref, params.comment);
  }

  const { value: story } = await backend.composeStoryAfterStoryUpdate(
    params.ref,
    updates as StoryUpdates,
  );
  return toMcpTextResult(story);
};

export const handleCreateStory = async (
  backend: ProjectBackend,
  params: z.infer<typeof CreateStorySchema>,
): Promise<McpTextResult> => {
  const storyRef = await backend.createStory(params as CreateStoryInput);
  const failedFields: PartialFailureFields = [];

  if (params.sprint !== undefined) {
    const sprintVal = params.sprint;
    const { warnings: w } = await catchBackend(
      () => backend.setField(storyRef, "sprint", sprintVal),
    );
    for (const reason of w) failedFields.push({ field: "sprint", reason });
  }

  if (params.story_points !== undefined) {
    const pointsVal = params.story_points;
    const { warnings: w } = await catchBackend(
      () => backend.setField(storyRef, "story_points", pointsVal),
    );
    for (const reason of w) failedFields.push({ field: "story_points", reason });
  }

  if (params.priority !== undefined) {
    const priorityVal = params.priority;
    const { warnings: w } = await catchBackend(
      () => backend.setField(storyRef, "priority", priorityVal),
    );
    for (const reason of w) failedFields.push({ field: "priority", reason });
  }

  const { value: storyDetail, warnings: readWarnings } = await backend.composeStorySnapshot(
    storyRef,
  );
  for (const reason of readWarnings) failedFields.push({ field: "read", reason });

  if (failedFields.length > 0) {
    return toMcpTextResult({
      ...(storyDetail as Story),
      partialFailure: true,
      failedFields,
    });
  }

  return toMcpTextResult(storyDetail);
};

export const handlePlanSprint = async (
  backend: ProjectBackend,
  params: z.infer<typeof PlanSprintSchema>,
): Promise<McpTextResult> => {
  const assigned: StoryRef[] = [];
  const skipped: Array<{ ref: StoryRef; reason: string }> = [];

  if (params.replace) {
    if (params.sprint === "all") {
      throw new Error(
        '"all" is not valid for plan_sprint - use "current", "next", null, or an explicit sprint name.',
      );
    }
    const { value: sprintItems } = await backend.findItems({
      scope: "sprint",
      keys: [],
      search: "",
      types: [],
      statuses: [],
      priority: "",
      epic_id: "",
      labels: [],
      assignee: "",
      estimated: undefined,
      sprint_ref: params.sprint,
      include_dependencies: false,
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
        assigned.push(item.ref);
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

  const result: Record<string, unknown> = { sprint: params.sprint, assigned, skipped };
  if (params.goal !== undefined) result.goal = params.goal;

  return toMcpTextResult(result);
};

export const handleLogImpediment = async (
  backend: ProjectBackend,
  scrumConfig: ScrumConfig,
  params: z.infer<typeof LogImpedimentSchema>,
): Promise<McpTextResult> => {
  const p0PriorityDisplay = resolveP0PriorityDisplay(scrumConfig);

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
  };
  const { listing: impediment, itemRef } = await backend.createImpediment(impedimentInput);

  if (params.affects) {
    if ("story" in params.affects) {
      const affectedComment = [
        ":warning: **Impediment logged**",
        "",
        params.description,
        "",
        `> Created by ${params.raised_by ?? "agent"}`,
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

  return toMcpTextResult({ impediment, affects: params.affects ?? null });
};

export const handleUpdateImpediment = async (
  backend: ProjectBackend,
  params: z.infer<typeof UpdateImpedimentSchema>,
): Promise<McpTextResult> => {
  const result = await updateImpedimentUseCase(
    backend,
    params.ref,
    params.status,
    params.resolution_notes,
  );
  return toMcpTextResult(result);
};
