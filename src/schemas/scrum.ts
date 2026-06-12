// =============================================================================
// src/schemas/scrum.ts - Zod input schemas for all 11 scrum_* tools
//
// Rules enforced here:
//   - No GitHub IDs, node IDs, or internal field identifiers appear in these schemas.
//   - The agent speaks Scrum vocabulary only; the backend translates.
//   - All tool schemas are strict() - unknown keys are rejected.
//   - Every field carries a .describe() so agents see documentation in the
//     JSON Schema properties map, not just the Zod source.
// =============================================================================

import { z } from "zod";
import type { EpicRef, StoryRef } from "../domain/types.ts";
import {
  IMPEDIMENT_STATUSES,
  SCRUM_FIELDS,
  toSprintName,
  VOCABULARY_KINDS,
} from "../domain/types.ts";
import { FIND_ITEMS_INTENTS } from "../scrum/find-items-intent.ts";
import { LISTING_FIELDS_MODES } from "../scrum/ports.ts";

// ── Primitive schemas (shared by multiple tools) ──────────────────────────────

// Accepted as input by any tool that references a story.
// Every read tool returns Story.ref.id - pass that value here.
const StoryRefSchema: z.ZodType<StoryRef> = z.union([
  z.object({
    id: z
      .string()
      .describe(
        "Opaque project-item handle returned by any read tool (scrum_orient, " +
          "scrum_find_items, scrum_get_item_detail, scrum_create_story, etc.). " +
          "Always present in Story.ref.id. Use scrum_orient or scrum_find_items " +
          "first if you do not yet have the id for the story you want to act on.",
      ),
  }),
  z.object({
    number: z
      .number()
      .describe(
        "Human-readable issue number (e.g. 42). " +
          "The backend resolves this to an opaque project-item handle. " +
          "Use when you know the issue number but do not yet have its 'id'.",
      ),
  }),
]);

/** Coerce MCP clients that stringify arrays; map null to [] (clear-all). */
const parseBlockedByInput = (val: unknown): unknown => {
  if (val === null) return [];
  if (typeof val === "string") {
    try {
      return JSON.parse(val) as unknown;
    } catch {
      return val;
    }
  }
  return val;
};

const BlockedByInputSchema = z.preprocess(
  parseBlockedByInput,
  z
    .array(StoryRefSchema)
    .optional()
    .describe(
      "Replace the full list of stories that block this story. " +
        "Each entry is a StoryRef ({ id }) obtained from a previous read tool. " +
        "Pass null or [] to clear all upstream dependencies. Omit to leave dependencies unchanged.",
    ),
);

// Accepted as input by any tool that references an epic (Milestone).
// Derived from the domain EpicRef type to maintain a single source of truth.
// Every read tool returns EpicRef.id - pass that value here.
const EpicRefSchema: z.ZodType<EpicRef> = z.object({
  id: z
    .string()
    .describe(
      "Opaque Milestone node ID returned by scrum_find_items (type=epic).ref.id " +
        "or scrum_get_item_detail on a story with an epic field.",
    ),
});

// Sprint targeting for writes and sprint data (not multi-sprint search).
const SprintRefSchema = z
  .union([
    z.literal("current"),
    z.literal("next"),
    z.null(),
    z.string().min(1).transform(toSprintName),
  ])
  .describe(
    'Which sprint to target. "current" = active sprint, "next" = upcoming sprint, ' +
      "null = backlog / clear sprint, or an exact sprint name from scrum_orient.",
  );

const FindItemsSprintSchema = z
  .union([
    z.literal("current"),
    z.literal("next"),
    z.literal("backlog"),
    z.literal("all"),
    z.string().min(1).transform(toSprintName),
  ])
  .describe(
    'Sprint filter. "current" | "next" | "backlog" | "all" (every iteration) | "<name>". Omit = entire board (active items only — Done/terminal items excluded by default; add statuses:["done"] to include them).',
  );

