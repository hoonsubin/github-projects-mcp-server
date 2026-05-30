# Template & Config Location Resolution Refactor

## Problem Statements

1. **Local-only config loading.** [`config-loader.ts`](src/adapters/github/config-loader.ts) calls `Deno.readTextFile(configPath)` — a raw filesystem call that crashes on any remote URL passed via `--config`.
2. **Raw strings for template paths.** Template values in config `type_mapping` are untyped repo-relative strings (`".github/ISSUE_TEMPLATE/story.yml"`). There is no type-level signal about whether a path is local, remote, or inline — callers cannot reason about resolution behaviour.
3. **`--root` hides a design gap.** The `--root` / `-r` CLI flag exists solely to tell [`GitHubFileReader`](src/adapters/github/internal/file-reader.ts) where to anchor relative paths when `--config` points outside the working directory. It is an ergonomic workaround for the fact that the project root is never declared in the config file itself.
4. **No remote template support.** Template values cannot be URLs. A team that wants to share templates from a central repository has no way to express that in config.
5. **Hidden dispatch.** [`GitHubFileReader.fetchRepoFile()`](src/adapters/github/internal/file-reader.ts) silently tries the local filesystem first, then falls back to the GitHub Contents API — all from a single `string` parameter. The caller gets no visibility into which strategy will be used.
6. **No seam for future `scrum_orient` inline config.** The tool will eventually accept an inline YAML config argument. The current architecture has no `ContentLocation`-like type to represent "content that is already in memory."

---

## Objective Statements

1. **Introduce a unified `ContentLocation` discriminated union** (`kind: "file" | "url" | "inline"`) that replaces raw path strings throughout config and template resolution. Every path-carrying value becomes a self-describing algebraic type. Includes a `SupportedMimeType` union type so consumers remain type-safe about MIME types.
2. **Remove the `--root` CLI flag.** The project root is declared as `projRoot` in the config YAML, relative to the config file's directory. When absent, it defaults to the config file's directory.
3. **Move resolution and fetch to the use-case layer.** Two pure utilities — [`resolveLocation()`](src/scrum/resolve-location.ts) (`string → ContentLocation`) and [`fetchContent()`](src/scrum/fetch-location.ts) (`ContentLocation → string`) — live in `src/scrum/`. Every adapter imports them without adapter-to-adapter coupling.
4. **Scope the changes to the domain, use-case, and adapter layers, plus the composition root.** Values change in `src/domain/`, `src/scrum/`, `src/adapters/`, and `src/server.ts`. Tool handlers, schemas, and MCP tool surface are untouched.
5. **Keep FileReaderPort as the use-case contract.** The port interface is updated from `fetchRepoFile(path: string)` to `fetchContent(location: ContentLocation)`, but use-case functions continue to code against the port — they never import adapter internals.

---

## Architecture Overview

### Before (current state)

```
server.ts
  --config <string>  → passed as configPath: string
  --root   <string>  → passed as projectRoot: string

AdapterStartupOptions { configPath?: string; projectRoot?: string }

config-loader.ts
  Deno.readTextFile(configPath)            ← local filesystem only, crashes on URLs
  typeTemplatePaths: Record<string, string>  ← untyped repo-relative path strings

GitHubFileReader(owner, repo, localRoot)
  fetchRepoFile(path: string)
    → try Deno.readTextFile(localRoot + "/" + path)  ← silent local-first dispatch
    → catch → GitHub Contents API (base64 decoded)   ← hidden fallback

FileReaderPort { fetchRepoFile(path: string): Promise<string> }

PlatformState.vocabulary.typeTemplatePaths: Record<string, string>
BackendResult.typeTemplatePaths: Record<string, string>
```

### After (target state)

```
use-case layer (src/scrum/)
  resolveLocation(string, baseDir)          ← string → ContentLocation
  fetchContent(ContentLocation)             ← ContentLocation → string (no auth)

server.ts
  --config <string>
    → resolveLocation(string, Deno.cwd())
    → ContentLocation { kind: "file" | "url" }
    → AdapterStartupOptions.configLocation

config-loader.ts  (adapter)
  receives ContentLocation
  → fetchContent(configLocation)
  → parse YAML → ScrumConfig
  → compute baseDir from location
  → resolve projRoot (relative to baseDir, or baseDir itself)
  → resolveLocation(template, projectRoot) for each type_mapping entry
  → typeTemplatePaths: Record<string, ContentLocation>

GitHubFileReader(owner, repo, token)        ← token replaces localRoot
  fetchContent(location: ContentLocation)
    github.com URL → fetchGitHubBlobAsRaw() with auth header + owner/repo validation
    all others     → delegate to fetchContent(location)

FileReaderPort { fetchContent(location: ContentLocation): Promise<string> }

PlatformState.vocabulary.typeTemplatePaths: Record<string, ContentLocation>
BackendResult.typeTemplatePaths: Record<string, ContentLocation>
```

Both `resolveLocation` and `fetchContent` live at the use-case layer so every adapter imports them without adapter-to-adapter coupling. Each adapter wraps `fetchContent` with only its platform's auth logic for URLs on its domain.

