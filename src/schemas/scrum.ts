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
import { toSprintName } from "../domain/types.ts";

// ── Primitive schemas (shared by multiple tools) ──────────────────────────────

// Accepted as input by any tool that references a story.
// Every read tool returns Story.ref.id — pass that value here.
const StoryRefSchema = z.object({
  id: z
    .string()
    .describe(
      "Opaque project-item handle returned by any read tool (scrum_get_sprint, " +
        "scrum_get_backlog, scrum_get_story, scrum_create_story, etc.). " +
        "Always present in Story.ref.id. Use scrum_get_sprint or scrum_get_backlog " +
        "first if you do not yet have the id for the story you want to act on.",
    ),
});

// Sprint targeting: "current", "next", "all", null (= backlog / clear sprint), or explicit sprint name.
// NOTE: "all" is intentionally excluded from SprintRef because it is a query-mode flag,
// not a sprint reference. Other tools that accept SprintRef will resolve "all" to null.
const SprintRefSchema = z
  .union([
    z.literal("current"),
    z.literal("next"),
    z.literal("all"),
    z.null(),
    z.string().min(1).transform(toSprintName),
  ])
  .describe(
    'Which sprint to target. "current" = the active sprint, ' +
      '"next" = the upcoming sprint, ' +
      '"all" = active sprint + next sprint + completed sprints (up to limit), ' +
      "null = backlog / clear sprint assignment, " +
      'or an exact sprint name string (e.g. "Sprint 5"). ' +
      "Use scrum_orient to see all valid sprint names. " +
      'NOTE: "all" is only meaningful for scrum_get_sprint; other tools resolve it to null.',
  );

// The six board fields the agent can write via scrum_set_field.
const ScrumFieldSchema = z
  .enum(["status", "sprint", "story_points", "priority", "assignee", "type"])
  .describe(
    "Board field to update. " +
      '"status" = workflow column (string display name, e.g. "In Progress"); ' +
      '"sprint" = iteration (SprintRef: "current" | "next" | "<name>" | null); ' +
      '"story_points" = effort estimate (number, e.g. 5); ' +
      '"priority" = urgency tier (string display name, e.g. "Must"); ' +
      '"assignee" = GitHub login of the owner (string, e.g. "hoonsubin"); ' +
      '"type" = story type canonical key (e.g. "feature", "bug" — see vocabulary.type in scrum_orient). ' +
      "Call scrum_orient to see all valid vocabulary values.",
  );

// Story type — the canonical key for the Type project board field.
// The valid values are declared in type_display in config.yml (e.g. "feature", "bug").
// Call scrum_orient to see vocabulary.type for the current project's valid values.
const StoryTypeSchema = z
  .string()
  .min(1)
  .describe(
    "Canonical type key declared in type_display in config.yml. " +
      'Common examples: "feature", "bug", "tech_debt", "spike", "impediment", "user_story". ' +
      "Call scrum_orient to read vocabulary.type for the exact keys valid in this project. " +
      "NOTE: use scrum_log_impediment for impediment stories — it handles the full workflow.",
  );

// ── Read tool schemas ─────────────────────────────────────────────────────────

// scrum_orient — no arguments; uses z.object({_:...}).shape inline in the handler

// scrum_get_sprint — optional sprint ref, defaults to "current" in the handler
export const GetSprintSchema = z
  .object({
    sprint: SprintRefSchema.optional().describe(
      'Which sprint to fetch. Defaults to "current" if omitted. ' +
        'Pass "all" to receive every sprint as an array of snapshots.',
    ),
    limit: z
      .number()
      .int()
      .positive()
      .default(50)
      .describe(
        'Maximum number of sprints to return when sprint="all". ' +
          "Ignored for single-sprint requests. Defaults to 50.",
      ),
  })
  .strict();

// scrum_get_backlog — all filters are optional; client-side filtering in handler
export const GetBacklogSchema = z
  .object({
    search: z
      .string()
      .optional()
      .describe(
        "Case-insensitive substring matched against story title and body. " +
          "Results are filtered before applying limit.",
      ),
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
      .describe(
        "Maximum number of stories to return. Defaults to 50. " +
          "Applied after active-item filter and user-supplied filters.",
      ),
  })
  .strict();

// scrum_get_story — single story by ref
export const GetStorySchema = z
  .object({
    ref: StoryRefSchema.describe(
      "Reference to the story to fetch. Supply the Story.ref.id value returned by " +
        "scrum_get_sprint, scrum_get_backlog, or a previous write tool.",
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
        "Additional labels to apply. Only pass labels that already exist in the repository — " +
          "check platform_state.labels.existing from scrum_orient first. " +
          "Story type is set via the Type board field, not a label.",
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
    comment: z
      .string()
      .optional()
      .describe(
        "Post a comment on the story after updating. " +
          "Can be combined with content fields (title, body, etc.) in one call. " +
          "Use with only { ref, comment } to post a comment without changing story content.",
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
          'assignee → GitHub login string (e.g. "hoonsubin"); ' +
          'type → canonical key string (e.g. "feature", "bug" — see vocabulary.type in scrum_orient). ' +
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
          "Each entry must supply the Story.ref.id value from a read tool.",
      ),
    replace: z
      .boolean()
      .default(false)
      .describe(
        "false (default) = add the listed stories to the sprint without touching existing items. " +
          "true = CLEAR all current sprint stories first, then assign the list. " +
          "Use replace:true only when fully replanning a sprint.",
      ),
    goal: z
      .string()
      .optional()
      .describe(
        "Sprint goal — a short statement of what the team aims to achieve this sprint.",
      ),
  })
  .strict();

// scrum_log_impediment — creates a "spike" story with an "impediment" label
// Optionally links to a story or sprint; omit to log a project-level orphan.
export const LogImpedimentSchema = z
  .object({
    description: z
      .string()
      .min(1)
      .describe(
        "Full description of the blocker. Be specific — this becomes the impediment story body " +
          "and the comment posted to the affected story.",
      ),
    affects: z
      .union([
        z.object({ story: StoryRefSchema }),
        z.object({ sprint: SprintRefSchema }),
      ])
      .optional()
      .describe(
        "The story or sprint this impediment affects. Omit to log a project-level orphan.",
      ),
    raised_by: z
      .string()
      .optional()
      .describe(
        'GitHub login of the team member raising the impediment (e.g. "hoonsubin"). ' +
          "Defaults to the Scrum Master configured in config.yml.",
      ),
    priority: z
      .string()
      .optional()
      .describe(
        'Urgency vocabulary display name (e.g. "Must"). ' +
          "Defaults to the highest-tier priority value. " +
          "Call scrum_orient to see valid priority values.",
      ),
  })
  .strict();

// scrum_update_impediment — update impediment status and resolution notes
export const UpdateImpedimentSchema = z
  .object({
    ref: z
      .object({
        id: z
          .string()
          .describe(
            "Impediment ID as returned by scrum_get_backlog.orphan_impediments or scrum_get_sprint.impediments ref.id field.",
          ),
      })
      .describe("Reference to the impediment to update."),
    status: z
      .enum(["open", "in_progress", "resolved"])
      .describe("New impediment status."),
    resolution_notes: z
      .string()
      .optional()
      .describe("Notes explaining why this impediment was resolved."),
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
