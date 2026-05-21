// =============================================================================
// src/domain/config.ts — Platform-agnostic Scrum configuration types
//
// ScrumConfig is the shape of .github/scrum/config.yml as the domain layer
// sees it. Backend adapter configs (GitHub tokens, project numbers, field
// mappings) are type-erased here as `Record<string, unknown>` — each adapter
// casts its own config out of `backends[platform]` without polluting the domain
// with platform-specific details.
// =============================================================================

import type { ArtifactType } from "./types.ts";

// ── Support types ─────────────────────────────────────────────────────────────

/**
 * One canonical priority tier. The ordered position in the array (index 0 =
 * highest) defines relative urgency. The agent reasons in these keys; each
 * backend maps them to its own display labels via priority_display.
 */
interface PriorityTier {
  key: string; // e.g. "p0", "p1", "p2", "p3"
}

/**
 * Semantic metadata for a single canonical workflow state.
 * terminal — counts as "done" for velocity and burndown (exactly one should be true).
 * blocking — indicates the story is impeding sprint flow; used for impediment
 *            inference when explicit dependency link data is unavailable.
 */
interface StatusSemantics {
  terminal: boolean;
  blocking: boolean;
}

// ── Top-level config shape ────────────────────────────────────────────────────

/** Top-level shape of .github/scrum/config.yml. */
export interface ScrumConfig {
  /** Platform-agnostic project identity, agent behaviour, and team roster. */
  project: {
    name: string;
    agent?: {
      name?: string;
      autonomy?: {
        level: "conservative" | "standard" | "full";
        require_confirmation_above_n_items?: number;
      };
    };
    team?: Array<{
      name: string;
      role: "scrum_master" | "product_owner" | "developer";
      contact?: string;
    }>;
  };

  /** Platform-neutral Scrum taxonomy — consumed by use-case layer and agent. */
  scrum: {
    sprint?: {
      length_weeks?: number;
      start_day?: string;
      story_point_scale?: string;
      story_point_values?: number[];
      velocity_window?: number;
      carry_over_threshold_days?: number;
    };
    /** Ordered highest→lowest. p0 is most urgent. */
    priority: PriorityTier[];
    /** Canonical workflow states with semantic metadata. */
    status: Record<string, StatusSemantics>;
  };

  /** Agent-facing quality gates. Server never enforces these. */
  definition_of_ready?: string[];
  definition_of_done?: string[];

  /** Ceremony artifact template paths, or null for agent skill defaults. */
  templates?: Partial<Record<ArtifactType, string | null>>;

  /** Where the agent writes ceremony documents (outside MCP server scope). */
  ceremony_records?: {
    backend: string;
    discussion_category?: string;
    issue_label?: string;
    file_path?: string;
  };

  /**
   * Backend adapter configurations, keyed by platform name (e.g. "github").
   * Type-erased here — each adapter casts its own entry to its concrete config
   * type (e.g. GitHubBackendConfig). The domain layer has no knowledge of
   * platform-specific fields such as tokens, project numbers, or field mappings.
   */
  backends: Record<string, unknown>;
}
