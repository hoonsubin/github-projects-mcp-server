// =============================================================================
// src/tools/scrum-write.ts - Register all scrum_* write tools

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CreateStoryInput, ProjectBackend, StoryUpdates } from "../scrum/ports.ts";
import type { Story, StoryRef } from "../domain/types.ts";
import type { ScrumConfig } from "../domain/config.ts";
import { resolveP0PriorityDisplay } from "../scrum/config-helpers.ts";
import {
  AddVocabularySchema,
  CreateStorySchema,
  LogImpedimentSchema,
  PlanSprintSchema,
  SetFieldSchema,
  UpdateImpedimentSchema,
  UpdateStorySchema,
} from "../schemas/scrum.ts";
import { catchBackend } from "../services/error-enrichment.ts";
import { pickDefined } from "../services/pick-defined.ts";
import { z } from "zod";

// ── Tool name constants ────────────────────────────────────────────────────────
// Single source of truth for every tool this module registers.
// Imported by src/server.ts for degraded-mode stub registration.

export const SCRUM_WRITE_TOOL_NAMES = [
  "scrum_add_vocabulary",
  "scrum_create_story",
  "scrum_update_story",
  "scrum_set_field",
  "scrum_log_impediment",
  "scrum_update_impediment",
  "scrum_plan_sprint",
] as const;

// ── Helper types ──────────────────────────────────────────────────────────────

interface PartialFailureResult {
  story: Story | StoryRef;
  partialFailure: true;
  failedFields: Array<{ field: string; reason: string }>;
}

// ── Public API ────────────────────────────────────────────────────────────────

