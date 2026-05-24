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
  EpicListing,
  EpicRef,
  EpicSummary,
  ItemSearchResult,
  SprintRef,
  Story,
  StoryRef,
  TemplateUriMap,
} from "../domain/types.ts";

// ── Input types (cross the port boundary) ─────────────────────────────────────

/**
 * Input filter for findItems port method.
 * All fields are optional — an empty filter returns all items.
 * Defined at the port boundary because it's an input type, not a domain type.
 */
export interface ItemFilter {
  scope?: "backlog" | "sprint" | "all";
  keys?: string[];
  search?: string;
  types?: string[];
  statuses?: string[];
  priority?: string;
  epic_id?: string;
  labels?: string[];
  assignee?: string;
  estimated?: boolean;
  sprint_ref?: string | null;
  include_dependencies?: boolean;
  limit?: number;
}

/**
 * Resolved filter with defaults applied.
 * All fields are guaranteed non-optional — use the defaults from the handler
 * before calling the port method.
 */
export interface ResolvedItemFilter {
  scope: "backlog" | "sprint" | "all";
  keys: string[];
  search: string;
  types: string[];
  statuses: string[];
  priority: string;
  epic_id: string;
  labels: string[];
  assignee: string;
  estimated: boolean | undefined;
  sprint_ref: string | null;
  include_dependencies: boolean;
  limit: number;
}

/**
 * Input query for getAnalytics port method.
 * Defined at the port boundary because it's an input type, not a domain type.
 */
export interface AnalyticsQuery {
  view: "burndown" | "history" | "comprehensive";
  sprint_ref?: string | null;
  history_window?: number; // 1-10, used when view includes history
}

// ── Supporting types that cross the boundary ──────────────────────────────────

/** Lightweight sprint descriptor — no backend-internal IDs. */
export interface SprintInfo {
  id: string; // iteration ID from platform (e.g. GitHub iteration field ID)
  name: string;
  startDate: string; // YYYY-MM-DD
  durationDays: number;
  endDate: string; // YYYY-MM-DD (computed by adapter)
}

/** What currently exists on the PM platform. Returned by orient use case. */
export interface PlatformState {
  fields: {
    status: { exists: boolean; options: string[]; missingOptions: string[] };
    sprint: { exists: boolean };
    story_points: { exists: boolean };
    priority: { exists: boolean; options: string[]; missingOptions: string[] };
    type: { exists: boolean; configured: boolean };
  };
  labels: { existing: string[]; expected: string[]; missing: string[] };
  iterations: {
    active: SprintInfo | null;
    next: SprintInfo | null;
    completed: SprintInfo[];
    completedCount: number;
  };
  /** Vocabulary display maps — resolved by the adapter from backend-specific config. */
  vocabulary: {
    statusDisplay: Record<string, string> | null; // canonical → display
    priorityDisplay: Record<string, string> | null; // canonical → display
    typeDisplay: Record<string, string> | null; // canonical → display
  };
  /** Active epics — populated by orientUseCase via backend.getEpics(). */
  epics: { active: EpicSummary[]; totalCount: number };
  /** PBI template URIs — built from ITEM_TYPES intersection with scrumConfig.templates. */
  templateUris: TemplateUriMap | null;
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
  comments: import("../domain/types.ts").StoryComment[];
  linked_artifacts: import("../domain/types.ts").LinkedArtifact[];
}

/**
 * Lightweight per-story projection shared by history and burndown.
 * Defined here (at the port boundary) so both the use-case layer (sprint-math)
 * and the adapter layer (mappers) can reference a single canonical type.
 */
export interface BurndownStoryInput {
  number: number;
  title: string;
  points: number;
  status: string | null;
  ref?: { id: string };
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
  title: string;
  body: string;
  type: string; // canonical key declared in config.yml type_display (e.g. "feature", "impediment")
  priority?: string;
  storyPoints?: number;
  labels?: string[];
  epic?: EpicRef;
  assignees?: string[];
  sprint?: SprintRef;
}

/** Inputs for scrum_update_story. */
export interface StoryUpdates {
  title?: string;
  body?: string;
  labels?: string[];
  assignees?: string[];
  epic?: EpicRef | null;
  blocked_by?: StoryRef[] | null; // null clears all; omit to leave unchanged
}

export type VocabularyKind = "status_option" | "priority_option" | "label";

// ── Listing types (SprintSnapshot items) ────────────────────────────────────────

/**
 * Base reference for listing entries.
 * StoryListing and ImpedimentListing extend this pattern.
 */
export interface Ref {
  id: string;
}

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
  ref: { id: string; key: string | null };
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
  ref: { id: string };
  description: string;
  status: "open" | "in_progress" | "resolved";
  raised_by: string | null;
  raised_at: string;
  resolved_at: string | null;
}

/**
 * Totals for a sprint snapshot (re-exported from domain/types.ts).
 * @deprecated Import from "../domain/types.ts" directly.
 */
export type { SprintTotals } from "../domain/types.ts";

/**
 * Sprint + item listing (re-exported from domain/types.ts).
 * @deprecated Import from "../domain/types.ts" directly.
 *
 * NOTE: items is now ItemListing[] (not StoryListing[]).
 * impediments has been removed — use BacklogHealth for impediment counts.
 */
export type { SprintSnapshot } from "../domain/types.ts";

// ── Focused port interfaces (Interface Segregation) ─────────────────────────────

/**
 * Epic port — returns all epics for the project.
 * Used by: getBacklogUseCase, orientUseCase
 */
export interface EpicPort {
  getEpics(): Promise<EpicListing[]>;
}

/**
 * Story port — returns full detail for a single story.
 * Used by: getStoryUseCase
 */
export interface StoryPort {
  getStoryDetail(ref: StoryRef): Promise<StoryDetail>;
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
    ref: Ref,
    status: "open" | "in_progress" | "resolved",
    resolutionNotes?: string,
  ): Promise<ImpedimentListing>;
}

/**
 * File reader port — fetches files from the repository backing the PM platform.
 * Used by: getTemplateUseCase
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
  }): Promise<PlatformState>;

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
