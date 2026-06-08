// =============================================================================
// src/adapters/github/fixtures/pages.ts
//
// Page envelope builder and pre-built paginated response fixtures.
// =============================================================================

import type { ProjectItem } from "../../../adapters/github/types.ts";
import { FIXTURE_ITEM_192, FIXTURE_ITEM_222, FIXTURE_ITEM_WITH_CUSTOM_FIELDS } from "./items.ts";
import { FIXTURE_ITEM_DONE } from "./items-synthetic.ts";

/** Build a full user.projectV2.items GraphQL response envelope from nodes. */
export const makePageEnvelope = (
  nodes: readonly ProjectItem[],
  opts?: { totalCount?: number; hasNextPage?: boolean; endCursor?: string | null },
) => ({
  user: {
    projectV2: {
      id: "PVT_kwHOAmfLjc4BWiTt",
      items: {
        totalCount: opts?.totalCount ?? nodes.length,
        pageInfo: {
          hasNextPage: opts?.hasNextPage ?? false,
          endCursor: opts?.endCursor ?? null,
        },
        nodes,
      },
    },
  },
});

/** Pre-built first-page envelope for board-scan tests (2 canonical nodes). hasNextPage=true so paginator fetches page 2. */
export const FIXTURE_PAGE_1 = makePageEnvelope([FIXTURE_ITEM_222, FIXTURE_ITEM_192], {
  hasNextPage: true,
  endCursor: "Y3Vyc29yOnYyOpKrMDAwMDAwMDAuMDHOCzXmIQ==",
});

/** Pre-built second-page envelope for pagination / custom-fields tests (1 augmented node + 1 Done node). */
export const FIXTURE_PAGE_2 = makePageEnvelope([
  FIXTURE_ITEM_WITH_CUSTOM_FIELDS,
  FIXTURE_ITEM_DONE,
]);
