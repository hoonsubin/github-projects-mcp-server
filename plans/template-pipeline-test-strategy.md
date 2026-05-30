# Plan: Template Pipeline — Unit & Integration Test Strategy

> **Context:** The prior analysis traced the full pipeline: `config.yml → loadConfig() → resolveLocation() → fetchContent() → templateResourceUseCase()`. This plan defines what new tests to add, where they live, and in what order to build them. It also documents improvements to existing tests across the whole test suite.
>
> **Handover note for coding agent:** This document is self-contained. Execute the phases in order. Each phase lists exact files, imports, test cases, and Deno-specific implementation requirements. Do not skip the verification step at the end of each phase.

---

## Current State Assessment

### Covered (no changes needed to logic, but see Phase 5 for housekeeping)

| Test file | Count | Coverage quality |
| --- | --- | --- |
| [`src/scrum/resolve-location.test.ts`](src/scrum/resolve-location.test.ts) | 13 tests | Good. Missing `.ts` extension and empty-string edge cases — added in Phase 5. |
| [`src/scrum/fetch-location.test.ts`](src/scrum/fetch-location.test.ts) | 12 tests | Good. Has a platform portability bug (`/etc/shadow`) and a non-standard error pattern — fixed in Phase 5. |
| [`src/adapters/github/internal/story-mutation-service.test.ts`](src/adapters/github/internal/story-mutation-service.test.ts) | ~40 tests | Good coverage. Has a duplicated spy factory and a redundant helper wrapper — refactored in Phase 6. |
| [`src/adapters/github/internal/user-milestone-resolver.test.ts`](src/adapters/github/internal/user-milestone-resolver.test.ts) | ~10 tests | Good. Has a duplicated spy factory — refactored in Phase 6. |
| [`src/adapters/github/internal/story-query-service.test.ts`](src/adapters/github/internal/story-query-service.test.ts) | ~6 tests | Good. Has an unsafe `as unknown as RuntimeConfig` cast — fixed in Phase 6. |
| [`src/services/pick-defined.test.ts`](src/services/pick-defined.test.ts) | 6 tests | Missing falsy-but-defined and absent-key edge cases — added in Phase 5. |

### Mixed Concerns (needs refactoring)

| Test file | Problem |
| --- | --- |
| [`src/scrum/template-resource.test.ts`](src/scrum/template-resource.test.ts) | Mixes pure use-case unit tests with integration tests that read real `.github/scrum/config.yml` via `buildTypeTemplatePaths()`. |

### Missing (new code needed)

| Layer | What | Where |
| --- | --- | --- |
| Domain | `mimeTypeForPath()` has no unit tests | New file: `src/domain/content-location.test.ts` |
| Use-case | No pure test for file-kind `ContentLocation` MIME resolution | [`src/scrum/template-resource.test.ts`](src/scrum/template-resource.test.ts) |
| Use-case | No pure test for url-kind `ContentLocation` MIME resolution | [`src/scrum/template-resource.test.ts`](src/scrum/template-resource.test.ts) |
| Full pipeline integration | No test for config.yml → resolveLocation → fetchContent → templateResourceUseCase end-to-end | New file: `src/scrum/template-pipeline.test.ts` |

> **Note:** A config-loader integration test (`config-loader-template.test.ts`) was considered but dropped. Building a valid `GitHubClient` stub for `loadConfig()` would require mocking GraphQL responses for project fields, status/priority/type options, and iterations — a fake that will rot. Phase 4 already validates `typeTemplatePaths` correctness by reading the real config file and calling `resolveLocation()` directly, which is sufficient.

---

## MIME Resolution Order (important for stub design)

Before writing any stub, note how `templateResourceUseCase()` actually sequences its work (see `src/scrum/template-resource.ts` lines 60–65):

```ts
const content = await fileReader.fetchContent(location);   // fetch FIRST
const mimeType = location.kind === "inline"
  ? "text/markdown"
  : location.kind === "file"
  ? mimeTypeForPath(location.path)
  : mimeTypeForPath(location.url.pathname);                // MIME resolved after
return { content, mimeType };
```

MIME resolution happens **after** the fetch, not before it. The stub `FileReaderPort` in Phase 2b must still call `fetchContent`, but since it returns a fixed string, the content value does not affect the MIME assertion. Both the stub and the real reader are valid for MIME tests — but the stub is simpler and avoids filesystem I/O.

---

## Shared Test Utilities

