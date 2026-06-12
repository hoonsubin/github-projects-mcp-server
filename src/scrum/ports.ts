// =============================================================================
// src/scrum/ports.ts - ProjectBackend interface (THE CONTRACT)
//
// This interface is the entire surface area that separates Scrum policy from
// platform details. It lives in the use-case layer - implementations depend
// on it, not the other way around.
//
// No GitHub field IDs, GraphQL shapes, or platform-specific primitives appear
// on either side of this interface.

// =============================================================================

import type {
  BacklogItemListing,
  DependencyMap,
  EpicListing,
  EpicRef,
  EpicRefWithName,
  EpicSummary,
  ImpedimentRef,
  ImpedimentStatus,
  ItemSearchResult,
  LinkedArtifact,
  SprintRef,
  Story,
  StoryComment,
  StoryRef,
  TemplateUriMap,
} from "../domain/types.ts";
import { SCRUM_FIELDS, SEARCH_SCOPES, VOCABULARY_KINDS } from "../domain/types.ts";
import type { ScrumField, SearchScope, VocabularyKind } from "../domain/types.ts";
import type { BackendCallResult } from "../services/error-enrichment.ts";
import type { ContentLocation } from "../domain/content-location.ts";

// ── Re-exports (domain vocabulary - single source of truth) ─────────────────

export { SCRUM_FIELDS, SEARCH_SCOPES, VOCABULARY_KINDS };
export type { ScrumField, SearchScope, VocabularyKind };

// ── Input types (cross the port boundary) ─────────────────────────────────────

/**
 * Input filter for findItems port method.
 * All fields are optional - an empty filter returns all items.
 * Defined at the port boundary because it's an input type, not a domain type.
 */
export const LISTING_FIELDS_MODES = ["compact", "standard", "full"] as const;
export type ListingFieldsMode = (typeof LISTING_FIELDS_MODES)[number];

export type FindItemsIntent =
  | "sprint_board"
  | "backlog_ready"
  | "readiness_check"
  | "blocked_items"
  | "search_backlog"
  | "by_keys";

export interface ItemFilter {
  readonly intent?: FindItemsIntent;
  /** Unified sprint filter: current | next | backlog | all | "<sprint name>". Omit = entire board. */
  readonly sprint?: string;
  readonly keys?: readonly string[];
  readonly search?: string;
  readonly types?: readonly string[];
  readonly statuses?: readonly string[];
  readonly priority?: string;
  readonly epic_id?: string;
  readonly labels?: readonly string[];
  readonly assignee?: string;
  readonly estimated?: boolean;
  /** When true, only items with blocked_by entries; when false, only items without blockers. */
  readonly has_blockers?: boolean;
  readonly include_dependencies?: boolean;
  readonly fields?: ListingFieldsMode;
  readonly limit?: number;
}

/**
 * Resolved filter with defaults applied.
 * All fields are guaranteed non-optional - use the defaults from the handler
 * before calling the port method.
 */
/** Adapter-internal search result before listing projection and dependency_map array shaping. */
export interface ItemSearchResultRaw {
  readonly items: readonly BacklogItemListing[];
  readonly total_count: number;
  readonly scope_summary: {
    readonly sprint_count: number | null;
    readonly backlog_count: number | null;
  };
  readonly dependency_map: DependencyMap | null;
}

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
  readonly has_blockers: boolean | undefined;
  readonly sprint_ref: string | null;
  readonly include_dependencies: boolean;
  readonly fields: ListingFieldsMode;
  readonly limit: number;
}

// ── Supporting types that cross the boundary ──────────────────────────────────

