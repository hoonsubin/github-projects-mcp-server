// =============================================================================
// src/adapters/github/write-services/epic-mutation-service.ts
// Epic CRUD via GitHub REST API (milestones).
//
// All milestone writes are REST-only — the GraphQL API has no create/update
// mutations for milestones.  See spike #246 for the full API analysis.
// =============================================================================

import type { CreateEpicInput } from "../../../scrum/ports.ts";
import type { EpicRef } from "../../../domain/types.ts";
import type { GitHubInfraContext } from "../infra/infra-context.ts";

interface MilestoneResponse {
  /** Milestone number — used as REST path param and returned as EpicRef.number */
  id: number;
  /** GraphQL node ID (MI_...) — returned as EpicRef.id */
  node_id: string;
  title: string;
  description: string | null;
  state: "open" | "closed";
  open_issues: number;
  closed_issues: number;
}

// =============================================================================
// EpicMutationService
// =============================================================================

export class EpicMutationService {
  constructor(
    private readonly ctx: GitHubInfraContext,
  ) {}

  /**
   * Creates a new milestone (epic) in the primary repo via GitHub REST API.
   *
   * POST /repos/{owner}/{repo}/milestones
   * Returns an EpicRef with the GraphQL node ID (MI_...) and integer number.
   */
  async createMilestone(input: CreateEpicInput): Promise<EpicRef> {
    const { data } = await this.ctx.gh.rest<MilestoneResponse>(
      `repos/${this.ctx.owner}/${this.ctx.repo}/milestones`,
      {
        method: "POST",
        body: {
          title: input.name,
          ...(input.description ? { description: input.description } : {}),
          state: "open",
        },
      },
    );

    return { id: data.node_id, number: data.id };
  }
}
