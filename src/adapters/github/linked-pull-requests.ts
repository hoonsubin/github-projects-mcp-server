// =============================================================================
// Linked pull requests from GitHub Projects field values and PR board items.
// =============================================================================

import type { LinkedArtifact } from "../../domain/types.ts";
import type { ItemFieldValue } from "./types.ts";

export type PullRequestFieldNode = {
  number?: number;
  title?: string | null;
  url?: string;
  state?: string;
  isDraft?: boolean;
};

/** Map a Projects "Pull requests" column value to agent-visible linked artifacts. */
export const pullRequestNodesToLinkedArtifacts = (
  nodes: readonly (PullRequestFieldNode | null | undefined)[],
): LinkedArtifact[] =>
  nodes.flatMap((pr) => {
    if (!pr || typeof pr.number !== "number") return [];
    return [{
      number: pr.number,
      title: pr.title ?? "",
      url: pr.url ?? "",
      state: pr.state ?? "UNKNOWN",
      is_draft: pr.isDraft ?? false,
    }];
  });

/** Collect linked PRs from ProjectV2ItemFieldPullRequestValue nodes on a board item. */
export const extractLinkedPullRequestsFromFieldValues = (
  fieldValues: readonly ItemFieldValue[],
): LinkedArtifact[] => {
  const linked: LinkedArtifact[] = [];
  for (const fv of fieldValues) {
    if (fv.__typename !== "ProjectV2ItemFieldPullRequestValue") continue;
    linked.push(...pullRequestNodesToLinkedArtifacts(fv.pullRequests?.nodes ?? []));
  }
  return linked;
};

/** Deduplicate linked PRs from multiple sources (timeline events, board column). */
export const mergeLinkedArtifacts = (
  ...groups: Array<readonly LinkedArtifact[] | null | undefined>
): LinkedArtifact[] | null => {
  const seen = new Set<number>();
  const merged: LinkedArtifact[] = [];
  for (const group of groups) {
    for (const artifact of group ?? []) {
      if (seen.has(artifact.number)) continue;
      seen.add(artifact.number);
      merged.push(artifact);
    }
  }
  return merged.length > 0 ? merged : null;
};
