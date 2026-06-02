// =============================================================================
// Replay GitHub GraphQL responses from fixture manifest v2.
// =============================================================================

import { resolve } from "@std/path";
import type { GitHubClient, RestResponse } from "../http-client.ts";
import { computeQueryHash, extractOperationName } from "./query-hash.ts";
import type { FixtureManifestV2 } from "./types.ts";

export class FixtureReplayClient implements GitHubClient {
  private readonly responseByHash = new Map<string, unknown>();
  private readonly orderedFallback: unknown[] = [];
  private fallbackIndex = 0;

  constructor(
    private readonly fixturesDir: string,
    _manifest?: FixtureManifestV2,
    options?: { orderedFallback?: unknown[] },
  ) {
    if (options?.orderedFallback) {
      this.orderedFallback.push(...options.orderedFallback);
    }
  }

  async loadResponses(manifest: FixtureManifestV2): Promise<void> {
    for (const entry of manifest.wire.responses) {
      const path = resolve(this.fixturesDir, entry.file);
      const text = await Deno.readTextFile(path);
      this.responseByHash.set(entry.hash, JSON.parse(text));
    }
  }

  async graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    const hash = computeQueryHash(query, variables);
    const hit = this.responseByHash.get(hash);
    if (hit !== undefined && hit !== null) {
      return hit as T;
    }

    if (this.fallbackIndex < this.orderedFallback.length) {
      const response = this.orderedFallback[this.fallbackIndex++];
      return response as T;
    }

    const operation = extractOperationName(query);
    throw new Error(
      `FixtureReplayClient: no wire response for hash "${hash}" ` +
        `(operation ${operation}, variables ${JSON.stringify(variables ?? {})}). ` +
        `Re-run deno task capture-fixtures to record this call.`,
    );
  }

  rest<T>(
    _path: string,
    _options?: Record<string, unknown>,
  ): Promise<RestResponse<T>> {
    throw new Error("FixtureReplayClient: REST calls are not replayed from fixtures.");
  }
}
