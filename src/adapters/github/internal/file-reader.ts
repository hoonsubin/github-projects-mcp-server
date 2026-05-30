// =============================================================================
// src/adapters/github/internal/file-reader.ts - GitHubFileReader adapter
//
// Implements FileReaderPort: delegates to the use-case fetchContent() for
// most locations, but intercepts github.com blob URLs to fetch via
// raw.githubusercontent.com with an auth header. The owner/repo in the URL
// must match this adapter's configured owner/repo (cross-repo blob URLs are
// rejected with a clear error).
// =============================================================================

import { fetchContent } from "../../../scrum/fetch-location.ts";
import type { ContentLocation } from "../../../domain/content-location.ts";
import type { FileReaderPort } from "../../../scrum/ports.ts";
import type { ResolvedToken } from "../types.ts";

export class GitHubFileReader implements FileReaderPort {
  constructor(
    private readonly owner: string,
    private readonly repo: string,
    private readonly token: ResolvedToken,
  ) {}

  fetchContent(location: ContentLocation): Promise<string> {
    if (location.kind === "url" && location.url.hostname === "github.com") {
      return this.fetchGitHubBlobAsRaw(location.url);
    }
    return fetchContent(location);
  }

  /**
   * Convert a github.com blob URL to its raw.githubusercontent.com equivalent
   * and fetch it with an auth header.
   *
   * Expected URL format:
   *   https://github.com/{owner}/{repo}/blob/{branch}/{filePath}
   *
   * The {owner} and {repo} segments must match this adapter's configured values.
   * Cross-repo blob URLs are rejected to prevent accidental data leakage.
   */
  private async fetchGitHubBlobAsRaw(blobUrl: URL): Promise<string> {
    const parts = blobUrl.pathname.split("/").filter(Boolean);
    if (parts.length < 5 || parts[2] !== "blob") {
      throw new Error(
        `Unsupported GitHub URL format: ${blobUrl}. ` +
          `Expected: https://github.com/{owner}/{repo}/blob/{branch}/{filePath}`,
      );
    }

    const [urlOwner, urlRepo, , branch, ...fileParts] = parts;

    if (urlOwner !== this.owner || urlRepo !== this.repo) {
      throw new Error(
        `GitHub URL owner/repo mismatch: expected ${this.owner}/${this.repo}, ` +
          `got ${urlOwner}/${urlRepo}. ` +
          `Template URLs must point to the configured repository.`,
      );
    }

    const rawUrl = new URL(
      `https://raw.githubusercontent.com/${urlOwner}/${urlRepo}/${branch}/${fileParts.join("/")}`,
    );
    const res = await fetch(rawUrl, {
      headers: { Authorization: `Bearer ${this.token}` },
    });
    if (!res.ok) {
      throw new Error(`GitHub raw fetch failed for ${rawUrl}: HTTP ${res.status}`);
    }
    return res.text();
  }
}
