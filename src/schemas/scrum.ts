// =============================================================================
// src/schemas/scrum.ts — Zod input schemas for all 11 scrum_* tools
//
// Rules enforced here:
//   - No GitHub IDs, node IDs, or internal field identifiers appear in these schemas.
//   - The agent speaks Scrum vocabulary only; the backend translates.
//   - All tool schemas are strict() — unknown keys are rejected.
//   - Every field carries a .describe() so agents see documentation in the
//     JSON Schema properties map, not just the Zod source.
// =============================================================================

import { z } from "zod";

// ── Primitive schemas (shared by multiple tools) ──────────────────────────────

// Accepted as input by any tool that references a story. At least one of number or id required.
export const StoryRefSchema = z
  .object({
    number: z
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        "User-facing issue number (e.g. 42). Visible in GitHub issue URLs and in " +
          "scrum_get_backlog / scrum_get_sprint results.",
      ),
    id: z
      .string()
      .optional()
      .describe(
        "Opaque board item ID returned by a previous tool call (e.g. scrum_create_story, " +
          "scrum_get_story). Use when you have the ID but not the issue number.",
      ),
  })
  .refine((v) => v.number !== undefined || v.id !== undefined, {
    message: "StoryRef requires at least one of: number, id",
  });

// Sprint targeting: "current", "next", null (= backlog / clear sprint), or explicit sprint name.
export const SprintRefSchema = z
  .union([
    z.literal("current"),
    z.literal("next"),
    z.null(),
    z.string().min(1),
  ])
  .describe(
    "Which sprint to target. " +
      '"current" = the active sprint, ' +
      '"next" = the upcoming sprint, ' +
      'null = backlog / clear sprint assignment, ' +
      'or an exact sprint name string (e.g. "Sprint 5"). ' +
      "Use scrum_orient to see all valid sprint names.",
  );

// The five board fields the agent can write via scrum_set_field. Fixed set for v1.
export const ScrumFieldSchema = z
  .enum(["status", "sprint", "story_points", "priority", "assignee"])
  .describe(
    "Board field to update. " +
      '"status" = workflow column (string display name, e.g. "In Progress"); ' +
      '"sprint" = iteration (SprintRef: "current" | "next" | "<name>" | null); ' +
      '"story_points" = effort estimate (number, e.g. 5); ' +
      '"priority" = urgency tier (string display name, e.g. "Must"); ' +
      '"assignee" = GitHub login of the owner (string, e.g. "hoonsubin"). ' +
      "Call scrum_orient to see all valid vocabulary values.",
  );

// Story type — drives the type label applied by the backend.
// NOTE: "impediment" is NOT a StoryType. scrum_log_impediment uses type:"spike" + an "impediment" label.
export const StoryTypeSchema = z
  .enum(["feature", "bug", "tech_debt", "spike"])
  .describe(
    '"feature" = new functionality, ' +
      '"bug" = defect to fix, ' +
      '"tech_debt" = refactor or cleanup work, ' +
      '"spike" = research or exploration task. ' +
      "NOTE: do NOT use 'impediment' here — use scrum_log_impediment instead.",
  );

// ── Read tool schemas ─────────────────────────────────────────────────────────

// scrum_orient — no arguments; uses z.object({_:...}).shape inline in the handler

// scrum_get_sprint — optional sprint ref, defaults to "current" in the handler
export const GetSprintSchema = z
  .object({
    sprint: SprintRefSchema.optional().describe(
      'Which sprint to fetch. Defaults to "current" if omitted. ' +
        "Pass null to get a backlog-style view instead.",
    ),
  })
  .strict();

// scrum_get_backlog — all filters are optional; client-side filtering in handler
export const GetBacklogSchema = z
  .object({
    search: z
      .string()
      .optional()
      .describe("Case-insensitive substring matched against story title and body."),
    labels: z
      .array(z.string())
      .optional()
      .describe("Return only stories carrying ALL of these labels (intersection, not union)."),
    priority: z
      .string()
      .optional()
      .describe(
        'Return only stories with this exact priority display name (e.g. "Must"). ' +
          "Use scrum_orient to see valid priority values.",
      ),
    epic: z
      .string()
      .optional()
      .describe("Return only stories belonging to this Milestone title (exact match)."),
    limit: z
      .number()
      .int()
      .positive()
      .default(50)
      .describe("Maximum number of stories to return. Defaults to 50."),
  })
  .strict();

// scrum_get_story — single story by ref
export const GetStorySchema = z
  .object({
    ref: StoryRefSchema.describe(
      "Reference to the story to fetch. Supply number (issue number) or id (board item ID), " +
        "or both.",
    ),
  })
  .strict();

// scrum_get_history — how many completed sprints to look back
export const GetHistorySchema = z
  .object({
    window: z
      .number()
      .int()
      .min(1)
      .max(10)
      .default(5)
      .describe("Number of completed sprints to include (1–10). Defaults to 5."),
  })
  .strict();

// scrum_get_burndown — optional sprint ref, defaults to "current" in the handler
export const GetBurndownSchema = z
  .object({
    sprint: SprintRefSchema.optional().describe(
      'Sprint to chart. Defaults to "current" if omitted.',
    ),
  })
  .strict();

// ── Write tool schemas ────────────────────────────────────────────────────────

