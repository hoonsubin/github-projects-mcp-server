// =============================================================================
// src/adapters/github/internal/epic-service.ts - Epic Read Operations
//
// Single responsibility: fetch GitHub Milestones across all tracked repositories
// and map them to EpicListing[]. Milestones are the GitHub backing concept for
// Epics (Design Decision D4 in tasks/REFACTORING.md).
//
// Results from multiple repos are merged and deduplicated by node ID so that
// milestones shared across repos appear only once.
//
// Sprint filtering: when sprintIterationId is provided, only epics with ≥1 item
// in the active sprint are returned. Falls back to all open epics when null.
// =============================================================================

import type * as GH from "../generated/github-types.ts";
import type { GitHubClient } from "./http-client.ts";
import { LIST_MILESTONES_QUERY } from "../queries.ts";
import type { EpicListing } from "../../../domain/types.ts";
import type { MilestoneRef } from "../types.ts";
import { StoryQueryService } from "./story-query-service.ts";

/** Query projection of GH.Milestone for epic listing. */
interface MilestoneNode extends MilestoneRef {
  description: string | null;
  state: GH.MilestoneState;
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
    private readonly storyQueryService: StoryQueryService,
  ) {}

  async getEpics(sprintIterationId?: string | null): Promise<EpicListing[]> {
    const allMilestones = await this._fetchMilestones();

    if (!sprintIterationId) return allMilestones;

    // Fetch items in the active sprint and collect their epic IDs.
    // sprintIterationId is a raw GitHub iteration ID (e.g. "iteration_abc123") -
    // resolveSprint does a title-based lookup, so pass "current" as the SprintRef
    // to match the active sprint by semantic reference rather than opaque ID.
    const sprintItems = await this.storyQueryService.findItems({
      scope: "sprint",
      keys: [],
      search: "",
      types: [],
      statuses: [],
      priority: "",
      epic_id: "",
      labels: [],
      assignee: "",
      estimated: undefined,
      sprint_ref: "current",
      include_dependencies: false,
      limit: 100,
    });

    const epicIdsInSprint = new Set<string>();
    for (const item of sprintItems.items) {
      if (item.epic?.ref.id) epicIdsInSprint.add(item.epic.ref.id);
    }

    return allMilestones.filter((m) => epicIdsInSprint.has(m.ref.id));
  }

  /** Fetch all milestones across tracked repositories. */
  private async _fetchMilestones(): Promise<EpicListing[]> {
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
    open_item_count: m.openIssues.totalCount,
  };
};
