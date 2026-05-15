// =============================================================================
// src/scrum/ports.ts — ProjectBackend interface (THE CONTRACT)
//
// This interface is the entire surface area that separates Scrum policy from
// platform details. It lives in the use-case layer — implementations depend
// on it, not the other way around.
//
// No GitHub field IDs, GraphQL shapes, or platform-specific primitives appear
// on either side of this interface.
//
// Phase C (Structural Cleanup): Decomposed into focused interfaces following
// the Interface Segregation Principle. Each use case imports only the port it
// needs. ProjectBackend remains as a composition type for backward compatibility.
// =============================================================================

import type { SprintRef, Story, StoryRef } from "../domain/types.ts";

// ── Supporting types that cross the boundary ──────────────────────────────────

/** Lightweight sprint descriptor — no backend-internal IDs. */
export interface SprintInfo {
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
  };
  labels: { existing: string[]; expected: string[]; missing: string[] };
  iterations: {
    active: SprintInfo | null;
    next: SprintInfo | null;
    completed: SprintInfo[];
    completedCount: number;
  };
}

/** Full story payload with associated data, returned by getStoryDetail. */
export interface StoryDetail {
  story: Story;
  comments: Array<{
    author: string;
    body: string;
    created_at: string;
    url: string;
  }>;
  linkedPrs: Array<{
    number: number;
    title: string;
    url: string;
    state: string;
    is_draft: boolean;
  }>;
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
  ref?: { id: string } | null;
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
  epic?: string;
  assignees?: string[];
  sprint?: SprintRef;
}

/** Inputs for scrum_update_story. */
export interface StoryUpdates {
  title?: string;
  body?: string;
  labels?: string[];
  assignees?: string[];
  epic?: string | null;
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
 */
export interface StoryListing {
  ref: { id: string; key: string | null };
  title: string;
  status: string | null;
  story_points: number | null;
  priority: string | null;
  sprint: string | null;
  writable: boolean; // true for active items, false for history/read-only
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
 * Totals for an active sprint snapshot.
 * History snapshots use SprintTotalsHistory instead.
 */
export interface SprintTotalsActive {
  by_status: Record<string, number>;
  story_points: number;
}

/**
 * Totals for a completed sprint snapshot.
 * Extends SprintTotalsActive with velocity metrics.
 */
export interface SprintTotalsHistory extends SprintTotalsActive {
  committed_points: number;
  completed_points: number;
}

/**
 * Sprint + item listing — canonical shape for both active and historical sprints.
 *
 * totals uses SprintTotalsActive for active sprints, SprintTotalsHistory for history.
 * Consumers distinguish by checking for committed_points presence.
 */
export interface SprintSnapshot {
  sprint: {
    name: string;
    start_date: string;
    end_date: string;
    duration_days: number;
    days_remaining: number | null;
  };
  items: StoryListing[];
  total_count: number;
  totals: SprintTotalsActive | SprintTotalsHistory;
  impediments: ImpedimentListing[];
}

// ── Focused port interfaces (Interface Segregation) ─────────────────────────────

/**
 * Backlog port — returns stories not assigned to any sprint and orphan impediments.
 * Used by: getBacklogUseCase
 */
export interface BacklogPort {
  getBacklogStories(): Promise<Story[]>;
  getOrphanImpediments(): Promise<ImpedimentListing[]>;
}

/**
 * Sprint port — returns stories assigned to a specific sprint.
 * Used by: getSprintUseCase
 */
export interface SprintPort {
  getSprintStories(sprint: SprintRef): Promise<{
    stories: Story[];
    sprintInfo: SprintInfo | null;
  }>;
}

/**
 * Story port — returns full detail for a single story.
 * Used by: getStoryUseCase
 */
export interface StoryPort {
  getStoryDetail(ref: StoryRef): Promise<StoryDetail>;
}

/**
 * History port — returns completed sprint history.
 * Used by: getHistoryUseCase
 */
export interface HistoryPort {
  getCompletedSprintHistory(window: number): Promise<SprintHistoryEntry[]>;
}

/**
 * Burndown port — returns burndown data and completion timestamps.
 * Used by: getBurndownUseCase
 */
export interface BurndownPort {
  getBurndownInput(sprint: SprintRef): Promise<BurndownInput>;
  resolveCompletionTimestamps(input: BurndownInput): Promise<CompletionMap>;
}

/**
 * Impediment port — returns sprint-specific impediments and allows status updates.
 * Used by: getSprintUseCase, updateImpedimentUseCase
 */
export interface ImpedimentPort {
  getSprintImpediments(sprint: SprintRef): Promise<ImpedimentListing[]>;
  updateImpediment(
    ref: Ref,
    status: "open" | "in_progress" | "resolved",
    resolutionNotes?: string,
  ): Promise<ImpedimentListing>;
}

/**
 * Template port — fetches repository files for ceremony templates.
 * Used by: getTemplateUseCase
 *
 * NOTE: This is GitHub-specific. Non-GitHub backends should not implement this.
 */
export interface TemplatePort {
  fetchRepoFile(path: string): Promise<string>;
}

/**
 * Project reader — composition of all read ports.
 * Used by: orientUseCase (via getPlatformState), scrum-read tools
 */
export interface ProjectReader
  extends BacklogPort, SprintPort, StoryPort, HistoryPort, BurndownPort, ImpedimentPort {
  getPlatformState(declaredVocabulary: {
    statusValues: string[];
    priorityValues: string[];
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
    field: "status" | "sprint" | "story_points" | "priority" | "assignee" | "type",
    value: string | number | SprintRef | null,
  ): Promise<void>;
  addComment(ref: StoryRef, body: string): Promise<void>;
  addVocabulary(
    kind: VocabularyKind,
    value: string,
  ): Promise<{ created: boolean }>;
}

// ── Legacy composition type (backward compatibility) ────────────────────────────

/**
 * ProjectBackend — the full interface combining all ports.
 * Kept for backward compatibility; new code should import specific ports.
 */
// TemplatePort is GitHub-specific — non-GitHub backends may omit this;
// tool handler accepts TemplatePort directly
export interface ProjectBackend extends ProjectReader, ProjectWriter, TemplatePort {}
