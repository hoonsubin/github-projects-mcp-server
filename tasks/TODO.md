# Template & Config Location Resolution Refactor

> **Goal:** Replace the hard-coded local filesystem assumption in config and template loading with a unified `TemplateLocation` ADT that supports local files, remote URLs, and inline content. Remove the `--root` CLI flag. Make the "project root" self-describing from the config file itself.
>
> **Scope:** `src/domain/`, `src/scrum/`, `src/adapters/factory.ts`, `src/adapters/github/` internals, `src/server.ts`. No changes to tool handlers, use-case functions (except `template-resource.ts`), or the MCP tool surface.
>
> **Unchanged:** `src/tools/` (all tool handlers), `src/schemas/`, `src/scrum/find-items.ts`, `src/scrum/get-analytics.ts`, `src/scrum/get-board-health.ts`, `src/scrum/get-story.ts`, `src/scrum/listing-mappers.ts`, `src/scrum/update-impediment.ts`, `src/scrum/sprint-math.ts`, `src/scrum/config-helpers.ts`, `src/adapters/github/backend.ts` (logic unchanged), `src/adapters/github/internal/contents.ts`, `src/adapters/github/internal/story-mutation-service.ts`, `src/adapters/github/internal/story-query-service.ts`, `src/adapters/abstract-backend.ts`, `src/domain/types.ts`, `src/domain/errors.ts`, `src/services/`.

---

## Background & Motivation

### Current behaviour

Config loading (`config-loader.ts`) reads the YAML config with `Deno.readTextFile(configPath)` - a raw local-path string hardwired to the filesystem. Template paths declared in `type_mapping[key].template` are stored as raw repo-relative strings (e.g. `".github/ISSUE_TEMPLATE/story.yml"`). When the server resolves them to actual files, `GitHubFileReader` prepends a `localRoot` string and tries the local filesystem first, then falls back silently to the GitHub Contents API.

The `--root` / `-r` CLI flag exists solely to tell `GitHubFileReader` where to anchor relative paths when `--config` points outside the working directory. This is an ergonomic workaround for a design gap: the server doesn't know where "the project" lives unless you tell it explicitly.

### Why this needs to change

1. **No remote config support.** Passing a URL to `--config` crashes at `Deno.readTextFile`.
2. **No remote template support via URL.** Template values can only be local repo-relative paths. A team wanting to share templates from a central repository can't express that in config.
3. **`--root` is confusing.** Users have to know to pass it when `--config` is a non-standard path. The config file itself should declare where the project root is.
4. **Hidden dispatch.** `GitHubFileReader.fetchRepoFile(path: string)` silently tries local then remote with no type-level signal about what kind of path it received. The caller can't reason about the behaviour.
5. **Future: `scrum_orient` config arg.** The tool will eventually accept a config path/URL/inline YAML as an optional argument. The current architecture has no clean seam for this.

---

## Architecture Overview

The refactor introduces a single new domain type - `TemplateLocation` - that represents every possible source a file can come from. All config and template paths flow through this type. Resolution (string → `TemplateLocation`) is a pure use-case-layer function. Content fetching (`TemplateLocation` → `string`) is a shared use-case utility that adapters wrap with platform-specific auth.

```
use-case layer (src/scrum/)
  resolveLocation(string, baseDir)                 ← Step 2:  string → TemplateLocation
  fetchContent(TemplateLocation)                   ← Step 2c: TemplateLocation → string (no auth)

server.ts
  --config <string>
    → resolveLocation(string, Deno.cwd())          ← use-case utility
    → TemplateLocation { kind: "file" | "url" }
    → AdapterStartupOptions.configLocation

config-loader.ts  (adapter)
  receives TemplateLocation
  → fetchContent(configLocation)                   ← use-case utility, no auth needed
  → parse YAML → ScrumConfig
  → compute baseDir from location
  → resolve projRoot from config (relative to baseDir)
  → resolveLocation(template, projectRoot)         ← for each type_mapping entry
  → typeTemplatePaths: Record<string, TemplateLocation>

GitHubFileReader.fetchFile(TemplateLocation)       (adapter — implements FileReaderPort)
  github.com URL → intercept with auth → raw.githubusercontent.com
  all others     → delegate to fetchContent(location)

TrelloFileReader.fetchFile(TemplateLocation)       (hypothetical adapter — implements FileReaderPort)
  trello.com URL → intercept with Trello API + auth
  all others     → delegate to fetchContent(location)
```