### Files Changed

| File                                          | Change                                                                                                                    |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `src/domain/content-location.ts`              | **New** — `ContentLocation` type + `SupportedMimeType` + `describeContentLocation` + `mimeTypeForPath`                    |
| `src/scrum/resolve-location.ts`               | **New** — `resolveLocation(string, baseDir): ContentLocation`                                                             |
| `src/scrum/fetch-location.ts`                 | **New** — `fetchContent(ContentLocation): Promise<string>`                                                                |
| `src/scrum/resolve-location.test.ts`          | **New** — unit tests for `resolveLocation`                                                                                |
| `src/scrum/fetch-location.test.ts`            | **New** — unit tests for `fetchContent`                                                                                   |
| `src/scrum/testdata/sample.yml`               | **New** — fixture file for `fetchContent` file-branch test                                                                |
| `src/domain/config.ts`                        | Add `project.projRoot?: string`                                                                                           |
| `src/scrum/ports.ts`                          | `FileReaderPort` method rename+retype; `PlatformState.vocabulary.typeTemplatePaths` type                                  |
| `src/scrum/template-resource.ts`              | Parameter type, method call, `TemplateData.mimeType` typed as `SupportedMimeType`                                         |
| `src/scrum/orient.ts`                         | `buildTemplateUriMap` parameter type + import                                                                             |
| `src/adapters/factory.ts`                     | `AdapterStartupOptions`: remove `projectRoot`, rename `configPath→configLocation`; `BackendResult.typeTemplatePaths` type |
| `src/adapters/github/config-loader.ts`        | `ConfigParams`, `RuntimeConfig`, content fetch, baseDir, projRoot, template resolution                                    |
| `src/adapters/github/factory.ts`              | `GitHubFileReader` construction; `loadConfig` call                                                                        |
| `src/adapters/github/internal/file-reader.ts` | Rewrite: remove `localRoot`, add `token`, implement `fetchContent` with owner/repo validation                             |
| `src/adapters/github/internal/contents.ts`    | **Delete entirely** — only consumer is `file-reader.ts`; no other imports                                                 |
| `src/adapters/github/backend.ts`              | Verify `typeTemplatePaths` propagation (compile-time check only)                                                          |
| `src/server.ts`                               | Remove `--root`; resolve config to `ContentLocation`; remove `resolvePath` import                                         |

---

## Execution Phases

Steps are grouped by dependency. Phases must be completed in order; steps within a phase can be done in parallel.

```
Phase A — Domain foundation (no deps, ships atomically)
  Step 0    Pre-flight: audit FileReaderPort references in test files
  Step 1    New domain type: ContentLocation + SupportedMimeType
  Step 2    New use-case utility: resolveLocation
  Step 2a   Unit tests for resolveLocation
  Step 2b   New use-case utility: fetchContent
  Step 2c   Unit tests for fetchContent

Phase B — Port contract (depends on A)
  Step 3    Extend ScrumConfig.project with projRoot
  Step 4    Extend FileReaderPort (rename method, retype parameter)
  Step 5    Update AdapterStartupOptions and BackendResult

Phase C — Adapter implementation (depends on B)
  Step 6    Update config-loader.ts
  Step 7    Rewrite GitHubFileReader
  Step 7b   Delete contents.ts
  Step 8    Update template-resource.ts
  Step 9    Update orient.ts
  Step 10   Update PlatformState in ports.ts

Phase D — Composition root (depends on C)
  Step 11   Update server.ts
```

---

## Step-by-Step Implementation

### Step 0 — Pre-flight: audit `FileReaderPort` references in test files

Run:

```bash
grep -rn "FileReaderPort\|fetchRepoFile" src/ --include="*.test.ts"
```

