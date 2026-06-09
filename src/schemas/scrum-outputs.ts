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
  title: z.string().nullable(),
  ref: EntityRefSchema,
}).strict();

const EpicRefWithNameSchema = z.object({
  ref: EntityRefSchema,
  name: z.string(),
}).strict();

export const BacklogItemListingSchema = z.object({
  ref: ItemListingRefSchema,
  title: z.string(),
  type: z.string().nullable(),
  status: z.string().nullable(),
  story_points: z.number().nullable(),
  priority: z.string().nullable(),
  assignees: z.array(z.string()),
  labels: z.array(z.string()),
  sprint: z.object({
    name: z.string().nullable(),
    ref: EntityRefSchema,
  }).strict(),
  epic: EpicRefWithNameSchema.nullable(),
  blocked_by: z.array(DependencyEntrySchema),
  blocks: z.array(ItemListingRefSchema),
  custom_fields: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
}).strict();

const DependencyNodeSchema = z.object({
  key: z.string(),
  title: z.string().nullable(),
  status: z.string().nullable(),
  sprint: z.string().nullable(),
  epic_name: z.string().nullable(),
  story_points: z.number().nullable(),
  priority: z.string().nullable(),
  resolved: z.boolean(),
  blocks: z.array(z.string()),
  blocked_by: z.array(z.string()),
}).strict();

const DependencyMapSchema = z.record(z.string(), DependencyNodeSchema);

export const ItemSearchResultSchema = z.object({
  items: z.array(BacklogItemListingSchema),
  total_count: z.number(),
  scope_summary: z.object({
    sprint_count: z.number().nullable(),
    backlog_count: z.number().nullable(),
  }).strict(),
  dependency_map: DependencyMapSchema.nullable(),
  warnings: z.array(z.string()).optional(),
}).strict();

const SprintContextSchema = z.object({
  id: z.string(),
  name: z.string(),
  goal: z.string().nullable(),
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
  description: z.string().nullable(),
  status: z.enum(["open", "in_progress", "done"]).nullable(),
  open_item_count: z.number(),
}).strict();

export const OrientResultSchema = z.object({
  warnings: z.array(z.string()).optional(),
  platform_state: z.object({
    fields: z.object({
      status: z.object({
        exists: z.boolean(),
        options: z.array(z.string()),
        missing_options: z.array(z.string()),
      }).strict(),
      sprint: z.object({ exists: z.boolean() }).strict(),
      story_points: z.object({ exists: z.boolean() }).strict(),
      priority: z.object({
        exists: z.boolean(),
        options: z.array(z.string()),
        missing_options: z.array(z.string()),
      }).strict(),
      type_field: z.object({
        exists: z.boolean(),
        configured: z.boolean(),
      }).strict(),
    }).strict(),
    missing_options: z.array(z.string()),
    labels: z.object({
      existing: z.array(z.string()),
      expected: z.array(z.string()),
      missing: z.array(z.string()),
    }).strict(),
    iterations: z.object({
      active: SprintContextSchema.nullable(),
      next: SprintContextSchema.nullable(),
      completed_count: z.number(),
    }).strict(),
    epics: z.object({
      active: z.array(EpicSummarySchema),
      total_count: z.number(),
    }).strict(),
    template_uris: z.record(z.string(), z.string()).nullable(),
    deadline_field: z.string().nullable(),
  }).strict(),
  vocabulary: z.object({
    status: z.record(z.string(), z.string()).nullable(),
    priority: z.record(z.string(), z.string()).nullable(),
    type: z.record(z.string(), z.string()).nullable(),
    story_points: z.object({
      scale: z.string().nullable(),
      values: z.array(z.number()).nullable(),
    }).strict(),
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
    ).nullable(),
    dor: z.array(z.string()).nullable(),
    dod: z.array(z.string()).nullable(),
    autonomy: z.object({
      require_confirmation_above_n_items: z.number().nullable(),
    }).strict().nullable(),
  }).strict(),
}).strict();

export const StorySchema = z.object({
  ref: EntityRefSchema,
  title: z.string(),
  body: z.string(),
  type: z.string().nullable(),
  status: z.string().nullable(),
  sprint: z.string().nullable(),
  story_points: z.number().nullable(),
  priority: z.string().nullable(),
  assignees: z.array(z.string()),
  labels: z.array(z.string()),
  created_at: z.string(),
  updated_at: z.string(),
  blocked_by: z.array(DependencyEntrySchema),
  kind: z.string().nullable(),
  key: z.string().nullable(),
  url: z.string().nullable(),
  epic: EpicRefWithNameSchema.nullable(),
  warnings: z.array(z.string()).optional(),
}).strict();

const StoryCommentSchema = z.object({
  author: z.string(),
  body: z.string(),
  created_at: z.string(),
  url: z.string(),
}).strict();

const LinkedArtifactSchema = z.object({
  number: z.number(),
  title: z.string(),
  url: z.string(),
  state: z.string(),
  is_draft: z.boolean(),
}).strict();

export const ItemDetailResultSchema = z.object({
  story: StorySchema.omit({ warnings: true }),
  comments: z.array(StoryCommentSchema).nullable(),
  linked_artifacts: z.array(LinkedArtifactSchema).nullable(),
  acceptance_criteria: z.array(z.string()),
  warnings: z.array(z.string()).optional(),
}).strict();

export const ImpedimentListingSchema = z.object({
  ref: EntityRefSchema,
  description: z.string(),
  status: z.enum(IMPEDIMENT_STATUSES),
  raised_by: z.string().nullable(),
  raised_at: z.string(),
  resolved_at: z.string().nullable(),
}).strict();

export const AddVocabularyResultSchema = z.object({
  created: z.boolean(),
  kind: z.string(),
  value: z.string(),
}).strict();

const StoryRefOutputSchema = z.object({ id: z.string() }).passthrough();

export const PlanSprintResultSchema = z.object({
  sprint: z.union([z.string(), z.null()]),
  assigned: z.array(StoryRefOutputSchema),
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

export const CreateStoryResponseSchema = z.union([
  CreateStoryPartialFailureSchema,
  StorySchema,
]);

/** MCP outputSchema - success Story or same shape with partialFailure + failedFields set. */
export const CreateStoryOutputSchema = CreateStoryPartialFailureSchema.partial({
  partialFailure: true,
  failedFields: true,
});

export const LogImpedimentResultSchema = z.object({
  impediment: ImpedimentListingSchema,
  affects: z.unknown().nullable(),
}).strict();

export const SetFieldResponseSchema = StorySchema;

export const UpdateStoryResponseSchema = StorySchema;

export const UpdateImpedimentResponseSchema = ImpedimentListingSchema;

// scrum_get_sprint_data output schemas

const SprintInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  goal: z.string().nullable(),
  startDate: z.string(),
  durationDays: z.number(),
  endDate: z.string(),
}).strict();

export const SprintRawItemSchema = z.object({
  id: z.string(),
  number: z.number(),
  title: z.string(),
  type: z.string().nullable(),
  status: z.string().nullable(),
  storyPoints: z.number().nullable(),
  hasAssignee: z.boolean(),
  hasBlockers: z.boolean(),
  completedAt: z.string().nullable(),
}).strict();

export const SprintRawDataSchema = z.object({
  sprint: SprintInfoSchema,
  items: z.array(SprintRawItemSchema),
  warnings: z.array(z.string()).optional(),
}).strict();
