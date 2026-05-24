// =============================================================================
// src/domain/types.ts — Domain entity types
//
// Pure domain types: the concepts the MCP tool surface exposes to the agent.
// Nothing here imports from adapters, services, or generated schema files.
// These types are platform-agnostic — no GitHub field IDs, GraphQL node shapes,
// or wire-format details appear here.
// =============================================================================

// ── Item references (platform-agnostic) ───────────────────────────────────────

/**
 * A reference to any project item.
 *
 * - `{ id: string }` — opaque platform identifier (preferred, from read tools)
 * - `{ key: string }` — human-readable identifier (convenience, adapter resolves)
 *
 * Platform-agnostic: `key` covers GitHub numbers ("42"), Jira keys ("PROJ-123"),
 * Linear IDs ("ISS-42"), or any other human-readable identifier.
 */
export type ItemRef = { id: string } | { key: string };

/**
 * A resolved reference — always has an opaque `id`.
 * Used in listing entries, dependency entries, and any context where
 * the reference is guaranteed to be resolved (never needs adapter lookup).
 */
export type ResolvedRef = { id: string };

/** Type guard: true when ref has `id` (already resolved). */
export const isResolvedRef = (ref: ItemRef): ref is ResolvedRef => "id" in ref;

// ── Backward-compatible type aliases (will replace interfaces in P2) ──────────

/**
 * A reference to a single Story.
 *
 * Two forms accepted:
 * - `{ id: string }` — opaque project-item handle (PVTI_... on GitHub), returned
 *   by read tools. Prefer this form when available.
 * - `{ number: number }` — human-readable issue number (e.g. 42). The backend
 *   resolves this to an opaque handle via `resolveRef()`. Use when you know the
 *   issue number but do not yet have its `id`.
 *
 * TypeScript guard: `"id" in ref` narrows to the resolved form.
 */
export type StoryRef = { id: string } | { number: number };

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
  ref: ResolvedRef;
}

// ── Item type vocabulary ──────────────────────────────────────────────────────

/**
 * PBI vocabulary for item types.
 * Used in `z.enum(ITEM_TYPES)` in schemas, `TemplateUriMap`, and `BacklogHealth.by_type`.
 * Keep in sync with config.yml `type_display` keys.
 */
export const ITEM_TYPES = ["bug", "feature", "tech_debt", "spike", "user_story"] as const;

/** Union of all PBI item type strings. */
export type ItemType = (typeof ITEM_TYPES)[number];

// ── Sprint references ───────────────────────────────────────────────────────────

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

// ── Issue key ──────────────────────────────────────────────────────────────────

/**
 * Branded string for human-readable issue identifiers (e.g. "42", "PROJ-123").
 * Always present — unlike nullable `ref.id`, `IssueKey` is guaranteed non-null.
 * Used as the key in `DependencyMap` and `DependencyNode`.
 */
export type IssueKey = string & { readonly _brand: "IssueKey" };

/** Cast a string to IssueKey. Call only at system boundaries with validated input. */
export const toIssueKey = (key: string): IssueKey => key as IssueKey;

// ── Template URI types ─────────────────────────────────────────────────────────

/**
 * Template URI format for PBI ceremony templates.
 * Compile-time format validation via template literal type.
 * Example: `scrum://template/feature`
 */
export type ScrumTemplateUri = `scrum://template/${ItemType}`;

/**
 * Maps PBI item types to their template URIs.
 * Partial because not all item types necessarily have templates.
 * Example: `{ feature: "scrum://template/feature", bug: "scrum://template/bug" }`
 */
export type TemplateUriMap = Partial<Record<ItemType, ScrumTemplateUri>>;

// ── Sprint context ─────────────────────────────────────────────────────────────

/**
 * Risk stance for the current sprint's time progress.
 * - `normal`: on track
 * - `monitor`: approaching deadline with insufficient progress
 * - `elevated`: significantly behind schedule
 */