Both `resolveLocation` and `fetchContent` live at the use-case layer so every adapter imports them without adapter-to-adapter coupling. Each adapter wraps `fetchContent` with only its platform's auth logic for URLs on its domain.

---

## Execution Phases

Steps are grouped into phases by dependency. Phases must be completed in order; steps within a phase can be done in parallel.

```
Phase A — Domain foundation (no deps, ships atomically)
  Step 0   Pre-flight: audit FileReaderPort references in test files
  Step 1   New domain type: TemplateLocation
  Step 2   New use-case utility: resolveLocation (string → TemplateLocation)
  Step 2b  Unit tests for resolveLocation
  Step 2c  New use-case utility: fetchContent (TemplateLocation → string)

Phase B — Port contract (depends on A)
  Step 3   Extend ScrumConfig.project with projRoot
  Step 4   Extend FileReaderPort (doc comment only; signature unchanged)
  Step 5   Update AdapterStartupOptions and BackendResult

Phase C — Adapter implementation (depends on B)
  Step 6   Update config-loader.ts (import fetchContent; resolve typeTemplatePaths)
  Step 7   Update GitHubFileReader (wrap fetchContent + GitHub auth interceptor)
  Step 7b  Remove unused fetchRepoFile from contents.ts
  Step 8   Update template-resource.ts
  Step 9   Update orient.ts
  Step 10  Update PlatformState in ports.ts (type propagation to backend.ts is a compile-time check)

Phase D — Composition root (depends on C)
  Step 11  Update server.ts
```

---

## Step-by-Step Implementation

### Step 0 — Pre-flight: audit `FileReaderPort` references in test files

Before changing any types, locate every reference to `FileReaderPort` / `fetchRepoFile` in test files. Changing the method signature will break any stub or mock that implements the old interface. Run:

```bash
grep -rn "FileReaderPort\|fetchRepoFile" src/ --include="*.test.ts"
```

Update each test stub to implement `fetchFile(location: TemplateLocation): Promise<string>` instead of `fetchRepoFile(path: string): Promise<string>`. An empty-object `typeTemplatePaths: {}` fixture (like the one in [`story-mutation-service.test.ts`](src/adapters/github/internal/story-mutation-service.test.ts:146)) will continue to type-check as `Record<string, TemplateLocation>`.

Do this in Phase A before the type changes so test compilation failures don't distract from production-code type errors.

---

### Step 1 - New domain type: `TemplateLocation`

**File to create:** `src/domain/template-location.ts`

```typescript
export const TEMPLATE_LOCATION_KINDS = ["file", "url", "inline"] as const;
export type TemplateLocationKind = (typeof TEMPLATE_LOCATION_KINDS)[number];

/**
 * Discriminated union representing every source a config or template file can
 * come from. Resolution (string → TemplateLocation) happens in the use-case
 * layer (resolve-location.ts). Fetching (TemplateLocation → content) happens
 * in the backend adapter.
 *
 * "inline" exists for future scrum_orient support where the caller passes raw
 * YAML content directly rather than a path or URL.
 */
export type TemplateLocation =
  | { readonly kind: "file"; readonly path: string }
  | { readonly kind: "url"; readonly url: URL }
  | { readonly kind: "inline"; readonly content: string };
```

Also add a `describeLocation` helper alongside the type — it is a pure display function with no I/O and is used by both config-loader.ts (error messages) and server.ts (error hints):

```typescript
/** Human-readable representation for error messages. */
export const describeLocation = (loc: TemplateLocation): string => {
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
 * Infer a MIME type from a file extension.
 * Used by template-resource.ts to return the correct Content-Type for
 * .json and .yml templates (which are no longer forced to "text/markdown"
 * now that TemplateLocation carries the file extension).
 *
 * Falls back to "text/markdown" for unrecognized extensions (the
 * historical default — most templates are markdown).
 */
export const mimeTypeForPath = (p: string): string => {
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

**Why domain layer:** `TemplateLocation` is a value the use-case layer reasons about (it passes locations to ports). It is not infrastructure - it doesn't do I/O. Domain types live with their consumers, not their implementers. `describeLocation` and `mimeTypeForPath` are pure display/logic functions operating only on the domain type — they belong with the type, not duplicated in consumers.

**Naming note:** The type is called `TemplateLocation` but it represents config files too (e.g. `AdapterStartupOptions.configLocation`). A more generic name like `ContentSource` or `FileLocation` would be more honest, but the rename would cascade through ~12 files. The structure is correct regardless — this is a cosmetic observation, not a blocker.

**No existing type to extend or reuse.** Confirm by grepping - nothing named `TemplateLocation`, `ConfigLocation`, or similar exists in the codebase before this change.

---

### Step 2 - New use-case utility: `resolveLocation`

**File to create:** `src/scrum/resolve-location.ts`

This is a pure function - no I/O, no imports from the adapter layer.

```typescript
import * as path from "@std/path";
import type { TemplateLocation } from "../domain/template-location.ts";