### `src/scrum/_test_utils.ts` (required before Phase 2 and 4)

**New file.** The underscore prefix is the Deno idiom for module-private test helpers (not exported by the package surface). This file must be created before Phase 2 and Phase 4 because both import from it.

`buildTypeTemplatePaths()` is currently defined inline in `template-resource.test.ts`. The same logic is needed in `template-pipeline.test.ts`. Rather than duplicating it, extract it here. The `withTestServer()` helper (used in Phase 5) also lives here to avoid duplication across URL-branch tests.

```ts
// src/scrum/_test_utils.ts
// Internal test utility — not part of the public module surface.
// Underscore prefix signals: do not re-export from index files.

import { parse } from "@std/yaml";
import { dirname, resolve } from "@std/path";
import { fetchContent } from "./fetch-location.ts";
import { resolveLocation } from "./resolve-location.ts";
import type { ContentLocation } from "../domain/content-location.ts";
import type { FileReaderPort } from "./ports.ts";

/**
 * Reads and parses the committed .github/scrum/config.yml, extracts all
 * type_mapping entries that declare a `template` field, and resolves each
 * to a ContentLocation using the same logic as loadConfig() in config-loader.ts.
 *
 * Reads from disk once. Callers should use the module-level lazy promise
 * (see typeTemplatePathsPromise below) rather than calling this directly
 * in each test, to avoid redundant disk reads.
 */
export async function buildTypeTemplatePaths(): Promise<Record<string, ContentLocation>> {
  const configPath = ".github/scrum/config.yml";
  const rawYml = await Deno.readTextFile(configPath);
  const config = parse(rawYml) as Record<string, unknown>;
  const backends = config.backends as Record<string, unknown>;
  const github = backends.github as Record<string, Record<string, unknown>>;
  const typeMapping = github.type_mapping as Record<string, { template?: string }>;
  const projectRoot = dirname(resolve(Deno.cwd(), configPath));
  const paths: Record<string, ContentLocation> = {};
  for (const [key, entry] of Object.entries(typeMapping)) {
    if (entry.template) {
      paths[key] = resolveLocation(entry.template, projectRoot);
    }
  }
  return paths;
}

/**
 * Module-level lazy promise — disk read and YAML parse happen once per test
 * file import, not once per test case. All tests that need the paths should
 * await this instead of calling buildTypeTemplatePaths() directly.
 */
export const typeTemplatePathsPromise: Promise<Record<string, ContentLocation>> =
  buildTypeTemplatePaths();

/**
 * Stub FileReaderPort that delegates to the real fetchContent().
 * Use in pipeline integration tests where real template file content is needed.
 */
export const realFileReader: FileReaderPort = {
  fetchContent: (loc: ContentLocation) => fetchContent(loc),
};

/**
 * Stub FileReaderPort that returns a fixed string without touching the filesystem.
 * Use in pure unit tests where only MIME resolution is being tested, not content.
 */
export const stubFileReader: FileReaderPort = {
  fetchContent: (_loc: ContentLocation) => Promise.resolve("stub content"),
};

/**
 * Spins up an ephemeral local HTTP server on a random port, calls fn with
 * the base URL, then shuts the server down in a finally block.
 *
 * Use this instead of inlining Deno.serve / server.shutdown() in every URL test.
 * Port 0 lets the OS pick a free port, avoiding conflicts across parallel test runs.
 *
 * @example
 * await withTestServer(
 *   () => new Response("hello", { status: 200 }),
 *   async (base) => {
 *     const result = await fetchContent({ kind: "url", url: new URL("/test.yml", base) });
 *     assertEquals(result, "hello");
 *   },
 * );
 */
export async function withTestServer(
  handler: (req: Request) => Response,
  fn: (baseUrl: URL) => Promise<void>,
): Promise<void> {
  const server = Deno.serve(
    { hostname: "127.0.0.1", port: 0, onListen: () => {} },
    handler,
  );
  const { port } = server.addr as Deno.NetAddr;
  try {
    await fn(new URL(`http://127.0.0.1:${port}`));
  } finally {
    await server.shutdown();
  }
}
```

### `src/adapters/github/internal/_test_utils.ts` (required before Phase 6)

**New file.** `story-mutation-service.test.ts` and `user-milestone-resolver.test.ts` both define an identical queue-based `createGhSpy()`. The mutation service uses a 300-char `queryExcerpt` slice; the resolver uses 80. Use 300 in the shared version (safer for assertions on long queries). `makeConfig()` also moves here so `story-query-service.test.ts` can drop its unsafe cast.

```ts
// src/adapters/github/internal/_test_utils.ts
// Internal test utility for GitHub adapter tests.

