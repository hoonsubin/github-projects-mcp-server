// =============================================================================
// src/services/mutation-validator.ts — Validates GraphQL queries for mutations
//
// Single Responsibility: Detects mutation keywords in GraphQL query strings.
// Follows SRP — no business logic, only validation.
// =============================================================================

/**
 * Validates a GraphQL query string and determines if it contains a mutation.
 *
 * @param query - The GraphQL query string to validate
 * @returns true if the query contains a mutation keyword, false otherwise
 *
 * @example
 * ```typescript
 * const isValid = isMutationQuery("query { user { id } }");
 * // returns false
 *
 * const isMutation = isMutationQuery("mutation CreateIssue { ... }");
 * // returns true
 * ```
 */
export const isMutationQuery = (query: string): boolean => {
  if (!query || typeof query !== "string") {
    return false;
  }

  // Normalize to lowercase for case-insensitive matching
  const normalized = query.toLowerCase();

  // Check for mutation keyword at the start of a statement
  // Pattern: "mutation" followed by optional whitespace and identifier
  const mutationPattern = /\bmutation\b\s+\w+/;

  return mutationPattern.test(normalized);
};
