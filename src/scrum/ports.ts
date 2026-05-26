// =============================================================================
// src/scrum/ports.ts — ProjectBackend interface (THE CONTRACT)
//
// This interface is the entire surface area that separates Scrum policy from
// platform details. It lives in the use-case layer — implementations depend
// on it, not the other way around.
//
// No GitHub field IDs, GraphQL shapes, or platform-specific primitives appear
// on either side of this interface.

// =============================================================================

import type {
  AnalyticsResult,
  BacklogHealth,
  DependencyEntry,
  EntityRef,
  EpicListing,
  EpicRef,
  EpicSummary,
  ImpedimentRef,
  ItemListingRef,
  ItemSearchResult,
  LinkedArtifact,
  SprintRef,
  Story,
  StoryComment,
  StoryRef,
  TemplateUriMap,
} from "../domain/types.ts";
import type { BackendCallResult } from "../services/error-enrichment.ts";

// ── Input types (cross the port boundary) ─────────────────────────────────────

/** Search scope for item queries. */
export type SearchScope = "backlog" | "sprint" | "all";

/**
 * Input filter for findItems port method.
 * All fields are optional — an empty filter returns all items.
 * Defined at the port boundary because it's an input type, not a domain type.
 */
export interface ItemFilter {
  readonly scope?: SearchScope;
  readonly keys?: readonly string[];
  readonly search?: string;
  readonly types?: readonly string[];
  readonly statuses?: readonly string[];
  readonly priority?: string;
  readonly epic_id?: string;
  readonly labels?: readonly string[];
  readonly assignee?: string;
  readonly estimated?: boolean;
  readonly sprint_ref?: string | null;
  readonly include_dependencies?: boolean;
  readonly limit?: number;
}

/**
 * Resolved filter with defaults applied.
 * All fields are guaranteed non-optional — use the defaults from the handler
 * before calling the port method.
 */
export interface ResolvedItemFilter {
  readonly scope: SearchScope;
  readonly keys: readonly string[];
  readonly search: string;
  readonly types: readonly string[];
  readonly statuses: readonly string[];
  readonly priority: string;
  readonly epic_id: string;
  readonly labels: readonly string[];
  readonly assignee: string;
  readonly estimated: boolean | undefined;
  readonly sprint_ref: string | null;
  readonly include_dependencies: boolean;
  readonly limit: number;
}

/**
 * Input query for getAnalytics port method.
 * Defined at the port boundary because it's an input type, not a domain type.
 */
export interface AnalyticsQuery {
  readonly view: "burndown" | "history" | "both";
  readonly sprint_ref?: string | null;
  readonly history_window?: number; // 1-10, used when view includes history
}

// ── Supporting types that cross the boundary ──────────────────────────────────

/** Lightweight sprint descriptor — no backend-internal IDs. */
export interface SprintInfo {
  readonly id: string; // iteration ID from platform (e.g. GitHub iteration field ID)
  readonly name: string;
  readonly goal: string | null;
  readonly startDate: string; // YYYY-MM-DD
  readonly durationDays: number;
  readonly endDate: string; // YYYY-MM-DD (computed by adapter)
}

/** A platform field that may or may not exist. */
export interface FieldPresence {
  readonly exists: boolean;
}

/** A field with configurable options, such as status or priority. */
export interface FieldWithOptions extends FieldPresence {
  readonly options: readonly string[];
  readonly missingOptions: readonly string[];
}

/** Maps canonical vocabulary keys to platform display names. Null when not resolved. */
export type DisplayMap = Record<string, string> | null;

/** What currently exists on the PM platform. Returned by orient use case. */
export interface PlatformState {
  readonly fields: {
    readonly status: FieldWithOptions;
    readonly sprint: FieldPresence;
    readonly story_points: FieldPresence;
    readonly priority: FieldWithOptions;
    readonly type: FieldPresence & { readonly configured: boolean };
  };
  readonly labels: {
    readonly existing: readonly string[];
    readonly expected: readonly string[];
    readonly missing: readonly string[];
  };
  readonly iterations: {
    readonly active: SprintInfo | null;
    readonly next: SprintInfo | null;
    readonly completed: readonly SprintInfo[];
    readonly completedCount: number;
  };
  /** Vocabulary display maps — resolved by the adapter from backend-specific config. */
  readonly vocabulary: {
    readonly statusDisplay: DisplayMap; // canonical → display
    readonly priorityDisplay: DisplayMap; // canonical → display
    readonly typeDisplay: DisplayMap; // canonical → display
    /** Repo-relative template file paths, keyed by canonical type key. Only keys with a
     *  declared template are present. Empty when no templates are configured. */
    readonly typeTemplatePaths: Record<string, string>;
  };
  /** Active epics — populated by orientUseCase via backend.getEpics(). */
  readonly epics: { readonly active: readonly EpicSummary[]; readonly totalCount: number };
  /** PBI template URIs — built from typeTemplatePaths; null when no templates configured. */
  readonly templateUris: TemplateUriMap | null;
}