import type { GitHubClient, RestResponse } from "./http-client.ts";
import type { RuntimeConfig } from "../config-loader.ts";

// ── GitHubClient spy ──────────────────────────────────────────────────────────

export interface GitHubClientSpy extends GitHubClient {
  graphqlCalls: Array<{ queryExcerpt: string; variables: Record<string, unknown> }>;
  restCalls: Array<{ path: string; options: unknown }>;
  enqueue(...responses: unknown[]): void;
  remaining(): number;
}

/**
 * Queue-based GitHubClient spy. Enqueue responses in the order GraphQL calls
 * will be made. An empty queue throws immediately with the query excerpt so
 * you can identify which call was unexpected.
 *
 * Enqueue an Error instance to simulate a transport-level failure:
 *   gh.enqueue(new GitHubApiError("...", { code: "AUTH_FAILED", ... }))
 */
export function createGhSpy(): GitHubClientSpy {
  const queue: unknown[] = [];
  const spy: GitHubClientSpy = {
    graphqlCalls: [],
    restCalls: [],
    async graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
      spy.graphqlCalls.push({
        queryExcerpt: query.slice(0, 300).replace(/\s+/g, " "),
        variables: variables ?? {},
      });
      if (queue.length === 0) {
        throw new Error(`Unmocked graphql (empty queue): ${query.slice(0, 120)}`);
      }
      const r = queue.shift()!;
      if (r instanceof Error) throw r;
      return await Promise.resolve(r as T);
    },
    async rest<T>(path: string, options?: Record<string, unknown>): Promise<RestResponse<T>> {
      spy.restCalls.push({ path, options });
      return await Promise.resolve({ data: {} as T, linkHeader: null });
    },
    enqueue(...responses: unknown[]) {
      queue.push(...responses);
    },
    remaining() {
      return queue.length;
    },
  };
  return spy;
}

// ── RuntimeConfig factory ─────────────────────────────────────────────────────

/**
 * Builds a minimal but structurally valid RuntimeConfig for tests.
 * Pass overrides for only the fields your test cares about.
 *
 * Use this instead of `{} as unknown as RuntimeConfig` — the cast hides
 * breakage when RuntimeConfig fields change.
 */
export function makeConfig(overrides: Partial<RuntimeConfig> = {}): RuntimeConfig {
  return {
    scrumConfig: {
      project: { name: "Test" },
      scrum: { priority: [], status: {} },
      backends: { github: {} },
    },
    projectId: "PVT_project1",
    fields: {
      sprintFieldId: "PVTF_sprint",
      statusFieldId: "PVTF_status",
      storyPointsFieldId: "PVTF_points",
      priorityFieldId: "PVTF_priority",
      epicFieldId: null,
      assigneeFieldId: null,
      typeFieldId: "PVTF_type",
    },
    statusOptions: { "In Progress": "opt_ip" },
    priorityOptions: { "Must": "opt_must" },
    typeOptions: { feature: "opt_feature", bug: "opt_bug" },
    typeTemplatePaths: {},
    iterations: {
      active: { id: "IT_active", title: "Sprint 5", startDate: "2026-01-01", duration: 14 },
      next: { id: "IT_next", title: "Sprint 6", startDate: "2026-01-15", duration: 14 },
      completed: [],
      all: [],
    },
    ...overrides,
  };
}
```

---

## Phase 1 — Domain Unit Tests: `mimeTypeForPath()`

**New file:** `src/domain/content-location.test.ts`

Pure function — no file I/O, no network. Use `permissions: "none"` on every test to make the constraint machine-enforced. Any accidental I/O will cause an immediate test failure.

### Tests to implement

```ts
import { assertEquals } from "@std/assert";
import { mimeTypeForPath } from "./content-location.ts";

const opts = { permissions: "none" } as const;

Deno.test({ name: ".json → application/json", ...opts, fn() {
  assertEquals(mimeTypeForPath("template.json"), "application/json");
}});

Deno.test({ name: ".yml → application/x-yaml", ...opts, fn() {
  assertEquals(mimeTypeForPath("template.yml"), "application/x-yaml");
}});

Deno.test({ name: ".yaml → application/x-yaml", ...opts, fn() {
  assertEquals(mimeTypeForPath("template.yaml"), "application/x-yaml");
}});