export const SUPPORTED_TEMPLATE_EXTENSIONS = [".md", ".json", ".yml", ".yaml"] as const;
export type SupportedTemplateExtension = (typeof SUPPORTED_TEMPLATE_EXTENSIONS)[number];

/**
 * Resolve a raw string (from config YAML or a CLI arg) to a TemplateLocation.
 *
 * Resolution rules:
 *   - Starts with "http://" or "https://"  → { kind: "url", url: new URL(input) }
 *   - path.isAbsolute(input)               → { kind: "file", path: input }
 *   - otherwise                             → { kind: "file", path: path.resolve(baseDir, input) }
 *
 * @param input   Raw string from config or CLI.
 * @param baseDir Absolute directory to anchor relative paths against.
 *                For config files: Deno.cwd().
 *                For templates: the resolved projectRoot (see config-loader.ts).
 * @throws {Error} if the resolved path or URL has an unsupported file extension.
 */
export const resolveLocation = (input: string, baseDir: string): TemplateLocation => { ... }
```

**Extension guard:** After resolution, check that `path.extname(resolvedPath)` or the URL pathname's extension is one of `SUPPORTED_TEMPLATE_EXTENSIONS`. Throw a descriptive error if not. This is the only place extension validation lives - do not duplicate it elsewhere.

**Why use-case layer (`src/scrum/`):** This function knows about the domain concept of `TemplateLocation` and the rule about supported extensions, but does no I/O. Keeping it out of `src/domain/` is intentional - domain types are data shapes; this is behaviour.

**`@std/path` import:** The use-case layer imports `@std/path` (Deno standard library, not a framework). This is consistent with existing use-case code in [`sprint-math.ts`](src/scrum/sprint-math.ts) and is acceptable — the standard library is a stable, platform-level dependency, not a volatile framework detail.

---

### Step 2b — Unit tests for `resolveLocation`

**File to create:** `src/scrum/resolve-location.test.ts`

`resolveLocation` is a pure function — it must be tested independently before it flows into config-loader and server. Test cases:

| Input                                | baseDir         | Expected                                                           |
| ------------------------------------ | --------------- | ------------------------------------------------------------------ |
| `".github/scrum/config.yml"`         | `/home/project` | `{ kind: "file", path: "/home/project/.github/scrum/config.yml" }` |
| `"/absolute/path/config.yml"`        | `/home/project` | `{ kind: "file", path: "/absolute/path/config.yml" }`              |
| `"https://example.com/config.yml"`   | any             | `{ kind: "url", url: new URL("https://example.com/config.yml") }`  |
| `"http://example.com/config.yml"`    | any             | `{ kind: "url", url: new URL("http://example.com/config.yml") }`   |
| `"relative/template.md"`             | `/home/project` | `{ kind: "file", path: "/home/project/relative/template.md" }`     |
| `"./config.json"`                    | `/home/project` | `{ kind: "file", path: "/home/project/config.json" }`              |
| `"template.txt"`                     | any             | throws — unsupported extension                                     |
| `"https://example.com/template.txt"` | any             | throws — unsupported extension                                     |

### Step 2c — New use-case utility: `fetchContent`

**File to create:** `src/scrum/fetch-location.ts`

Shared dispatch on `TemplateLocation → string`. Lives at the use-case layer so every adapter imports it without adapter-to-adapter coupling. Uses only platform primitives (`Deno.readTextFile`, `fetch`) — no adapter dependencies.

```typescript
import type { TemplateLocation } from "../domain/template-location.ts";

/**
 * Fetch content from wherever a TemplateLocation points.
 * Pure dispatch — no adapter dependencies, no auth.
 *
 * Used by:
 *   - config-loader.ts (during boot, before FileReaderPort exists)
 *   - Adapter FileReader implementations (wrapping with platform auth)
 *
 * This is NOT the port interface — it's a raw utility.
 * FileReaderPort is the contract use-cases code against.
 */