/** Lightweight sprint descriptor - no backend-internal IDs. */
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
  /** Vocabulary display maps - resolved by the adapter from backend-specific config. */
  readonly vocabulary: {
    readonly statusDisplay: DisplayMap; // canonical → display
    readonly priorityDisplay: DisplayMap; // canonical → display
    readonly typeDisplay: DisplayMap; // canonical → display
    /** Repo-relative template file paths, keyed by canonical type key. Only keys with a
     *  declared template are present. Empty when no templates are configured. */
    readonly typeTemplatePaths: Record<string, ContentLocation>;
  };
  /** Active epics - populated by orientUseCase via backend.getEpics(). */
  readonly epics: { readonly active: readonly EpicSummary[]; readonly totalCount: number };
  /** PBI template URIs - built from typeTemplatePaths; null when no templates configured. */
  readonly templateUris: TemplateUriMap | null;
}

/**
 * Full story payload with associated data, returned by getStoryDetail.
 *
 * @deprecated Use ItemDetailResult from ../domain/types.ts instead.
 *   ItemDetailResult is a superset - it adds acceptance_criteria.
 *   StoryDetail is retained for backward compatibility until port type consolidation.
 */
export interface StoryDetail {
  story: Story;
  comments: StoryComment[] | null;
  linked_artifacts: LinkedArtifact[] | null;
}

/**
 * Lean per-item projection from an aggregate board scan.
 * Prep for BoardAggregates / getAggregates - not yet on the port interface.
 */
export interface ItemAggregate {
  readonly id: string;
  readonly type: string | null;
  readonly status: string | null;
  readonly sprintId: string | null;
  readonly storyPoints: number | null;
  readonly hasBlockers: boolean;
  readonly hasAssignee: boolean;
  readonly issueNumber: number | null;
  readonly isArchived: boolean;
  readonly sprintTitle: string | null;
  readonly title: string | null;
  readonly completed_at: string | null; // ISO-8601 timestamp from completionsFromBoardItems, null if not completed
}

/**
 * Input query for SprintDataPort.getSprintData().
 * Carries a SprintRef to identify which sprint to fetch raw data for.
 */
export interface SprintDataQuery {
  readonly sprint_ref: SprintRef;
}

/**
 * A single raw item in a sprint's data, with completion timestamp.
 * No aggregation — flat per-item facts for the agent to process.
 */
export interface SprintRawItem {
  readonly id: string;
  /** null for draft PBIs not yet promoted to a numbered issue */
  readonly number: number | null;
  readonly title: string;
  readonly type: string | null;
  readonly status: string | null;
  readonly story_points: number | null;
  readonly has_assignee: boolean;
  readonly has_blockers: boolean;
  readonly completed_at: string | null;
}

/**
 * Raw sprint data returned by SprintDataPort.getSprintData().
 * Contains sprint metadata and a flat array of items with completion timestamps.
 * No burndown series, no health metrics — the agent computes those.
 */
export interface SprintRawData {
  readonly sprint: SprintInfo | null;
  readonly items: readonly SprintRawItem[];
}

