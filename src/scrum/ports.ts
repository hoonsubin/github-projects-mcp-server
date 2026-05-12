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

import type { SprintRef, Story, StoryRef } from "../types.ts";

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
  type: "feature" | "bug" | "tech_debt" | "spike";
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

// ── The interface ──────────────────────────────────────────────────────────────

export interface ProjectBackend {
  // ── Read ──────────────────────────────────────────────────────────────────

  /**
   * Return what currently exists on the PM platform.
   * The adapter computes missingOptions by diffing declared vocabulary values
   * against live platform option names.
   */
  getPlatformState(declaredVocabulary: {
    statusValues: string[];
    priorityValues: string[];
  }): Promise<PlatformState>;

  /**
   * All stories assigned to a sprint, resolved from a SprintRef.
   */
  getSprintStories(sprint: SprintRef): Promise<{
    stories: Story[];
    sprintInfo: SprintInfo | null;
  }>;

  /**
   * All stories not assigned to any sprint.
   */
  getBacklogStories(): Promise<Story[]>;

  /**
   * Full detail for one story: content, board fields, comments, linked PRs.
   */
  getStoryDetail(ref: StoryRef): Promise<StoryDetail>;

  /**
   * Lightweight story rows for the last `window` completed sprints,
   * most-recent-first.
   */
  getCompletedSprintHistory(window: number): Promise<SprintHistoryEntry[]>;

  /**
   * Stories in a sprint shaped for burndown computation.
   */
  getBurndownInput(sprint: SprintRef): Promise<BurndownInput>;

  /**
   * Resolve completion timestamps for the stories in a burndown input.
   */
  resolveCompletionTimestamps(input: BurndownInput): Promise<CompletionMap>;

  /**
   * Fetch a file from the team's repository by repo-relative path.
   */
  fetchRepoFile(path: string): Promise<string>;

  // ── Write (stubbed in Phase 5) ────────────────────────────────────────────

  createStory(input: CreateStoryInput): Promise<StoryRef>;
  updateStory(ref: StoryRef, updates: StoryUpdates): Promise<void>;
  setField(
    ref: StoryRef,
    field: "status" | "sprint" | "story_points" | "priority" | "assignee",
    value: string | number | SprintRef | null,
  ): Promise<void>;
  addComment(ref: StoryRef, body: string): Promise<void>;
  addVocabulary(
    kind: VocabularyKind,
    value: string,
  ): Promise<{ created: boolean }>;
}
