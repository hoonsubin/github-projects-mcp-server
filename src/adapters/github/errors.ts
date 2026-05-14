// =============================================================================
// src/adapters/github/errors.ts — GitHubApiError class
//
// GitHubApiError is the canonical exception thrown by all GitHub HTTP helpers.
// Lives in adapters/github/ because it represents GitHub-specific failure modes.
// =============================================================================

// todo: create a new parent class called `SemanticError` and replace `graphqlErrors` to `apiErrorMsg`
// the upstream layer should only consider the SemanticError object so it can identify which backend is causing an error
// and how to solve that error (or at least provide pointers)
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