export const OrientSchema = z
  .object({
    detail: z
      .enum(["session", "full"])
      .optional()
      .default("session")
      .describe(
        '"session" (default) = vocabulary, sprint, DoR/DoD, team, autonomy, template URIs, ' +
          "capped epics (up to 5). Strips only labels.existing/expected (label inventory). " +
          '"full" = everything in session plus complete label inventory and all active epics. ' +
          "Use full only when you need platform_state.labels.existing (e.g. before assigning labels).",
      ),
    refresh: z
      .boolean()
      .optional()
      .default(false)
      .describe("When true, bypass session cache and reload metadata from the platform."),
  })
  .strict();

const WriteResponseSchema = z
  .enum(["ack", "story"])
  .optional()
  .default("ack")
  .describe(
    '"ack" (default) = minimal confirmation. "story" = full Story snapshot after the write.',
  );

// The six board fields the agent can write via scrum_set_field.
const ScrumFieldSchema = z
  .enum(SCRUM_FIELDS)
  .describe(
    "Board field to update. " +
      '"status" = workflow column (string display name, e.g. "In Progress"); ' +
      '"sprint" = iteration (SprintRef: "current" | "next" | "<name>" | null); ' +
      '"story_points" = effort estimate (number, e.g. 5); ' +
      '"priority" = urgency tier (string display name, e.g. "Must"); ' +
      '"assignee" = GitHub login of the owner (string, e.g. "hoonsubin"); ' +
      '"type" = story type canonical key (e.g. "feature", "bug" - see vocabulary.type in scrum_orient). ' +
      "Call scrum_orient to see all valid vocabulary values.",
  );

// Story type - the canonical key for the Type project board field.
// The valid values are declared in type_mapping in config.yml (e.g. "feature", "bug").
// Call scrum_orient to see vocabulary.type for the current project's valid values.
const StoryTypeSchema = z
  .string()
  .min(1)
  .describe(
    "Canonical type key declared in type_mapping in config.yml. " +
      'Common examples: "feature", "bug", "tech_debt", "spike", "impediment", "user_story". ' +
      "Call scrum_orient to read vocabulary.type for the exact keys valid in this project. " +
      "NOTE: use scrum_log_impediment for impediment stories - it handles the full workflow.",
  );

// ── Read tool schemas ─────────────────────────────────────────────────────────

// scrum_orient - no arguments; uses z.object({_:...}).shape inline in the handler

// scrum_get_item_detail - single story by ref
export const GetStorySchema = z
  .object({
    ref: StoryRefSchema.describe(
      "Reference to the story to fetch. Supply the Story.ref.id value returned by " +
        "scrum_orient, scrum_find_items, or a previous write tool.",
    ),
    detail: z
      .enum(["dor", "full"])
      .optional()
      .default("dor")
      .describe(
        '"dor" (default) = DoR/readiness slice: truncated body, latest comment, AC. ' +
          '"full" = complete body and comment history — use only when editing content.',
      ),
  })
  .strict();

// ── New tool schemas (for P6 handlers) ────────────────────────────────────────

