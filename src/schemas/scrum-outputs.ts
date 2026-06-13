// =============================================================================
// src/schemas/scrum-outputs.ts - Zod output schemas for scrum_* tool responses
//
// Runtime contracts for agent-visible JSON. Complement domain TypeScript types.
// =============================================================================

import { z } from "zod";
import { IMPEDIMENT_STATUSES } from "../domain/types.ts";

const EntityRefSchema = z.object({ id: z.string() }).strict();

const ItemListingRefSchema = z.object({
  id: z.string(),
  key: z.string(),
}).strict();

const DependencyEntrySchema = z.object({
  key: z.string(),
  title: z.string().nullable().optional(),
  ref: EntityRefSchema,
}).strict();

const LinkedArtifactSchema = z.object({
  number: z.number(),
  title: z.string(),
  url: z.string(),
  state: z.string(),
  is_draft: z.boolean(),
}).strict();

const EpicRefWithNameSchema = z.object({
  ref: EntityRefSchema,
  name: z.string(),
}).strict();

export const BacklogItemListingSchema = z.object({
  ref: ItemListingRefSchema,
  title: z.string(),
  type: z.string().nullable().optional(),
  status: z.string().nullable(),
  story_points: z.number().nullable().optional(),
  priority: z.string().nullable().optional(),
  assignees: z.array(z.string()).optional(),
  labels: z.array(z.string()).optional(),
  sprint: z.object({
    name: z.string().nullable(),
    ref: EntityRefSchema,
  }).strict(),
  epic: EpicRefWithNameSchema.nullable().optional(),
  blocked_by: z.array(DependencyEntrySchema).optional(),
  blocks: z.array(ItemListingRefSchema).optional(),
  linked_pull_requests: z.array(LinkedArtifactSchema).optional(),
  content_kind: z.enum(["issue", "pr", "draft"]).optional(),
  custom_fields: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
    .optional(),
}).strict();

const DependencyPointerSchema = z.object({
  key: z.string(),
  title: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  ref: EntityRefSchema,
}).strict();

const CompactBlockedBySchema = z.object({ key: z.string() }).strict();

export const CompactItemListingSchema = z.object({
  ref: ItemListingRefSchema,
  title: z.string(),
  type: z.string().nullable().optional(),
  status: z.string().nullable(),
  story_points: z.number().nullable().optional(),
  blocked_by: z.array(CompactBlockedBySchema).optional(),
}).strict();

export const StandardItemListingSchema = CompactItemListingSchema.extend({
  priority: z.string().nullable().optional(),
  sprint: z.string().nullable().optional(),
  assignees: z.array(z.string()).optional(),
  linked_pull_requests: z.array(LinkedArtifactSchema).optional(),
  content_kind: z.enum(["issue", "pr", "draft"]).optional(),
}).strict();

export const ItemSearchResultSchema = z.object({
  items: z.array(
    z.union([CompactItemListingSchema, StandardItemListingSchema, BacklogItemListingSchema]),
  ),
  total_count: z.number(),
  fields_mode: z
    .enum(["compact", "standard", "full"])
    .describe(
      "Projection applied to each item in this response. " +
        '"compact" = ref, title, type, status, story_points, blocked_by; ' +
        '"standard" = compact + priority, sprint, assignees, linked_pull_requests; ' +
        '"full" = all fields including labels, epic, custom_fields.',
    ),
  scope_summary: z.object({
    sprint_count: z.number().nullable(),
    backlog_count: z.number().nullable(),
  }).strict().optional(),
  dependency_map: z.array(DependencyPointerSchema).optional(),
  warnings: z.array(z.string()).optional(),
}).strict();

const SprintContextSchema = z.object({
  id: z.string(),
  name: z.string(),
  goal: z.string().nullable().optional(),
  start_date: z.string(),
  end_date: z.string(),
  duration_days: z.number(),
  days_elapsed: z.number(),
  days_remaining: z.number(),
  time_elapsed_pct: z.number(),
}).strict();

