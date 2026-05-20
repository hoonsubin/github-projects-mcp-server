// =============================================================================
// src/adapters/github/internal/file-reader.ts — GitHubFileReader adapter
//
// Implements FileReaderPort using the GitHub Contents API.
// Wraps fetchRepoFile from contents.ts with owner/repo pre-bound.
// =============================================================================

import { fetchRepoFile } from "./contents.ts";
import type { FileReaderPort } from "../../../scrum/ports.ts";

export class GitHubFileReader implements FileReaderPort {
  constructor(private readonly owner: string, private readonly repo: string) {}

  fetchRepoFile(path: string): Promise<string> {
    return fetchRepoFile(this.owner, this.repo, path);
  }
}
