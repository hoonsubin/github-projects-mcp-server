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
    .describe(
      "Single-select option ID — required when type is 'single_select' (get IDs from github_get_project_fields)",
    ),
  iteration_id: z
    .string()
    .optional()
    .describe(
      "Iteration (sprint) node ID — required when type is 'iteration' (get from github_get_project_fields or github_graphql)",
    ),
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
      if (v.value === undefined) {
        return "Error: field value type is 'text' but `value` (string) was not provided.";
      }
      return { isClear: false, fieldValue: { text: v.value } };

    case "date":
      if (v.value === undefined) {
        return "Error: field value type is 'date' but `value` (YYYY-MM-DD string) was not provided.";
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v.value)) {
        return `Error: field value type is 'date' but \`value\` '${v.value}' is not in YYYY-MM-DD format.`;
      }
      return { isClear: false, fieldValue: { date: v.value } };

    case "number":
      if (v.number_value === undefined) {
        return "Error: field value type is 'number' but `number_value` (number) was not provided.";
      }
      return { isClear: false, fieldValue: { number: v.number_value } };

    case "single_select":
      if (!v.option_id) {
        return "Error: field value type is 'single_select' but `option_id` was not provided. Get option IDs from github_get_project_fields.";
      }
      return { isClear: false, fieldValue: { singleSelectOptionId: v.option_id } };

    case "iteration":
      if (!v.iteration_id) {
        return "Error: field value type is 'iteration' but `iteration_id` was not provided. Get iteration IDs from github_get_project_fields or github_graphql.";
      }
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
        "No extra key needed for 'clear'.",
    ),
}).strict();

export const GetProjectFieldsSchema = z.object({
  owner: z.string().min(1).describe("GitHub username or organization login"),
  owner_type: OwnerTypeSchema,
  project_number: z.number().int().positive()
    .describe("The project number"),
  field_type: z.enum([
    "TEXT",
    "NUMBER",
    "DATE",
    "SINGLE_SELECT",
    "ITERATION",
    "ASSIGNEES",
    "LABELS",
    "MILESTONE",
    "REPOSITORY",
    "REVIEWERS",
    "TITLE",
    "TRACKED_BY",
    "TRACKS",
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
  project_id: z.string().min(1)
    .describe(
      "Node ID of the project (PVT_kwDO…). " +
        "Get it from github_get_project or github_graphql. " +
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

// ── Repository tools ──────────────────────────────────────────────────────────

/**
 * Arbitrary read-only GraphQL query. Mutations are blocked at the handler level.
 * Useful for ad-hoc lookups not covered by other tools (e.g. fetching node IDs,
 * listing labels, resolving repo metadata).
 */
export const GraphQLQuerySchema = z.object({
  query: z.string().min(1)
    .describe(
      "A read-only GraphQL query string. Must not contain the 'mutation' keyword. " +
        "Use this for ad-hoc lookups: node IDs, labels, repo metadata, etc.",
    ),
  variables: z.record(z.string(), z.unknown()).optional()
    .describe("Optional variables object for the query"),
}).strict();

/**
 * Read a single file from a GitHub repository via GraphQL.
 * Internally resolves to: repository { object(expression: \"<ref>:<path>\") { ... on Blob { text oid } } }
 */
export const GetRepoFileSchema = z.object({
  owner: z.string().min(1).describe("Repository owner (user or org login)"),
  repo: z.string().min(1).describe("Repository name"),
  path: z.string().min(1)
    .describe(
      "File path relative to the repository root (e.g. '.github/scrum/config.yml')",
    ),
  ref: z.string().optional()
    .describe("Git ref (branch, tag, or commit SHA) to read from. Defaults to HEAD."),
}).strict();

/**
 * Create a new issue in a GitHub repository.
 * Internally does a 2-step GraphQL sequence:
 *   1. Look up the repository node ID via `repository { id }`.
 *   2. Call the `createIssue` mutation with that ID.
 */
export const CreateIssueSchema = z.object({
  owner: z.string().min(1).describe("Repository owner (user or org login)"),
  repo: z.string().min(1).describe("Repository name"),
  title: z.string().min(1).max(255).describe("Issue title"),
  body: z.string().optional().describe("Issue body in Markdown"),
  assignee_ids: z.array(z.string()).optional()
    .describe(
      "Array of user node IDs to assign (get IDs via github_get_user_node_id or github_graphql)",
    ),
  label_ids: z.array(z.string()).optional()
    .describe(
      "Array of label node IDs to apply (get IDs via github_graphql listing repository labels)",
    ),
}).strict();

/**
 * Update an existing issue — state, title, body, assignees, or labels.
 * All fields are optional; only provided fields are changed.
 */
export const UpdateIssueSchema = z.object({
  issue_node_id: z.string().min(1)
    .describe(
      "Node ID of the issue to update (e.g. I_kwDO...). " +
        "Get it via github_get_issue_node_id or github_graphql.",
    ),
  state: z.enum(["OPEN", "CLOSED"]).optional()
    .describe("New issue state. Omit to leave unchanged."),
  title: z.string().min(1).max(255).optional()
    .describe("New title. Omit to leave unchanged."),
  body: z.string().optional()
    .describe("New body in Markdown. Omit to leave unchanged."),
  assignee_ids: z.array(z.string()).optional()
    .describe(
      "Replacement set of user node IDs. Omit to leave unchanged. " +
        "Pass an empty array [] to clear all assignees.",
    ),
  label_ids: z.array(z.string()).optional()
    .describe(
      "Replacement set of label node IDs. Omit to leave unchanged. " +
        "Pass an empty array [] to clear all labels.",
    ),
}).strict();

/**
 * Add a comment to an issue, pull request, or discussion.
 * Issues and PRs use the `addComment` mutation (subject_id is the node ID).
 * Discussions use the `addDiscussionComment` mutation.
 */
export const CreateCommentSchema = z.object({
  subject_id: z.string().min(1)
    .describe(
      "Node ID of the issue (I_kwDO...), PR (PR_kwDO...), or discussion (D_kwDO...) to comment on",
    ),
  body: z.string().min(1).describe("Comment body in Markdown"),
  type: z.enum(["issue", "pr", "discussion"])
    .describe(
      "Target type: 'issue' and 'pr' use the addComment mutation; " +
        "'discussion' uses addDiscussionComment",
    ),
}).strict();

/**
 * Write (create or overwrite) a single file in a GitHub repository.
 * Internally does a 2-step GraphQL sequence:
 *   1. Fetch the current HEAD commit OID for `expectedHeadOid` (optimistic lock).
 *   2. Call `createCommitOnBranch` with the file content base64-encoded.
 * Plain text content is accepted; base64 encoding is handled internally.
 */
export const WriteRepoFileSchema = z.object({
  owner: z.string().min(1).describe("Repository owner (user or org login)"),
  repo: z.string().min(1).describe("Repository name"),
  branch: z.string().min(1)
    .describe("Target branch to commit to (e.g. 'main'). Branch must already exist."),
  path: z.string().min(1)
    .describe("File path relative to the repository root (e.g. '.github/scrum/config.yml')"),
  content: z.string()
    .describe("Plain text file content. Base64 encoding is handled internally."),
  commit_message: z.string().min(1)
    .describe("Commit message headline (first line). Keep under 72 characters."),
}).strict();
