import { z } from "zod";

// ── Common ───────────────────────────────────────────────────────────────────

export const PaginationSchema = {
  first: z.number().int().min(1).max(100).default(20)
    .describe("Number of items to return (1-100, default 20)"),
  after: z.string().optional()
    .describe("Cursor for pagination — use endCursor from a previous response"),
};

export const OwnerTypeSchema = z.enum(["user", "org"]).default("user")
  .describe("Whether the owner is a user or an organization");

// ── Projects ─────────────────────────────────────────────────────────────────

export const ListProjectsSchema = z.object({
  owner: z.string().min(1).describe("GitHub username or organization login"),
  owner_type: OwnerTypeSchema,
  ...PaginationSchema,
  include_closed: z.boolean().default(false)
    .describe("Include closed projects in results"),
}).strict();

export const GetProjectSchema = z.object({
  owner: z.string().min(1).describe("GitHub username or organization login"),
  owner_type: OwnerTypeSchema,
  project_number: z.number().int().positive()
    .describe("The project number shown in the GitHub URL (e.g., 1 for /projects/1)"),
}).strict();

export const UpdateProjectSchema = z.object({
  project_id: z.string().min(1)
    .describe("Node ID of the project (e.g., PVT_kwDO...)"),
  title: z.string().min(1).max(255).optional()
    .describe("New title for the project"),
  short_description: z.string().max(255).optional()
    .describe("New short description"),
  readme: z.string().optional()
    .describe("Markdown readme content"),
  public: z.boolean().optional()
    .describe("Set project visibility"),
  closed: z.boolean().optional()
    .describe("Set to true to close, false to reopen"),
}).strict();

// ── Items ────────────────────────────────────────────────────────────────────

export const ListItemsSchema = z.object({
  owner: z.string().min(1).describe("GitHub username or organization login"),
  owner_type: OwnerTypeSchema,
  project_number: z.number().int().positive()
    .describe("The project number"),
  ...PaginationSchema,
  filter_type: z.enum(["Issue", "PullRequest", "DraftIssue"]).optional()
    .describe("Filter items by content type: 'Issue', 'PullRequest', 'DraftIssue'"),
  iteration_id: z.string().optional()
    .describe("Filter to items assigned to a specific sprint iteration node ID"),
  status_option_id: z.string().optional()
    .describe("Filter to items with a specific Status option ID (from github_get_project_fields)"),
}).strict();

export const AddItemSchema = z.object({
  project_id: z.string().min(1)
    .describe("Node ID of the project (e.g., PVT_kwDO...)"),
  content_id: z.string().min(1)
    .describe("Node ID of the Issue or PullRequest to add (e.g., I_kwDO... or PR_kwDO...)"),
}).strict();

export const AddDraftIssueSchema = z.object({
  project_id: z.string().min(1)
    .describe("Node ID of the project"),
  title: z.string().min(1).max(255)
    .describe("Title for the draft issue"),
  body: z.string().optional()
    .describe("Markdown body for the draft issue"),
  assignee_ids: z.array(z.string()).max(10).optional()
    .describe("Array of user node IDs to assign"),
  iteration_id: z.string().optional()
    .describe("Iteration node ID to assign to a sprint immediately on creation"),
}).strict();

export const DeleteItemSchema = z.object({
  project_id: z.string().min(1)
    .describe("Node ID of the project"),
  item_id: z.string().min(1)
    .describe("Node ID of the project item to delete (e.g., PVTI_lADO...)"),
}).strict();

export const ArchiveItemSchema = z.object({
  project_id: z.string().min(1)
    .describe("Node ID of the project"),
  item_id: z.string().min(1)
    .describe("Node ID of the project item to archive/unarchive"),
  archived: z.boolean().default(true)
    .describe("true to archive, false to unarchive"),
}).strict();

// ── Field values ─────────────────────────────────────────────────────────────
//
// Flat schema instead of a discriminated union.
//
// Why: z.discriminatedUnion() serialises to an anyOf JSON Schema with 6 variants,
// each having different required keys and additionalProperties:false. Local LLMs
// reliably confuse the sibling keys across variants (e.g. using `value` instead of
// `option_id` for single_select), producing hard Zod failures on every write call.
//
// A flat object with an enum `type` discriminator and all variant-specific keys
// marked optional is unambiguous: the model sets `type`, then sets exactly the one
// key the description says to set. Runtime enforcement of the required-key-per-type
// constraint is done in each handler via `resolveFieldValue()` below.

