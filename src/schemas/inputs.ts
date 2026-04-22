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
  filter_type: z.enum(["Issue", "PullRequest", "DraftIssue", "REDACTED"]).optional()
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

export const FieldValueUnion = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), value: z.string() }),
  z.object({ type: z.literal("number"), value: z.number() }),
  z.object({ type: z.literal("date"), value: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD") }),
  z.object({ type: z.literal("single_select"), option_id: z.string().describe("Option ID from the field's options list") }),
  z.object({ type: z.literal("iteration"), iteration_id: z.string().describe("Iteration ID from the field's configuration") }),
  z.object({ type: z.literal("clear") }),
]);

export const UpdateFieldValueSchema = z.object({
  project_id: z.string().min(1)
    .describe("Node ID of the project"),
  item_id: z.string().min(1)
    .describe("Node ID of the project item"),
  field_id: z.string().min(1)
    .describe("Node ID of the field to update (from github_get_project_fields)"),
  value: FieldValueUnion
    .describe(
      "The new field value. Use type='text'|'number'|'date'|'single_select'|'iteration'|'clear'. " +
      "For single_select, provide option_id. For iteration, provide iteration_id."
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
      "Use type='iteration' + iteration_id to commit items to a sprint.",
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
