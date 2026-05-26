// =============================================================================
// src/adapters/github/internal/file-reader.ts - GitHubFileReader adapter
//
// Implements FileReaderPort: checks the local workspace first, then falls back
// to the GitHub Contents API. Local lookup avoids a round-trip for files that
// exist in the repo the server is running inside.
// =============================================================================

import { fetchRepoFile } from "./contents.ts";
import type { FileReaderPort } from "../../../scrum/ports.ts";

export class GitHubFileReader implements FileReaderPort {
  constructor(
    private readonly owner: string,
    private readonly repo: string,
    private readonly localRoot: string,
  ) {}

  async fetchRepoFile(path: string): Promise<string> {
    const localPath = `${this.localRoot}/${path.replace(/^\/+/, "")}`;
    try {
      return await Deno.readTextFile(localPath);
    } catch {
      // File not found locally - fetch from the remote repository.
      return fetchRepoFile(this.owner, this.repo, path);
    }
  }
}