Deno.test({ name: ".md → text/markdown", ...opts, fn() {
  assertEquals(mimeTypeForPath("README.md"), "text/markdown");
}});

Deno.test({ name: "unrecognized ext → text/markdown fallback", ...opts, fn() {
  assertEquals(mimeTypeForPath("foo.txt"), "text/markdown");
}});

Deno.test({ name: "no extension → text/markdown fallback", ...opts, fn() {
  assertEquals(mimeTypeForPath("Makefile"), "text/markdown");
}});

Deno.test({ name: "absolute path with .json", ...opts, fn() {
  assertEquals(mimeTypeForPath("/abs/path/file.json"), "application/json");
}});

Deno.test({ name: "URL pathname with .yml", ...opts, fn() {
  assertEquals(mimeTypeForPath("/owner/repo/main/.github/template.yml"), "application/x-yaml");
}});
```

### Verification

```bash
deno lint src/domain/content-location.test.ts
deno fmt --check src/domain/content-location.test.ts
deno task test
```

---

## Phase 2 — Split `template-resource.test.ts` Concerns

### 2a. Remove `buildTypeTemplatePaths()` and config-resolved tests

Delete the following from `src/scrum/template-resource.test.ts`:

1. The entire `buildTypeTemplatePaths()` helper function and its imports (`parse`, `dirname`, `resolve`, `resolveLocation`).
2. The `stubFileReader` const (it moves to `_test_utils.ts`, already done above).
3. The three tests: `"resolves user_story template from real config"`, `"resolves bug template from real config"`, `"resolves impediment template from real config"`.

After deletion, remove any imports that are no longer referenced: `@std/yaml`, `@std/path`, `resolveLocation`, `fetchContent`. Keep: `@std/assert`, `templateResourceUseCase`, `ContentLocation`, `SupportedMimeType`.

Replace the `stubFileReader` inline definition with an import from `./_test_utils.ts`:

```ts
import { stubFileReader } from "./_test_utils.ts";
```

### 2b. Add pure unit tests for file-kind and url-kind MIME resolution

Append these six tests to `src/scrum/template-resource.test.ts`. They use `stubFileReader` (returns `"stub content"` without any I/O) and test only the MIME branch of `templateResourceUseCase()`.

Reminder: MIME is resolved **after** `fetchContent()` returns (see MIME Resolution Order section above). The stub content value is irrelevant to these assertions.

```ts
// ── file-kind MIME resolution ─────────────────────────────────────────────────

Deno.test("templateResourceUseCase — file-kind .yml → application/x-yaml MIME", async () => {
  const paths: Record<string, ContentLocation> = {
    my_type: { kind: "file", path: "/some/path/template.yml" },
  };
  const result = await templateResourceUseCase("my_type", stubFileReader, paths);
  assertEquals(result.mimeType, "application/x-yaml" as SupportedMimeType);
});

Deno.test("templateResourceUseCase — file-kind .json → application/json MIME", async () => {
  const paths: Record<string, ContentLocation> = {
    my_type: { kind: "file", path: "/some/path/template.json" },
  };
  const result = await templateResourceUseCase("my_type", stubFileReader, paths);
  assertEquals(result.mimeType, "application/json" as SupportedMimeType);
});

Deno.test("templateResourceUseCase — file-kind .md → text/markdown MIME", async () => {
  const paths: Record<string, ContentLocation> = {
    my_type: { kind: "file", path: "/some/path/template.md" },
  };
  const result = await templateResourceUseCase("my_type", stubFileReader, paths);
  assertEquals(result.mimeType, "text/markdown" as SupportedMimeType);
});

// ── url-kind MIME resolution ──────────────────────────────────────────────────

Deno.test("templateResourceUseCase — url-kind .yml → application/x-yaml MIME", async () => {
  const paths: Record<string, ContentLocation> = {
    my_type: { kind: "url", url: new URL("https://raw.example.com/template.yml") },
  };
  const result = await templateResourceUseCase("my_type", stubFileReader, paths);
  assertEquals(result.mimeType, "application/x-yaml" as SupportedMimeType);
});

Deno.test("templateResourceUseCase — url-kind .json → application/json MIME", async () => {
  const paths: Record<string, ContentLocation> = {
    my_type: { kind: "url", url: new URL("https://raw.example.com/template.json") },
  };
  const result = await templateResourceUseCase("my_type", stubFileReader, paths);
  assertEquals(result.mimeType, "application/json" as SupportedMimeType);
});