**Expected result: zero hits.** No test file in this codebase stubs `FileReaderPort` or calls `fetchRepoFile`. The only relevant test fixture is `typeTemplatePaths: {}` at [`story-mutation-service.test.ts:146`](src/adapters/github/internal/story-mutation-service.test.ts#L146) — an empty object that type-checks correctly as either `Record<string, string>` (before) or `Record<string, ContentLocation>` (after). No test changes are required in Phase A.

If the grep returns unexpected hits, update each stub to implement `fetchContent(location: ContentLocation): Promise<string>` before proceeding.

---

### Step 1 — New domain type: `ContentLocation` + `SupportedMimeType`

**Before creating this file**, grep to confirm nothing similar exists:

```bash
grep -rn "ContentLocation\|ContentSource\|FileLocation\|TemplateLocation" src/
```

Expected: zero hits. Proceed only if confirmed.

**File to create:** `src/domain/content-location.ts`

```typescript
export const CONTENT_LOCATION_KINDS = ["file", "url", "inline"] as const;
export type ContentLocationKind = (typeof CONTENT_LOCATION_KINDS)[number];

export type ContentLocation =
  | { readonly kind: "file"; readonly path: string }
  | { readonly kind: "url"; readonly url: URL }
  | { readonly kind: "inline"; readonly content: string };

/**
 * Supported MIME types for template content resources.
 * Narrow union — not unconstrained string. Consumers that match on this
 * get exhaustiveness checking; adding a new MIME type requires updating
 * all match sites that must handle it.
 */
export type SupportedMimeType =
  | "text/markdown"
  | "application/json"
  | "application/x-yaml";

/** Human-readable representation for error messages. */
export const describeContentLocation = (loc: ContentLocation): string => {
  switch (loc.kind) {
    case "file":
      return loc.path;
    case "url":
      return loc.url.toString();
    case "inline":
      return "<inline content>";
  }
};

/**
 * Infer a MIME type from a file extension for MCP resource Content-Type.
 * Falls back to "text/markdown" for unrecognized extensions.
 */
export const mimeTypeForPath = (p: string): SupportedMimeType => {
  const ext = p.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "json":
      return "application/json";
    case "yml":
    case "yaml":
      return "application/x-yaml";
    default:
      return "text/markdown";
  }
};
```

**Why domain layer:** `ContentLocation` is a value the use-case layer reasons about. It is not infrastructure — it does no I/O. `describeContentLocation` and `mimeTypeForPath` are pure functions on the domain type and belong here to avoid duplication across consumers. `SupportedMimeType` is a domain-level union: the set of MIME types the system can serve is a domain constraint, not an adapter detail. Consumers that use `mimeTypeForPath` get a narrow, honest return type rather than the unconstrained `string`.

**Naming choice:** The type is named `ContentLocation` — it represents the location of _any_ content (config files, templates, inline strings) that the system fetches and serves. This generalizes cleanly to config files (`configLocation: ContentLocation`) without the confusion that a name like `TemplateLocation` would cause when used for non-template data.

---

### Step 2 — New use-case utility: `resolveLocation`

**File to create:** `src/scrum/resolve-location.ts`

Use named imports consistent with the rest of the codebase (e.g. `server.ts` uses `import { resolve as resolvePath } from "@std/path"`):

```typescript
import { extname, isAbsolute, resolve } from "@std/path";
import type { ContentLocation } from "../domain/content-location.ts";

export const SUPPORTED_TEMPLATE_EXTENSIONS = [".md", ".json", ".yml", ".yaml"] as const;
export type SupportedTemplateExtension = (typeof SUPPORTED_TEMPLATE_EXTENSIONS)[number];

/**
 * Resolve a raw string (from config YAML or a CLI arg) to a ContentLocation.
 *
 * Resolution rules:
 *   - Starts with "http://" or "https://"  → { kind: "url", url: new URL(input) }
 *   - isAbsolute(input)                    → { kind: "file", path: input }
 *   - otherwise                            → { kind: "file", path: resolve(baseDir, input) }
 *
 * @param input   Raw string from config or CLI.
 * @param baseDir Absolute directory to anchor relative paths against.
 * @throws {Error} if the resolved path or URL has an unsupported file extension.
 */
export const resolveLocation = (
  input: string,
  baseDir: string,
): ContentLocation => {
  if (input.startsWith("https://") || input.startsWith("http://")) {
    const url = new URL(input);
    const ext = extname(url.pathname);
    if (!SUPPORTED_TEMPLATE_EXTENSIONS.includes(ext as SupportedTemplateExtension)) {
      throw new Error(
        `Unsupported file extension "${ext}" in URL: ${input}. ` +
          `Supported extensions: ${SUPPORTED_TEMPLATE_EXTENSIONS.join(", ")}`,
      );
    }
    return { kind: "url", url };
  }

  const resolved = isAbsolute(input) ? input : resolve(baseDir, input);
  const ext = extname(resolved);
  if (!SUPPORTED_TEMPLATE_EXTENSIONS.includes(ext as SupportedTemplateExtension)) {
    throw new Error(
      `Unsupported file extension "${ext}" in path: ${resolved}. ` +
        `Supported extensions: ${SUPPORTED_TEMPLATE_EXTENSIONS.join(", ")}`,
    );
  }
  return { kind: "file", path: resolved };
};
```

**Extension guard:** This is the only place extension validation lives. Do not duplicate it in `config-loader.ts` or `server.ts`.

**Why use-case layer:** Knows about `ContentLocation` and supported-extension rules, but does no I/O. Consistent with `@std/path` already used in `server.ts`.

---

### Step 2a — Unit tests for `resolveLocation`

**File to create:** `src/scrum/resolve-location.test.ts`

`resolveLocation` is pure — test it exhaustively before it flows into `config-loader.ts`.

| Input                                | `baseDir`       | Expected                                                           |
| ------------------------------------ | --------------- | ------------------------------------------------------------------ |
| `".github/scrum/config.yml"`         | `/home/project` | `{ kind: "file", path: "/home/project/.github/scrum/config.yml" }` |
| `"/absolute/path/config.yml"`        | `/home/project` | `{ kind: "file", path: "/absolute/path/config.yml" }`              |
| `"https://example.com/config.yml"`   | any             | `{ kind: "url", url: new URL("https://example.com/config.yml") }`  |
| `"http://example.com/config.yml"`    | any             | `{ kind: "url", url: new URL("http://example.com/config.yml") }`   |
| `"relative/template.md"`             | `/home/project` | `{ kind: "file", path: "/home/project/relative/template.md" }`     |
| `"./config.json"`                    | `/home/project` | `{ kind: "file", path: "/home/project/config.json" }`              |
| `"template.txt"`                     | any             | throws — unsupported extension                                     |
| `"https://example.com/template.txt"` | any             | throws — unsupported extension                                     |

---

### Step 2b — New use-case utility: `fetchContent`

**File to create:** `src/scrum/fetch-location.ts`

```typescript
import type { ContentLocation } from "../domain/content-location.ts";

/**
 * Fetch content from wherever a ContentLocation points.
 * Pure dispatch — no adapter dependencies, no auth.
 *
 * Security note: the URL branch issues a plain unauthenticated fetch.
 * Callers are responsible for ensuring the URL originates from trusted
 * operator input (CLI or config file), not from user-supplied tool arguments.
 * GitHubFileReader wraps this for github.com URLs with an auth header.
 */
export const fetchContent = async (
  location: ContentLocation,
): Promise<string> => {
  switch (location.kind) {
    case "file":
      return Deno.readTextFile(location.path);
    case "inline":
      return location.content;
    case "url": {
      const res = await fetch(location.url);
      if (!res.ok) throw new Error(`Cannot fetch ${location.url}: ${res.status}`);
      return res.text();
    }
  }
};
```

**Why use-case layer:** `resolveLocation` converts `string → ContentLocation`; `fetchContent` converts `ContentLocation → string`. Together they form the resolution + retrieval pipeline. `config-loader.ts` imports `fetchContent` directly (not through `FileReaderPort`) because config loading happens before `FileReaderPort` implementors exist.

---

### Step 2c — Unit tests for `fetchContent`

**File to create:** `src/scrum/fetch-location.test.ts`

**Important — test task permissions:** `deno task test` runs with `--allow-read --allow-net` but **not** `--allow-write`. Do not use `Deno.makeTempFile` or `Deno.writeTextFile` in these tests — they will fail under the existing task.

Instead, create a committed fixture file:

**File to create:** `src/scrum/testdata/sample.yml`

```yaml
# Test fixture for fetch-location.test.ts — do not delete
project:
  name: test-project
```

Then reference it by its known path in the test.

| Input                                                     | Expected outcome                                               |
| --------------------------------------------------------- | -------------------------------------------------------------- |
| `{ kind: "file", path: "src/scrum/testdata/sample.yml" }` | returns the fixture file content                               |
| `{ kind: "inline", content: "raw: yaml" }`                | returns `"raw: yaml"` as-is                                    |
| `{ kind: "url", url: <test server URL> }`                 | returns the test server's response body                        |
| `{ kind: "url", url: <404 URL> }`                         | throws `Error` containing `"Cannot fetch"` and the status code |

For the `url` branch, spin up a lightweight `Deno.serve` listener on an ephemeral port. Use `{ hostname: "127.0.0.1", port: 0 }` so the OS assigns a free port. Shut it down in test teardown with `server.shutdown()`.

---

### Step 3 — Extend `ScrumConfig.project` with `projRoot`

**File to edit:** [`src/domain/config.ts`](src/domain/config.ts)

Add one optional field to the existing `project` object (line 56):

```typescript
project: {
  name: string;
  projRoot?: string; // Relative to config file's directory. Absent = use config file's directory.
  agent?: { ... };
  team?: [ ... ];
}
```

**Downstream effect:** Only `config-loader.ts` reads this field. No other code is affected.

---

### Step 4 — Extend `FileReaderPort`

**File to edit:** [`src/scrum/ports.ts`](src/scrum/ports.ts) (around line 347)

```typescript
// BEFORE
export interface FileReaderPort {
  fetchRepoFile(path: string): Promise<string>;
}

// AFTER
import type { ContentLocation } from "../domain/content-location.ts";

export interface FileReaderPort {
  /** Fetch content from any location: file, URL, or inline data. */
  fetchContent(location: ContentLocation): Promise<string>;
}
```

**Method renamed to `fetchContent`:** The old name `fetchRepoFile` implied repository-scoped file access. The new name reflects that this port fetches content from any location (file, URL, or inline). This aligns with the use-case utility `fetchContent` in `src/scrum/fetch-location.ts`.

**Downstream compile errors to follow:**

- `src/scrum/template-resource.ts` — calls `fileReader.fetchRepoFile(path)` → update to `fileReader.fetchContent(location)` in Step 8
- `src/adapters/github/internal/file-reader.ts` — implements old interface → Step 7
- TypeScript will surface every remaining call site. Follow the errors in order.

---

### Step 5 — Update `AdapterStartupOptions` and `BackendResult`

**File to edit:** [`src/adapters/factory.ts`](src/adapters/factory.ts)

```typescript
import type { ContentLocation } from "../domain/content-location.ts";

// BEFORE
export interface AdapterStartupOptions {
  readonly configPath?: string;
  readonly projectRoot?: string;
}

// AFTER
export interface AdapterStartupOptions {
  /**
   * Where to load the scrum config from.
   * undefined → adapter uses its default: { kind: "file", path: ".github/scrum/config.yml" }
   */
  readonly configLocation?: ContentLocation;
}
```

Also update `BackendResult.typeTemplatePaths`:

```typescript
// BEFORE
readonly typeTemplatePaths: Record<string, string>;

// AFTER
readonly typeTemplatePaths: Record<string, ContentLocation>;
```

**Downstream effects:** `src/adapters/github/factory.ts` reads `options?.configPath` and `options?.projectRoot` → update in Step 7. `src/server.ts` passes `{ configPath, projectRoot }` → update in Step 11.

---

### Step 6 — Update `config-loader.ts`

**File to edit:** [`src/adapters/github/config-loader.ts`](src/adapters/github/config-loader.ts)

**A. Update `ConfigParams`:**

```typescript
// BEFORE
interface ConfigParams {
  github: GitHubClient;
  configPath?: string;
}

// AFTER
interface ConfigParams {
  github: GitHubClient;
  configLocation?: ContentLocation;
}
```

**B. Update `RuntimeConfig.typeTemplatePaths`:**

```typescript
typeTemplatePaths: Record<string, ContentLocation>;
```

**C. Replace `Deno.readTextFile(configPath)` with `fetchContent`:**

```typescript
import { fetchContent } from "../../../scrum/fetch-location.ts";
import { resolveLocation } from "../../../scrum/resolve-location.ts";
import { describeContentLocation } from "../../../domain/content-location.ts";
import { dirname, resolve } from "@std/path";
```

Replace the existing `rawYml = await Deno.readTextFile(configPath)` block:

```typescript
const configLocation: ContentLocation = params.configLocation ?? {
  kind: "file",
  path: resolve(Deno.cwd(), ".github/scrum/config.yml"),
};

let rawYml: string;
try {
  rawYml = await fetchContent(configLocation);
} catch (err) {
  throw new Error(
    `Cannot read config at '${describeContentLocation(configLocation)}': ${
      err instanceof Error ? err.message : String(err)
    }. ` +
      `Ensure the server is started from the project root, or pass --config <path>.`,
  );
}
```

Replace all remaining `configPath` string references in error messages (lines 374, 380, 382, 384, 388, 413, 420, 422, 430, 477, 495) with `describeContentLocation(configLocation)`.

**D. Compute `baseDir` after fetching:**

```typescript
const baseDir: string = (() => {
  switch (configLocation.kind) {
    case "file":
      return dirname(configLocation.path);
    case "url":
      return dirname(configLocation.url.pathname);
    case "inline":
      return Deno.cwd();
  }
})();
```

**Corner case — URL-sourced configs:** When `configLocation.kind === "url"`, `baseDir` is the pathname directory portion only (e.g. `"/configs/"` for `https://example.com/configs/scrum.yml`). `path.resolve(baseDir, relativeTemplate)` will produce a local filesystem path that almost certainly does not exist. This means: **relative template paths in a URL-sourced config will not work unless `projRoot` in the YAML points to a valid local directory.** This is an intentional constraint — the verification checklist confirms the behaviour (item 7).

**E. Resolve `projectRoot` from config:**

```typescript
const projectRoot = parsedConfig.project.projRoot
  ? resolve(baseDir, parsedConfig.project.projRoot)
  : baseDir;
```

**F. Build `typeTemplatePaths` as `Record<string, ContentLocation>`:**

```typescript
const typeTemplatePaths: Record<string, ContentLocation> = {};
if (patchedGhConfig.type_mapping) {
  for (const [key, entry] of Object.entries(patchedGhConfig.type_mapping)) {
    if (entry.template) {
      typeTemplatePaths[key] = resolveLocation(entry.template, projectRoot);
    }
  }
}
```

---

### Step 7 — Rewrite `GitHubFileReader`

**File to edit:** [`src/adapters/github/internal/file-reader.ts`](src/adapters/github/internal/file-reader.ts)

**Delete the entire file contents** and replace with:

```typescript
import { fetchContent } from "../../../scrum/fetch-location.ts";
import type { ContentLocation } from "../../../domain/content-location.ts";
import type { FileReaderPort } from "../../../scrum/ports.ts";

export class GitHubFileReader implements FileReaderPort {
  constructor(
    private readonly owner: string,
    private readonly repo: string,
    private readonly token: string,
  ) {}

  async fetchContent(location: ContentLocation): Promise<string> {
    if (location.kind === "url" && location.url.hostname === "github.com") {
      return this.fetchGitHubBlobAsRaw(location.url);
    }
    return fetchContent(location);
  }

  private async fetchGitHubBlobAsRaw(blobUrl: URL): Promise<string> {
    // Convert: https://github.com/{owner}/{repo}/blob/{branch}/{path}
    //      to: https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{path}
    //
    // Validation: the blob URL's owner and repo MUST match this adapter's
    // configured owner and repo. Cross-repo blob URLs in template config
    // are rejected with a clear error.
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
    if (!res.ok) throw new Error(`GitHub raw fetch failed for ${rawUrl}: ${res.status}`);
    return res.text();
  }
}
```

**In `src/adapters/github/factory.ts`** — replace the file-reader construction block (around line 137–141):

```typescript
// BEFORE
const localRoot = options?.projectRoot ?? Deno.cwd();
const fileReader = new GitHubFileReader(owner, primaryRepo, localRoot);

// AFTER
const fileReader = new GitHubFileReader(owner, primaryRepo, gh.auth.token);
```

`gh.auth.token` here is already the resolved value — `loadConfig` expands `$ENV_VAR` references and returns a patched config object with literal strings. No additional `Deno.env.get()` call is needed.

Also update the `loadConfig` call (around line 46–49):

```typescript
const config = await loadConfig({
  github: { graphql },
  configLocation: options?.configLocation, // was: configPath: options?.configPath
});
```

**Behavioural change vs. the old implementation:** The old `GitHubFileReader` used the GitHub Contents API (`GET /repos/{owner}/{repo}/contents/{path}`) which returns base64-encoded content. The new `fetchGitHubBlobAsRaw` fetches from `raw.githubusercontent.com` which returns plain text. The Contents API approach only accepted repo-relative paths; the new approach requires a full `github.com/…/blob/…` URL in config. This is intentional — the new system is explicit about what it fetches.

---

### Step 7b — Delete `contents.ts`

**File to delete:** `src/adapters/github/internal/contents.ts`

`contents.ts` exports only `fetchRepoFile`. Its sole consumer is `file-reader.ts`. After Step 7, `file-reader.ts` no longer imports it. The file, its `RepoFileResponse` type, `decodeRepoFileContent` helper, and all its imports (`GitHubApiError`, `rest`) are entirely dead.

Verify before deleting:

```bash
grep -rn "from.*contents" src/
```

Expected: zero hits (since `file-reader.ts` was already rewritten). Then delete the file.

---

### Step 8 — Update `template-resource.ts`

**File to edit:** [`src/scrum/template-resource.ts`](src/scrum/template-resource.ts)

**Check before writing:** Look at `TemplateData` interface at lines 14–17. Its `mimeType` field is currently typed as the literal `"text/markdown"`. This must be updated to `SupportedMimeType` because `mimeTypeForPath` returns that narrow union. Failure to do this causes a TypeScript compile error: `Type 'SupportedMimeType' is not assignable to type '"text/markdown"'`.

```typescript
import type { FileReaderPort } from "./ports.ts";
import type { ContentLocation, SupportedMimeType } from "../domain/content-location.ts";
import { mimeTypeForPath } from "../domain/content-location.ts";

interface TemplateData {
  content: string;
  /** MIME type for the template resource. Narrow union — not unconstrained string. */
  mimeType: SupportedMimeType;
}

export const templateResourceUseCase = async (
  type: string,
  fileReader: FileReaderPort,
  typeTemplatePaths: Record<string, ContentLocation>,
): Promise<TemplateData> => {
  const location = typeTemplatePaths[type];
  if (!location) {
    throw new Error(
      `No template declared for type "${type}". ` +
        `Add a template path to type_mapping.${type} in your backend config, ` +
        `or read vocabulary.template_uris from scrum_orient to see which types have templates.`,
    );
  }
  const content = await fileReader.fetchContent(location);
  const mimeType: SupportedMimeType = location.kind === "inline"
    ? "text/markdown"
    : location.kind === "file"
    ? mimeTypeForPath(location.path)
    : mimeTypeForPath(location.url.pathname);
  return { content, mimeType };
};
```

**Why `SupportedMimeType` over `string`:** `mimeTypeForPath` returns exactly three values (`"text/markdown" | "application/json" | "application/x-yaml"`). Widening to `string` is a primitive-obsession regression (T5) — it loses type safety and permits invalid values. The explicit `: SupportedMimeType` annotation on the ternary ensures that if a future extension adds a new MIME type to `mimeTypeForPath`, this assignment will still type-check (since all branches return valid `SupportedMimeType` values).

---

### Step 9 — Update `orient.ts`

**File to edit:** [`src/scrum/orient.ts`](src/scrum/orient.ts)

`buildTemplateUriMap` at line 30 receives `typeTemplatePaths` from `state.vocabulary.typeTemplatePaths` (passed at line 187). After Step 10 updates `PlatformState.vocabulary.typeTemplatePaths` to `Record<string, ContentLocation>`, this function's parameter type must match. The truthy check `if (typeTemplatePaths[type])` continues to work — a `ContentLocation` object is truthy.

```typescript
// BEFORE
const buildTemplateUriMap = (typeTemplatePaths: Record<string, string>): TemplateUriMap | null => {

// AFTER
import type { ContentLocation } from "../domain/content-location.ts";

const buildTemplateUriMap = (typeTemplatePaths: Record<string, ContentLocation>): TemplateUriMap | null => {
```

No logic change — only the type annotation and import.

---

### Step 10 — Update `PlatformState` in `ports.ts`

**File to edit:** [`src/scrum/ports.ts`](src/scrum/ports.ts) (around line 159–166)

```typescript
// BEFORE
readonly vocabulary: {
  readonly statusDisplay: DisplayMap;
  readonly priorityDisplay: DisplayMap;
  readonly typeDisplay: DisplayMap;
  /** Repo-relative template file paths, keyed by canonical type key. Only keys with a
   *  declared template are present. Empty when no templates are configured. */
  readonly typeTemplatePaths: Record<string, string>;
};

// AFTER
readonly vocabulary: {
  readonly statusDisplay: DisplayMap;
  readonly priorityDisplay: DisplayMap;
  readonly typeDisplay: DisplayMap;
  /** Template locations keyed by canonical type key. Only keys with a declared
   *  template are present. Empty when no templates are configured. */
  readonly typeTemplatePaths: Record<string, ContentLocation>;
};
```

Add the import at the top of `ports.ts`:

```typescript
import type { ContentLocation } from "../domain/content-location.ts";
```

**Backend propagation:** [`backend.ts:220`](src/adapters/github/backend.ts#L220) passes `this.deps.config.typeTemplatePaths` into `PlatformState.vocabulary`. Since `config.typeTemplatePaths` is now `Record<string, ContentLocation>`, this propagates automatically — no logic change needed. The compiler confirms the types flow correctly.

---

### Step 11 — Update `server.ts`

**File to edit:** [`src/server.ts`](src/server.ts)

**A. Remove `--root` / `-r` entirely:**

- Remove `"root"` from the `string: [...]` array in `parseArgs` options (line 63)
- Remove `r: "root"` from the `alias: {...}` object (line 64)
- Remove the `_projectRoot` variable (lines 113–115)
- Remove `--root, -r` from the help text string (around line 79–81 and the example at lines 97–101)
- Remove `projectRoot` from `createMcpServer`, `runHttp`, and `runStdio` signatures (lines 240–241, 335–336, 362)

**B. Remove the now-unused `resolvePath` import:**

```typescript
// BEFORE (line 39)
import { resolve as resolvePath } from "@std/path";

// AFTER — delete this line entirely
// resolvePath was only used for _configPath and _projectRoot; resolveLocation replaces both
```

**C. Add new imports:**

```typescript
import { resolveLocation } from "./scrum/resolve-location.ts";
import { describeContentLocation } from "./domain/content-location.ts";
import type { ContentLocation } from "./domain/content-location.ts";
```

**D. Resolve `--config` to a `ContentLocation`:**

```typescript
// BEFORE (lines 109–111)
const _configPath: string | undefined = _cliArgs.config
  ? resolvePath(Deno.cwd(), _cliArgs.config)
  : undefined;

// AFTER
const _configLocation: ContentLocation | undefined = _cliArgs.config
  ? resolveLocation(_cliArgs.config, Deno.cwd())
  : undefined;
```

**E. Pass `configLocation` through the call chain:**

```typescript
// createMcpServer signature
const createMcpServer = async (configLocation?: ContentLocation): Promise<McpServer> => {

// createBackend call
backendResult = await createBackend(factories, { configLocation });

// error hint
} else if (_configLocation) {
  hint = `Config not found or invalid at: ${describeContentLocation(_configLocation)}`;
```

**F. Update `runHttp` and `runStdio` signatures:**

Both currently accept `(configPath?: string, projectRoot?: string)`. Change to `(configLocation?: ContentLocation)` and thread through to `createMcpServer`.

**G. Migration note:** The `--root` / `-r` flag is removed with no deprecation period. Any script or Claude Desktop config that passes `--root` will receive an "unknown flag" error. Release notes should include: _"The `--root` / `-r` CLI flag has been removed. Use `projRoot` in the config YAML instead. Template paths in `type_mapping` now accept full URLs in addition to local paths — repo-relative paths must be replaced with `https://github.com/{owner}/{repo}/blob/{branch}/{path}` URLs."_

---

## Cross-Cutting Concerns

### `_deno-shim.node.ts`

The Node.js shim at [`_deno-shim.node.ts`](src/_deno-shim.node.ts) already provides `Deno.readTextFile` as a bridge to `node:fs/promises readFile`. Any code calling `Deno.readTextFile` — including the new `fetchContent` — is automatically covered in the Node.js bundle. No shim changes are needed.

### `ConfigReloader`

[`ConfigReloader.reload()`](src/adapters/github/internal/config-reloader.ts#L19) calls `loadConfig({ github: this.github })` with no `configLocation`. After the refactor, `loadConfig` defaults to:

```typescript
{ kind: "file", path: resolve(Deno.cwd(), ".github/scrum/config.yml") }
```

This is intentional. `ConfigReloader` refreshes live GitHub field metadata (iterations, option IDs) — it does not re-fetch the config YAML. Remote config sources are immutable from the reloader's perspective. If reloading from a remote config is needed later, store the original `configLocation` in `ConfigReloader` and pass it through.

### Security: unauthenticated `fetchContent` for URLs

`fetchContent` issues a plain `fetch` for URL locations — no auth. This is correct for config files (operator-controlled, CLI-supplied) and for public template URLs. If a `github.com` URL reaches `fetchContent` directly (bypassing `GitHubFileReader`), it would attempt an unauthenticated fetch and likely receive a 404. This is acceptable: the only caller that passes `github.com` URLs at runtime is `GitHubFileReader.fetchContent`, which intercepts them before calling `fetchContent`. `config-loader.ts` calls `fetchContent` directly for the config file itself — if the config lives in a private GitHub repo, the operator must supply a raw URL with a token in the query string or use a local file.

### `fetchContent` sharing

Both `config-loader.ts` and `GitHubFileReader` import `fetchContent` from `src/scrum/fetch-location.ts`. This eliminates duplication. Each adapter wraps `fetchContent` with only its platform's auth logic — a hypothetical `TrelloFileReader` would intercept `trello.com` URLs and delegate everything else to `fetchContent`.

### Owner/repo validation in `GitHubFileReader`

The new `fetchGitHubBlobAsRaw` validates that the blob URL's owner and repo match the adapter's configured `this.owner` and `this.repo`. A cross-repo URL produces a clear error. This prevents accidental token misuse: if a config file from project A is used with project B's token, and a template URL points to repo A, the mismatch is caught at fetch time rather than producing a confusing 401/404.

---

## Verification Checklist

### 0. Lint and format

```bash
deno lint
deno fmt --check
```

Zero warnings, no unformatted files. Per [`AGENT.md`](AGENT.md), lint must pass before marking any task complete.

### 1. TypeScript compiles clean

```bash
deno check src/server.ts
```

Zero type errors. Follow the compiler's error trail in order — it points to every affected call site.

### 2. All existing tests still pass

```bash
deno task test
```

No regressions.

### 3. New unit tests pass

```bash
deno test src/scrum/resolve-location.test.ts src/scrum/fetch-location.test.ts
```

All cases from Steps 2a and 2c must pass before merging Phase A.

### 4. Local file path (default behaviour preserved)

Start the server with no flags. Confirm it loads `.github/scrum/config.yml` from the working directory and `scrum_orient` returns template URIs if templates are configured.

### 5. Explicit local path via `--config`

```bash
deno run --allow-all src/server.ts --config /absolute/path/to/config.yml
```

Confirm templates resolve relative to the config file's directory, not CWD.

### 6. Relative path via `--config`

```bash
deno run --allow-all src/server.ts --config ../../some/other/project/scrum.yml
```

Confirm templates resolve relative to the resolved config directory, not CWD.

### 7. `projRoot` override

Add `projRoot: "templates/"` to the `project` section of a test config. Place templates under `templates/` relative to the config file. Confirm they resolve correctly.

### 8. `--root` flag is gone

```bash
deno run --allow-all src/server.ts --root .
```

Should print an unknown-flag error. Confirm it does NOT start the server.

### 9. Remote GitHub template URL

In `type_mapping`, set one template to a full GitHub blob URL:

```yaml
template: "https://github.com/{owner}/{repo}/blob/main/.github/ISSUE_TEMPLATE/story.yml"
```

Call `scrum://template/user_story`. Confirm the file content is returned (requires valid token and repo access).

### 10. Error messages are readable

```bash
deno run --allow-all src/server.ts --config /no/such/file.yml
```

Confirm the error includes the path string, not `[object Object]`.

### 11. `ConfigReloader` still works

After the server starts, make a change on the GitHub board (rename an iteration). Call `scrum_orient`. Confirm the reloader picks up the change without re-fetching the config YAML.

### 12. `contents.ts` is gone and nothing broke

```bash
grep -rn "from.*contents" src/
```

Expected: zero hits. The compile step (item 1) already confirms no imports reference the deleted file.

### 13. Cross-repo template URL is rejected

In `type_mapping`, set a template URL pointing to a different repository than the configured one:

```yaml
template: "https://github.com/other-org/other-repo/blob/main/template.md"
```

Call `scrum://template/user_story`. Confirm the error message includes "owner/repo mismatch" and the expected/actual values.

---

## Future Extension Points (Do Not Implement Now)

**`scrum_orient` inline config arg:** To support passing raw YAML to `scrum_orient`, the tool handler would construct:

```typescript
{ kind: "inline", content: rawYaml } satisfies ContentLocation
```

and pass it as `configLocation`. Template relative paths in inline configs require `projRoot` to be declared explicitly in the YAML — they cannot be inferred from CWD alone.

**Non-GitHub remote config:** The plain `fetch` in `fetchContent` already handles any HTTPS URL for config files. No further work needed.

**Non-GitHub template URLs:** `GitHubFileReader.fetchContent` already handles non-GitHub hostnames with a plain `fetchContent` fallback. Authenticated non-GitHub remotes are out of scope.
