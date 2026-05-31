// =============================================================================
// src/adapters/github/internal/epic-service.ts - Epic Read Operations
// =============================================================================

import type * as GH from "../generated/github-types.ts";
import type { GitHubClient } from "./http-client.ts";
import { LIST_MILESTONES_QUERY } from "../queries.ts";
import type { EpicListing } from "../../../domain/types.ts";
import type { MilestoneRef } from "../types.ts";
import type { ProjectItemsAssembler } from "./assemblers/project-items-assembler.ts";

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

/** Fetches GitHub Milestones across tracked repos and maps them to EpicListing[]. */
export class EpicService {
  constructor(
    private readonly gh: GitHubClient,
    private readonly owner: string,
    private readonly repos: string[],
    private readonly projectItemsAssembler: ProjectItemsAssembler,
  ) {}

  async getEpics(sprintIterationId?: string | null): Promise<EpicListing[]> {
    const allMilestones = await this._fetchMilestones();

    if (!sprintIterationId) return allMilestones;

    const output = await this.projectItemsAssembler.assemble({
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
      limit: 500,
    });

    const epicIdsInSprint = new Set<string>();
    for (const item of output.items) {
      if (item.epic?.ref.id) epicIdsInSprint.add(item.epic.ref.id);
    }

    return allMilestones.filter((m) => epicIdsInSprint.has(m.ref.id));
  }

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