// scrum_create_story — create and optionally place on board in one call
export const CreateStorySchema = z
  .object({
    title: z
      .string()
      .min(1)
      .describe("Story title. Keep concise — one sentence describing the deliverable."),
    body: z
      .string()
      .describe(
        "Full markdown body. Recommended format: user-story opener " +
          '("As a [user], I want [goal], so that [benefit].") followed by an ' +
          "Acceptance Criteria checklist. Required — pass an empty string if minimal.",
      ),
    type: StoryTypeSchema,
    priority: z
      .string()
      .optional()
      .describe(
        'Priority vocabulary display name (e.g. "Must", "Should", "Could"). ' +
          "Must match an existing priority option — call scrum_orient to see valid values.",
      ),
    story_points: z
      .number()
      .optional()
      .describe("Effort estimate using your team's scale (commonly Fibonacci: 1, 2, 3, 5, 8, 13)."),
    labels: z
      .array(z.string())
      .optional()
      .describe(
        "Additional labels to apply. Type labels (type:feature, type:bug, etc.) are " +
          "managed automatically — do not duplicate them here.",
      ),
    epic: z
      .string()
      .optional()
      .describe("Milestone title to assign this story to. Created automatically if not found."),
    assignees: z
      .array(z.string())
      .optional()
      .describe('GitHub logins to assign (e.g. ["hoonsubin"]).'),
    sprint: SprintRefSchema.optional().describe(
      'Place the story in this sprint immediately after creation. Omit to leave in the backlog. "current" or "next" are the most common values.',
    ),
  })
  .strict();

// scrum_update_story — edits content only; for board fields use scrum_set_field
export const UpdateStorySchema = z
  .object({
    ref: StoryRefSchema,
    title: z.string().optional().describe("Replacement title. Omit to leave unchanged."),
    body: z
      .string()
      .optional()
      .describe(
        "Replacement markdown body — REPLACES the entire body, does not append. " +
          "Call scrum_get_story first if you want to add to the existing body.",
      ),
    labels: z
      .array(z.string())
      .optional()
      .describe(
        "Replacement label set — REPLACES ALL existing labels. " +
          "Call scrum_get_story first to read current labels if you want to add without removing.",
      ),
    assignees: z
      .array(z.string())
      .optional()
      .describe(
        "Replacement assignee list of GitHub logins — REPLACES ALL existing assignees. " +
          "Call scrum_get_story first to read current assignees if you want to add without removing.",
      ),
    epic: z
      .string()
      .or(z.null())
      .optional()
      .describe(
        "Milestone title to assign to, or null to detach from the current epic. " +
          "Omit entirely to leave unchanged.",
      ),
  })
  .strict();

// scrum_set_field — single entry point for all story-level board-field mutations.
export const SetFieldSchema = z
  .object({
    ref: StoryRefSchema,
    field: ScrumFieldSchema,
    value: z
      .union([z.string(), z.number(), SprintRefSchema, z.null()])
      .describe(
        "Value for the field. Shape depends on field: " +
          'status → string display name (e.g. "In Progress", "Done"); ' +
          'sprint → "current" | "next" | "<sprint-name>" | null; ' +
          "story_points → number (e.g. 3, 5, 8); " +
          'priority → string display name (e.g. "Must", "Should"); ' +
          'assignee → GitHub login string (e.g. "hoonsubin"). ' +
          "Pass null for any field to clear the value entirely.",
      ),
  })
  .strict();

// scrum_plan_sprint — bulk-assign stories; replace:true clears existing sprint items first
export const PlanSprintSchema = z
  .object({
    sprint: SprintRefSchema.describe(
      'Target sprint. "current", "next", or an exact sprint name string.',
    ),
    stories: z
      .array(StoryRefSchema)
      .min(1)
      .describe(
        "Stories to assign to the sprint. At least one required. " +
          "Each entry needs at least number or id.",
      ),
    replace: z
      .boolean()
      .default(false)
      .describe(
        "false (default) = add the listed stories to the sprint without touching existing items. " +
          "true = CLEAR all current sprint stories first, then assign the list. " +
          "Use replace:true only when fully replanning a sprint.",
      ),
  })
  .strict();

// scrum_log_impediment — creates a "spike" story with an "impediment" label linked to the affected story
export const LogImpedimentSchema = z
  .object({
    description: z
      .string()
      .min(1)
      .describe(
        "Full description of the blocker. Be specific — this becomes the impediment story body " +
          "and the comment posted to the affected story.",
      ),
    affects: StoryRefSchema.describe("The story this impediment is blocking (required)."),
    raised_by: z
      .string()
      .optional()
      .describe(
        "GitHub login of the team member raising the impediment (e.g. \"hoonsubin\"). " +
          "Defaults to the Scrum Master configured in config.yml.",
      ),
    priority: z
      .string()
      .optional()
      .describe(
        "Urgency vocabulary display name (e.g. \"Must\"). " +
          "Defaults to the highest-tier priority value. " +
          "Call scrum_orient to see valid priority values.",
      ),
  })
  .strict();

// scrum_add_vocabulary — idempotent addition of a vocabulary entry to the platform schema.
export const AddVocabularySchema = z
  .object({
    kind: z
      .enum(["status_option", "priority_option", "label"])
      .describe(
        '"status_option" = add a new column/state to the Status field; ' +
          '"priority_option" = add a new tier to the Priority field; ' +
          '"label" = add a new repo label. ' +
          "IMPORTANT: this tool cannot create new project fields — only options within " +
          "existing fields. Creating a new field requires a human to act in the GitHub Projects UI.",
      ),
    value: z
      .string()
      .min(1)
      .describe(
        'Display name of the option or label to add (e.g. "Blocked", "Critical", "tech_debt"). ' +
          "Safe to call if the value already exists — operation is idempotent.",
      ),
  })
  .strict();

// scrum_get_template — fetch a ceremony artifact template by type
export const GetTemplateSchema = z
  .object({
    artifact_type: z
      .enum([
        "sprint_review",
        "retrospective",
        "standup",
        "sprint_planning",
        "refinement",
      ])
      .describe(
        'Ceremony template to fetch: "sprint_review", "retrospective", "standup", ' +
          '"sprint_planning", or "refinement".',
      ),
  })
  .strict();