export type SprintRiskStance = "normal" | "monitor" | "elevated";

/**
 * Sprint with time-progress fields.
 * Built by `sprintContextFromSprintInfo()` at the port boundary.
 */
export interface SprintContext {
  name: string;
  start_date: string;
  end_date: string;
  duration_days: number;
  days_elapsed: number;
  days_remaining: number;
  time_elapsed_pct: number; // 0-100
  riskStance: SprintRiskStance;
}

/**
 * Compute risk stance based on time elapsed vs. work remaining.
 * - `normal`: time_elapsed_pct <= 110% of work_pct (within 10% buffer)
 * - `monitor`: time_elapsed_pct > 110% of work_pct but < 130%
 * - `elevated`: time_elapsed_pct >= 130% of work_pct
 */
const computeRiskStance = (
  timeElapsedPct: number,
  workPct: number,
): SprintRiskStance => {
  if (workPct === 0) return timeElapsedPct > 0 ? "elevated" : "normal";
  const ratio = timeElapsedPct / workPct;
  if (ratio >= 1.3) return "elevated";
  if (ratio > 1.1) return "monitor";
  return "normal";
};

/**
 * Build a SprintContext from sprint metadata + work data.
 * Called by orientUseCase to populate platform_state.iterations.active/next.
 */
export const sprintContextFromSprintInfo = (
  info: { name: string; start_date: string; end_date: string; duration_days: number },
  daysElapsed: number,
  workPct: number, // 0-100, percentage of committed points completed
): SprintContext => {
  const daysRemaining = Math.max(0, info.duration_days - daysElapsed);
  const timeElapsedPct = info.duration_days > 0
    ? Math.round((daysElapsed / info.duration_days) * 100)
    : 0;

  return {
    name: info.name,
    start_date: info.start_date,
    end_date: info.end_date,
    duration_days: info.duration_days,
    days_elapsed: daysElapsed,
    days_remaining: daysRemaining,
    time_elapsed_pct: timeElapsedPct,
    riskStance: computeRiskStance(timeElapsedPct, workPct),
  };
};

// ── Epic summary (orient) ──────────────────────────────────────────────────────

/**
 * Lightweight epic entry for orient response.
 * Contains only the fields needed for the executive summary — no child stories.
 */
export interface EpicSummary {
  ref: ResolvedRef;
  name: string;
  description: string | null;
  status: "open" | "in_progress" | "done" | null;
}

// ── Board health ───────────────────────────────────────────────────────────────

/**
 * Board health output for scrum_get_board_health.
 * Replaces StoryListing in contexts where only health metrics are needed.
 */
export interface BacklogHealth {
  total_stories: number;
  by_status: Record<string, number>;
  by_type: Partial<Record<ItemType, number>>;
  sprint_risk: SprintRiskStance | null; // null if no active sprint
  impediments: {
    open: number;
    in_progress: number;
  };
  readiness: { ready: number; partially_ready: number; not_ready: number };
}

// ── Item listing (findItems output) ────────────────────────────────────────────

/**
 * Enriched listing entry for story collections.
 * Replaces StoryListing from ports.ts.
 *
 * sprint.ref.id is currently hardcoded to "" — known gap until the adapter
 * provides sprint node IDs. Will be fixed when SprintInfo.id is populated.
 */
export interface ItemListing {
  ref: ResolvedRef & { key: string | null };
  title: string;
  status: string | null;
  story_points: number | null;
  priority: string | null; // named field (was implicit in StoryListing)
  sprint: {
    name: string | null;
    ref: ResolvedRef; // hardcoded to { id: "" } until adapter provides sprint node IDs
  };
  epic: { ref: ResolvedRef; name: string } | null;
  writable: boolean;
  has_dependencies: DependencyEntry[];
}

// ── Dependency graph ───────────────────────────────────────────────────────────