const EpicSummarySchema = z.object({
  ref: EntityRefSchema,
  name: z.string(),
  description: z.string().nullable().optional(),
  status: z.enum(["open", "in_progress", "done"]).nullable().optional(),
  open_item_count: z.number(),
}).strict();

export const OrientResultSchema = z.object({
  warnings: z.array(z.string()).optional(),
  platform_state: z.object({
    fields: z.object({
      status: z.object({
        exists: z.boolean(),
        options: z.array(z.string()),
        // Omitted when empty (board options match config)
        missing_options: z.array(z.string()).optional(),
      }).strict(),
      sprint: z.object({ exists: z.boolean() }).strict(),
      story_points: z.object({ exists: z.boolean() }).strict(),
      priority: z.object({
        exists: z.boolean(),
        options: z.array(z.string()),
        // Omitted when empty (board options match config)
        missing_options: z.array(z.string()).optional(),
      }).strict(),
      type_field: z.object({
        exists: z.boolean(),
        configured: z.boolean(),
      }).strict(),
    }).strict(),
    // Omitted when empty (no vocabulary gaps across status + priority)
    missing_options: z.array(z.string()).optional(),
    // Entire object omitted when all sub-arrays are empty
    labels: z.object({
      // Omitted in session mode and when empty (full inventory: use detail:"full")
      existing: z.array(z.string()).optional(),
      // Omitted in session mode and when empty
      expected: z.array(z.string()).optional(),
      // Omitted when empty (no missing labels)
      missing: z.array(z.string()).optional(),
    }).strict().optional(),
    iterations: z.object({
      active: SprintContextSchema.nullable(),
      // Omitted when null (no upcoming sprint scheduled)
      next: SprintContextSchema.nullable().optional(),
      completed_count: z.number(),
    }).strict(),
    epics: z.object({
      active: z.array(EpicSummarySchema),
      total_count: z.number(),
    }).strict(),
    template_uris: z.record(z.string(), z.string()).nullable().optional(),
    // Omitted when null (no deadline field configured)
    deadline_field: z.string().nullable().optional(),
  }).strict(),
  vocabulary: z.object({
    status: z.record(z.string(), z.string()).nullable(),
    priority: z.record(z.string(), z.string()).nullable(),
    type: z.record(z.string(), z.string()).nullable(),
    // Omitted when both scale and values are null (story points not configured)
    story_points: z.object({
      scale: z.string().nullable(),
      values: z.array(z.number()).nullable(),
    }).strict().optional(),
    sprint: z.object({
      duration_days: z.number().nullable(),
      velocity_window: z.number(),
      length_weeks: z.number().nullable(),
    }).strict(),
    team: z.array(
      z.object({
        name: z.string(),
        role: z.enum(["scrum_master", "product_owner", "developer"]),
        contact: z.string().optional(),
      }).strict(),
    ).nullable().optional(),
    dor: z.array(z.string()).nullable().optional(),
    dod: z.array(z.string()).nullable().optional(),
    autonomy: z.object({
      require_confirmation_above_n_items: z.number().nullable(),
    }).strict().nullable().optional(),
  }).strict(),
}).strict();

export const StorySchema = z.object({
  ref: EntityRefSchema,
  title: z.string(),
  body: z.string(),
  type: z.string().nullable().optional(),
  status: z.string().nullable(),
  sprint: z.string().nullable().optional(),
  story_points: z.number().nullable().optional(),
  priority: z.string().nullable().optional(),
  assignees: z.array(z.string()).optional(),
  labels: z.array(z.string()).optional(),
  created_at: z.string(),
  updated_at: z.string(),
  blocked_by: z.array(DependencyEntrySchema).optional(),
  kind: z.string().nullable().optional(),
  key: z.string().nullable().optional(),
  url: z.string().nullable().optional(),
  epic: EpicRefWithNameSchema.nullable().optional(),
  warnings: z.array(z.string()).optional(),
}).strict();

const StoryCommentSchema = z.object({
  author: z.string(),
  body: z.string(),
  created_at: z.string(),
  url: z.string(),
}).strict();

