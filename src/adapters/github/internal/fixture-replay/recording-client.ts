// =============================================================================
// Records live GraphQL responses and builds manifest v2 wire index.
// =============================================================================

import { resolve } from "@std/path";
import type { GitHubClient, RestResponse } from "../http-client.ts";
import { computeQueryHash, extractOperationName, hashToFilename } from "./query-hash.ts";
import type { ScenarioCallLogEntry, WireResponseEntry } from "./types.ts";

export interface RecordedWireCall {
  readonly hash: string;
  readonly operation: string;
  readonly variables: Record<string, unknown>;
  readonly response: unknown;
}

export class RecordingGitHubClient implements GitHubClient {
  readonly calls: RecordedWireCall[] = [];
  private readonly seenHashes = new Set<string>();

  constructor(private readonly inner: GitHubClient) {}

  async graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    const result = await this.inner.graphql<T>(query, variables);
    const hash = computeQueryHash(query, variables);
    this.calls.push({
      hash,
      operation: extractOperationName(query),
      variables: variables ?? {},
      response: result,
    });
    this.seenHashes.add(hash);
    return result;
  }

  rest<T>(
    path: string,
    options?: Record<string, unknown>,
  ): Promise<RestResponse<T>> {
    return this.inner.rest<T>(path, options);
  }

  /** Flush new responses to disk; returns manifest wire entries (deduped by hash). */
  async persistWireResponses(
    fixturesDir: string,
    wireSubdir = "wire",
  ): Promise<WireResponseEntry[]> {
    const wireDir = resolve(fixturesDir, wireSubdir);
    await Deno.mkdir(wireDir, { recursive: true });

    const entries: WireResponseEntry[] = [];
    const written = new Set<string>();

    for (const call of this.calls) {
      if (written.has(call.hash)) continue;
      written.add(call.hash);

      const filename = `${hashToFilename(call.hash)}.json`;
      const relativePath = `${wireSubdir}/${filename}`;
      const absolutePath = resolve(fixturesDir, relativePath);
      await Deno.writeTextFile(absolutePath, JSON.stringify(call.response, null, 2));

      entries.push({
        hash: call.hash,
        operation: call.operation,
        variables: call.variables,
        file: relativePath,
      });
    }

    return entries;
  }

  /** Scenario-local ordered call log (includes duplicate hashes if re-called). */
  buildScenarioCallLog(wireEntries: WireResponseEntry[]): ScenarioCallLogEntry[] {
    const fileByHash = new Map(wireEntries.map((e) => [e.hash, e.file]));
    return this.calls.map((call) => ({
      hash: call.hash,
      operation: call.operation,
      variables: call.variables,
      file: fileByHash.get(call.hash) ?? `wire/${hashToFilename(call.hash)}.json`,
    }));
  }

  resetCallLog(): void {
    this.calls.length = 0;
  }
}

/** Merge wire entries from multiple recording phases (dedupe by hash). */
export const mergeWireEntries = (
  ...groups: WireResponseEntry[][]
): WireResponseEntry[] => {
  const byHash = new Map<string, WireResponseEntry>();
  for (const group of groups) {
    for (const entry of group) {
      byHash.set(entry.hash, entry);
    }
  }
  return [...byHash.values()];
};