export const fetchContent = async (location: TemplateLocation): Promise<string> => {
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

**Why use-case layer (`src/scrum/`):** Mirrors `resolve-location.ts` — both operate on `TemplateLocation`. `resolveLocation` converts `string → TemplateLocation`; `fetchContent` converts `TemplateLocation → string`. Together they form the resolution + retrieval pipeline. Keeping them side-by-side avoids adapter-to-adapter imports when multiple platform adapters exist.

**I/O precedent:** `resolve-location.ts` imports `@std/path`; `fetch-location.ts` uses `Deno.readTextFile` and `fetch`. Both are Deno platform primitives and the standard library — stable dependencies, not volatile framework details.

**Not the port:** `FileReaderPort.fetchFile` is the contract use-cases code against. `fetchContent` is the raw utility that adapter implementations of that port wrap with platform-specific auth. `config-loader.ts` imports `fetchContent` directly (not through the port) because config loading happens before `FileReaderPort` implementers exist.

---

### Step 3 - Extend `ScrumConfig.project` with `projRoot`

**File to edit:** `src/domain/config.ts`

Add one optional field to the existing `project` object:

```typescript
project: {
  name: string;
  projRoot?: string;  // Relative to config file's directory. Defaults to config file's directory.
                      // Use when templates live at a different root than the config file.
  agent?: { ... };
  team?: [ ... ];
}
```

**Why here:** `projRoot` is a user-declared config value, not a runtime-computed path. It belongs in the domain config type alongside the other `project` fields.

**Downstream effect:** `config-loader.ts` reads `config.project.projRoot` after parsing. No other code reads this field directly.

---

### Step 4 - Extend `FileReaderPort`

**File to edit:** `src/scrum/ports.ts`

Replace the existing method signature:

```typescript
// BEFORE
export interface FileReaderPort {
  fetchRepoFile(path: string): Promise<string>;
}

// AFTER
export interface FileReaderPort {
  /**
   * Fetch the content of a file from wherever the TemplateLocation points.
   * Resolution (string → TemplateLocation) is the caller's responsibility.
   * This port only fetches; it does not resolve or validate paths.
   */
  fetchFile(location: TemplateLocation): Promise<string>;
}
```

Add the import at the top of `ports.ts`:

```typescript
import type { TemplateLocation } from "../domain/template-location.ts";
```

**Downstream effects:**

- `src/scrum/template-resource.ts` calls `fileReader.fetchRepoFile(path)` → update to `fileReader.fetchFile(location)` where `location` comes from `typeTemplatePaths[type]` (now a `TemplateLocation`).
- `src/adapters/github/internal/file-reader.ts` implements `FileReaderPort` → update `GitHubFileReader` (Step 7).
- TypeScript will surface every call site as a compile error - follow the errors to find all affected files.

---

### Step 5 - Update `AdapterStartupOptions` and `BackendResult`

**File to edit:** `src/adapters/factory.ts`

```typescript
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
   * resolved against Deno.cwd() by the adapter factory.
   */
  readonly configLocation?: TemplateLocation;
}
```

Also update `BackendResult.typeTemplatePaths`:

```typescript
// BEFORE
readonly typeTemplatePaths: Record<string, string>;

// AFTER
readonly typeTemplatePaths: Record<string, TemplateLocation>;
```

Add import at top of `factory.ts`:

```typescript
import type { TemplateLocation } from "../domain/template-location.ts";
```

**Downstream effects:**

- `src/adapters/github/factory.ts` reads `options?.configPath` and `options?.projectRoot` → update to `options?.configLocation` (Step 6).
- `src/server.ts` passes `{ configPath, projectRoot }` → update to `{ configLocation }` (Step 11).

---

### Step 6 - Update `config-loader.ts`

**File to edit:** `src/adapters/github/config-loader.ts`

This is the most substantial change. Key points:

**A. `ConfigParams` interface:**

```typescript
// BEFORE
interface ConfigParams {
  github: GitHubClient;
  configPath?: string;
}

// AFTER
interface ConfigParams {
  github: GitHubClient;
  configLocation?: TemplateLocation; // defaults to local .github/scrum/config.yml
}
```

**B. `RuntimeConfig.typeTemplatePaths`:**

```typescript
// BEFORE
typeTemplatePaths: Record<string, string>;

// AFTER
typeTemplatePaths: Record<string, TemplateLocation>;
```

**C. Config content fetching** - replace `Deno.readTextFile(configPath)` with `fetchContent` imported from the use-case layer:

```typescript
import { fetchContent } from "../../../scrum/fetch-location.ts";
```

Then call `fetchContent(configLocation)` instead of `Deno.readTextFile(configPath)` and instead of the previously-planned local `fetchContent` function.

The shared `fetchContent` lives at `src/scrum/fetch-location.ts` (Step 2c) and dispatches on `TemplateLocation.kind` using only platform primitives (`Deno.readTextFile`, `fetch`). No adapter dependencies — safe to import during boot before `GitHubFileReader` exists.

Note: config file fetching uses plain `fetch` (no GitHub auth). If the config lives in a private GitHub repo, the user must supply a raw URL with a token in the query string, or use a local file. This is an intentional constraint - authenticating config fetches is out of scope for this change.

**D. Compute `baseDir` after fetching:**

```typescript
const baseDir: string = (() => {
  switch (configLocation.kind) {
    case "file":
      return path.dirname(configLocation.path);
    case "url":
      return new URL(".", configLocation.url).pathname; // URL directory
    case "inline":
      return Deno.cwd(); // no anchor - relative template paths need projRoot
  }
})();
```

**E. Resolve `projectRoot` from config:**

```typescript
const projectRoot = parsedConfig.project.projRoot
  ? path.resolve(baseDir, parsedConfig.project.projRoot)
  : baseDir;
```

**F. Build `typeTemplatePaths` as `Record<string, TemplateLocation>`:**

```typescript
// Replace the existing string-based loop:
const typeTemplatePaths: Record<string, TemplateLocation> = {};
for (const [key, entry] of Object.entries(patchedGhConfig.type_mapping ?? {})) {
  if (entry.template) {
    typeTemplatePaths[key] = resolveLocation(entry.template, projectRoot);
  }
}
```

Imports needed:

```typescript
import { resolveLocation } from "../../../scrum/resolve-location.ts";
import { fetchContent } from "../../../scrum/fetch-location.ts";
import { describeLocation } from "../../../domain/template-location.ts";
```

**G. Default `configLocation`:**

```typescript
const configLocation: TemplateLocation = params.configLocation ?? {
  kind: "file",
  path: path.resolve(Deno.cwd(), ".github/scrum/config.yml"),
};
```

**Important:** The existing `configPath` string in error messages (e.g. `"Config error in ${configPath}"`) should be replaced with `describeLocation(configLocation)` — a human-readable representation of the `TemplateLocation`. Import `describeLocation` from `"../../../domain/template-location.ts"` (added in Step 1).

---

### Step 7 - Update `GitHubFileReader`

**File to edit:** `src/adapters/github/internal/file-reader.ts`

Remove `localRoot` from the constructor. Add `token` (already available from the resolved config - pass it in from `GitHubAdapterFactory`). Delegate to the shared `fetchContent` for all non-GitHub cases instead of duplicating the dispatch logic.

```typescript
import { fetchContent } from "../../../scrum/fetch-location.ts";
import type { TemplateLocation } from "../../../domain/template-location.ts";
import type { FileReaderPort } from "../../../scrum/ports.ts";

export class GitHubFileReader implements FileReaderPort {
  constructor(
    private readonly owner: string,
    private readonly repo: string,
    private readonly token: string,
  ) {}

  async fetchFile(location: TemplateLocation): Promise<string> {
    // Only intercept github.com URLs for authenticated raw fetch.
    // Everything else (file, inline, non-GitHub URLs) delegates to the shared utility.
    if (location.kind === "url" && location.url.hostname === "github.com") {
      return this.fetchGitHubBlobAsRaw(location.url);
    }
    return fetchContent(location);
  }

  private async fetchGitHubBlobAsRaw(blobUrl: URL): Promise<string> {
    // Convert: https://github.com/{owner}/{repo}/blob/{branch}/{path}
    //      to: https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{path}
    const parts = blobUrl.pathname.split("/").filter(Boolean);
    // parts: [owner, repo, "blob", branch, ...filePath]
    if (parts[2] !== "blob" || parts.length < 5) {
      throw new Error(
        `Unsupported GitHub URL format: ${blobUrl}. ` +
          `Expected: https://github.com/{owner}/{repo}/blob/{branch}/{filePath}`,
      );
    }
    const [ghOwner, ghRepo, , branch, ...fileParts] = parts;
    const rawUrl = new URL(
      `https://raw.githubusercontent.com/${ghOwner}/${ghRepo}/${branch}/${fileParts.join("/")}`,
    );
    const res = await fetch(rawUrl, {
      headers: { Authorization: `Bearer ${this.token}` },
    });
    if (!res.ok) throw new Error(`GitHub raw fetch failed for ${rawUrl}: ${res.status}`);
    return res.text();
  }
}
```

**Pattern:** The adapter only adds its platform's auth logic. `file`, `inline`, and non-GitHub `url` kinds all flow through the shared `fetchContent`. A hypothetical `TrelloFileReader` would follow the same pattern — intercept `trello.com` URLs, delegate everything else.

**In `GitHubAdapterFactory.create()`** (file: `src/adapters/github/factory.ts`):

Replace:

```typescript
const localRoot = options?.projectRoot ?? Deno.cwd();
const fileReader = new GitHubFileReader(owner, primaryRepo, localRoot);
```

With:

```typescript
const fileReader = new GitHubFileReader(owner, primaryRepo, gh.auth.token);
```

Also update the call to `loadConfig`:

```typescript
const config = await loadConfig({
  github: { graphql },
  configLocation: options?.configLocation, // was: configPath: options?.configPath
});
```

---

### Step 8 - Update `template-resource.ts`

**File to edit:** `src/scrum/template-resource.ts`

The `typeTemplatePaths` parameter type changes. The `path` variable becomes a `TemplateLocation`, passed directly to `fetchFile`:

```typescript
// BEFORE
export const templateResourceUseCase = async (
  type: string,
  fileReader: FileReaderPort,
  typeTemplatePaths: Record<string, string>,
): Promise<TemplateData> => {
  const path = typeTemplatePaths[type];
  if (!path) { ... }
  const content = await fileReader.fetchRepoFile(path);
  return { content, mimeType: "text/markdown" };
};

