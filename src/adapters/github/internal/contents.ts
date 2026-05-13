// =============================================================================
// src/adapters/github/internal/contents.ts — GitHub Contents API helpers
//
// Extracted from services/github.ts as part of Phase C (Structural Cleanup).
// Provides file fetching and decoding for the GitHub Contents API.
// =============================================================================

import { GitHubApiError } from "../errors.ts";
import { rest, type RestResponse } from "./http-client.ts";

// ── GitHub Contents API types ──────────────────────────────────────────────────

/**
 * GitHub REST endpoint `GET /repos/{owner}/{repo}/contents/{path}` response
 * for a single file hit. On a directory, it returns an array instead.
 * On 404, the existing `rest<T>()` error classification fires:
 * `GitHubApiError(404, ...)`.
 */
interface RepoFileResponse {
  type: "file";
  encoding: "base64";
  content: string; // base64-encoded, may include newlines
  name: string;
  path: string;
  size: number;
  sha: string;
  url: string;
  html_url: string;
  download_url: string | null;
}

/**
 * Decode a base64-encoded file body returned by the GitHub Contents API.
 *
 * GitHub's API includes newline characters in the base64 string for readability.
 * These must be stripped before decoding — atob() rejects strings with whitespace.
 *
 * Exported for unit testing.
 * todo: this function is only used inside unit tests. Doesn't have to be exported
 */
export const decodeRepoFileContent = (encoded: string): string => atob(encoded.replace(/\s/g, ""));

/**
 * Fetch the content of a single file from the repo via the GitHub Contents API.
 *
 * Returns the decoded UTF-8 file content as a string.
 *
 * Throws GitHubApiError with an actionable message if:
 *   - The file does not exist (404) — with a hint to add the file or
 *     set the template path to null in config.yml.
 *   - The path resolves to a directory rather than a file.
 *   - Any other GitHub API error (permissions, rate limit, etc.).
 */
export const fetchRepoFile = async (
  owner: string,
  repo: string,
  path: string,
): Promise<string> => {
  let response: RepoFileResponse | RepoFileResponse[];

  try {
    const result = await rest<RepoFileResponse | RepoFileResponse[]>(
      `/repos/${owner}/${repo}/contents/${path}`,
    );
    response = result.data;
  } catch (err) {
    if (err instanceof GitHubApiError && err.statusCode === 404) {
      throw new GitHubApiError(
        `Template file "${path}" is declared in config.yml but was not found ` +
          `in the repository. Either add the file or set the template path to null ` +
          `in config.yml under the templates section.`,
        404,
      );
    }
    throw err;
  }

  if (Array.isArray(response)) {
    throw new GitHubApiError(
      `Template path "${path}" resolves to a directory, not a file. ` +
        `Provide the path to a specific file in config.yml.`,
    );
  }

  return decodeRepoFileContent(response.content);
};
