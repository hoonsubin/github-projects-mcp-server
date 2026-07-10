// =============================================================================
// src/domain/types.ts - Domain entity types
//
// Pure domain types: the concepts the MCP tool surface exposes to the agent.
// Nothing here imports from adapters, services, or generated schema files.
// These types are platform-agnostic - no GitHub field IDs, GraphQL node shapes,
// or wire-format details appear here.
// =============================================================================

// ── Base entity handle ────────────────────────────────────────────────────────

/**
 * The universal opaque entity handle.
 *
 * Assigned by the backend adapter and passed back opaquely by the domain layer.
 * The value of `id` is platform-specific (e.g. PVTI_... on GitHub Projects) but
 * the domain layer never inspects it - it is always treated as an opaque string.
 *
 * This is the single base type for all resolved entity references in the system.
 * No layer other than the adapter that produced it should care about the `id` format.
 *
 * Renamed from: ResolvedRef
 */
export type EntityRef = { readonly id: string };

// ── Input refs (agent → server) ───────────────────────────────────────────────

/**
 * A reference to a Story accepted as tool input.
 *
 * Two forms:
 * - `{ id }` - opaque project-item handle (PVTI_... on GitHub). Returned by every
 *   read tool. Prefer this form when the agent already holds a listing entry.
 * - `{ number }` - human-readable issue number (e.g. 42). The adapter resolves
 *   this to an opaque handle via resolveRef(). Use for direct lookup when the
 *   agent has no prior listing entry for the target item.
 *
 * TypeScript guard: `"id" in ref` narrows to EntityRef (resolved form).
 */
export type StoryRef = EntityRef | { readonly number: number };

/**
 * A reference to an Epic passed as tool input.
 * Always resolved - the agent obtains this from EpicListing.ref or IssueStory.epic.ref
 * and passes it back unchanged to story create/update tools.
 *
 * On GitHub: id is the Milestone node ID (MI_...).
 */
export type EpicRef = EntityRef & { readonly number?: number };

/** Epic reference bundled with its display name. */
export type EpicRefWithName = { readonly ref: EpicRef; readonly name: string };

/**
 * A reference to an Impediment passed as tool input.
 * Always resolved - the agent obtains this from ImpedimentListing.ref
 * and passes it back to scrum_update_impediment.
 */
export type ImpedimentRef = EntityRef;

/** Lifecycle status for an impediment. */
export type ImpedimentStatus = "open" | "in_progress" | "resolved";

/** Const tuple for Zod z.enum(IMPEDIMENT_STATUSES). */
export const IMPEDIMENT_STATUSES = ["open", "in_progress", "resolved"] as const;

// ── Domain vocabulary (const tuples for Zod schemas and type narrowing) ─────────

/** Search scope for item queries. */
export const SEARCH_SCOPES = ["backlog", "sprint", "all"] as const;

export type SearchScope = (typeof SEARCH_SCOPES)[number];

/** Writable board fields on a story. */
export const SCRUM_FIELDS = [
  "status",
  "sprint",
  "story_points",
  "priority",
  "assignee",
  "type",
] as const;

/** Board field to update via setField. */
export type ScrumField = (typeof SCRUM_FIELDS)[number];

export const VOCABULARY_KINDS = ["status_option", "priority_option", "label"] as const;

export type VocabularyKind = (typeof VOCABULARY_KINDS)[number];

/** Listing field projection modes for item responses. */
export const LISTING_FIELDS_MODES = ["compact", "standard", "full"] as const;
export type ListingFieldsMode = (typeof LISTING_FIELDS_MODES)[number];

/** Find-items intent presets. */
export const FIND_ITEMS_INTENTS = [
  "sprint_board",
  "backlog_ready",
  "readiness_check",
  "blocked_items",
  "search_backlog",
  "by_keys",
] as const;
export type FindItemsIntent = (typeof FIND_ITEMS_INTENTS)[number];

// ── Output ref (server → agent, listing context only) ────────────────────────

/**
 * The compound item handle embedded in BacklogItemListing and dependency arrays.
 *
 * Bundles two identifiers the agent needs simultaneously:
 * - `id`  - opaque platform handle. Used in all write tool calls.
 * - `key` - human-readable issue number string (e.g. "42"). Shown to the user
 *            and used as the canonical node key in DependencyMap. Empty string
 *            for Draft Issues (which have no issue number).
 *
 * This type is OUTPUT-ONLY. It is never a valid input to a write tool.
 * To target an item from a listing, pass `{ id: item.ref.id }` - not the
 * ItemListingRef itself.
 *
 * New type - replaces inline `{ id: string; key: string }` in five locations.
 */
