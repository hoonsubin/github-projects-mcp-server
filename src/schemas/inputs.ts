// =============================================================================
// src/schemas/inputs.ts — Legacy input schemas
//
// Phase 4 cleanup: All dead schemas removed. Only GraphQLQuerySchema remains
// (imported by scrum-write.ts for the deprecated github_graphql tool).
// =============================================================================

import { z } from "zod";

/**
 * Arbitrary read-only GraphQL query. Mutations are blocked at the handler level.
 * Useful for ad-hoc lookups not covered by other tools (e.g. fetching node IDs,
 * listing labels, resolving repo metadata).
 */
export const GraphQLQuerySchema = z.object({
  query: z.string().min(1)
    .describe(
      "A read-only GraphQL query string. Must not contain the 'mutation' keyword. " +
        "Use this for ad-hoc lookups: node IDs, labels, repo metadata, etc.",
    ),
  variables: z.record(z.string(), z.unknown()).optional()
    .describe("Optional variables object for the query"),
}).strict();
