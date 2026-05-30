// =============================================================================
// scripts/api-capture/github-capturer.ts - GitHub FixtureCapturer
//
// Records live GitHub API responses and writes them as JSON fixtures so unit
// tests can run offline via the queue-based GitHubClientSpy.
//
// Two capture phases, each using an isolated recording client:
//
//   bootstrap-fields.json
//     The project field metadata response from bootstrapGitHub().
//     Covers field ID resolution, option maps, and iteration classification.
//
//   project-items.json  |  project-items-p1.json, project-items-p2.json, …
//     Every page fetched by PaginatedProjectItemFetcher.collect().
//     A single file is written for boards that fit in one page (<= 100 items).
//     Multiple files are written for paginated boards, one per page.
//
// The recording client is a thin wrapper: it intercepts each graphql() call,
// stores the raw response, and forwards it unchanged to the real caller. No
// query strings are duplicated here — the production code paths execute as-is.
// =============================================================================

import { dirname, fromFileUrl, resolve } from "@std/path";
import { graphql as rawGraphql } from "../../src/adapters/github/internal/http-client.ts";
import { resolveToken, validateToken } from "../../src/adapters/github/types.ts";
import type { GitHubBackendConfig, ResolvedToken } from "../../src/adapters/github/types.ts";
import { bootstrapGitHub } from "../../src/adapters/github/bootstrap.ts";
import { PaginatedProjectItemFetcher } from "../../src/adapters/github/internal/pagination.ts";
import { GET_USER_NODE_ID } from "../../src/adapters/github/queries.ts";
import type { ScrumConfig } from "../../src/domain/config.ts";

// Fixtures land next to the tests that consume them.
const DEFAULT_FIXTURES_DIR = resolve(
  dirname(fromFileUrl(import.meta.url)),
  "../../src/adapters/github/internal/__fixtures__",
);

// ── Recording client factory ──────────────────────────────────────────────────

/**
 * Wraps a real graphql function with an interceptor that buffers each raw
 * response in order. Returns the client to inject and a saveAll() to flush
 * the buffer to disk after the phase completes.
 *
 * Naming:
 *   - single call  → <prefix>.json
 *   - multiple calls (pagination) → <prefix>-p1.json, <prefix>-p2.json, …
 */
function makeRecorder(
  realGraphql: <T>(q: string, v?: Record<string, unknown>) => Promise<T>,
) {
  const captured: unknown[] = [];

  const client = {
    graphql: async <T>(query: string, variables?: Record<string, unknown>): Promise<T> => {
      const result = await realGraphql<T>(query, variables);
      captured.push(result);
      return result;
    },
  };

  const saveAll = async (dir: string, prefix: string): Promise<string[]> => {
    const written: string[] = [];
    for (let i = 0; i < captured.length; i++) {
      const name = captured.length === 1 ? `${prefix}.json` : `${prefix}-p${i + 1}.json`;
      const path = resolve(dir, name);
      await Deno.writeTextFile(path, JSON.stringify(captured[i], null, 2));
      written.push(path);
    }
    return written;
  };

  return { client, saveAll };
}

// ── GitHubFixtureCapturer ─────────────────────────────────────────────────────

export class GitHubFixtureCapturer {
  readonly platform = "github";

  async capture(scrumConfig: ScrumConfig, outputDir?: string) {
    const effectiveDir = outputDir ?? DEFAULT_FIXTURES_DIR;
    await Deno.mkdir(effectiveDir, { recursive: true });

    const ghConfig = scrumConfig.backends.github as GitHubBackendConfig;
    const configDesc = "capture-fixtures";

    const resolvedToken: ResolvedToken = resolveToken(ghConfig.auth.token, configDesc);
    validateToken(resolvedToken, configDesc);

    const resolvedGhConfig: GitHubBackendConfig = {
      ...ghConfig,
      auth: { ...ghConfig.auth, token: resolvedToken },
    };

    // Curry the resolved token once — same pattern the adapter factory uses.
    const realGraphql = <T>(query: string, variables?: Record<string, unknown>) =>
      rawGraphql<T>(resolvedToken, query, variables ?? {});

    const savedFiles: string[] = [];

    // ── Phase 1: bootstrap fields ─────────────────────────────────────────────
    // bootstrapGitHub() makes one GraphQL call to fetch project field metadata.

    const bootstrapRec = makeRecorder(realGraphql);
    const live = await bootstrapGitHub({
      ghConfig: resolvedGhConfig,
      github: bootstrapRec.client,
      projectRoot: ".",
      configDesc,
    });
    savedFiles.push(...await bootstrapRec.saveAll(effectiveDir, "bootstrap-fields"));

    // ── Phase 2: project items ────────────────────────────────────────────────
    // PaginatedProjectItemFetcher.collect() makes one call per page of 100.
    // A board with <= 100 items produces a single project-items.json.

    const bootState = { scrumConfig, ghConfig: resolvedGhConfig, live };
    const itemsRec = makeRecorder(realGraphql);
    const fetcher = new PaginatedProjectItemFetcher(bootState, itemsRec.client);
    await fetcher.collect(() => true);
    savedFiles.push(...await itemsRec.saveAll(effectiveDir, "project-items"));

    // ── Phase 3: user node IDs ────────────────────────────────────────────────
    // Captures GetUserNodeId for the owner login from the config so
    // user-milestone-resolver.test.ts and field-value-mutator.test.ts can
    // exercise the real resolveUserNodeId path with real API response shapes.
    // Also captures a NOT_FOUND response for a non-existent user.

    // Resolve a real user login — for user-type owners, the owner IS the user.
    // For org-type owners, fall back to the first team member's login.
    const loginToResolve = resolvedGhConfig.owner_type === "user"
      ? resolvedGhConfig.owner
      : (resolvedGhConfig.team?.[0]?.login ?? resolvedGhConfig.owner);
    const userNodeIds: Record<string, unknown> = {};

    // Resolve the user login (real API call)
    const ownerResult = await realGraphql(GET_USER_NODE_ID, { login: loginToResolve });
    userNodeIds[loginToResolve] = ownerResult;

    // NOT_FOUND: simulate a non-existent user (API returns { user: null })
    userNodeIds["_not_found_"] = { user: null };

    const userNodeIdsPath = resolve(effectiveDir, "user-node-ids.json");
    await Deno.writeTextFile(userNodeIdsPath, JSON.stringify(userNodeIds, null, 2));
    savedFiles.push(userNodeIdsPath);

    // ── Manifest ──────────────────────────────────────────────────────────────
    const capturedAt = new Date().toISOString();
    const manifest = {
      capturedAt,
      platform: "github",
      owner: resolvedGhConfig.owner,
      projectNumber: resolvedGhConfig.project_number,
      files: savedFiles.map((f) => f.slice(effectiveDir.length + 1)),
    };
    const manifestPath = resolve(effectiveDir, "manifest.json");
    await Deno.writeTextFile(manifestPath, JSON.stringify(manifest, null, 2));
    savedFiles.push(manifestPath);

    return { platform: "github", outputDir: effectiveDir, files: savedFiles, capturedAt };
  }
}