Deno.test("templateResourceUseCase — url-kind .md → text/markdown MIME", async () => {
  const paths: Record<string, ContentLocation> = {
    my_type: { kind: "url", url: new URL("https://raw.example.com/template.md") },
  };
  const result = await templateResourceUseCase("my_type", stubFileReader, paths);
  assertEquals(result.mimeType, "text/markdown" as SupportedMimeType);
});
```

### 2c. Keep existing inline tests unchanged

The five existing inline tests stay:

- Inline template MIME (text/markdown)
- Inline YAML content
- Inline JSON content
- Type not in map throws
- Empty map throws

### Verification

```bash
deno lint src/scrum/template-resource.test.ts src/scrum/_test_utils.ts
deno fmt --check src/scrum/template-resource.test.ts src/scrum/_test_utils.ts
deno task test
```

All previously passing tests must still pass. Count should be: 5 existing inline/error tests + 6 new MIME tests = 11 tests in this file.

---

## Phase 4 — Full Pipeline Integration Test

**New file:** `src/scrum/template-pipeline.test.ts`

End-to-end: committed `config.yml` → `resolveLocation()` → real `fetchContent()` → `templateResourceUseCase()`. No GitHub client needed — reads the filesystem directly.

### Snapshot testing

Use `assertSnapshot` from `@std/testing/snapshot` for content assertions. On first run it writes golden `.snap` files under `__snapshots__/`. Subsequent runs diff against them. This catches template file regressions (accidental edits, wrong path resolution) that `assertStringIncludes` would miss.

To generate/update snapshots: `deno task test -- --update` (or `deno test --allow-read --update src/scrum/template-pipeline.test.ts`).

Commit the generated `__snapshots__/template-pipeline.test.ts.snap` file alongside the test.

### Implementation

```ts
// =============================================================================
// src/scrum/template-pipeline.test.ts
//
// Full pipeline integration: config.yml → resolveLocation → fetchContent →
// templateResourceUseCase. Reads the committed .github/scrum/config.yml and
// .github/ISSUE_TEMPLATE/ files directly. No GitHub client or network needed.
// =============================================================================

import { assertSnapshot } from "@std/testing/snapshot";
import { assertEquals } from "@std/assert";
import { templateResourceUseCase } from "./template-resource.ts";
import { typeTemplatePathsPromise, realFileReader } from "./_test_utils.ts";
import type { SupportedMimeType } from "../domain/content-location.ts";

// ── Per-type pipeline tests ───────────────────────────────────────────────────

Deno.test("pipeline: user_story config → resolve → fetch → use case", async (t) => {
  const paths = await typeTemplatePathsPromise;
  const result = await templateResourceUseCase("user_story", realFileReader, paths);
  assertEquals(result.mimeType, "application/x-yaml" as SupportedMimeType);
  await assertSnapshot(t, result.content);
});

Deno.test("pipeline: bug config → resolve → fetch → use case", async (t) => {
  const paths = await typeTemplatePathsPromise;
  const result = await templateResourceUseCase("bug", realFileReader, paths);
  assertEquals(result.mimeType, "application/x-yaml" as SupportedMimeType);
  await assertSnapshot(t, result.content);
});

Deno.test("pipeline: impediment config → resolve → fetch → use case", async (t) => {
  const paths = await typeTemplatePathsPromise;
  const result = await templateResourceUseCase("impediment", realFileReader, paths);
  assertEquals(result.mimeType, "application/x-yaml" as SupportedMimeType);
  await assertSnapshot(t, result.content);
});

// ── Structural correctness ────────────────────────────────────────────────────

Deno.test("pipeline: all resolved types have kind:file with existing path", async () => {
  const paths = await typeTemplatePathsPromise;
  for (const [type, loc] of Object.entries(paths)) {
    assertEquals(loc.kind, "file", `type "${type}" expected kind:file`);
    if (loc.kind === "file") {
      // Deno.stat throws NotFound if the path does not exist
      try {
        await Deno.stat(loc.path);
      } catch {
        throw new Error(`type "${type}" path does not exist: ${loc.path}`);
      }
    }
  }
});