export type ItemListingRef = { readonly id: string; readonly key: string };

/** Lifecycle status for an epic. */
export type EpicStatus = "open" | "in_progress" | "done";

/**
 * Lightweight epic entry for planning contexts.
 * Returned by scrum_find_items alongside StoryListing[].
 * Full epic detail (child stories, history) is derived by the agent via
 * scrum_find_items filtered by epic name.
 */
export interface EpicListing {
  readonly ref: EpicRef;
  readonly name: string;
  readonly description: string | null;
  readonly priority: string | null; // team's vocabulary value, or null
  readonly status: EpicStatus | null;
  readonly story_count: number; // total stories under this epic (all statuses)
  readonly open_item_count: number; // stories with status ≠ "done" / "closed"
}

/**
 * A single dependency link between two stories.
 * key is always present (human-readable issue number, e.g. "17").
 * ref.id is the project item ID when resolvable from in-memory context; null otherwise.
 * title is the story title when available; null if not yet resolved.
 */
export interface DependencyEntry {
  readonly key: string;
  readonly title: string | null;
  readonly ref: EntityRef;
}

// ── Item type vocabulary ──────────────────────────────────────────────────────

/**
 * PBI vocabulary for item types.
 * Used in `z.enum(ITEM_TYPES)` in schemas and `TemplateUriMap`.
 * Keep in sync with config.yml `type_mapping` keys.
 * todo: make the item types be dynamically populated based on the scrum config file properties
 */
export const ITEM_TYPES = [
  "bug",
  "feature",
  "tech_debt",
  "spike",
  "user_story",
  "impediment",
] as const;

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
 * Note: `"all"` is a query-mode flag for `scrum_get_sprint` only - it is NOT
 * part of `SprintRef` and must be handled before values enter port methods.
 */
export type SprintRef = "current" | "next" | null | SprintName;

// ── Issue key ──────────────────────────────────────────────────────────────────

/**
 * Branded string for human-readable issue identifiers (e.g. "42", "PROJ-123").
 * Always present - unlike nullable `ref.id`, `IssueKey` is guaranteed non-null.
 * Used as the key in `DependencyMap`.
 */
export type IssueKey = string & { readonly _brand: "IssueKey" };

/** Cast a string to IssueKey. Call only at system boundaries with validated input. */
export const toIssueKey = (key: string): IssueKey => key as IssueKey;

// ── Template URI types ─────────────────────────────────────────────────────────

/**
 * Template URI format for PBI templates.
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
 * Sprint with time-progress fields.
 * Built by `sprintContextFromSprintInfo()` in scrum/utils/sprint-context.ts.
 * Risk and readiness judgments are agent-side concerns (see scrum-master skill).
 */
export interface SprintContext extends SprintWindowMeta {
  id: string;
  // todo: sprint goals are not implemented yet
  goal: string | null;
  days_elapsed: number;
  time_elapsed_pct: number; // 0-100
}

// ── Epic summary (orient) ──────────────────────────────────────────────────────

/**
 * Lightweight epic entry for orient response.
 * Contains only the fields needed for the executive summary - no child stories.
 */
export interface EpicSummary {
  ref: EpicRef;
  name: string;
  description: string | null;
  status: EpicStatus | null;
  open_item_count: number;
}

// ── Item listing (findItems output) ────────────────────────────────────────────

/**
 * Enriched listing entry for story collections.
 * Replaces StoryListing from ports.ts.
 *
 * `key` is always present (non-nullable) - Draft Issues fall back to ref.id.
 */
export interface BacklogItemListing {
  readonly ref: ItemListingRef;
  readonly title: string;
  readonly type: string | null;
  readonly status: string | null;
  readonly story_points: number | null;
  readonly priority: string | null;
  readonly assignees: readonly string[];
  readonly labels: readonly string[];
  readonly sprint: {
    readonly name: string | null;
    readonly ref: EntityRef;
  };
  readonly epic: EpicRefWithName | null;
  /** Keys of items that block this one (must be Done first). */
  readonly blocked_by: ReadonlyArray<DependencyEntry>;
  /** Keys of items this one blocks (reverse dependency). Populated by adapter. */
  readonly blocks: ReadonlyArray<ItemListingRef>;
  /** Linked PRs from the board Pull requests column (delivery work for this PBI). */
  readonly linked_pull_requests?: ReadonlyArray<LinkedArtifact>;
  /** Underlying platform content. Defaults to issue when omitted. */
  readonly content_kind?: "issue" | "pr" | "draft";
  readonly custom_fields: Record<string, string | number | boolean | null>;
}

