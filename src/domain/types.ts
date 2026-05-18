// =============================================================================
// src/domain/types.ts — Domain entity types
//
// Pure domain types: the concepts the MCP tool surface exposes to the agent.
// Nothing here imports from adapters, services, or generated schema files.
// These types are platform-agnostic — no GitHub field IDs, GraphQL node shapes,
// or wire-format details appear here.
// =============================================================================

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

// todo: need to handle epics as first-class object
/**
 * A reference to an impediment (spike story tagged 'impediment').
 * On GitHub: id is the GitHub Issue node ID (I_...), not the project item ID.
 * Impediment operations (updateImpediment) operate on the GitHub Issue directly.
 */
export interface ImpedimentRef {
  id: string;
}

/**
 * A reference to a sprint.
 * Accepted forms: `"current"`, `"next"`, `null` (= no sprint, i.e., the backlog),
 * or an explicit sprint name (e.g., `"Sprint 12"`).
 */
export type SprintRef = "current" | "next" | null | string;

// ── Story entity ──────────────────────────────────────────────────────────────

/**
 * The canonical Story entity returned by every read tool.
 *
 * Epic IS writable in v1 (maps to GitHub Milestone).
 */
export interface Story {
  ref: { id: string }; // opaque project-item handle — use in subsequent tool calls
  key: string | null; // human-readable identifier ("42", "PRO-123"); null for draft issues
  title: string;
  body: string;
  type: string | null; // canonical type key from config (e.g. "feature", "bug"); null when unset
  status: string | null; // team's vocabulary value, e.g. "In Progress"
  sprint: string | null; // sprint name, or null if in backlog
  story_points: number | null;
  priority: string | null; // team's vocabulary value, e.g. "Must"
  assignees: string[]; // GitHub logins
  labels: string[]; // repo labels; type is tracked via the Type board field, not labels
  epic: string | null; // GitHub Milestone title; null if unset
  created_at: string; // ISO-8601
  updated_at: string; // ISO-8601
  url: string | null; // canonical URL in the backend UI
}

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