Deno.test("pipeline: types without template field are absent from map", async () => {
  const paths = await typeTemplatePathsPromise;
  // Map must be non-empty (config has at least one type with a template).
  assertEquals(Object.keys(paths).length > 0, true, "expected at least one template in config");
  // Every resolved location must be kind:file — the committed config uses
  // relative file paths only. url/inline would indicate a bug in buildTypeTemplatePaths.
  for (const loc of Object.values(paths)) {
    assertEquals(loc.kind, "file");
  }
});
```

### First-run snapshot generation

After writing the test, run once with `--update` to generate the snapshot file:

```bash
deno test --allow-read --allow-env=GITHUB_TOKEN,NODE_ENV --update src/scrum/template-pipeline.test.ts
```

Then commit `src/scrum/__snapshots__/template-pipeline.test.ts.snap`.

### Verification

```bash
deno lint src/scrum/template-pipeline.test.ts
deno fmt --check src/scrum/template-pipeline.test.ts
deno task test
```

---

## Phase 5 — Fixes and Edge Cases in Existing Tests

These are correctness and portability fixes to existing test files. No new production code is changed.

### 5a. Fix import inconsistency across all test files

**Problem:** `story-mutation-service.test.ts`, `user-milestone-resolver.test.ts`, `story-query-service.test.ts`, and `pick-defined.test.ts` all import `jsr:@std/assert@^1.0.0` directly, bypassing the `deno.json` import map alias. If the version in `deno.json` is ever bumped, these four files won't track it.

**Fix:** In all four files, replace:

```ts
import { ... } from "jsr:@std/assert@^1.0.0";
```

with:

```ts
import { ... } from "@std/assert";
```

### 5b. Fix `/etc/shadow` platform portability (`fetch-location.test.ts`)

**Problem:** `/etc/shadow` does not exist on macOS — the test throws `NotFound` ("No such file or directory") instead of `"Permission denied"`, causing the test to fail on any macOS runner.

**Fix:** Add `ignore: Deno.build.os !== "linux"` to skip the test on non-Linux platforms. The test remains valuable on Linux CI.

```ts
Deno.test({
  name: "fetchContent — file branch throws on permission denied",
  ignore: Deno.build.os !== "linux",
  async fn() {
    const location: ContentLocation = {
      kind: "file",
      path: "/etc/shadow",
    };
    await assertRejects(
      () => fetchContent(location),
      Error,
      "Permission denied",
    );
  },
});
```

### 5c. Replace manual try/catch with `assertRejects` in 503 test (`fetch-location.test.ts`)

**Problem:** The "url branch error message includes status code" test uses a manual `threw` boolean and try/catch. Every other error test in the file uses `assertRejects`. The manual pattern is more verbose and does not fail loudly if the function unexpectedly doesn't throw (the `assertEquals(threw, true)` is easy to miss).

**Fix:** Rewrite using `assertRejects`. `assertRejects` returns the caught error, so you can assert on its message after the fact.

Replace the entire test body with:

```ts
Deno.test("fetchContent — url branch error message includes status code", async () => {
  await withTestServer(
    (_req) => new Response("Server Error", { status: 503 }),
    async (base) => {
      const location: ContentLocation = { kind: "url", url: new URL("/config.yml", base) };
      const err = await assertRejects(
        () => fetchContent(location),
        Error,
        "Cannot fetch",
      );
      assertStringIncludes(err.message, "503");
    },
  );
});
```

Note: this also applies the `withTestServer` helper from `_test_utils.ts` (see 5d below).

### 5d. Refactor URL branch tests to use `withTestServer` (`fetch-location.test.ts`)

**Problem:** All five URL branch tests repeat the same `Deno.serve / addr / try-finally / server.shutdown()` scaffold, differing only in the handler and assertions. This is ~8 lines of boilerplate per test.

**Fix:** Import `withTestServer` from `./_test_utils.ts` and rewrite all five URL tests. Example for the 200 success case:

```ts
import { withTestServer } from "./_test_utils.ts";

Deno.test("fetchContent — url branch fetches from local test server", async () => {
  const responseBody = "# fetched from server\ndata: ok\n";
  await withTestServer(
    () => new Response(responseBody, { status: 200 }),
    async (base) => {
      const location: ContentLocation = { kind: "url", url: new URL("/test.yml", base) };
      assertEquals(await fetchContent(location), responseBody);
    },
  );
});

Deno.test("fetchContent — url branch returns empty string on empty 200 response", async () => {
  await withTestServer(
    () => new Response("", { status: 200 }),
    async (base) => {
      const location: ContentLocation = { kind: "url", url: new URL("/empty.yml", base) };
      assertEquals(await fetchContent(location), "");
    },
  );
});

