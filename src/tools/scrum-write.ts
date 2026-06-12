// =============================================================================
// src/tools/scrum-write.ts - Register all scrum_* write tools

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ProjectBackend } from "../scrum/ports.ts";
import type { ScrumConfig } from "../domain/config.ts";
import type { SessionCache } from "../services/session-cache.ts";
import {
  AddVocabularySchema,
  CreateStorySchema,
  LogImpedimentSchema,
  PlanSprintSchema,
  SetFieldSchema,
  UpdateImpedimentSchema,
  UpdateStorySchema,
} from "../schemas/scrum.ts";
import { z } from "zod";
import {
  AddVocabularyResultSchema,
  LogImpedimentResultSchema,
  PlanSprintResultSchema,
  UpdateImpedimentResponseSchema,
} from "../schemas/scrum-outputs.ts";
import {
  handleAddVocabulary,
  handleCreateStory,
  handleLogImpediment,
  handlePlanSprint,
  handleSetField,
  handleUpdateImpediment,
  handleUpdateStory,
} from "./handlers/write.ts";

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

// ── Public API ────────────────────────────────────────────────────────────────

export const registerScrumWriteTools = (
  server: McpServer,
  backend: ProjectBackend,
  scrumConfig: ScrumConfig,
  sessionCache: SessionCache,
): void => {
  server.registerTool(
    "scrum_add_vocabulary",
    {
      title: "Add Vocabulary Entry",
      description: `Idempotently add vocabulary. Three kinds behave differently:

        - status_option / priority_option → ONLY for values in scrum_orient platform_state.missing_options
          that are declared in .github/scrum/config.yml (status_display / priority_display). Config is
          authoritative — do not invent board options outside config.
        - label → repository label (fully agent-driven; fetch the current list via scrum_orient(detail:"full") → platform_state.labels.existing when needed)

        Response: created:true = new value added; created:false + already_exists:true = already present (safe no-op).

        Cannot create new project fields — only options within existing Status/Priority fields.

        Args:
          kind   "status_option" | "priority_option" | "label"
          value  display name to add (e.g. config-declared "Blocked", or any label like "test-label")`,
      inputSchema: AddVocabularySchema.shape,
      outputSchema: AddVocabularyResultSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: z.infer<typeof AddVocabularySchema>) => {
      const result = await handleAddVocabulary(backend, scrumConfig, sessionCache, params);
      // When a new vocabulary entry is created, the valid values for downstream
      // tool calls change. Notify connected clients so they can re-fetch tool
      // descriptions without a session restart.
      if (!result.isError) {
        try {
          const payload = JSON.parse(result.content[0].text) as { created?: boolean };
          if (payload.created === true) {
            await server.sendToolListChanged();
          }
        } catch {
          // Best-effort — never let notification failure affect the tool response.
        }
      }
      return result;
    },
  );

  server.registerTool(
    "scrum_set_field",
    {
      title: "Set Board Field",
      description:
        `Set a single board field on a story. The primary write primitive - use this to move
        stories across the board, assign sprints, set points, update priority, assignee, or type.

        Call scrum_get_item_detail(detail:"dor") first if you need the current value before overwriting.
        Confirm story points, priority, and sprint changes with the human before writing.

        Example: { "ref": { "id": "..." }, "field": "status", "value": "In Progress", "response": "ack" }

        Args:
          ref    { id: string } - story to update (Story.ref.id from any read tool)
          field  one of: "status" | "sprint" | "story_points" | "priority" | "assignee" | "type"
          value  shape depends on field:
                   status        → MUST be resolved from vocabulary.status in scrum_orient.
                                   Never pass display names like "Done" or "In Progress" literally -
                                   the project may use "Completed", "Closed", or any custom label.
                                   Always resolve: vocabulary.status["done"] → pass that exact string.
                   sprint        → "current" | "next" | "<sprint-name>" | null  (null clears)
                   story_points  → number (e.g. 3, 5, 8)
                   priority      → string display name from vocabulary.priority in scrum_orient
                   assignee      → GitHub login string (e.g. "hoonsubin")
                   type          → canonical key (e.g. "feature", "bug" - see vocabulary.type in scrum_orient)
                 Pass null for any field to clear the value entirely.

        response  "ack" (default) | "story" — prefer ack; verify with find_items when needed.

        Returns: WriteAck by default, or Story when response="story".`,
      inputSchema: SetFieldSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    (params: z.input<typeof SetFieldSchema>) => handleSetField(backend, scrumConfig, params),
  );

  server.registerTool(
    "scrum_update_story",
    {
      title: "Update Story",
      description:
        `Edit the content fields of a story: title, body, labels, assignees, epic, or dependencies.
        For board fields (status, sprint, story_points, priority, assignee) use scrum_set_field.

        WARNING - labels and assignees REPLACE the full existing set, they do not append.
        To add one label without losing the rest: call scrum_get_item_detail first, merge the
        new label into the existing labels array, then pass the merged set here.
        Same applies to assignees - always read first unless intent is to replace wholesale.
        body also replaces the entire body - read first if you intend to append content.

        Args:
          ref        { number: integer } | { id: string } - story to update
          title      string - new title (omit to leave unchanged)
          body       string - replacement markdown body (omit to leave unchanged)
          labels     string[] - REPLACES all existing labels (omit to leave unchanged)
          assignees  string[] - REPLACES all existing assignees, GitHub logins (omit to leave unchanged)
          epic       { id: string } | null - EpicRef to assign, or null to detach from epic (omit to leave unchanged)
          comment    string - Post a comment on the story after updating (omit to skip)
          blocked_by  StoryRef[] - REPLACES all upstream (blocked_by) dependencies; null or [] clears; omit to leave unchanged

        response  "ack" (default) | "story" - ack returns { ref, applied }; story returns full Story.

        Returns: WriteAck by default, or Story when response="story".`,
      inputSchema: UpdateStorySchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    (params: z.input<typeof UpdateStorySchema>) => handleUpdateStory(backend, scrumConfig, params),
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
          labels       string[] - must already exist; call scrum_orient(detail:"full") to see platform_state.labels.existing
          epic         { id: string } - EpicRef from scrum_find_items (type=epic).ref.id
          assignees    string[] - GitHub logins
          sprint       "current" | "next" | "<sprint-name>" - places on board; omit for backlog

        Returns: created Story object, or the same fields with partialFailure: true and failedFields[].`,
      inputSchema: CreateStorySchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    (params: z.infer<typeof CreateStorySchema>) => handleCreateStory(backend, scrumConfig, params),
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

        Returns: { sprint, assigned: StoryRef[], cleared?: StoryRef[], skipped: [{ ref, reason }] }
        When replace:true, cleared lists items removed from the sprint before assignment.
        The operation continues through individual failures - check skipped[] for errors.`,
      inputSchema: PlanSprintSchema.shape,
      outputSchema: PlanSprintResultSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    (params: z.infer<typeof PlanSprintSchema>) => handlePlanSprint(backend, params),
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
      outputSchema: LogImpedimentResultSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    (params: z.infer<typeof LogImpedimentSchema>) =>
      handleLogImpediment(backend, scrumConfig, params),
  );

  server.registerTool(
    "scrum_update_impediment",
    {
      title: "Update Impediment",
      description: `Update an impediment's status and optionally add resolution notes.

        Args:
          ref              { id } - impediment project item ID from scrum_find_items
          status           "open" | "in_progress" | "resolved" - new impediment status
          resolution_notes  string (optional) - notes explaining why this impediment was resolved

        Draft issues cannot be updated — promote to a full issue first.
        Returns: the updated ImpedimentListing.`,
      inputSchema: UpdateImpedimentSchema.shape,
      outputSchema: UpdateImpedimentResponseSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    (params: z.infer<typeof UpdateImpedimentSchema>) => handleUpdateImpediment(backend, params),
  );
};

// Re-export handlers for contract tests
export {
  handleAddVocabulary,
  handleCreateStory,
  handleLogImpediment,
  handlePlanSprint,
  handleSetField,
  handleUpdateImpediment,
  handleUpdateStory,
  resolveP0PriorityDisplay,
} from "./handlers/write.ts";