// scrum_find_items - unified item search across all PBIs
export const FindItemsSchema = z
  .object({
    intent: z
      .enum(FIND_ITEMS_INTENTS)
      .optional()
      .describe(
        "Preset filter bundle (Scrum views). " +
          '"sprint_board" = current Sprint Backlog (iteration-assigned, standard fields); ' +
          '"backlog_ready" = Product Backlog groomed items with estimates; ' +
          '"readiness_check" = Sprint readiness + dependency_map; ' +
          '"blocked_items" = blocked work in current sprint + dependency_map; ' +
          '"search_backlog" = keyword search (requires search; default scope all); ' +
          '"by_keys" = lookup by issue number (requires keys). Omit to use explicit filters below.',
      ),
    sprint: FindItemsSprintSchema.optional(),
    keys: z
      .array(z.string().regex(/^\d+$/, "Must be a numeric string"))
      .optional()
      .describe('Direct lookup by issue number, e.g. ["42"]. Omit unused filters entirely.'),
    search: z.string().optional(),
    types: z.array(z.string()).optional(),
    statuses: z.array(z.string()).optional(),
    priority: z
      .string()
      .optional()
      .describe(
        'Priority filter. Accepts display name ("Must") or canonical key ("p0"). ' +
          "Resolve from vocabulary.priority in scrum_orient when unsure.",
      ),
    has_blockers: z
      .boolean()
      .optional()
      .describe(
        "When true, only items with blocked_by entries; when false, only items without blockers. " +
          'intent "blocked_items" sets this to true by default.',
      ),
    epic_id: z.string().optional(),
    labels: z.array(z.string()).optional(),
    assignee: z.string().optional(),
    estimated: z.boolean().optional(),
    include_dependencies: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        "Include off-listing active blocker pointers referenced by blocked_by. " +
          "Requires sprint or intent — unscoped use is coerced to readiness_check on current sprint.",
      ),
    fields: z
      .enum(LISTING_FIELDS_MODES)
      .optional()
      .default("compact")
      .describe('"compact" (default) | "standard" | "full" listing projection.'),
    limit: z.number().int().positive().optional().default(50),
  })
  .strict();

// scrum_get_sprint_data - sprint metrics and optional per-item facts
export const GetSprintDataSchema = z
  .object({
    sprint: z
      .union([SprintRefSchema, z.null()])
      .optional()
      .describe(
        'Sprint to fetch. Omit or "current" for active sprint; "next", sprint name; null for empty result.',
      ),
    view: z
      .enum(["summary", "items"])
      .optional()
      .default("summary")
      .describe(
        '"summary" (default) = Scrum metrics only (counts, points, blocked). ' +
          '"items" = summary plus per-item facts for burndown/velocity computation.',
      ),
    active_only: z
      .boolean()
      .optional()
      .default(true)
      .describe(
        "When true (default), exclude Done/terminal-status items from summary and item lists.",
      ),
  })
  .strict();

// ── Write tool schemas ────────────────────────────────────────────────────────

// scrum_create_story - create and optionally place on board in one call
export const CreateStorySchema = z
  .object({
    title: z
      .string()
      .min(1)
      .describe("Story title. Keep concise - one sentence describing the deliverable."),
    body: z
      .string()
      .describe(
        "Full markdown body. Recommended format: user-story opener " +
          '("As a [user], I want [goal], so that [benefit].") followed by an ' +
          "Acceptance Criteria checklist. Required - pass an empty string if minimal.",
      ),
    type: StoryTypeSchema,
    priority: z
      .string()
      .optional()
      .describe(
        'Priority vocabulary display name (e.g. "Must", "Should", "Could"). ' +
          "Must match an existing priority option - call scrum_orient to see valid values.",
      ),
    story_points: z
      .number()
      .optional()
      .describe("Effort estimate using your team's scale (commonly Fibonacci: 1, 2, 3, 5, 8, 13)."),
    labels: z
      .array(z.string())
      .optional()
      .describe(
        "Additional labels to apply. Only pass labels that already exist in the repository - " +
          'call scrum_orient(detail:"full") to see platform_state.labels.existing first. ' +
          "Story type is set via the Type board field, not a label.",
      ),
    epic: EpicRefSchema.optional().describe(
      "Epic reference ({ id: string }) from scrum_find_items (type=epic).ref.id. " +
        "Associates the new story with the corresponding Milestone.",
    ),
    assignees: z
      .array(z.string())
      .optional()
      .describe('GitHub logins to assign (e.g. ["hoonsubin"]).'),
    sprint: SprintRefSchema.optional().describe(
      'Place the story in this sprint immediately after creation. Omit to leave in the backlog. "current" or "next" are the most common values.',
    ),
  })
  .strict();

