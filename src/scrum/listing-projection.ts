// =============================================================================
// src/scrum/listing-projection.ts - compact / standard / full listing shapes
// =============================================================================

import type { BacklogItemListing, DependencyPointer, LinkedArtifact } from "../domain/types.ts";
import type { ListingFieldsMode } from "./ports.ts";

export interface CompactItemListing {
  readonly ref: { readonly id: string; readonly key: string };
  readonly title: string;
  readonly status: string | null;
  readonly story_points: number | null;
  readonly blocked_by: ReadonlyArray<{ readonly key: string }>;
}

export interface StandardItemListing extends CompactItemListing {
  readonly type: string | null;
  readonly priority: string | null;
  readonly sprint: string | null;
  readonly assignees: readonly string[];
  readonly linked_pull_requests?: ReadonlyArray<LinkedArtifact>;
  readonly content_kind?: "issue" | "pr" | "draft";
}

export type ProjectedItemListing = CompactItemListing | StandardItemListing | BacklogItemListing;

export const projectListing = (
  item: BacklogItemListing,
  mode: ListingFieldsMode,
): ProjectedItemListing => {
  if (mode === "full") return item;

  const compact: CompactItemListing = {
    ref: item.ref,
    title: item.title,
    status: item.status,
    story_points: item.story_points,
    blocked_by: item.blocked_by.map((dep) => ({ key: dep.key })),
  };

  if (mode === "compact") return compact;

  return {
    ...compact,
    type: item.type,
    priority: item.priority,
    sprint: item.sprint.name,
    assignees: item.assignees,
    ...((item.linked_pull_requests?.length ?? 0) > 0
      ? { linked_pull_requests: item.linked_pull_requests }
      : {}),
    ...(item.content_kind && item.content_kind !== "issue"
      ? { content_kind: item.content_kind }
      : {}),
  };
};

export const projectListings = (
  items: readonly BacklogItemListing[],
  mode: ListingFieldsMode,
): ProjectedItemListing[] => items.map((item) => projectListing(item, mode));

export const dependencyMapToArray = (
  map: Record<string, DependencyPointer> | null,
): DependencyPointer[] | undefined => {
  if (!map || Object.keys(map).length === 0) return undefined;
  return Object.values(map);
};