/**
 * Full story payload with associated data, returned by getStoryDetail.
 *
 * @deprecated Use ItemDetailResult from ../domain/types.ts instead.
 *   ItemDetailResult is a superset — it adds acceptance_criteria.
 *   StoryDetail will be removed in P2 (port type consolidation).
 */
export interface StoryDetail {
  story: Story;
  comments: StoryComment[] | null;
  linked_artifacts: LinkedArtifact[] | null;
}

/**
 * Lightweight per-story projection shared by history and burndown.
 * Defined here (at the port boundary) so both the use-case layer (sprint-math)
 * and the adapter layer (mappers) can reference a single canonical type.
 */
export interface BurndownStoryInput {
  readonly number: number;
  readonly title: string;
  readonly points: number;
  readonly status: string | null;
  readonly ref?: EntityRef;
}

/** One completed sprint's worth of data for history. */
export interface SprintHistoryEntry {
  info: SprintInfo;
  stories: BurndownStoryInput[];
}

/** Stories + sprint geometry needed to compute a burndown series. */
export interface BurndownInput {
  sprint: SprintInfo;
  stories: BurndownStoryInput[];
}

/** Completion timestamps per story number. */
export interface CompletionMap {
  completions: Map<number, string>; // issue number → ISO-8601 timestamp
  dataSource: "audit_log" | "issue_close_proxy";
  warning?: string;
}

/** Inputs for scrum_create_story. */
export interface CreateStoryInput {
  readonly title: string;
  readonly body: string;
  readonly type: string; // canonical key declared in config.yml type_mapping (e.g. "feature", "impediment")
  readonly priority?: string;
  readonly storyPoints?: number;
  readonly labels?: readonly string[];
  readonly epic?: EpicRef;
  readonly assignees?: readonly string[];
  readonly sprint?: SprintRef;
}

/** Inputs for scrum_update_story. */
export interface StoryUpdates {
  readonly title?: string;
  readonly body?: string;
  readonly labels?: readonly string[];
  readonly assignees?: readonly string[];
  readonly epic?: EpicRef | null;
  readonly blocked_by?: readonly StoryRef[] | null; // null clears all; omit to leave unchanged
}

export type VocabularyKind = "status_option" | "priority_option" | "label";

// ── Listing types (SprintSnapshot items) ────────────────────────────────────────

/**
 * Lightweight listing entry for story collections.
 * Does NOT include body, comments, or linked PRs — use StoryDetail for full content.
 *
 * ref.key matches Story.key: the human-readable issue number as a string (e.g. "42"),
 * or null for Draft Issues.
 *
 * writable: true for active sprint items (safe to mutate), false for history/read-only items.
 *
 * @deprecated Use ItemListing from domain/types.ts instead.
 * ItemListing adds priority as a named field, sprint.ref, and epic info.
 * Scheduled for removal in the next major refactor phase.
 */
export interface StoryListing {
  ref: ItemListingRef;
  title: string;
  status: string | null;
  story_points: number | null;
  priority: string | null;
  sprint: string | null;
  writable: boolean; // true for active items, false for history/read-only
  has_dependencies: DependencyEntry[];
}

/**
 * Lightweight impediment entry for collections.
 */
export interface ImpedimentListing {
  readonly ref: ImpedimentRef;
  readonly description: string;
  readonly status: "open" | "in_progress" | "resolved";
  readonly raised_by: string | null;
  readonly raised_at: string;
  readonly resolved_at: string | null;
}

// ── Focused port interfaces (Interface Segregation) ─────────────────────────────

/**
 * Epic port — returns all epics for the project.
 * Used by: getBacklogUseCase, orientUseCase
 */