export const registerScrumWriteTools = (
  server: McpServer,
  backend: ProjectBackend,
  scrumConfig: ScrumConfig,
): void => {
  const p0PriorityDisplay = resolveP0PriorityDisplay(scrumConfig);

  server.registerTool(
    "scrum_add_vocabulary",
    {
      title: "Add Vocabulary Entry",
      description: `Idempotently add a new option to an existing board field, or a new repo label.

        IMPORTANT CONSTRAINT: this tool can only add options to fields that already exist
        (status, priority). It cannot create new project fields - that requires a human to
        act in the GitHub Projects UI.

        Use this when scrum_set_field or scrum_create_story fails because a vocabulary value
        is not found. Call scrum_orient first to see what values already exist before adding duplicates.

        Args:
          kind   "status_option" | "priority_option" | "label"
          value  display name to add (e.g. "Blocked", "Critical", "tech_debt")

        Safe to call if the value already exists - operation is idempotent.`,
      inputSchema: AddVocabularySchema.shape,
      annotations: { role: "admin" },
    },
    async (params: z.infer<typeof AddVocabularySchema>) => {
      const result = await backend.addVocabulary(params.kind, params.value);
      return {
        content: [{
          type: "text",
          text: JSON.stringify({ ...result, kind: params.kind, value: params.value }, null, 2),
        }],
      };
    },
  );

  server.registerTool(
    "scrum_set_field",
    {
      title: "Set Board Field",
      description:
        `Set a single board field on a story. The primary write primitive - use this to move
        stories across the board, assign sprints, set points, update priority, assignee, or type.

        Call scrum_get_story first if you need to read the current value before overwriting.

        Args:
          ref    { id: string } - story to update (Story.ref.id from any read tool)
          field  one of: "status" | "sprint" | "story_points" | "priority" | "assignee" | "type"
          value  shape depends on field:
                   status        → string display name (e.g. "In Progress", "Done")
                   sprint        → "current" | "next" | "<sprint-name>" | null  (null clears)
                   story_points  → number (e.g. 3, 5, 8)
                   priority      → string display name (e.g. "Must", "Should")
                   assignee      → GitHub login string (e.g. "hoonsubin")
                   type          → canonical key (e.g. "feature", "bug" - see vocabulary.type in scrum_orient)
                 Pass null for any field to clear the value entirely.

        Returns: updated Story object.`,
      inputSchema: SetFieldSchema.shape,
      annotations: { role: "admin" },
    },
    async (params: z.infer<typeof SetFieldSchema>) => {
      const { warnings } = await catchBackend(
        () => backend.setField(params.ref, params.field, params.value),
      );
      const { value: detail } = await backend.getStoryDetail(params.ref);
      const response = warnings.length > 0 ? { ...detail?.story, warnings } : detail?.story;
      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
    },
  );

  server.registerTool(
    "scrum_update_story",
    {
      title: "Update Story",
      description:
        `Edit the content fields of a story: title, body, labels, assignees, epic, or dependencies.
        For board fields (status, sprint, story_points, priority, assignee) use scrum_set_field.

        WARNING - labels and assignees REPLACE the full existing set, they do not append.
        Call scrum_get_story first if you want to add a label without removing existing ones.
        body also replaces the entire body - read first if you intend to append.

        Args:
          ref        { number: integer } | { id: string } - story to update
          title      string - new title (omit to leave unchanged)
          body       string - replacement markdown body (omit to leave unchanged)
          labels     string[] - REPLACES all existing labels (omit to leave unchanged)
          assignees  string[] - REPLACES all existing assignees, GitHub logins (omit to leave unchanged)
          epic       { id: string } | null - EpicRef to assign, or null to detach from epic (omit to leave unchanged)
          comment    string - Post a comment on the story after updating (omit to skip)
          blocked_by  StoryRef[] | null - REPLACES all upstream (blocked_by) dependencies; null clears; omit to leave unchanged

        Returns: updated Story object.`,
      inputSchema: UpdateStorySchema.shape,
      annotations: { role: "admin" },
    },
    async (params: z.infer<typeof UpdateStorySchema>) => {
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

      const { value: detail } = await backend.getStoryDetail(params.ref);
      return { content: [{ type: "text", text: JSON.stringify(detail?.story, null, 2) }] };
    },
  );

  server.registerTool(
    "scrum_create_story",
    {
      title: "Create Story",
      description:
        `Create a new story on the project board and optionally assign it to a sprint in one call.

        Stories are created as Draft Issues first. If labels or an epic are supplied the draft is
        automatically promoted to a full Issue so those fields can be applied - this is transparent
        to the caller. Board fields (type, priority, sprint, story_points) are applied after creation;
        if a board field fails the story is still created - check 'partialFailure' in the response.

        Args:
          title        string (required) - concise one-sentence title
          body         string (required) - full markdown body; use user-story format + AC checklist
          type         canonical key (e.g. "feature", "bug") - set via the Type board field
                       Call scrum_orient for vocabulary.type to see valid keys for this project
          priority     string - vocabulary display name (e.g. "Must"); call scrum_orient for valid values
          story_points number - Fibonacci estimate (1, 2, 3, 5, 8, 13)
          labels       string[] - must already exist; check platform_state.labels.existing from scrum_orient
          epic         { id: string } - EpicRef from scrum_find_items (type=epic).ref.id
          assignees    string[] - GitHub logins
          sprint       "current" | "next" | "<sprint-name>" - places on board; omit for backlog

        Returns: created Story object, or partial-failure shape { story, partialFailure: true, failedFields[] }.`,
      inputSchema: CreateStorySchema.shape,
      annotations: { role: "admin" },
    },
    async (params: z.infer<typeof CreateStorySchema>) => {
      // Step 1: Create the story via backend
      const storyRef = await backend.createStory(params as CreateStoryInput);

      // Step 2: Apply optional field sets (collect failures, don't abort)
      const failedFields: PartialFailureResult["failedFields"] = [];

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

      // Step 3: Fetch updated story - getStoryDetail already returns BackendCallResult
      let storyDetail: Story | Partial<StoryRef>;
      const { value: fetchedDetail, warnings: readWarnings } = await backend.getStoryDetail(
        storyRef,
      );
      for (const reason of readWarnings) failedFields.push({ field: "read", reason });
      if (fetchedDetail) {
        storyDetail = fetchedDetail.story;
      } else {
        storyDetail = { id: "id" in storyRef ? storyRef.id : String(storyRef.number) };
      }

      // Step 4: Return with partial failure indicator if needed
      if (failedFields.length > 0) {
        const result: PartialFailureResult & { story: Story } = {
          story: storyDetail as Story,
          partialFailure: true,
          failedFields,
        };
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      return { content: [{ type: "text", text: JSON.stringify(storyDetail, null, 2) }] };
    },
  );

  server.registerTool(
    "scrum_plan_sprint",
    {
      title: "Plan Sprint",
      description:
        `Bulk-assign stories to a sprint. More efficient than calling scrum_set_field per story
        when planning a sprint or moving multiple items at once.

        Args:
          sprint   "current" | "next" | "<sprint-name>" - target sprint
          stories  StoryRef[] (min 1) - each entry must supply Story.ref.id
          replace  boolean, default false
                   false = add the listed stories; existing sprint items are untouched
                   true  = CLEAR all current sprint stories first, then assign the list
                           Use with caution - replace:true removes any story not in your list.

        Returns: { sprint, assigned: StoryRef[], skipped: [{ ref, reason }] }
        The operation continues through individual failures - check skipped[] for errors.`,
      inputSchema: PlanSprintSchema.shape,
      annotations: { role: "admin" },
    },
    async (params: z.infer<typeof PlanSprintSchema>) => {
      const assigned: StoryRef[] = [];
      const skipped: Array<{ ref: StoryRef; reason: string }> = [];

      // Step 1: If replace: true, clear existing sprint items
      if (params.replace) {
        if (params.sprint === "all") {
          throw new Error(
            '"all" is not valid for plan_sprint - use "current", "next", null, or an explicit sprint name.',
          );
        }
        interface BackendWithSprintStories {
          getSprintStories(
            s: typeof params.sprint,
          ): Promise<{ stories: Array<{ ref: { id: string } }> }>;
        }
        const { stories: currentStories } = await (backend as unknown as BackendWithSprintStories)
          .getSprintStories(params.sprint);
        for (const story of currentStories) {
          const { warnings: w } = await catchBackend(
            () => backend.setField(story.ref, "sprint", null),
          );
          if (w.length > 0) {
            for (const reason of w) skipped.push({ ref: story.ref, reason });
          } else {
            assigned.push(story.ref);
          }
        }
      }

      // Step 2: Assign each requested story
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

      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.registerTool(
    "scrum_log_impediment",
    {
      title: "Log Impediment",
      description:
        `Log a blocking impediment: creates a spike story tagged 'impediment', posts a warning
        comment on the affected story, and cross-links the two stories.

        Use this instead of scrum_create_story when logging something that blocks another story.
        The impediment will appear in scrum_find_items results filterable by the 'impediment' label.

        Args:
          description  string (required) - full description of the blocker; becomes the story body
                       and the comment posted to the affected story
          affects      { story: { id } } | { sprint: string } - optional; omit to log a project-level orphan
          raised_by    string - GitHub login of the person raising it; defaults to Scrum Master
          priority     string - vocabulary display name (e.g. "Must"); defaults to highest tier

        Returns: the created impediment Story object.`,
      inputSchema: LogImpedimentSchema.shape,
      annotations: { role: "admin" },
    },
    async (params: z.infer<typeof LogImpedimentSchema>) => {
      // Step 1: Compose body with description + optional "Affects" section
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

      // Step 2: Create the impediment story
      const impedimentInput: CreateStoryInput = {
        title: `Impediment: ${params.description.slice(0, 80)}`,
        body: bodyParts.join("\n"),
        type: "impediment",
        priority: params.priority ?? p0PriorityDisplay,
        labels: ["impediment"],
      };
      const { listing: impediment, itemRef } = await backend.createImpediment(impedimentInput);

      // Step 3: Post cross-reference comments
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

      return {
        content: [{
          type: "text",
          text: JSON.stringify({ impediment, affects: params.affects ?? null }, null, 2),
        }],
      };
    },
  );

  server.registerTool(
    "scrum_update_impediment",
    {
      title: "Update Impediment",
      description: `Update an impediment's status and optionally add resolution notes.

        Args:
          ref              { id } - impediment project item ID from scrum_get_board_health or scrum_find_items
          status           "open" | "in_progress" | "resolved" - new impediment status
          resolution_notes  string (optional) - notes explaining why this impediment was resolved

        Returns: the updated ImpedimentListing.`,
      inputSchema: UpdateImpedimentSchema.shape,
      annotations: { role: "admin" },
    },
    async (params: z.infer<typeof UpdateImpedimentSchema>) => {
      const result = await backend.updateImpediment(
        params.ref,
        params.status,
        params.resolution_notes,
      );
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  );
};
