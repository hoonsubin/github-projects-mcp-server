// =============================================================================
// src/schemas/scrum.ts — Zod input schemas for all 11 scrum_* tools
// [Phase 1, step 2 — COMPLETE: all schemas implemented]
//
// Rules enforced here:
//   - No GitHub IDs, node IDs, or internal field identifiers appear in these schemas.
//   - The agent speaks Scrum vocabulary only; the backend translates.
//   - All tool schemas are strict() — unknown keys are rejected.
// =============================================================================

import { z } from "zod";

// ── Primitive schemas (shared by multiple tools) ──────────────────────────────

// Accepted as input by any tool that references a story. At least one of number or id required.
export const StoryRefSchema = z
  .object({
    number: z.number().int().positive().optional(), // user-facing issue number
    id: z.string().optional(), // opaque backend handle from a previous call
  })
  .refine((v) => v.number !== undefined || v.id !== undefined, {
    message: "StoryRef requires at least one of: number, id",
  });

// Sprint targeting: "current", "next", null (= backlog / clear sprint), or explicit sprint name.
export const SprintRefSchema = z.union([
  z.literal("current"),
  z.literal("next"),
  z.null(),
  z.string().min(1),
]);

// The five board fields the agent can write via scrum_set_field. Fixed set for v1.
export const ScrumFieldSchema = z.enum([
  "status",
  "sprint",
  "story_points",
  "priority",
  "assignee",
]);

// Story type — drives the type label applied by the backend.
// NOTE: "impediment" is NOT a StoryType. scrum_log_impediment uses type:"spike" + an "impediment" label.
export const StoryTypeSchema = z.enum(["feature", "bug", "tech_debt", "spike"]);

// ── Read tool schemas ─────────────────────────────────────────────────────────

// scrum_orient — no arguments; uses z.object({}).strict().shape inline in the handler

// scrum_get_sprint — optional sprint ref, defaults to "current" in the handler
export const GetSprintSchema = z
  .object({ sprint: SprintRefSchema.optional() })
  .strict();

// scrum_get_backlog — all filters are optional; client-side filtering in handler
export const GetBacklogSchema = z
  .object({
    search: z.string().optional(), // substring match on title+body
    labels: z.array(z.string()).optional(), // include only stories carrying all these labels
    priority: z.string().optional(), // vocabulary value, e.g. "Must"
    epic: z.string().optional(), // Milestone title
    limit: z.number().int().positive().default(50),
  })
  .strict();

// scrum_get_story — single story by ref
export const GetStorySchema = z.object({ ref: StoryRefSchema }).strict();

// scrum_get_history — how many completed sprints to look back
export const GetHistorySchema = z
  .object({
    window: z.number().int().min(1).max(10).default(5),
  })
  .strict();

// scrum_get_burndown — optional sprint ref, defaults to "current" in the handler
export const GetBurndownSchema = z
  .object({ sprint: SprintRefSchema.optional() })
  .strict();

// ── Write tool schemas ────────────────────────────────────────────────────────

// scrum_create_story — create and optionally place on board in one call
export const CreateStorySchema = z
  .object({
    title: z.string().min(1),
    body: z.string(), // full markdown body; agent assembles user-story format + AC
    type: StoryTypeSchema,
    priority: z.string().optional(),
    story_points: z.number().optional(),
    labels: z.array(z.string()).optional(),
    epic: z.string().optional(), // Milestone title; creates if not found
    assignees: z.array(z.string()).optional(), // GitHub logins
    sprint: SprintRefSchema.optional(), // if provided, placed on board immediately
  })
  .strict();

// scrum_update_story — edits content only; for board fields use scrum_set_field
export const UpdateStorySchema = z
  .object({
    ref: StoryRefSchema,
    title: z.string().optional(),
    body: z.string().optional(), // replaces full body; agent reads first if appending
    labels: z.array(z.string()).optional(), // replaces label set (excludes type:* / priority:* managed elsewhere)
    assignees: z.array(z.string()).optional(), // replaces assignee set
    epic: z.string().or(z.null()).optional(), // null to detach from epic/Milestone
  })
  .strict();

// scrum_set_field — single entry point for all story-level board-field mutations.
// Operates on a specific story item; for board schema changes use scrum_add_vocabulary.
// value shape depends on field and is validated at runtime in the handler.
export const SetFieldSchema = z
  .object({
    ref: StoryRefSchema,
    field: ScrumFieldSchema,
    value: z.union([z.string(), z.number(), SprintRefSchema, z.null()]),
  })
  .strict();

// scrum_plan_sprint — bulk-assign stories; replace:true clears existing sprint items first
export const PlanSprintSchema = z
  .object({
    sprint: SprintRefSchema,
    stories: z.array(StoryRefSchema).min(1),
    replace: z.boolean().default(false),
  })
  .strict();

// scrum_log_impediment — creates a "spike" story with an "impediment" label linked to the affected story
export const LogImpedimentSchema = z
  .object({
    description: z.string().min(1),
    affects: StoryRefSchema, // the story this impediment is blocking
    raised_by: z.string().optional(), // team member login; defaults to configured Scrum Master
    priority: z.string().optional(), // vocabulary value; defaults to highest tier
  })
  .strict();

// scrum_add_vocabulary — idempotent addition of a vocabulary entry to the platform schema.
// Adds a missing option to an existing project field (status, priority) or creates a missing
// repo label (type labels, "impediment"). Cannot create new project fields — that requires
// human action via the GitHub Projects UI.
export const AddVocabularySchema = z
  .object({
    kind: z.enum(["status_option", "priority_option", "label"]),
    value: z.string().min(1), // display name to add (e.g. "Blocked", "Critical", "tech_debt")
  })
  .strict();
