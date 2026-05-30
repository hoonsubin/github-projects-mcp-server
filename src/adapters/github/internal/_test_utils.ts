// =============================================================================
// src/adapters/github/internal/_test_utils.ts
// Internal test utility for GitHub adapter tests.
// =============================================================================

import type { GitHubClient, RestResponse } from "./http-client.ts";
import type { RuntimeConfig } from "../config-loader.ts";

// ── GitHubClient spy ──────────────────────────────────────────────────────────

export interface GitHubClientSpy extends GitHubClient {
  graphqlCalls: Array<{ queryExcerpt: string; variables: Record<string, unknown> }>;
  restCalls: Array<{ path: string; options: unknown }>;
  enqueue(...responses: unknown[]): void;
  remaining(): number;
}

/**
 * Queue-based GitHubClient spy. Enqueue responses in the order GraphQL calls
 * will be made. An empty queue throws immediately with the query excerpt so
 * you can identify which call was unexpected.
 *
 * Enqueue an Error instance to simulate a transport-level failure:
 *   gh.enqueue(new GitHubApiError("...", { code: "AUTH_FAILED", ... }))
 */
export function createGhSpy(): GitHubClientSpy {
  const queue: unknown[] = [];
  const spy: GitHubClientSpy = {
    graphqlCalls: [],
    restCalls: [],
    async graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
      spy.graphqlCalls.push({
        queryExcerpt: query.slice(0, 300).replace(/\s+/g, " "),
        variables: variables ?? {},
      });
      if (queue.length === 0) {
        throw new Error(`Unmocked graphql (empty queue): ${query.slice(0, 120)}`);
      }
      const r = queue.shift()!;
      if (r instanceof Error) throw r;
      return await Promise.resolve(r as T);
    },
    async rest<T>(path: string, options?: Record<string, unknown>): Promise<RestResponse<T>> {
      spy.restCalls.push({ path, options });
      return await Promise.resolve({ data: {} as T, linkHeader: null });
    },
    enqueue(...responses: unknown[]) {
      queue.push(...responses);
    },
    remaining() {
      return queue.length;
    },
  };
  return spy;
}

// ── RuntimeConfig factory ─────────────────────────────────────────────────────

/**
 * Builds a minimal but structurally valid RuntimeConfig for tests.
 * Pass overrides for only the fields your test cares about.
 *
 * Use this instead of `{} as unknown as RuntimeConfig` — the cast hides
 * breakage when RuntimeConfig fields change.
 */
export function makeConfig(overrides: Partial<RuntimeConfig> = {}): RuntimeConfig {
  return {
    scrumConfig: {
      project: { name: "Test" },
      scrum: { priority: [], status: {} },
      backends: { github: {} },
    },
    projectId: "PVT_project1",
    fields: {
      sprintFieldId: "PVTF_sprint",
      statusFieldId: "PVTF_status",
      storyPointsFieldId: "PVTF_points",
      priorityFieldId: "PVTF_priority",
      epicFieldId: null,
      assigneeFieldId: null,
      typeFieldId: "PVTF_type",
    },
    statusOptions: { "In Progress": "opt_ip" },
    priorityOptions: { "Must": "opt_must" },
    typeOptions: { feature: "opt_feature", bug: "opt_bug" },
    typeTemplatePaths: {},
    iterations: {
      active: { id: "IT_active", title: "Sprint 5", startDate: "2026-01-01", duration: 14 },
      next: { id: "IT_next", title: "Sprint 6", startDate: "2026-01-15", duration: 14 },
      completed: [],
      all: [],
    },
    ...overrides,
  };
}