// AFTER
export const templateResourceUseCase = async (
  type: string,
  fileReader: FileReaderPort,
  typeTemplatePaths: Record<string, TemplateLocation>,
): Promise<TemplateData> => {
  const location = typeTemplatePaths[type];
  if (!location) { ... }
  const content = await fileReader.fetchFile(location);
  return { content, mimeType: "text/markdown" };
};
```

The `mimeType` is now inferred from the location's file extension via [`mimeTypeForPath()`](src/domain/template-location.ts) (added in Step 1). In [`template-resource.ts`](src/scrum/template-resource.ts), replace:

```typescript
return { content, mimeType: "text/markdown" };
```

With logic that extracts the path from the `TemplateLocation` and calls the helper:

```typescript
import { mimeTypeForPath } from "../domain/template-location.ts";

const mimeType = location.kind === "inline"
  ? "text/markdown" // inline content — no extension available
  : location.kind === "file"
  ? mimeTypeForPath(location.path)
  : mimeTypeForPath(location.url.pathname);
return { content, mimeType };
```

This gives correct `Content-Type` for JSON and YAML templates without a deferred TODO.

---

### Step 9 - Update `orient.ts`

**File to edit:** `src/scrum/orient.ts`

`buildTemplateUriMap` receives `Record<string, TemplateLocation>`. The presence check `if (typeTemplatePaths[type])` still works because a `TemplateLocation` object is truthy. No logic change needed - only the type annotation:

```typescript
// BEFORE
const buildTemplateUriMap = (typeTemplatePaths: Record<string, string>): TemplateUriMap | null => {

// AFTER
const buildTemplateUriMap = (typeTemplatePaths: Record<string, TemplateLocation>): TemplateUriMap | null => {
```

Add the import for `TemplateLocation`.

---

### Step 10 - Update `PlatformState` in `ports.ts`

**File to edit:** `src/scrum/ports.ts`

In `PlatformState.vocabulary`:

```typescript
// BEFORE
readonly typeTemplatePaths: Record<string, string>;

// AFTER
readonly typeTemplatePaths: Record<string, TemplateLocation>;
```

Also update the comment on the field to remove the "Repo-relative template file paths" description - they are no longer necessarily repo-relative.

**Backend propagation (compile-time check):** [`backend.ts`](src/adapters/github/backend.ts) line 220 passes `this.deps.config.typeTemplatePaths` through to `PlatformState`. Since `config.typeTemplatePaths` is now `Record<string, TemplateLocation>`, this propagates automatically — no logic change needed. The compiler confirms the types flow correctly; no separate step required.

---

### Step 11 - Update `server.ts`

**File to edit:** `src/server.ts`

**A. Remove `--root` / `-r` CLI flag entirely:**

- Remove from `parseArgs` options
- Remove `_projectRoot` variable
- Remove from the help text string
- Remove from `createMcpServer`, `runHttp`, `runStdio` function signatures

**B. Resolve `--config` to a `TemplateLocation`:**

```typescript
import { resolveLocation } from "./scrum/resolve-location.ts";
import type { TemplateLocation } from "./domain/template-location.ts";

const _configLocation: TemplateLocation | undefined = _cliArgs.config
  ? resolveLocation(_cliArgs.config, Deno.cwd())
  : undefined;
```

**C. Pass `configLocation` instead of `configPath` + `projectRoot`:**

```typescript
backendResult = await createBackend(factories, { configLocation: _configLocation });
```

**D. Update error hint** - replace references to `configPath` string with `describeLocation` imported from `"./domain/template-location.ts"`:

```typescript
import { describeLocation } from "./domain/template-location.ts";

// ...
} else if (_configLocation) {
  hint = `Config not found or invalid at: ${describeLocation(_configLocation)}`;
}
```

**E. `--root` migration note:** The `--root` / `-r` flag is removed with no deprecation period. Any script, systemd unit, or Claude Desktop config that passes `--root` will see an "unknown flag" error from `parseArgs`. Add a line to the release notes: "The `--root` / `-r` CLI flag has been removed. Use `projRoot` in the config YAML instead. Templates now resolve relative to the config file's directory by default."

## Files Touched (Complete List)

| File                                          | Change type                                                                                                                          |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `src/domain/template-location.ts`             | **New**                                                                                                                              |
| `src/scrum/resolve-location.ts`               | **New**                                                                                                                              |
| `src/domain/config.ts`                        | Add `project.projRoot?: string`                                                                                                      |
| `src/scrum/ports.ts`                          | `FileReaderPort` method rename+retype; `PlatformState.vocabulary.typeTemplatePaths` type; add import                                 |
| `src/scrum/template-resource.ts`              | Parameter type + method call update                                                                                                  |
| `src/scrum/orient.ts`                         | `buildTemplateUriMap` parameter type + import                                                                                        |
| `src/adapters/factory.ts`                     | `AdapterStartupOptions` remove `projectRoot`, rename `configPath→configLocation`; `BackendResult.typeTemplatePaths` type; add import |
| `src/adapters/github/config-loader.ts`        | `ConfigParams`, `RuntimeConfig`, content fetching, baseDir computation, projectRoot resolution, template path resolution             |
| `src/adapters/github/factory.ts`              | `GitHubFileReader` construction; `loadConfig` call                                                                                   |
| `src/adapters/github/internal/file-reader.ts` | Remove `localRoot`; add `token`; implement `fetchFile` dispatch                                                                      |
| `src/adapters/github/backend.ts`              | Verify `typeTemplatePaths` propagation (likely compile-checks clean)                                                                 |
| `src/server.ts`                               | Remove `--root`; resolve config to `TemplateLocation`; update function signatures                                                    |

---

## Cross-Cutting Concerns

### `_deno-shim.node.ts`

The Node.js shim at [`_deno-shim.node.ts:73`](src/_deno-shim.node.ts:73) already provides `Deno.readTextFile` as a bridge to `node:fs/promises readFile`. Any code calling `Deno.readTextFile` — including the new `fetchFile` dispatch in `GitHubFileReader` and `fetchContent` in `config-loader.ts` — is automatically covered in the Node.js bundle. No shim changes are needed.

### Test files

Test file stub updates are handled in Step 0 (pre-flight audit). No further test changes are expected beyond what that step surfaces.

### `ConfigReloader`

`ConfigReloader` calls `loadConfig({ github: this.github })` without a `configLocation`, which defaults to the local `.github/scrum/config.yml`. When the server started with a remote config (`--config https://…`), reload will silently fall back to the local file.

**Decision:** This is an intentional limitation. `ConfigReloader.reload()` refreshes live GitHub project field metadata (iterations, field option IDs) — it does not re-fetch the config YAML. Remote config sources are immutable from the reloader's perspective. If reloading a remote config is needed later, store the original `configLocation` in `ConfigReloader` and pass it through.

### `fetchContent` sharing

The shared `fetchContent` function lives at `src/scrum/fetch-location.ts` (Step 2c) at the use-case layer. Both `config-loader.ts` and `GitHubFileReader` import it. This eliminates the previously-planned duplication between two local dispatch implementations.

**Why use-case layer:** Keeps adapter-to-use-case as the only dependency direction. A hypothetical `TrelloFileReader` imports `fetchContent` from `src/scrum/` without ever touching `src/adapters/github/`. The pattern is symmetric across all adapters — each only adds platform-specific auth for its own domain URLs.

**Why not through FileReaderPort for config loading:** Config loading happens during adapter construction, before `GitHubFileReader` (or any `FileReaderPort` implementer) exists. `loadConfig` imports `fetchContent` directly. Once the adapter is constructed, template fetching goes through `FileReaderPort.fetchFile()` as normal.

---

## Verification Checklist

### 0. Lint and format (pre-merge gate)

```bash
deno lint
deno fmt --check
```

Must pass with zero warnings and no unformatted files. Per [`AGENT.md`](AGENT.md), lint must pass before marking any task complete.

### 1. TypeScript compiles clean

```bash
deno check src/server.ts
```

There must be zero type errors. Follow the compiler's error trail in order - it will point to every affected call site.

### 2. Local file path (existing behaviour preserved)

Start the server as before, no flags:

```bash
deno run --allow-all src/server.ts
```

Confirm it loads `.github/scrum/config.yml` from the working directory. Confirm `scrum_orient` returns template URIs if templates are configured.

### 3. Explicit local path via `--config`

```bash
deno run --allow-all src/server.ts --config /absolute/path/to/config.yml
```

Confirm templates resolve relative to the config file's directory, not the CWD.

### 4. Relative path via `--config`

```bash
deno run --allow-all src/server.ts --config ../../some/other/project/scrum.yml
```

Confirm templates resolve relative to the resolved config directory, not the CWD.

### 5. `--root` flag is gone

```bash
deno run --allow-all src/server.ts --root .
```

Should print the help/usage error (unknown flag) or be silently ignored, depending on `parseArgs` strict mode. Confirm it does NOT cause the server to start incorrectly.

### 6. Remote GitHub template URL

In `type_mapping`, set one template to a full GitHub blob URL:

```yaml
template: "https://github.com/{owner}/{repo}/blob/main/.github/ISSUE_TEMPLATE/story.yml"
```

Call `scrum://template/user_story` MCP resource. Confirm the file content is returned (requires valid token and repo access).

### 7. `projRoot` override

Add `projRoot: "templates/"` to the `project` section of a test config. Place templates under `templates/` relative to the config file. Confirm they resolve correctly.

### 8. Error messages are readable

Point `--config` at a non-existent file:

```bash
deno run --allow-all src/server.ts --config /no/such/file.yml
```

Confirm the error message includes the path (not `[object Object]`).

### 9. `ConfigReloader` still works

After the server starts, make a change on the GitHub board (rename an iteration). Call `scrum_orient`. Confirm the reloader picks up the change. This verifies `configReloader.reload()` still calls `loadConfig` correctly with no `configLocation` (falling back to the default).

### 10. `ConfigReloader` with remote config is a documented no-op

Start the server with a remote config:

```bash
deno run --allow-all src/server.ts --config https://example.com/scrum.yml
```

Call `scrum_orient` to trigger a reload. Confirm the server does NOT crash or switch to the local `.github/scrum/config.yml`. The reloader refreshes field metadata (iterations, options) only — config source is not re-fetched. This is the documented behaviour.

### 11. `resolveLocation` unit tests pass

```bash
deno test src/scrum/resolve-location.test.ts
```

All cases from Step 2b must pass before merging Phase A.

### 12. All existing tests still pass

```bash
deno test
```

No regressions — every test that stubbed `FileReaderPort` has been updated (Step 0).

---

## Future Extension Points (Do Not Implement Now)

**`scrum_orient` inline config arg:** To support passing raw YAML content to `scrum_orient`, the tool handler would construct:

```typescript
{ kind: "inline", content: rawYaml } satisfies TemplateLocation
```

and pass it as `configLocation`. Template relative paths in inline configs require `projRoot` to be declared explicitly in the YAML - they cannot be inferred from CWD alone. This is the correct constraint: inline content has no inherent location.

**Non-GitHub remote config:** The plain `fetch` in `fetchContent` (Step 6C) already handles any HTTPS URL for config files. No further work needed for that case.

**Non-GitHub template URLs:** `GitHubFileReader.fetchRemoteUrl` already handles non-GitHub hostnames with a plain `fetch` fallback. Authenticated non-GitHub remotes are out of scope.
