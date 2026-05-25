// =============================================================================
// src/adapters/github/internal/epic-service.ts — Epic Read Operations
//
// Single responsibility: fetch GitHub Milestones across all tracked repositories
// and map them to EpicListing[]. Milestones are the GitHub backing concept for
// Epics (Design Decision D4 in tasks/REFACTORING.md).
//
// Results from multiple repos are merged and deduplicated by node ID so that
// milestones shared across repos appear only once.
// =============================================================================

import type * as GH from "../generated/github-types.ts";
import type { GitHubClient } from "./http-client.ts";
import { LIST_MILESTONES_QUERY } from "../queries.ts";
import type { EpicListing } from "../../../domain/types.ts";

/** Query projection of GH.Milestone for epic listing. */
interface MilestoneNode
  extends Required<Pick<GH.Milestone, "id" | "title" | "description" | "state">> {
  openIssues: { totalCount: number };
  closedIssues: { totalCount: number };
}

interface ListMilestonesResponse {
  repository?: {
    milestones?: {
      nodes: MilestoneNode[];
    };
  } | null;
}

/**
 * Epic read operations: fetches all GitHub Milestones across tracked repositories
 * and maps them to EpicListing[]. Injected into GitHubProjectBackend via constructor (DIP).
 */
export class EpicService {
  constructor(
    private readonly gh: GitHubClient,
    private readonly owner: string,
    private readonly repos: string[],
  ) {}

  async getEpics(): Promise<EpicListing[]> {
    const results = await Promise.all(
      this.repos.map((repo) =>
        this.gh.graphql<ListMilestonesResponse>(LIST_MILESTONES_QUERY, {
          owner: this.owner,
          repo,
        })
      ),
    );

    const seen = new Set<string>();
    const epics: EpicListing[] = [];

    for (const result of results) {
      for (const m of result.repository?.milestones?.nodes ?? []) {
        if (seen.has(m.id)) continue;
        seen.add(m.id);
        epics.push(toEpicListing(m));
      }
    }

    return epics;
  }
}

const toEpicListing = (m: MilestoneNode): EpicListing => {
  return {
    ref: { id: m.id },
    name: m.title,
    description: m.description || null,
    priority: null,
    status: m.state === "OPEN" ? "open" : "done",
    story_count: m.openIssues.totalCount + m.closedIssues.totalCount,
  };
};