// ── Dependency pointers (supplementary blockers) ───────────────────────────────

/**
 * Shallow pointer to an upstream blocker not already present in items[].
 * Keyed by IssueKey in `DependencyMap`. Reverse `blocks` edges and blockers
 * already listed in items[].blocked_by are omitted as redundant.
 */
export interface DependencyPointer {
  readonly key: IssueKey;
  readonly ref: EntityRef;
  readonly title: string | null;
  readonly status: string | null;
}

/**
 * Supplementary active blockers for returned items, keyed by IssueKey.
 * Opt-in — only off-listing blockers that are not Done (or are in the active sprint).
 */
export type DependencyMap = Record<string, DependencyPointer>;

// ── Story entity ──────────────────────────────────────────────────────────────

/**
 * Fields shared by every Story variant. Board fields (type, status, sprint,
 * story_points, priority) are nullable because they may be unset on the board.
 */
export interface StoryBase {
  readonly ref: EntityRef; // opaque project-item handle - use in subsequent tool calls
  readonly title: string;
  readonly body: string;
  readonly type: ItemType | null; // canonical type key from config (e.g. "feature", "bug"); null when unset
  readonly status: string | null; // team's vocabulary value, e.g. "In Progress"
  readonly sprint: string | null; // sprint name, or null if in backlog
  readonly story_points: number | null;
  readonly priority: string | null; // team's vocabulary value, e.g. "Must"
  readonly assignees: readonly string[]; // GitHub logins
  readonly labels: readonly string[]; // repo labels; type is tracked via the Type board field, not labels
  readonly created_at: string; // ISO-8601
  readonly updated_at: string; // ISO-8601
  readonly blocked_by: readonly DependencyEntry[]; // stories that must be Done before this one starts
  // ── Bridging fields ── populated by backends; nullable when the concept is absent ──
  readonly kind: string | null; // content type discriminator (e.g. "issue", "draft", "pr")
  readonly key: string | null; // human-readable issue number; null for draft items
  readonly url: string | null; // canonical URL in the backend UI; null for draft items
  readonly epic: EpicRefWithName | null;
}

export const SUPPORTED_BACKENDS = {
  // must match the `backend.[key]` from the scrum config file
  GitHub: "github",
} as const;

export type SupportedBackend = typeof SUPPORTED_BACKENDS[keyof typeof SUPPORTED_BACKENDS];

/**
 * Backend adapter configurations, keyed by platform name (e.g. "github").
 * Type-erased here - each adapter casts its own entry to its concrete config
 * type (e.g. GitHubBackendConfig). The domain layer has no knowledge of
 * platform-specific fields such as tokens, project numbers, or field mappings.
 */
export type AdapterBackend = Record<SupportedBackend, unknown>;

/**
 * Discriminated union of all Story variants.
 * Narrow on `story.kind` to access variant-specific fields without null checks.
 */
export type Story = StoryBase;

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

/** Metadata describing a sprint time window. */
export interface SprintWindowMeta {
  readonly name: string;
  readonly start_date: string;
  readonly end_date: string;
  readonly duration_days: number;
  readonly days_remaining: number;
}

// ── Find-items output ──────────────────────────────────────────────────────────

/**
 * Output for scrum_find_items.
 * Combines item listings with scope metadata and optional dependency graph.
 */
export interface ItemSearchResult {
  items: readonly BacklogItemListing[];
  total_count: number;
  scope_summary: {
    sprint_count: number | null;
    backlog_count: number | null;
  };
  dependency_map?: readonly DependencyPointer[];
}

// ── Story detail output ────────────────────────────────────────────────────────

/**
 * A comment on a story. Shared across domain, port, and adapter layers.
 * Single source of truth - duplicates in ports.ts and adapter/types.ts
 * should import this type instead of defining their own.
 */
export interface StoryComment {
  author: string;
  body: string;
  created_at: string; // ISO-8601
  url: string;
}

