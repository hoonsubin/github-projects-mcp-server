// =============================================================================
// Stable GraphQL call identity for fixture indexing and replay.
// =============================================================================

const sortValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(obj).sort().map((key) => [key, sortValue(obj[key])]),
    );
  }
  return value;
};

/** Extract named operation from a GraphQL document string. */
export const extractOperationName = (query: string): string => {
  const named = query.match(/\b(?:query|mutation)\s+(\w+)/);
  if (named?.[1]) return named[1];

  return query.replace(/\s+/g, " ").trim().slice(0, 80);
};

export const stableVariablesJson = (variables?: Record<string, unknown>): string => {
  if (!variables || Object.keys(variables).length === 0) return "{}";
  return JSON.stringify(sortValue(variables));
};

/** Hash key used to index wire fixture responses in manifest v2. */
export const computeQueryHash = (
  query: string,
  variables?: Record<string, unknown>,
): string => {
  const operation = extractOperationName(query);
  const vars = stableVariablesJson(variables);
  return `${operation}:${vars}`;
};

/** File-safe slug from a query hash (operation + variables). */
export const hashToFilename = (hash: string): string =>
  hash.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 180);