/**
 * Graph node for dependency resolution, keyed by IssueKey (not nullable ref.id).
 * Includes inline state signals so callers don't need a second lookup.
 */
export interface DependencyNode {
  key: IssueKey;
  title: string;
  status: string | null;
  sprint: string | null;
  epic: { ref: ResolvedRef; name: string } | null;
  story_points: number | null;
  priority: string | null;
  /** Stories that this node blocks (reverse dependency). */
  blocks: IssueKey[];
}

/**
 * Full dependency graph, keyed by IssueKey.
 * Opt-in — not paid on every list call.
 */
export type DependencyMap = Record<string, DependencyNode>;

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

// ── Find-items output ──────────────────────────────────────────────────────────

/**
 * Output for scrum_find_items.
 * Combines item listings with scope metadata and optional dependency graph.
 */
export interface ItemSearchResult {
  items: ItemListing[];
  scope_summary: {
    total_count: number; // before limit
    limit: number;
    scope: "backlog" | "sprint" | "all";
    filters_applied: {
      search?: string;
      keys?: string[];
      types?: ItemType[];
      statuses?: string[];
      priority?: string;
      epic_id?: string;
      labels?: string[];
      assignee?: string;
      sprint_ref?: string | null;
    };
  };
  dependency_map?: DependencyMap; // present only if include_dependencies: true
}

// ── Analytics output ───────────────────────────────────────────────────────────

/**
 * Output for scrum_get_analytics.
 * Merges burndown data + sprint history into a single type.
 *
 * imports SprintSnapshot from ports.ts — resolve at P2 boundary
 */
export interface AnalyticsResult {
  burndown: BurndownResponse | null; // null if burndown unavailable
  history: null; // null in P1 — SprintSnapshot imported from ports in P2
  window: number;
}

// ── Story detail output ────────────────────────────────────────────────────────

/**
 * Output for scrum_get_story_detail.
 * Wraps Story detail with comments, linked PRs, and parsed acceptance criteria.
 */
export interface ItemDetailResult {
  story: Story;
  comments: {
    author: string;
    body: string;
    created_at: string;
    url: string;
  }[];
  linkedPrs: Array<{
    number: number;
    title: string;
    url: string;
    state: string;
    is_draft: boolean;
  }>;
  acceptance_criteria: string[]; // parsed from story body
}

// ── Orient output ──────────────────────────────────────────────────────────────

/**
 * Exported output type for scrum_orient.
 * Moved from private interface in orient.ts to domain so tests and handlers
 * can import and annotate it.
 */
export interface OrientResult {
  platform_state: {
    fields: {
      status: { exists: boolean; options: string[]; missing_options: string[] };
      sprint: { exists: boolean };
      story_points: { exists: boolean };
      priority: { exists: boolean; options: string[]; missing_options: string[] };
      type_field: { exists: boolean; configured: boolean };
    };
    missing_options: string[];
    labels: { existing: string[]; expected: string[]; missing: string[] };
    iterations: {
      active: SprintContext | null;
      next: SprintContext | null;
      completed_count: number;
    };
    /** Active epics — populated by orientUseCase via backend.getEpics(). */
    epics: { active: EpicSummary[]; total_count: number };
    /** PBI template URIs — built from ITEM_TYPES intersection with scrumConfig.templates. */
    template_uris: TemplateUriMap | null;
  };
  vocabulary: {
    status: Record<string, string> | null;
    priority: Record<string, string> | null;
    type: Record<string, string> | null;
    story_points: { scale: string | null; values: number[] | null };
    sprint: { duration_days: number | null; velocity_window: number; length_weeks: number | null };
    team: unknown;
    dor: unknown;
    dod: unknown;
    autonomy: { require_confirmation_above_n_items: number | null } | null;
    templates: {
      sprint_review: string | null;
      retrospective: string | null;
      standup: string | null;
      sprint_planning: string | null;
      refinement: string | null;
    };
  };
}
