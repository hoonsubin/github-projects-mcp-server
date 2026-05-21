// =============================================================================
// src/domain/types.ts — Domain entity types
//
// Pure domain types: the concepts the MCP tool surface exposes to the agent.
// Nothing here imports from adapters, services, or generated schema files.
// These types are platform-agnostic — no GitHub field IDs, GraphQL node shapes,
// or wire-format details appear here.
// =============================================================================

// todo: this entire type conflates backend adaptor types with the use-case layer types.
// ── Story references ──────────────────────────────────────────────────────────

/**
 * A reference to a single Story.
 * Every read tool returns `Story.ref.id` — pass it back here to identify the story.
 * Backend-agnostic: the id is an opaque project-item handle (PVTI_... on GitHub)
 * returned by scrum_get_sprint, scrum_get_backlog, or scrum_create_story.
 */
export interface StoryRef {
  id: string; // opaque project-item handle returned by any read tool
}

/**
 * A reference to an impediment (spike story tagged 'impediment').
 * On GitHub: id is the GitHub Issue node ID (I_...), not the project item ID.
 * Impediment operations (updateImpediment) operate on the GitHub Issue directly.
 */
export interface ImpedimentRef {
  id: string;
}

/**
 * A reference to a single Epic.
 * On GitHub: id is the Milestone node ID (MI_...).
 * Pass to story create/update tools as the epic identifier.
 */
export interface EpicRef {
  id: string;
}

/**
 * Lightweight epic entry for planning contexts.
 * Returned in scrum_get_backlog alongside StoryListing[].
 * Full epic detail (child stories, history) is derived by the agent via
 * scrum_get_backlog filtered by epic name.
 */
export interface EpicListing {
  ref: EpicRef;
  name: string;
  description: string | null;
  priority: string | null; // team's vocabulary value, or null
  status: "open" | "in_progress" | "done" | null;
  story_count: number; // total stories under this epic (all statuses)
}

/**
 * A single dependency link between two stories.
 * key is always present (human-readable issue number, e.g. "17").
 * ref.id is the project item ID when resolvable from in-memory context; null otherwise.
 * title is the story title when available; null if not yet resolved.
 */
export interface DependencyEntry {
  key: string;
  title: string | null;
  // ref is sometimes a id, key pair (https://github.com/hoonsubin/github-projects-mcp-server/blob/0af4b3cefbc24470262964c3f9a27a1129ec6bc5/src/scrum/ports.ts#L146)
  // and sometimes it's not. The item reference type should be unified across the project
  ref: { id: string | null };
}

/**
 * An explicit sprint name (e.g. "Sprint 12") lifted into a branded type.
 * Prevents arbitrary strings from being used as sprint references without
 * going through a validated boundary (schema transform or `toSprintName`).
 */
export type SprintName = string & { readonly _brand: "SprintName" };

/** Cast a validated string to SprintName. Call only at system boundaries. */
export const toSprintName = (name: string): SprintName => name as SprintName;

/**
 * A reference to a sprint.
 * Accepted forms: `"current"`, `"next"`, `null` (= no sprint / clear),
 * or an explicit `SprintName` (e.g. `toSprintName("Sprint 12")`).
 * Note: `"all"` is a query-mode flag for `scrum_get_sprint` only — it is NOT
 * part of `SprintRef` and must be handled before values enter port methods.
 */
export type SprintRef = "current" | "next" | null | SprintName;

// ── Story entity ──────────────────────────────────────────────────────────────

/**
 * Fields shared by every Story variant. Board fields (type, status, sprint,
 * story_points, priority) are nullable because they may be unset on the board.
 */
interface StoryBase { // todo: also a close duplicate of the `ports.ts`. The type should be uniformed
  ref: { id: string }; // opaque project-item handle — use in subsequent tool calls
  title: string;
  body: string;
  type: string | null; // canonical type key from config (e.g. "feature", "bug"); null when unset
  status: string | null; // team's vocabulary value, e.g. "In Progress"
  sprint: string | null; // sprint name, or null if in backlog
  story_points: number | null;
  priority: string | null; // team's vocabulary value, e.g. "Must"
  assignees: string[]; // GitHub logins
  labels: string[]; // repo labels; type is tracked via the Type board field, not labels
  created_at: string; // ISO-8601
  updated_at: string; // ISO-8601
  blocked_by: DependencyEntry[]; // stories that must be Done before this one starts
}

/** A GitHub Projects draft issue — has no issue number, URL, or milestone. */
export interface DraftStory extends StoryBase {
  kind: "draft";
  key: null;
  url: null;
  epic: null;
  blocked_by: DependencyEntry[]; // always [] — Draft Issues have no tracked dependencies
}

/** A real GitHub Issue (or PR) promoted to a project item. */
export interface IssueStory extends StoryBase {
  kind: "issue";
  key: string; // human-readable issue number, e.g. "42"
  url: string; // canonical URL in the backend UI
  epic: { ref: EpicRef; name: string } | null;
}

/**
 * Discriminated union of all Story variants.
 * Narrow on `story.kind` to access variant-specific fields without null checks.
 */
export type Story = DraftStory | IssueStory;

// ── Shared primitives ─────────────────────────────────────────────────────────

/**
 * A single sprint iteration entry as returned by the GitHub iteration field
 * configuration. Used in config and as the base for SprintIteration.
 */
export interface IterationEntry {
  id: string;
  title: string;
  startDate: string;
  duration: number;
}

// ── Burndown types (scrum_get_burndown) ───────────────────────────────────────

/** Response shape for scrum_get_burndown. */
export interface BurndownResponse {
  sprint: BurndownSprintMeta;
  data_source: "audit_log" | "issue_close_proxy";
  warning?: string;
  series: BurndownDayPoint[];
  ideal: IdealDayPoint[];
  stories: BurndownStory[];
}

/** Sprint window metadata returned alongside the burndown series. */
export interface BurndownSprintMeta {
  name: string;
  start_date: string; // YYYY-MM-DD
  end_date: string; // YYYY-MM-DD
  duration_days: number;
  days_remaining: number;
}

/** One entry in the actual burndown series — one per calendar day. */
export interface BurndownDayPoint {
  date: string; // YYYY-MM-DD
  remaining_points: number;
  completed_points: number;
}

/** One entry in the ideal burndown line — one per calendar day. */
export interface IdealDayPoint {
  date: string; // YYYY-MM-DD
  remaining_points: number;
}

/** Lightweight per-story summary in the burndown response. */
export interface BurndownStory {
  number: number;
  title: string;
  points: number; // 0 if the story has no points assigned
  status: string | null;
  completed_at: string | null; // ISO-8601 timestamp, or null if not yet done
}

// ── Template types (scrum_get_template) ───────────────────────────────────────

/**
 * The five ceremony artifact types for which custom templates can be declared.
 * Used in ScrumConfig.templates, GetTemplateSchema, and TemplateResponse.
 */
export type ArtifactType =
  | "sprint_review"
  | "retrospective"
  | "standup"
  | "sprint_planning"
  | "refinement";

/**
 * Discriminated union response for scrum_get_template.
 *
 * source: "custom"  — a custom template was fetched from the repo.
 *                     content is the raw template text; the agent applies it.
 * source: "default" — no custom template is declared for this artifact type.
 *                     content is null; the agent uses its own built-in default.
 *
 * Invalid states (e.g. content: null with source: "custom") are structurally
 * excluded by the discriminated union — the compiler enforces the contract.
 */
export type TemplateResponse =
  | { content: string; source: "custom" }
  | { content: null; source: "default" };