export const ItemDetailResultSchema = z.object({
  story: StorySchema.omit({ warnings: true }),
  comments: z.array(StoryCommentSchema).nullable().optional(),
  linked_artifacts: z.array(LinkedArtifactSchema).nullable().optional(),
  acceptance_criteria: z.array(z.string()).optional(),
  warnings: z.array(z.string()).optional(),
}).strict();

export const ImpedimentListingSchema = z.object({
  ref: EntityRefSchema,
  description: z.string(),
  status: z.enum(IMPEDIMENT_STATUSES),
  raised_by: z.string().nullable().optional(),
  raised_at: z.string(),
  resolved_at: z.string().nullable().optional(),
}).strict();

export const AddVocabularyResultSchema = z.object({
  created: z.boolean(),
  already_exists: z.boolean().optional(),
  kind: z.string(),
  value: z.string(),
}).strict();

const StoryRefOutputSchema = z.object({ id: z.string() }).passthrough();

export const PlanSprintResultSchema = z.object({
  sprint: z.union([z.string(), z.null()]),
  assigned: z.array(StoryRefOutputSchema),
  cleared: z.array(StoryRefOutputSchema).optional(),
  skipped: z.array(
    z.object({
      ref: StoryRefOutputSchema,
      reason: z.string(),
    }).strict(),
  ),
  goal: z.string().optional(),
}).strict();

/** Flat story fields plus partial-failure markers (matches MCP outputSchema). */
export const CreateStoryPartialFailureSchema = StorySchema.extend({
  partialFailure: z.literal(true),
  failedFields: z.array(
    z.object({
      field: z.string(),
      reason: z.string(),
    }).strict(),
  ),
}).strict();

export const CreateStoryTotalFailureSchema = z.object({
  partialFailure: z.literal(true),
  failedFields: z.array(
    z.object({ field: z.string(), reason: z.string() }).strict(),
  ),
}).strict();

export const CreateStoryResponseSchema = z.union([
  CreateStoryPartialFailureSchema,
  CreateStoryTotalFailureSchema,
  StorySchema,
]);

/** MCP outputSchema - success Story or partial/total failure markers. */
export const CreateStoryOutputSchema = z.union([
  StorySchema,
  CreateStoryPartialFailureSchema,
  CreateStoryTotalFailureSchema,
]);

export const LogImpedimentResultSchema = z.object({
  impediment: ImpedimentListingSchema,
  affects: z.unknown().nullable(),
}).strict();

export const WriteAckSchema = z.object({
  ref: EntityRefSchema,
  applied: z.literal(true),
  field: z.string().optional(),
  warnings: z.array(z.string()).optional(),
}).strict();

export const SetFieldResponseSchema = z.union([WriteAckSchema, StorySchema]);

export const UpdateStoryResponseSchema = z.union([WriteAckSchema, StorySchema]);

export const UpdateImpedimentResponseSchema = ImpedimentListingSchema;

// scrum_get_sprint_data output schemas

const SprintInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  goal: z.string().nullable().optional(),
  start_date: z.string(),
  duration_days: z.number(),
  end_date: z.string(),
}).strict();

export const SprintSummarySchema = z.object({
  total_count: z.number(),
  active_count: z.number(),
  done_count: z.number(),
  total_points: z.number(),
  done_points: z.number(),
  remaining_points: z.number(),
  blocked_count: z.number(),
  unassigned_count: z.number(),
}).strict();

export const SprintRawItemSchema = z.object({
  id: z.string(),
  number: z.number().nullable().optional(), // absent when draft (no GitHub issue number)
  title: z.string(),
  type: z.string().nullable().optional(),
  status: z.string().nullable(),
  story_points: z.number().nullable().optional(),
  has_assignee: z.boolean(),
  has_blockers: z.boolean(),
  completed_at: z.string().nullable().optional(),
}).strict();

export const SprintRawDataSchema = z.object({
  sprint: SprintInfoSchema.nullable(),
  summary: SprintSummarySchema.nullable().optional(),
  items: z.array(SprintRawItemSchema).optional(),
  warnings: z.array(z.string()).optional(),
}).strict();