// scrum_update_story - edits content only; for board fields use scrum_set_field
export const UpdateStorySchema = z
  .object({
    ref: StoryRefSchema,
    title: z.string().optional().describe("Replacement title. Omit to leave unchanged."),
    body: z
      .string()
      .optional()
      .describe(
        "Replacement markdown body - REPLACES the entire body, does not append. " +
          "Call scrum_get_item_detail first if you want to add to the existing body.",
      ),
    labels: z
      .array(z.string())
      .optional()
      .describe(
        "Replacement label set - REPLACES ALL existing labels. " +
          "Call scrum_get_item_detail first to read current labels if you want to add without removing.",
      ),
    assignees: z
      .array(z.string())
      .optional()
      .describe(
        "Replacement assignee list of GitHub logins - REPLACES ALL existing assignees. " +
          "Call scrum_get_item_detail first to read current assignees if you want to add without removing.",
      ),
    epic: EpicRefSchema
      .nullable()
      .optional()
      .describe(
        "Epic reference ({ id: string }) to assign to, or null to detach from the current epic. " +
          "Pass the EpicRef.id from scrum_find_items (type=epic).ref.id. Omit entirely to leave unchanged.",
      ),
    comment: z
      .string()
      .optional()
      .describe(
        "Post a comment on the story after updating. " +
          "Can be combined with content fields (title, body, etc.) in one call. " +
          "Use with only { ref, comment } to post a comment without changing story content.",
      ),
    blocked_by: BlockedByInputSchema.optional(),
    response: WriteResponseSchema,
  })
  .strict();

// scrum_set_field - single entry point for all story-level board-field mutations.
export const SetFieldSchema = z
  .object({
    ref: StoryRefSchema,
    field: ScrumFieldSchema,
    value: z
      .union([z.string(), z.number(), SprintRefSchema, z.null()])
      .describe(
        "Field value. status/priority accept canonical keys (e.g. done, p0) or display names. " +
          'sprint → "current" | "next" | "<name>" | null. Pass null to clear.',
      ),
    response: WriteResponseSchema,
  })
  .strict();

// scrum_plan_sprint - bulk-assign stories; replace:true clears existing sprint items first
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
        "Sprint goal - a short statement of what the team aims to achieve this sprint.",
      ),
  })
  .strict();

// scrum_log_impediment - creates a "spike" story with an "impediment" label
// Optionally links to a story or sprint; omit to log a project-level orphan.
export const LogImpedimentSchema = z
  .object({
    description: z
      .string()
      .min(1)
      .describe(
        "Full description of the blocker. Be specific - this becomes the impediment story body " +
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

// scrum_update_impediment - update impediment status and resolution notes
export const UpdateImpedimentSchema = z
  .object({
    ref: z
      .object({
        id: z
          .string()
          .describe(
            "Impediment ID as returned by scrum_find_items(types: ['impediment']).items[].ref.id.",
          ),
      })
      .describe("Reference to the impediment to update."),
    status: z
      .enum(IMPEDIMENT_STATUSES)
      .describe("New impediment status."),
    resolution_notes: z
      .string()
      .optional()
      .describe("Notes explaining why this impediment was resolved."),
  })
  .strict();

// scrum_add_vocabulary - idempotent addition of a vocabulary entry to the platform schema.
export const AddVocabularySchema = z
  .object({
    kind: z
      .enum(VOCABULARY_KINDS)
      .describe(
        '"status_option" = add a config-declared Status display name missing from the board; ' +
          '"priority_option" = add a config-declared Priority display name missing from the board; ' +
          '"label" = add a new repo label (agent-driven, not config-gated). ' +
          "status_option and priority_option require the value to appear in scrum_orient missing_options.",
      ),
    value: z
      .string()
      .min(1)
      .describe(
        "Display name to add. For status_option/priority_option use exact names from config " +
          "status_display/priority_display that are listed in missing_options. Labels: any name.",
      ),
  })
  .strict();
