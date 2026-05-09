# Story 11: Phase 2.6 — Template Management (`scrum_get_template`)

**Priority:** Could **Size:** S **Story Points:** 3 **Sprint:** Sprint 3 **Status:** Ready for Implementation

---

## Goal

Add `scrum_get_template` as the sixth and final read tool, completing the server's read surface before Phase 3 (write tools) begins. The tool answers one question: _"Does this team have a custom template for this ceremony type?"_ If yes, it returns the raw content. If no, it tells the agent to use its own built-in default.

The tool is deliberately thin — the server never interprets, validates, or interpolates templates. Content is returned verbatim. The agent is the intelligence layer; the server is the fetch mechanism.

This story also closes two related gaps introduced in earlier phases:

1. `ScrumConfigYml` has no typed `templates` field — the config block falls through to `[key: string]: unknown`.
2. `scrum_orient` does not return `templates` in `declared_vocabulary` — the agent currently has no way to inspect which ceremony types have custom templates declared without calling `scrum_get_template` for each one.

Both gaps are fixed as part of this story's scope.

---

## Prerequisites — What Is Already Done

| Item                            | File                      | Status      |
| ------------------------------- | ------------------------- | ----------- |
| `rest<T>()` helper              | `src/services/github.ts`  | ✅ Story 10 |
| `RestResponse<T>` interface     | `src/services/github.ts`  | ✅ Story 10 |
| `loadConfig` / `RuntimeConfig`  | `src/services/config.ts`  | ✅ Phase 1  |
| `getBootstrapConfig`, `getRepo` | `src/tools/scrum-read.ts` | ✅ Phase 2  |
| `formatError`                   | `src/services/github.ts`  | ✅ Phase 1  |
| `scrum_orient` registration     | `src/tools/scrum-read.ts` | ✅ Phase 2  |

---

## Background: Why the Tool Is Intentionally Thin

The server's design principle is: _the server returns facts; the agent is the intelligence layer._ Applied to templates, this means:

- The server does not know what output platform the agent will write to (GitHub Discussion, Notion page, Slack canvas, markdown file).
- The server does not know the agent's ceremony facilitation preferences.
- Default template content varies by deployment and is the scrum-agile-assistant skill's domain, not the MCP's.

`scrum_get_template` therefore does exactly one thing: look up a configured file path in `config.yml` and, if present, fetch and return the raw file content from the repo. Two outcomes. No logic beyond that.

This is not laziness — it is a deliberate boundary. The README states it explicitly:

> _"The server never embeds default template content. Defaults are the agent's domain."_

The clean code work in this story is about making that boundary **structurally enforced** in the types, not just described in prose.

---

## Clean Code Analysis — Design Decisions and Refactoring Scope

### Clean Code Issue 1 — `ScrumConfigYml` has an untyped catch-all absorbing `templates` (Meaningful Names, Type Safety)

**The smell:** `ScrumConfigYml` ends with `[key: string]: unknown`. The `templates:` block in `config.yml` falls through this catch-all. Code that reads `yml.templates` gets back `unknown` — the compiler cannot help, and any access requires a type assertion.

> _"Use intention-revealing names... The name of a variable, function, or class should answer all the big questions: why it exists, what it does, and how it is used."_

A catch-all index signature is the type-level equivalent of a comment that says "other stuff goes here." Adding a `templates` field to `ScrumConfigYml` expresses intent: this key exists, has this shape, and callers can rely on it.

**The fix:** Add to `ScrumConfigYml`:

```typescript
templates?: Partial<Record<ArtifactType, string | null>>;
```

Where `ArtifactType` is declared alongside the type (see New Types below).

### Clean Code Issue 2 — The return type should be a discriminated union, not a conditional nullable (Objects and Data Structures)

**The smell (naive approach):**

```typescript
interface TemplateResponse {
  content: string | null;
  source: "custom" | "default";
}
```

This type allows `{ content: null, source: "custom" }` and `{ content: "text", source: "default" }` — both of which are nonsense states. The compiler cannot catch a caller that forgets to check `source` before using `content`.

> _"We want to hide implementation details and expose abstractions... Objects hide their data behind abstractions and expose functions that operate on that data."_

A discriminated union makes invalid states unrepresentable:

```typescript
type TemplateResponse =
  | { content: string; source: "custom" }
  | { content: null; source: "default" };
```

