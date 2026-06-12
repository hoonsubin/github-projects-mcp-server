// =============================================================================
// src/scrum/item-detail-projection.ts - DoR-tier detail for agent text channel
// =============================================================================

import type { ItemDetailResult } from "../domain/types.ts";

export type ItemDetailTier = "dor" | "full";

const BODY_MAX = 800;
const COMMENT_BODY_MAX = 400;

const truncate = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, max)}…`;

/** Slim detail payload for routine DoR/readiness checks (agent-visible text). */
export const projectItemDetailForAgent = (
  detail: ItemDetailResult,
  tier: ItemDetailTier,
): ItemDetailResult => {
  if (tier === "full") return detail;

  return {
    ...detail,
    story: {
      ...detail.story,
      body: truncate(detail.story.body, BODY_MAX),
    },
    comments: detail.comments?.length
      ? [detail.comments[detail.comments.length - 1]!].map((comment) => ({
        ...comment,
        body: truncate(comment.body, COMMENT_BODY_MAX),
      }))
      : detail.comments,
    linked_artifacts: detail.linked_artifacts?.length
      ? detail.linked_artifacts.slice(0, 5)
      : detail.linked_artifacts,
  };
};