Deno.test("fetchContent — url branch throws on 404", async () => {
  await withTestServer(
    () => new Response("Not Found", { status: 404 }),
    async (base) => {
      const location: ContentLocation = { kind: "url", url: new URL("/missing.yml", base) };
      await assertRejects(() => fetchContent(location), Error, "Cannot fetch");
    },
  );
});

// Apply the same pattern to the 503 test (see 5c above).
// The connection-refused test does not use a server — keep it as-is.
```

### 5e. Add missing edge cases to `resolve-location.test.ts`

**Problem:** Two edge cases are untested: a `.ts` extension (which `resolveLocation` should reject, even though `fetchContent` accepts it), and an empty-string input.

**Add these two tests** to `src/scrum/resolve-location.test.ts`:

```ts
Deno.test("resolveLocation — .ts extension throws (unsupported)", () => {
  assertThrows(
    () => resolveLocation("fetch-location.ts", "/base"),
    Error,
    "Unsupported file extension",
  );
});

Deno.test("resolveLocation — empty string throws (unsupported file extension)", () => {
  // An empty string has no extension — resolveLocation should reject it.
  assertThrows(
    () => resolveLocation("", "/base"),
    Error,
  );
});
```

> **Note on the empty-string test:** verify the actual thrown message against the implementation before pinning an exact message substring. Use a bare `Error` assertion if the message is not guaranteed.

### 5f. Add missing edge cases to `pick-defined.test.ts`

**Problem:** `false` and `0` are falsy but defined — they should be included by `pickDefined`. There is no test for them. A key that is entirely absent from the object (not present at all, vs explicitly `undefined`) is also untested.

**Add these three tests** to `src/services/pick-defined.test.ts`:

```ts
Deno.test("pickDefined - includes false (falsy but defined)", () => {
  assertEquals(pickDefined({ a: false }, ["a"]), { a: false });
});

Deno.test("pickDefined - includes 0 (falsy but defined)", () => {
  assertEquals(pickDefined({ a: 0 }, ["a"]), { a: 0 });
});

Deno.test("pickDefined - skips key absent from object entirely", () => {
  const obj = { b: 1 } as Record<string, unknown>;
  assertEquals(pickDefined(obj, ["a", "b"]), { b: 1 });
});
```

### Verification for Phase 5

```bash
deno lint src/scrum/fetch-location.test.ts src/scrum/resolve-location.test.ts src/services/pick-defined.test.ts
deno fmt --check src/scrum/fetch-location.test.ts src/scrum/resolve-location.test.ts src/services/pick-defined.test.ts
deno task test
```

All previously passing tests must still pass. The `/etc/shadow` test will now be skipped on macOS instead of failing.

---

## Phase 6 — Adapter Test Refactoring

### 6a. Extract shared spy and config factory to `_test_utils.ts`

**Problem:** `story-mutation-service.test.ts` and `user-milestone-resolver.test.ts` each define their own `createGhSpy()`. Both are queue-based with identical logic. `story-query-service.test.ts` uses `{} as unknown as RuntimeConfig` to avoid building a full config, hiding future type errors.

**Fix:**

1. Create `src/adapters/github/internal/_test_utils.ts` with `createGhSpy()` and `makeConfig()` as documented in the Shared Test Utilities section above.

2. In `story-mutation-service.test.ts`:
   - Remove the local `createGhSpy` definition and `GitHubClientSpy` interface.
   - Remove the local `makeConfig` function.
   - Remove the `createServiceWithConfig` wrapper function — it is only called once. Replace the one call site with `createService({ configOverrides: { typeOptions: {} } })` inline.
   - Add at the top: `import { createGhSpy, makeConfig } from "./_test_utils.ts";`

3. In `user-milestone-resolver.test.ts`:
   - Remove the local `createGhSpy` definition and `GitHubClientSpy` interface.
   - Add at the top: `import { createGhSpy, type GitHubClientSpy } from "./_test_utils.ts";`

4. In `story-query-service.test.ts`:
   - Remove `mockConfig` and its `as unknown as RuntimeConfig` cast.
   - Add: `import { makeConfig } from "./_test_utils.ts";`
   - Replace every `mockConfig` reference with `makeConfig()`. The `buildDependencyMap` tests don't care about most fields, so the defaults from `makeConfig()` are sufficient.

### 6b. Improve `fieldCalls` method tracking in `story-mutation-service.test.ts`

**Problem:** All field mutator methods route through a single `recordCall` function, so tests can only assert that *a* call was made — not *which method* was called.

**Fix:** Replace the single `recordCall` with per-method recorders. Keep the `fieldCalls` array but record `{ method, args }` tuples:

```ts
const fieldCalls: Array<{ method: string; args: unknown[] }> = [];
const makeRecorder = (method: string) =>
  (...args: unknown[]): Promise<void> => {
    fieldCalls.push({ method, args });
    return Promise.resolve();
  };