Now a TypeScript caller that narrows on `source` gets a typed `content` — no assertion needed. The server's two-outcome contract is enforced structurally, not just by documentation.

### Clean Code Issue 3 — Fetching and decoding must be separate named steps (SRP, Functions)

**The smell (naive approach):** A handler that calls `rest()` inline, reads `response.data.content`, calls `atob()`, and returns the result — all in one closure body.

> _"Functions should do one thing... If a function does only those steps that are one level below the stated name of the function, then the function is doing one thing."_

The handler's stated job is: _resolve the template path, decide custom vs. default, return the response_. Fetching a file from GitHub and decoding its base64 content are implementation details at a lower abstraction level. They belong in named helpers.

**The fix:** Two focused helpers (see implementations below):

- `fetchRepoFile(owner, repo, path)` — one REST call, returns decoded string content. Throws `GitHubApiError` on 404 (path declared but file missing).
- `decodeRepoFileContent(encoded)` — pure, one line. Named because (a) it documents _why_ the decode is needed, and (b) it makes the base64-decoding testable in isolation.

### Clean Code Issue 4 — `scrum_orient` silently omits `templates` from `declared_vocabulary` (DRY, Minimal Surprise)

**The smell:** `scrum_orient` returns `declared_vocabulary` so the agent can see the team's full configuration without making additional tool calls. But it currently omits `templates`. The agent must call `scrum_get_template` for every ceremony type just to discover which ones are configured — N+1 calls to answer a question `scrum_orient` already has the data to answer.

> _"Duplication may be the root of all evil in software."_ — and a protocol-level N+1 is a form of structural duplication.

**The fix:** Extend `scrum_orient`'s `declared_vocabulary` response to include:

```jsonc
"templates": {
  "sprint_review":   ".github/scrum/templates/sprint-review.md",
  "retrospective":   null,
  "standup":         null,
  "sprint_planning": null,
  "refinement":      null
}
```

This is a one-block addition to an existing `JSON.stringify` call — no architectural change. The agent reads this during its orientation call and only calls `scrum_get_template` when it needs the actual content.

### Clean Code Issue 5 — Missing 404 handling for a declared-but-absent file (Error Handling)

**The smell:** The happy path is: path declared → fetch → return content. But what if the path is declared in `config.yml` and the file has been deleted from the repo? Without explicit 404 handling, the tool returns a confusing GitHub API error that the agent cannot act on.

> _"Error handling is important, but if it obscures logic, it's wrong... Use exceptions rather than return codes."_

**The fix:** `fetchRepoFile` catches a `GitHubApiError` with `statusCode === 404` and re-throws with an actionable message:

```text
Template file ".github/scrum/templates/sprint-review.md" is declared in config.yml
but was not found in the repository. Either add the file or set templates.sprint_review
to null in config.yml.
```

This message is exactly what the agent should relay to the user. No additional reasoning required.

---

## Acceptance Criteria

1. **`ArtifactType` union type exported from `src/types.ts`** — `"sprint_review" | "retrospective" | "standup" | "sprint_planning" | "refinement"`. The same literal union is used in `ScrumConfigYml`, `GetTemplateSchema`, and `TemplateResponse`.

2. **`ScrumConfigYml.templates` typed** — `templates?: Partial<Record<ArtifactType, string | null>>` added to the interface. The catch-all `[key: string]: unknown` remains for other unknown keys but `templates` is now explicitly typed.

3. **`TemplateResponse` discriminated union in `src/types.ts`** — `{ content: string; source: "custom" } | { content: null; source: "default" }`.

4. **`GetTemplateSchema` in `src/schemas/scrum.ts`** — `z.object({ artifact_type: z.enum([...]) }).strict()` using the five `ArtifactType` values.

5. **`fetchRepoFile` in `src/services/github.ts`** — uses `rest<T>()` to call the GitHub Contents API (`GET /repos/{owner}/{repo}/contents/{path}`). Returns the decoded file content as a string. Throws an actionable `GitHubApiError` on 404.

6. **`decodeRepoFileContent` exported from `src/services/github.ts`** — pure function, decodes a base64-encoded GitHub Contents API response body to a UTF-8 string. Exported for unit testing.

7. **`scrum_get_template` registered** — inside `registerScrumReadTools` with MCP metadata (title, description, inputSchema, annotations: `{ readOnlyHint: true }`).