export const FieldValueUnion = z.object({
  type: z
    .enum(["text", "number", "date", "single_select", "iteration", "clear"])
    .describe(
      "Field value type. Pick one:\n" +
      "  'text'          — plain string → also set `value` (string)\n" +
      "  'number'        — numeric      → also set `number_value` (number)\n" +
      "  'date'          — ISO date     → also set `value` (YYYY-MM-DD string)\n" +
      "  'single_select' — option ID    → also set `option_id` (string from field options)\n" +
      "  'iteration'     — sprint ID    → also set `iteration_id` (string from sprint config)\n" +
      "  'clear'         — removes the current value, no other keys needed",
    ),
  value: z
    .string()
    .optional()
    .describe("String value — required when type is 'text' or 'date' (YYYY-MM-DD format for date)"),
  number_value: z
    .number()
    .optional()
    .describe("Numeric value — required when type is 'number'"),
  option_id: z
    .string()
    .optional()
    .describe("Single-select option ID — required when type is 'single_select' (get IDs from github_get_project_fields)"),
  iteration_id: z
    .string()
    .optional()
    .describe("Iteration (sprint) node ID — required when type is 'iteration' (get from scrum://config or github_get_project_fields)"),
});

// ---------------------------------------------------------------------------
// resolveFieldValue
// ---------------------------------------------------------------------------
//
// Converts the flat FieldValueUnion input into:
//   { isClear: true }                           — for type='clear'
//   { isClear: false, fieldValue: {...} }       — for all other types
//
// Returns an error string if the required companion key is missing. Call sites
// should return this string as a tool error rather than throwing.

export type ResolvedFieldValue =
  | { isClear: true }
  | { isClear: false; fieldValue: Record<string, unknown> };

export const resolveFieldValue = (
  v: z.infer<typeof FieldValueUnion>,
): ResolvedFieldValue | string => {
  switch (v.type) {
    case "clear":
      return { isClear: true };

    case "text":
      if (v.value === undefined)
        return "Error: field value type is 'text' but `value` (string) was not provided.";
      return { isClear: false, fieldValue: { text: v.value } };

    case "date":
      if (v.value === undefined)
        return "Error: field value type is 'date' but `value` (YYYY-MM-DD string) was not provided.";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v.value))
        return `Error: field value type is 'date' but \`value\` '${v.value}' is not in YYYY-MM-DD format.`;
      return { isClear: false, fieldValue: { date: v.value } };

    case "number":
      if (v.number_value === undefined)
        return "Error: field value type is 'number' but `number_value` (number) was not provided.";
      return { isClear: false, fieldValue: { number: v.number_value } };

    case "single_select":
      if (!v.option_id)
        return "Error: field value type is 'single_select' but `option_id` was not provided. Get option IDs from github_get_project_fields.";
      return { isClear: false, fieldValue: { singleSelectOptionId: v.option_id } };

    case "iteration":
      if (!v.iteration_id)
        return "Error: field value type is 'iteration' but `iteration_id` was not provided. Get iteration IDs from scrum://config or github_get_project_fields.";
      return { isClear: false, fieldValue: { iterationId: v.iteration_id } };

    default: {
      // Exhaustiveness guard — if FieldValueUnion.type gains a new variant this
      // becomes a compile error, forcing the switch to be updated.
      const _exhaustive: never = v.type;
      return `Error: unknown field value type '${String(_exhaustive)}'.`;
    }
  }
};

export const UpdateFieldValueSchema = z.object({
  project_id: z.string().min(1)
    .describe("Node ID of the project"),
  item_id: z.string().min(1)
    .describe("Node ID of the project item"),
  field_id: z.string().min(1)
    .describe("Node ID of the field to update (from github_get_project_fields)"),
  value: FieldValueUnion
    .describe(
      "The new field value. Set `type` to one of: 'text', 'number', 'date', 'single_select', 'iteration', 'clear'. " +
      "Then set the matching key: `value` for text/date, `number_value` for number, " +
      "`option_id` for single_select, `iteration_id` for iteration. " +
      "No extra key needed for 'clear'."
    ),
}).strict();

