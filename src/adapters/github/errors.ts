// =============================================================================
// src/adapters/github/errors.ts — GitHubApiError class
//
// GitHubApiError is the canonical exception thrown by all GitHub HTTP helpers.
// Lives in adapters/github/ because it represents GitHub-specific failure modes.
// =============================================================================

export class GitHubApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly graphqlErrors?: string[],
  ) {
    super(message);
    this.name = "GitHubApiError";
  }
}
