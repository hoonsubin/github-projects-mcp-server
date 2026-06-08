// =============================================================================
// src/adapters/github/internal/fixtures/user-nodes.ts
//
// User node ID fixtures for ResolveActorNodeId query tests.
// =============================================================================

/**
 * Captured GraphQL responses for ResolveActorNodeId queries.
 * Keyed by GitHub login. "_not_found_" is a synthetic entry where the API
 * returns { user: null } - used for NOT_FOUND error path tests.
 */
export const USERNODE_IDS: Record<string, { user: { id: string } | null }> = {
  "hoonsubin": {
    user: {
      id: "U_kgDOAmfLjQ",
    },
  },
  "_not_found_": {
    user: null,
  },
};

/** Convenience: the resolved user node ID for the "hoonsubin" login. */
export const FIXTURE_USER_ID = "U_kgDOAmfLjQ";