8. **Custom path → content** — when `yml.templates[artifact_type]` is a non-null string, the tool fetches the file at that path and returns `{ content: <decoded string>, source: "custom" }`.

9. **Null or absent → default signal** — when `yml.templates[artifact_type]` is `null` or the `templates` key is absent from config, returns `{ content: null, source: "default" }` without any network call.

10. **404 on declared path** — when the file path is declared but the file does not exist in the repo, the tool returns an error response with the actionable message described in Clean Code Issue 5.

11. **`scrum_orient` updated** — `declared_vocabulary` now includes a `templates` block: a `Record<ArtifactType, string | null>` showing all five ceremony types and their configured paths (or `null`).

12. **Handler reads as orchestration only** — the registered handler body contains: config load, path resolution, the custom/default branch decision, and a single call to `fetchRepoFile`. No inline base64 decoding, no inline error message construction.

13. **Type-check passes** — `deno check src/index.ts` returns no errors after all changes.

14. **Unit tests** — `decodeRepoFileContent` covered in `src/services/github_test.ts`.

---

## New Types — `src/types.ts`

Add in a new `// ── Template types ──` section after the `// ── Burndown types ──` section:

```typescript
// ── Template types (scrum_get_template) ──────────────────────────────────────

/**
 * The five ceremony artifact types for which custom templates can be declared.
 * Used in ScrumConfigYml.templates, GetTemplateSchema, and TemplateResponse.
 */
export type ArtifactType =
  | "sprint_review"
  | "retrospective"
  | "standup"
  | "sprint_planning"
  | "refinement";

/**
 * Discriminated union response for scrum_get_template.
 *
 * source: "custom"  — a custom template was fetched from the repo.
 *                     content is the raw template text; the agent applies it.
 * source: "default" — no custom template is declared for this artifact type.
 *                     content is null; the agent uses its own built-in default.
 *
 * Invalid states (e.g. content: null with source: "custom") are structurally
 * excluded by the discriminated union — the compiler enforces the contract.
 */
export type TemplateResponse =
  | { content: string; source: "custom" }
  | { content: null; source: "default" };
```

Also extend `ScrumConfigYml` — add the `templates` field before the index signature:

```typescript
// In ScrumConfigYml, add before [key: string]: unknown:
templates?: Partial<Record<ArtifactType, string | null>>;
```

---

## New Schema — `src/schemas/scrum.ts`

Add after the existing read schemas:

```typescript
// scrum_get_template — fetch a ceremony artifact template by type
export const GetTemplateSchema = z
  .object({
    artifact_type: z.enum([
      "sprint_review",
      "retrospective",
      "standup",
      "sprint_planning",
      "refinement",
    ]),
  })
  .strict();
```

The `ArtifactType` values are inlined rather than imported from `types.ts` to keep the schema file self-contained — a pattern consistent with the existing schemas in that file.

---

## Service Layer — `src/services/github.ts`

### GitHub Contents API response shape

The REST endpoint `GET /repos/{owner}/{repo}/contents/{path}` returns (on a file hit):

```typescript
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
```

On a directory, it returns an array — `fetchRepoFile` guards against this. On 404, the existing `rest<T>()` error classification fires: `GitHubApiError(404, ...)`. `fetchRepoFile` catches that and re-throws with an actionable message.

### `decodeRepoFileContent` (exported, pure)

```typescript
/**
 * Decode a base64-encoded file body returned by the GitHub Contents API.
 *
 * GitHub's API includes newline characters in the base64 string for readability.
 * These must be stripped before decoding — atob() rejects strings with whitespace.
 *
 * Exported for unit testing.
 */
export const decodeRepoFileContent = (encoded: string): string => atob(encoded.replace(/\s/g, ""));
```

Naming this function matters for two reasons:

- It documents _why_ the replace is needed (`atob` rejects whitespace).
- It makes the decode step independently testable without a REST call.

### `fetchRepoFile` (module-internal)

```typescript
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
const fetchRepoFile = async (
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
```

No `REQUIRED_PERMISSION` entry is needed for the Contents API — the existing `get_repo_file: "Contents: Read"` entry already covers it.

---

## Tool Implementation — `src/tools/scrum-read.ts`

### Helper — `resolveTemplatePath` (module-private, pure)

Reads the template path from config. Extracted from the handler to keep path resolution a named, testable step:

```typescript
/**
 * Look up the configured file path for an artifact type.
 * Returns the path string if declared and non-null, or null if the team
 * has not configured a custom template for this type.
 */
const resolveTemplatePath = (
  yml: ScrumConfigYml,
  artifactType: ArtifactType,
): string | null => yml.templates?.[artifactType] ?? null;
```

### Helper — `buildDefaultResponse` (module-private, pure)

```typescript
/**
 * Build the "use your built-in default" response.
 * Named to make the handler's intent readable at the call site.
 */
const buildDefaultResponse = (): TemplateResponse => ({
  content: null,
  source: "default",
});
```

### The Handler — Orchestration Only

```typescript
async (params: z.infer<typeof GetTemplateSchema>) => {
  try {
    const { owner, ownerType, projectNumber } = getBootstrapConfig();
    const repo = getRepo();
    const config = await loadConfig({ github: gh, owner, ownerType, projectNumber, repo });

    const path = resolveTemplatePath(config.yml, params.artifact_type);

    if (path === null) {
      const response: TemplateResponse = buildDefaultResponse();
      return { content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }] };
    }

    const fileContent = await fetchRepoFile(owner, repo, path);
    const response: TemplateResponse = { content: fileContent, source: "custom" };
    return { content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }] };
  } catch (err: unknown) {
    return { content: [{ type: "text" as const, text: formatError(err) }], isError: true };
  }
},
```

The handler has three branches: null path → default response; non-null path → fetch → custom response; any error → error response. Each branch is one line of logic. No inline decoding, no inline message construction.

### `scrum_orient` Update

In the `declared_vocabulary` block of `scrum_orient`'s handler, add after `definition_of_done`:

```typescript
templates: {
  sprint_review:   yml.templates?.sprint_review   ?? null,
  retrospective:   yml.templates?.retrospective   ?? null,
  standup:         yml.templates?.standup         ?? null,
  sprint_planning: yml.templates?.sprint_planning ?? null,
  refinement:      yml.templates?.refinement      ?? null,
},
```

This gives the agent a complete picture of the team's template configuration in a single `scrum_orient` call. The agent only calls `scrum_get_template` when it needs the actual content — not to discover what's configured.

---

## File Changes

| File                          | Change                                                                                                                                                                                                                                                              |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/types.ts`                | Add `ArtifactType` type and `TemplateResponse` discriminated union in a new `// ── Template types ──` section; add `templates?` field to `ScrumConfigYml`                                                                                                           |
| `src/schemas/scrum.ts`        | Add `GetTemplateSchema`                                                                                                                                                                                                                                             |
| `src/services/github.ts`      | Add `RepoFileResponse` interface; add `decodeRepoFileContent` (exported); add `fetchRepoFile` (module-private)                                                                                                                                                      |
| `src/tools/scrum-read.ts`     | Add import for `GetTemplateSchema`, `ArtifactType`, `TemplateResponse`; add `resolveTemplatePath`, `buildDefaultResponse`; register `scrum_get_template` in `registerScrumReadTools`; update `scrum_orient` handler to include `templates` in `declared_vocabulary` |
| `src/services/github_test.ts` | Add unit tests for `decodeRepoFileContent`                                                                                                                                                                                                                          |

`src/index.ts` and `src/services/config.ts` are **untouched** — adding a tool inside `registerScrumReadTools` is transparent to `index.ts`; `RuntimeConfig` does not need updating because the tool reads directly from `config.yml` via `loadConfig().yml.templates`.

---

## Testing Plan

### `decodeRepoFileContent` (in `src/services/github_test.ts`)

| Test case                     | Input                                                        | Expected                         |
| ----------------------------- | ------------------------------------------------------------ | -------------------------------- |
| Clean base64                  | `btoa("hello world")`                                        | `"hello world"`                  |
| Base64 with embedded newlines | GitHub API wraps lines at 60 chars; strip `\n` before decode | Correct decoded string           |
| Empty string                  | `""`                                                         | `""`                             |
| UTF-8 content                 | Base64 of a string with unicode                              | Correctly decoded unicode string |

### `resolveTemplatePath` (in `src/tools/scrum-read_test.ts`)

| Test case                   | Scenario                                                        | Expected                |
| --------------------------- | --------------------------------------------------------------- | ----------------------- |
| Path declared               | `yml.templates.sprint_review = ".github/scrum/templates/sr.md"` | Returns the path string |
| Explicitly null             | `yml.templates.sprint_review = null`                            | Returns `null`          |
| Key absent from `templates` | `yml.templates = {}`                                            | Returns `null`          |
| `templates` section absent  | `yml.templates = undefined`                                     | Returns `null`          |