export const GetProjectFieldsSchema = z.object({
  owner: z.string().min(1).describe("GitHub username or organization login"),
  owner_type: OwnerTypeSchema,
  project_number: z.number().int().positive()
    .describe("The project number"),
  field_type: z.enum([
    "TEXT", "NUMBER", "DATE", "SINGLE_SELECT", "ITERATION",
    "ASSIGNEES", "LABELS", "MILESTONE", "REPOSITORY", "REVIEWERS",
    "TITLE", "TRACKED_BY", "TRACKS",
  ]).optional()
    .describe("Filter fields by data type. Omit to return all fields."),
}).strict();

// ── Sprint tools ──────────────────────────────────────────────────────────────

export const GetSprintStatusSchema = z.object({
  iteration_id: z.string().optional()
    .describe(
      "Iteration node ID to query. Omit to auto-detect the active iteration " +
      "by today's date (errors if no iteration is currently active).",
    ),
}).strict();

export const GetVelocitySchema = z.object({
  iterations_count: z.number().int().min(1).max(10).default(4)
    .describe("Number of completed iterations to include in the velocity series."),
}).strict();

export const GetBacklogItemsSchema = z.object({
  include_estimated_only: z.boolean().default(false)
    .describe("Return only items that have a story points value set (sprint-ready candidates)."),
  first: z.number().int().min(1).max(100).default(20)
    .describe("Number of items to return (1–100, default 20)."),
  after: z.string().optional()
    .describe("Pagination cursor from a previous response."),
}).strict();

export const BulkUpdateItemFieldSchema = z.object({
  project_id: z.string().min(1).optional()
    .describe(
      "Node ID of the project (PVT_kwDO…). " +
      "Omit to auto-resolve from scrum://config (project-board.config.json must be present — run `deno task sync-config` first). " +
      "Do NOT pass owner or project_number here.",
    ),
  item_ids: z.array(z.string().min(1)).min(1).max(50)
    .describe("Project item node IDs (PVTI_lADO...). Maximum 50 per call."),
  field_id: z.string().min(1)
    .describe("Field node ID to update (from github_get_project_fields)."),
  value: FieldValueUnion
    .describe(
      "The new field value. Same format as github_update_item_field. " +
      "To commit items to a sprint: type='iteration', iteration_id='<sprint iteration node ID>'.",
    ),
  stop_on_error: z.boolean().default(false)
    .describe("Abort on first failure. Default false (best-effort across all items)."),
}).strict();

export const CloseSprintSchema = z.object({
  closing_iteration_id: z.string().min(1)
    .describe("Iteration node ID of the sprint being closed."),
  target_iteration_id: z.string().optional()
    .describe(
      "Iteration to carry incomplete items into. " +
      "Omit to clear the Sprint field entirely (items return to backlog).",
    ),
  archive_done: z.boolean().default(false)
    .describe("Archive items whose status is Done after moving."),
  dry_run: z.boolean().default(true)
    .describe(
      "Preview the close operation without executing it. " +
      "Default true — you must explicitly pass false to execute.",
    ),
}).strict();

export const GenerateSprintReportSchema = z.object({
  iteration_id: z.string().optional()
    .describe("Iteration node ID. Omit to use the currently active iteration."),
  include_retrospective_scaffold: z.boolean().default(true)
    .describe("Include a Start / Stop / Continue template in the output."),
}).strict();

// ── Issue/PR lookup (needed to get node IDs) ─────────────────────────────────

export const GetIssueNodeIdSchema = z.object({
  owner: z.string().min(1).describe("Repository owner (user or org)"),
  repo: z.string().min(1).describe("Repository name"),
  issue_number: z.number().int().positive().describe("Issue or PR number"),
  type: z.enum(["issue", "pull_request"]).default("issue")
    .describe("Whether this is an issue or pull request"),
}).strict();

export const GetUserNodeIdSchema = z.object({
  login: z.string().min(1).describe("GitHub username"),
}).strict();
