// =============================================================================
// src/adapters/github/write-services/epic-mutation-service.ts
// Epic CRUD via GitHub REST API (milestones).
//
// All milestone writes are REST-only — the GraphQL API has no create/update
// mutations for milestones.  See spike #246 for the full API analysis.
// =============================================================================

import type { CreateEpicInput, EpicUpdates } from "../../../scrum/ports.ts";
import type { EpicListing, EpicRef } from "../../../domain/types.ts";
import type { GitHubInfraContext } from "../infra/infra-context.ts";

interface MilestoneResponse {
  /** Internal database ID — NOT the milestone number. Use `number` for the sequential milestone number. */
  id: number;
  /** GraphQL node ID (MI_...) — returned as EpicRef.id */
  node_id: string;
  /** Sequential milestone number (e.g. 1, 2, 3) — returned as EpicRef.number */
  number: number;
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

    return { id: data.node_id, number: data.number };
  }

  /**
   * Updates an existing milestone (epic) via GitHub REST API.
   *
   * PATCH /repos/{owner}/{repo}/milestones/{number}
   * Only sends fields present in `updates` — the REST API ignores omitted keys.
   * Returns the full EpicListing rebuilt from the response so agents see
   * the post-mutation state without an additional GraphQL round-trip.
   */
  async updateMilestone(ref: EpicRef, updates: EpicUpdates): Promise<EpicListing> {
    const milestoneNumber = ref.number;
    if (!milestoneNumber) {
      throw new Error(
        `EpicRef.number is required for milestone updates but was absent (ref.id=${ref.id}).`,
      );
    }

    const body: Record<string, unknown> = {};
    if (updates.name !== undefined) body.title = updates.name;
    if (updates.description !== undefined) body.description = updates.description;
    if (updates.status !== undefined) {
      body.state = updates.status === "done" ? "closed" : "open";
    }

    if (Object.keys(body).length === 0) {
      // Nothing to update — return current state via a GET call as a cheap rebuild.
      const { data } = await this.ctx.gh.rest<MilestoneResponse>(
        `repos/${this.ctx.owner}/${this.ctx.repo}/milestones/${milestoneNumber}`,
        { method: "GET" },
      );
      return toEpicListing(data);
    }

    const { data } = await this.ctx.gh.rest<MilestoneResponse>(
      `repos/${this.ctx.owner}/${this.ctx.repo}/milestones/${milestoneNumber}`,
      { method: "PATCH", body },
    );

    return toEpicListing(data);
  }
}

/** Rebuild EpicListing from a REST milestone response (same shape as the GraphQL mapping). */
const toEpicListing = (m: MilestoneResponse): EpicListing => ({
  ref: { id: m.node_id, number: m.number },
  name: m.title,
  description: m.description ?? null,
  priority: null,
  status: m.state === "open" ? "open" : "done",
  story_count: m.open_issues + m.closed_issues,
  open_item_count: m.open_issues,
});