/**
 * A linked artifact (pull request, merge request, patch, etc.) associated
 * with a story. Platform-agnostic - replaces GitHub-specific "linkedPrs"
 * terminology in domain and port types.
 */
export interface LinkedArtifact {
  number: number;
  title: string;
  url: string;
  state: string;
  is_draft: boolean;
}

/**
 * Output for scrum_get_story_detail.
 * Wraps Story detail with comments, linked artifacts, and parsed acceptance criteria.
 */
export interface ItemDetailResult {
  readonly story: Story;
  readonly comments: readonly StoryComment[] | null;
  readonly linked_artifacts: readonly LinkedArtifact[] | null;
  readonly acceptance_criteria: readonly string[]; // parsed from story body
}

// ── Partial-result marker ──────────────────────────────────────────────────────

/**
 * Marker interface for use-case response types that can carry per-field
 * warning messages alongside their primary data.
 *
 * Warnings follow the AdapterError format: "[backendName] CODE: message\n  → Recovery: instruction"
 * Use-case code accumulates warnings via catchBackend() for fallible backend calls.
 */
export interface PartialResult {
  readonly warnings: readonly string[];
}

// ── Use-case result wrapper ────────────────────────────────────────────────────

/**
 * Generic wrapper for use-case function return values.
 *
 * Every use-case function returns UseCaseResult<T> instead of raw T.
 * - `data`: the primary payload (may be null if the adapter call fully failed)
 * - `warnings`: accumulated adapter-error strings from catchBackend() calls
 *
 * Use-case functions NEVER throw AdapterError - they convert them into warnings.
 * The framework layer unwraps UseCaseResult<T> and formats the response.
 *
 * Non-adapter errors (programming bugs, startup config failures) propagate
 * normally - catchBackend re-throws them.
 */
export interface UseCaseResult<T> extends PartialResult {
  readonly data: T;
}

// ── Orient output ──────────────────────────────────────────────────────────────

/** Scrum team role in the project vocabulary. */
export type TeamRole = "scrum_master" | "product_owner" | "developer";

/**
 * Exported output type for scrum_orient.
 * Extends PartialResult because orientUseCase wraps fallible backend calls
 * (getEpics) via catchBackend() and accumulates their
 * warnings here.
 */
export interface OrientResult extends PartialResult {
  readonly platform_state: {
    readonly fields: {
      readonly status: {
        readonly exists: boolean;
        readonly options: readonly string[];
        readonly missing_options: readonly string[];
      };
      readonly sprint: { readonly exists: boolean };
      readonly story_points: { readonly exists: boolean };
      readonly priority: {
        readonly exists: boolean;
        readonly options: readonly string[];
        readonly missing_options: readonly string[];
      };
      readonly type_field: { readonly exists: boolean; readonly configured: boolean };
    };
    readonly missing_options: readonly string[];
    readonly labels: {
      readonly existing: readonly string[];
      readonly expected: readonly string[];
      readonly missing: readonly string[];
    };
    readonly iterations: {
      readonly active: SprintContext | null;
      readonly next: SprintContext | null;
      readonly completed_count: number;
    };
    /** Active epics - populated by orientUseCase via backend.getEpics(). */
    readonly epics: { readonly active: readonly EpicSummary[]; readonly total_count: number };
    /** PBI template URIs - built from ITEM_TYPES intersection with scrumConfig.templates. */
    readonly template_uris: TemplateUriMap | null;
    /**
     * The `custom_fields` key that holds deadline / due-date values on BacklogItemListing.
     * Sourced from `deadline_field` in config.yml. Null when not configured.
     * The agent uses this for overdue detection: item.custom_fields[deadline_field] < today.
     */
    readonly deadline_field: string | null;
  };
  readonly vocabulary: {
    readonly status: Record<string, string> | null;
    readonly priority: Record<string, string> | null;
    readonly type: Record<string, string> | null;
    readonly story_points: {
      readonly scale: string | null;
      readonly values: readonly number[] | null;
    };
    readonly sprint: {
      readonly duration_days: number | null;
      readonly velocity_window: number;
      readonly length_weeks: number | null;
    };
    readonly team:
      | readonly {
        readonly name: string;
        readonly role: TeamRole;
        readonly contact?: string;
      }[]
      | null;
    readonly dor: readonly string[] | null;
    readonly dod: readonly string[] | null;
    readonly autonomy: { readonly require_confirmation_above_n_items: number | null } | null;
  };
}