export interface EpicPort {
  getEpics(sprintIterationId?: string | null): Promise<EpicListing[]>;
}

/**
 * Story port — returns full detail for a single story.
 * Used by: getStoryUseCase
 */
export interface StoryPort {
  getStoryDetail(ref: StoryRef): Promise<BackendCallResult<StoryDetail>>;
}

/**
 * Find items port — unified item search across all PBIs.
 * Replaces SprintPort.getSprintStories() and BacklogPort.getBacklogStories().
 */
export interface FindItemsPort {
  findItems(filter: ResolvedItemFilter): Promise<ItemSearchResult>;
}

/**
 * Analytics port — unified sprint analytics (burndown + history).
 * Replaces HistoryPort.getCompletedSprintHistory() and BurndownPort methods.
 */
export interface AnalyticsPort {
  getAnalytics(query: AnalyticsQuery): Promise<AnalyticsResult>;
}

/**
 * Board health port — health dashboard (no item lists).
 * Provides aggregated metrics without returning individual story data.
 */
export interface BoardHealthPort {
  getBoardHealth(sprintScope: string): Promise<BacklogHealth>;
}

/**
 * Impediment port — returns sprint-specific impediments and allows status updates.
 * Used by: getSprintUseCase, updateImpedimentUseCase
 */
export interface ImpedimentPort {
  getSprintImpediments(sprint: SprintRef): Promise<ImpedimentListing[]>;
  getOrphanImpediments(): Promise<ImpedimentListing[]>;
  updateImpediment(
    ref: ImpedimentRef,
    status: "open" | "in_progress" | "resolved",
    resolutionNotes?: string,
  ): Promise<ImpedimentListing>;
}

/**
 * File reader port — fetches files from the repository backing the PM platform.
 * Used by: getTemplateUseCase
 * todo: this should be more generalized so it's not strictly fetching from a repository
 */
export interface FileReaderPort {
  fetchRepoFile(path: string): Promise<string>;
}

/**
 * Project reader — composition of all read ports.
 * Used by: orientUseCase (via getPlatformState), scrum-read tools
 */
export interface ProjectReader
  extends StoryPort, EpicPort, FindItemsPort, AnalyticsPort, BoardHealthPort, ImpedimentPort {
  getPlatformState(declaredVocabulary: {
    canonicalStatusKeys: string[];
    canonicalPriorityKeys: string[];
  }): Promise<BackendCallResult<PlatformState>>;

  /**
   * Compute work completion for a sprint.
   * Returns completed points and total committed points.
   * { completed: 0, total: 0 } when no items have story points.
   */
  getSprintCompletion(iterationId: string): Promise<{ completed: number; total: number }>;

  /**
   * Re-sync with the platform: re-fetch live field metadata (iterations, field
   * option IDs) so subsequent calls reflect changes made on the board since
   * the server started. Called automatically by orientUseCase.
   */
  reload(): Promise<void>;
}

/**
 * Project writer — all mutation operations.
 * Used by: scrum-write tools
 */
export interface ProjectWriter {
  createStory(input: CreateStoryInput): Promise<StoryRef>;
  createImpediment(
    input: CreateStoryInput,
  ): Promise<{ listing: ImpedimentListing; itemRef: StoryRef }>;
  updateStory(ref: StoryRef, updates: StoryUpdates): Promise<void>;
  setField(
    ref: StoryRef,
    // todo: this is a hard-coded project field. This should be dynamically generated based on the
    // scrum config, and the code will keep an internal default to check 'readiness'
    // the language model should be flexible enough to map dynamic fields with its purpose
    // even without explicit instruction for each cases (assuming the user's prompt is reasonable)
    field: "status" | "sprint" | "story_points" | "priority" | "assignee" | "type",
    value: string | number | SprintRef | null,
  ): Promise<void>;
  addComment(ref: StoryRef, body: string): Promise<void>;
  addVocabulary(
    kind: VocabularyKind,
    value: string,
  ): Promise<{ created: boolean }>;
}

/**
 * ProjectBackend — the full interface combining all ports.
 * Tool handlers use this for convenience; new use-case code should
 * import specific ports (FindItemsPort, AnalyticsPort, etc.).
 */
export interface ProjectBackend extends ProjectReader, ProjectWriter {}