/** Fields known from a just-completed mutation (merged over a snapshot fetch). */
export interface StorySnapshotOverrides {
  readonly title?: string;
  readonly body?: string;
  readonly labels?: readonly string[];
  readonly assignees?: readonly string[];
  readonly type?: string | null;
  readonly status?: string | null;
  readonly sprint?: string | null;
  readonly story_points?: number | null;
  readonly priority?: string | null;
  readonly epic?: EpicRef | EpicRefWithName | null;
  readonly blocked_by?: readonly StoryRef[] | null;
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

/** Result of an idempotent create operation. */
export type CreateResult = {
  readonly created: boolean;
  /** True when the value was already present (idempotent no-op). */
  readonly already_exists?: boolean;
};

// ── Listing types (SprintSnapshot items) ────────────────────────────────────────

/**
 * Lightweight impediment entry for collections.
 */
export interface ImpedimentListing {
  readonly ref: ImpedimentRef;
  readonly description: string;
  readonly status: ImpedimentStatus;
  readonly raised_by: string | null;
  readonly raised_at: string;
  readonly resolved_at: string | null;
}

// ── Focused port interfaces (Interface Segregation) ─────────────────────────────

/**
 * Epic port - returns all epics for the project.
 * Used by: getBacklogUseCase, orientUseCase
 */
export interface EpicPort {
  getEpics(sprintIterationId?: string | null): Promise<EpicListing[]>;
}

/**
 * Story port - returns full detail for a single story.
 * Used by: getItemDetailUseCase
 */
export interface StoryPort {
  getStoryDetail(ref: StoryRef): Promise<BackendCallResult<StoryDetail>>;
  /**
   * Build a tool-response Story after a mutation without comments/linked PRs.
   * Merges optional {@link StorySnapshotOverrides} over a single lean item fetch.
   */
  composeStorySnapshot(
    ref: StoryRef,
    overrides?: StorySnapshotOverrides,
  ): Promise<BackendCallResult<Story>>;
  composeStoryAfterSetField(
    ref: StoryRef,
    field: ScrumField,
    value: string | number | SprintRef | null,
  ): Promise<BackendCallResult<Story>>;
  composeStoryAfterStoryUpdate(
    ref: StoryRef,
    updates: StoryUpdates,
  ): Promise<BackendCallResult<Story>>;
  composeStoryAfterCreateStory(
    ref: StoryRef,
    input: CreateStoryInput,
  ): Promise<BackendCallResult<Story>>;
}

/**
 * Find items port - unified item search across all PBIs.
 * Replaces SprintPort.getSprintStories() and BacklogPort.getBacklogStories().
 */
export interface FindItemsPort {
  findItems(filter: ResolvedItemFilter): Promise<BackendCallResult<ItemSearchResultRaw>>;
}

/**
 * Impediment port - returns sprint-specific impediments and allows status updates.
 * Used by: updateImpedimentUseCase
 */
export interface ImpedimentPort {
  getSprintImpediments(sprint: SprintRef): Promise<ImpedimentListing[]>;
  getOrphanImpediments(): Promise<ImpedimentListing[]>;
  updateImpediment(
    ref: ImpedimentRef,
    status: ImpedimentStatus,
    resolutionNotes?: string,
  ): Promise<ImpedimentListing>;
}

/**
 * Sprint data port - returns raw sprint items with completion timestamps.
 * Used by: scrum_get_sprint_data handler
 */
export interface SprintDataPort {
  getSprintData(query: SprintDataQuery): Promise<SprintRawData>;
}

/**
 * File reader port - fetches content from any location the platform supports.
 * Used by: templateResourceUseCase
 */
export interface FileReaderPort {
  /** Fetch content from a file, URL, or inline data. */
  fetchContent(location: ContentLocation): Promise<string>;
}

/**
 * Project reader - composition of all read ports.
 * Used by: orientUseCase (via getPlatformState), scrum-read tools
 */
export interface ProjectReader
  extends StoryPort, EpicPort, FindItemsPort, ImpedimentPort, SprintDataPort {
  getPlatformState(declaredVocabulary: {
    canonicalStatusKeys: string[];
    canonicalPriorityKeys: string[];
  }): Promise<BackendCallResult<PlatformState>>;

  /**
   * Re-sync with the platform: re-fetch live field metadata (iterations, field
   * option IDs) so subsequent calls reflect changes made on the board since
   * the server started. Called automatically by orientUseCase.
   */
  reload(): Promise<void>;

  /**
   * Refresh field metadata without invalidating the session board cache.
   * Used by scrum_orient to avoid redundant full-board refetches.
   */
  reloadMetadata(): Promise<void>;
}

/**
 * Project writer - all mutation operations.
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
    field: ScrumField,
    value: string | number | SprintRef | null,
  ): Promise<void>;
  addComment(ref: StoryRef, body: string): Promise<void>;
  addVocabulary(
    kind: VocabularyKind,
    value: string,
  ): Promise<CreateResult>;
}

/**
 * ProjectBackend - the full interface combining all ports.
 * Tool handlers use this for convenience; new use-case code should
 * import specific ports (FindItemsPort, SprintDataPort, etc.).
 */
export interface ProjectBackend extends ProjectReader, ProjectWriter {}