const fieldValueMutator = {
  setFieldStatus: makeRecorder("setFieldStatus"),
  setFieldSprint: makeRecorder("setFieldSprint"),
  setFieldStoryPoints: makeRecorder("setFieldStoryPoints"),
  setFieldPriority: makeRecorder("setFieldPriority"),
  setFieldType: makeRecorder("setFieldType"),
  setFieldAssignee: makeRecorder("setFieldAssignee"),
  clearField: makeRecorder("clearField"),
} as unknown as FieldValueMutator;
```

Update the assertion in `"sets type field when typeFieldId is configured"` to verify the correct method:

```ts
const typeCall = fieldCalls.find((c) => c.method === "setFieldType");
assert(typeCall, "setFieldType should have been called");
assertEquals(typeCall.args[0], "PVTI_new1");
```

### Verification for Phase 6

```bash
deno lint src/adapters/github/internal/
deno fmt --check src/adapters/github/internal/
deno task test
```

All previously passing tests must still pass. Total test count must not decrease.

---

## Execution Order

```
src/scrum/_test_utils.ts                           → Create (prerequisite for phases 2, 4, 5d)
src/adapters/github/internal/_test_utils.ts        → Create (prerequisite for phase 6)
Phase 1  → src/domain/content-location.test.ts     (no deps)
Phase 2a → Remove 3 config tests from template-resource.test.ts
Phase 2b → Add 6 MIME unit tests to template-resource.test.ts
Phase 4  → src/scrum/template-pipeline.test.ts + snapshot generation
Phase 5  → Fixes to fetch-location, resolve-location, pick-defined (no deps, do in any order)
Phase 6  → Adapter test refactoring (depends on _test_utils.ts being created)
```

Phases 5 and 6 are independent of each other and of phases 1–4. They can be done in parallel with the pipeline work, or saved for a separate pass.

---

## File Inventory

| File | Action |
| --- | --- |
| `src/scrum/_test_utils.ts` | **Create** — `buildTypeTemplatePaths`, lazy promise, both reader stubs, `withTestServer` |
| `src/adapters/github/internal/_test_utils.ts` | **Create** — `createGhSpy`, `GitHubClientSpy`, `makeConfig` |
| `src/domain/content-location.test.ts` | **Create** — Phase 1, 8 tests with `permissions: "none"` |
| `src/scrum/template-resource.test.ts` | **Modify** — Phase 2a (remove 3 tests + helper + unused imports), Phase 2b (add 6 tests, import stubs from `_test_utils.ts`) |
| `src/scrum/template-pipeline.test.ts` | **Create** — Phase 4, 5 tests using `assertSnapshot` for content |
| `src/scrum/__snapshots__/template-pipeline.test.ts.snap` | **Generate** — first-run `--update`, then commit |
| `src/scrum/fetch-location.test.ts` | **Modify** — Phase 5b (`/etc/shadow` ignore), 5c (503 assertRejects), 5d (withTestServer refactor) |
| `src/scrum/resolve-location.test.ts` | **Modify** — Phase 5e (add `.ts` and empty-string tests) |
| `src/services/pick-defined.test.ts` | **Modify** — Phase 5f (add `false`, `0`, absent-key tests) |
| `src/adapters/github/internal/story-mutation-service.test.ts` | **Modify** — Phase 6a (import shared spy+config, remove local defs, inline createServiceWithConfig), 6b (per-method fieldCalls) |
| `src/adapters/github/internal/user-milestone-resolver.test.ts` | **Modify** — Phase 6a (import shared spy, remove local def) |
| `src/adapters/github/internal/story-query-service.test.ts` | **Modify** — Phase 6a (import makeConfig, remove unsafe cast) |
| `src/adapters/github/config-loader.ts` | **No change** |
| `deno.json` | **No change** — `@std/fs` avoided by using `Deno.stat` instead of `existsSync` |