---

## Implementation Order

| Step | File                           | What                                                                               | Est.   |
| ---- | ------------------------------ | ---------------------------------------------------------------------------------- | ------ |
| 1    | `src/types.ts`                 | Add `ArtifactType`, `TemplateResponse`; extend `ScrumConfigYml`                    | 10 min |
| 2    | `src/schemas/scrum.ts`         | Add `GetTemplateSchema`                                                            | 5 min  |
| 3    | `src/services/github.ts`       | Add `RepoFileResponse` interface, `decodeRepoFileContent`, `fetchRepoFile`         | 20 min |
| 4    | `src/tools/scrum-read.ts`      | Add `resolveTemplatePath`, `buildDefaultResponse`; register `scrum_get_template`   | 15 min |
| 5    | `src/tools/scrum-read.ts`      | Update `scrum_orient` to include `templates` in `declared_vocabulary`              | 10 min |
| 6    | —                              | `deno check src/index.ts` — must pass clean                                        | 5 min  |
| 7    | `src/services/github_test.ts`  | Unit tests for `decodeRepoFileContent`                                             | 15 min |
| 8    | `src/tools/scrum-read_test.ts` | Unit tests for `resolveTemplatePath`                                               | 10 min |
| 9    | —                              | Cross-check `scrum_get_template` and `scrum_orient` response shapes against README | 5 min  |

**Estimated total effort: ~1.5 hours**

---

## Dependencies

| Dependency                              | Status      | Notes                                                      |
| --------------------------------------- | ----------- | ---------------------------------------------------------- |
| `rest<T>()` in `src/services/github.ts` | ⏳ Story 10 | `fetchRepoFile` calls `rest()` — must be implemented first |
| `RestResponse<T>` interface             | ⏳ Story 10 | Used by `rest()` return type                               |
| `loadConfig` / `RuntimeConfig`          | ✅ Done     | Provides `config.yml` access via `config.yml`              |
| `GitHubApiError` class                  | ✅ Done     | Used for 404 re-throw in `fetchRepoFile`                   |
| `getBootstrapConfig`, `getRepo`         | ✅ Done     | Bootstrap helpers already in `scrum-read.ts`               |

**Story 11 is blocked by Story 10.** `fetchRepoFile` depends on `rest<T>()`. Do not start Step 3 until Story 10 Step 1 (`rest<T>()`) is merged.

---

## Risk Assessment

| Risk                                                                                     | Impact | Mitigation                                                                                                                                                                                                     |
| ---------------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GitHub Contents API returns directory array when path is a folder                        | Medium | `Array.isArray(response)` guard in `fetchRepoFile` with an actionable error message                                                                                                                            |
| Base64 decode fails for non-UTF-8 binary files                                           | Low    | Templates are markdown text files; document this assumption in `fetchRepoFile` JSDoc. Binary files would be a config error — the error message from `atob` is sufficient                                       |
| `scrum_orient` update introduces a regression in `declared_vocabulary` shape             | Low    | `deno check` catches type errors; the addition is additive — no existing keys change                                                                                                                           |
| `ScrumConfigYml.templates` field conflicts with `[key: string]: unknown` index signature | Low    | TypeScript allows named fields alongside index signatures as long as the named field's type is assignable to the index value type — `Partial<Record<ArtifactType, string \| null>>` is assignable to `unknown` |
| Tool omitted from the README tool count                                                  | Low    | Update the README tool count from 11 to 12 in Step 9 cross-check                                                                                                                                               |

---

## Notes

- **Default content is not the server's concern.** If a caller asks why the server doesn't return built-in defaults: that would require the server to know about the agent's ceremony format preferences, the target output platform, and the team's document style — none of which are platform facts. The boundary is intentional.
- **No caching.** Each `scrum_get_template` call fetches fresh content from the repo. Templates change infrequently, but the server has no session state and caching would require it. The agent can cache at its level if needed.
- **The `templates` section in `config.yml` is already present** with all five keys set to `null`. No config migration is needed — the type extension in Step 1 simply gives the existing data a proper TypeScript shape.
- **`scrum_get_template` becomes the sixth read tool**, making the total surface 12 tools (6 read + 6 write). Update the README header comment in Phase 3 or Phase 4 — not blocking here.
