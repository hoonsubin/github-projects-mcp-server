# Phase C — Structural Cleanup: Detailed Execution Plan

## Assessment Summary

### Current State

- **[`src/scrum/ports.ts`](src/scrum/ports.ts)**: `ProjectBackend` interface has **14 methods** (10 read + 4 write). All use cases import the full interface.
- **[`src/adapters/github/backend.ts`](src/adapters/github/backend.ts)**: `GitHubProjectBackend` is **1259 lines** with a self-documented TODO: "this class is way too massive."
- **[`src/services/pagination.ts`](src/services/pagination.ts)**: 420 lines, 100% GitHub-specific (uses `RuntimeConfig`, `ProjectItem`, `GitHubBackendConfig`).
- **[`src/services/resolver.ts`](src/services/resolver.ts)**: 187 lines, 100% GitHub-specific (uses `RuntimeConfig`, GitHub GraphQL queries).
- **[`src/services/github.ts`](src/services/github.ts)**: 339 lines, contains HTTP transport (`graphql`, `rest`), Contents API (`fetchRepoFile`, `decodeRepoFileContent`).
- **[`src/scrum/get-template.ts`](src/scrum/get-template.ts)**: Calls `backend.fetchRepoFile()` — the only use case that depends on this GitHub-specific method.
- **[`src/index.ts`](src/index.ts)**: Imports `graphql`, `rest` from `services/github.ts` directly.

### Dependency Analysis

```
Phase C dependency graph:
  C.2 (move pagination/resolver) ──┐
  C.4 (split github.ts) ───────────┤
  B.1, B.2, B.5 (new methods) ─────┤──→ C.1 (split interface) ──→ C.3 (split backend)
  C.1 (split interface) ───────────┤
  C.4 (split github.ts) ───────────┤──→ C.5 (remove fetchRepoFile)
  C.1 (split interface) ───────────┘
  All tasks ───────────────────────→ C.6 (verify tombstoned deletions)
```

---

## Task C.1: Split `ProjectBackend` — Interface Segregation

### Problem

The 14-method `ProjectBackend` interface violates the Interface Segregation Principle. Each use case only needs 1-3 methods, but all must implement all 14.

### Sub-tasks

#### C.1.1: Define focused port interfaces in `ports.ts`

**File:** [`src/scrum/ports.ts`](src/scrum/ports.ts)

Create these new interfaces (keep `ProjectBackend` as a composition for backward compatibility during transition):

| Interface        | Methods                                                                                                       | Depends On |
| ---------------- | ------------------------------------------------------------------------------------------------------------- | ---------- |
| `BacklogPort`    | `getBacklogStories()`, `getOrphanImpediments()`                                                               | —          |
| `SprintPort`     | `getSprintStories()`                                                                                          | —          |
| `StoryPort`      | `getStoryDetail()`                                                                                            | —          |
| `HistoryPort`    | `getCompletedSprintHistory()`                                                                                 | —          |
| `BurndownPort`   | `getBurndownInput()`, `resolveCompletionTimestamps()`                                                         | —          |
| `ImpedimentPort` | `getSprintImpediments()`, `updateImpediment()`                                                                | —          |
| `ProjectWriter`  | `createStory()`, `updateStory()`, `setField()`, `addComment()`, `addVocabulary()`                             | —          |
| `ProjectReader`  | composition of `BacklogPort` + `SprintPort` + `StoryPort` + `HistoryPort` + `BurndownPort` + `ImpedimentPort` | —          |

**Note:** `fetchRepoFile` stays on `ProjectBackend` for now (C.5 handles removal).

#### C.1.2: Update use case imports

**Files to update:**

- [`src/scrum/get-backlog.ts`](src/scrum/get-backlog.ts) → import `BacklogPort`
- [`src/scrum/get-sprint.ts`](src/scrum/get-sprint.ts) → import `SprintPort`
- [`src/scrum/get-story.ts`](src/scrum/get-story.ts) → import `StoryPort`
- [`src/scrum/get-history.ts`](src/scrum/get-history.ts) → import `HistoryPort`
- [`src/scrum/get-burndown.ts`](src/scrum/get-burndown.ts) → import `BurndownPort`
- [`src/scrum/update-impediment.ts`](src/scrum/update-impediment.ts) → import `ImpedimentPort`
- [`src/scrum/orient.ts`](src/scrum/orient.ts) → import `ProjectReader` (needs `getPlatformState`)
- [`src/scrum/get-template.ts`](src/scrum/get-template.ts) → import `ProjectReader` (needs `fetchRepoFile`)

#### C.1.3: Update tool registration imports

**Files to update:**

- [`src/tools/scrum-read.ts`](src/tools/scrum-read.ts) → update to use `ProjectReader` or specific ports
- [`src/tools/scrum-write.ts`](src/tools/scrum-write.ts) → update to use `ProjectWriter`

#### C.1.4: Update `GitHubProjectBackend` to implement all interfaces

**File:** [`src/adapters/github/backend.ts`](src/adapters/github/backend.ts)

The class already implements all methods. After C.1.1, it will implicitly implement all new interfaces. No code changes needed — just type assertions if required.

#### C.1.5: Update `src/index.ts` factory

**File:** [`src/index.ts`](src/index.ts:100)

The `createBackend` function returns `ProjectBackend`. Consider returning a union type or keeping `ProjectBackend` as the public-facing type while use cases receive narrower interfaces.

---

## Task C.2: Move `pagination.ts` and `resolver.ts` to adapter layer

### Problem

Both files are 100% GitHub-specific but live in `services/` (generic utilities).

### Sub-tasks

#### C.2.1: Create `adapters/github/internal/` directory

**Action:** Create directory structure.

#### C.2.2: Move `pagination.ts`

**From:** `src/services/pagination.ts`
**To:** `src/adapters/github/internal/pagination.ts`

**Import updates needed:**

- Line 15: `import type { RuntimeConfig } from "../adapters/github/config-loader.ts"` → `import type { RuntimeConfig } from "../config-loader.ts"`
- Lines 16-23: `import type { ... } from "../adapters/github/types.ts"` → `import type { ... } from "../types.ts"`

#### C.2.3: Move `resolver.ts`

**From:** `src/services/resolver.ts`
**To:** `src/adapters/github/internal/resolver.ts`

**Import updates needed:**

- Line 8: `import type { RuntimeConfig } from "../adapters/github/config-loader.ts"` → `import type { RuntimeConfig } from "../config-loader.ts"`

#### C.2.4: Update imports in `backend.ts`

**File:** [`src/adapters/github/backend.ts`](src/adapters/github/backend.ts)

- Line 13: `import { resolveSprint, resolveStory } from "../../services/resolver.ts"` → `import { resolveSprint, resolveStory } from "./internal/resolver.ts"`
- Line 14: `import { isBacklogItem, PaginatedProjectItemFetcher } from "../../services/pagination.ts"` → `import { isBacklogItem, PaginatedProjectItemFetcher } from "./internal/pagination.ts"`

#### C.2.5: Delete old files

- Delete `src/services/pagination.ts`
- Delete `src/services/resolver.ts`

---

## Task C.3: Split `GitHubProjectBackend` — Single Responsibility

### Problem

`GitHubProjectBackend` is 1259 lines with mixed responsibilities. A TODO comment on line 63 explicitly states: "this class is way too massive."

### Sub-tasks

#### C.3.1: Extract `LabelResolver` service

**New file:** `src/adapters/github/internal/label-resolver.ts`

Methods to extract from `GitHubProjectBackend`:

- `fetchRepoNodeId()` (line 292)
- `resolveLabelNodeIds()` (line 381)
- `resolveOrCreateLabel()` (line 419)
- `hashToColor()` (line 1141)
- `addLabel()` (line 1119)
- `fetchTypeLabels()` (line 1178)

#### C.3.2: Extract `FieldValueMutator` service

**New file:** `src/adapters/github/internal/field-value-mutator.ts`

Methods to extract:

- `clearField()` (line 312)
- `setFieldStatus()` (line 940)
- `setFieldSprint()` (line 961)
- `setFieldStoryPoints()` (line 980)
- `setFieldPriority()` (line 998)
- `setFieldAssignee()` (line 1023)

#### C.3.3: Extract `BurndownCalculator` service

**New file:** `src/adapters/github/internal/burndown-calculator.ts`

Methods to extract:

- `resolveCompletionTimestamps()` (line 281)
- `fetchIssueCloseCompletions()` (line 1223)
- `extractLinkHeader()` (line 1253)

#### C.3.4: Extract `UserMilestoneResolver` service

**New file:** `src/adapters/github/internal/user-milestone-resolver.ts`

Methods to extract:

- `resolveUserNodeId()` (line 325)
- `resolveUserNodeIds()` (line 337)
- `resolveOrCreateMilestoneNodeId()` (line 345)

#### C.3.5: Extract `VocabularyManager` service

**New file:** `src/adapters/github/internal/vocabulary-manager.ts`

Methods to extract:

- `addVocabulary()` (line 1042)
- `addStatusOption()` (line 1053)
- `addPriorityOption()` (line 1064)
- `addSingleSelectOption()` (line 1075)

#### C.3.6: Refactor `GitHubProjectBackend` to delegate

**File:** [`src/adapters/github/backend.ts`](src/adapters/github/backend.ts)

After extracting services, `GitHubProjectBackend` becomes a coordinator:

- Inject services via constructor
- Delegate method calls to injected services
- Keep only methods that orchestrate multiple services or are inherently thin:
  - `getPlatformState()` (~40 lines)
  - `getSprintStories()` (~20 lines)
  - `getBacklogStories()` (~15 lines)
  - `getStoryDetail()` (~25 lines)
  - `createStory()` (~115 lines)
  - `updateStory()` (~55 lines)
  - `setField()` (~30 lines)
  - `addComment()` (~18 lines)
  - `getOrphanImpediments()` (~75 lines)
  - `getSprintImpediments()` (~90 lines)
  - `updateImpediment()` (~95 lines)
  - `getCompletedSprintHistory()` (~50 lines)
  - `getBurndownInput()` (~30 lines)
  - `fetchAllItems()` (~10 lines)
  - `toSprintInfo()` (~10 lines)
  - `resolveStatusDisplayName()` (~5 lines)
  - `resolveTerminalStatusDisplayName()` (~5 lines)

Target: ~200 lines for `backend.ts`.

---

## Task C.4: Split `services/github.ts` — Extract HTTP client and Contents API

### Problem

`services/github.ts` (339 lines) contains HTTP transport, Contents API, and a test helper — all GitHub-specific.

### Sub-tasks

#### C.4.1: Extract HTTP transport

**New file:** `src/adapters/github/internal/http-client.ts`

Extract:

- `graphql<T>()` function (line 52)
- `rest()` function (line 159)
- `RestResponse<T>` interface (line 18)
- `getToken()` helper (line 23)
- `extractOpName()` helper (line 44)
- `GitHubApiError` import (line 3)
- `log` import (line 2)
- Constants: `GITHUB_API_URL`, `REST_API_URL`, `REQUEST_TIMEOUT_MS`

#### C.4.2: Extract Contents API

**New file:** `src/adapters/github/internal/contents.ts`

Extract:

- `fetchRepoFile()` function (line 306)
- `decodeRepoFileContent()` function (line 289)
- `RepoFileResponse` interface (line 267)

#### C.4.3: Update imports in `backend.ts`

**File:** [`src/adapters/github/backend.ts`](src/adapters/github/backend.ts)

- Line 9: `import { fetchRepoFile, graphql, rest } from "../../services/github.ts"` → `import { graphql, rest } from "./internal/http-client.ts"`
- Add: `import { fetchRepoFile } from "./internal/contents.ts"`
- Line 11: `import type { RestResponse } from "../../services/github.ts"` → `import type { RestResponse } from "./internal/http-client.ts"`

#### C.4.4: Update imports in `index.ts`

**File:** [`src/index.ts`](src/index.ts)

- Line 22: `import { graphql, rest } from "./services/github.ts"` → `import { graphql, rest } from "./adapters/github/internal/http-client.ts"`

#### C.4.5: Update imports in `pagination.ts` (after move in C.2)

**File:** `src/adapters/github/internal/pagination.ts` (after move)

- Line 3: `import { GitHubApiError } from "../adapters/github/errors.ts"` → `import { GitHubApiError } from "../errors.ts"`
- Line 1: `import type { GraphQLResponse } from "../adapters/github/types.ts"` → `import type { GraphQLResponse } from "../types.ts"`

#### C.4.6: Update imports in `services/error-enrichment.ts`

**File:** `src/services/error-enrichment.ts`

- Check if it imports from `services/github.ts` and update accordingly.

#### C.4.7: Delete `services/github.ts`

- Delete `src/services/github.ts` after all imports are updated.

---

## Task C.5: Remove `fetchRepoFile()` from `ProjectBackend` port

### Problem

`fetchRepoFile(path: string)` is a GitHub Contents API method on a platform-agnostic interface. A Jira/Azure DevOps backend would not need this.

### Sub-tasks

#### C.5.1: Remove `fetchRepoFile` from `ProjectBackend` interface

**File:** [`src/scrum/ports.ts`](src/scrum/ports.ts:246)

- Remove line 246: `fetchRepoFile(path: string): Promise<string>;`

#### C.5.2: Update `getTemplateUseCase` to access Contents API directly

**File:** [`src/scrum/get-template.ts`](src/scrum/get-template.ts)

Current:

```typescript
export const getTemplateUseCase = async (
  backend: ProjectBackend,
  scrumConfig: ScrumConfig,
  artifactType: ArtifactType,
): Promise<TemplateResponse> => {
  const path = scrumConfig.templates?.[artifactType] ?? null;
  if (path === null) {
    return { content: null, source: "default" };
  }
  const fileContent = await backend.fetchRepoFile(path);
  return { content: fileContent, source: "custom" };
};
```

New approach: Accept an optional `contentsClient` parameter or use a dedicated port:

```typescript
export const getTemplateUseCase = async (
  backend: ProjectBackend,
  scrumConfig: ScrumConfig,
  artifactType: ArtifactType,
  contentsClient?: {
    fetchRepoFile(owner: string, repo: string, path: string): Promise<string>;
  },
): Promise<TemplateResponse> => {
  const path = scrumConfig.templates?.[artifactType] ?? null;
  if (path === null) {
    return { content: null, source: "default" };
  }
  if (!contentsClient) {
    return { content: null, source: "default" }; // Fallback for non-GitHub backends
  }
  const gh = scrumConfig.backends.github as GitHubBackendConfig;
  const fileContent = await contentsClient.fetchRepoFile(
    gh.owner,
    gh.tracked_repos[0],
    path,
  );
  return { content: fileContent, source: "custom" };
};
```

#### C.5.3: Update `getTemplate` tool handler

**File:** [`src/tools/scrum-read.ts`](src/tools/scrum-read.ts)

Pass the `fetchRepoFile` function from the HTTP client to `getTemplateUseCase`.

#### C.5.4: Remove `fetchRepoFile` from `GitHubProjectBackend`

**File:** [`src/adapters/github/backend.ts`](src/adapters/github/backend.ts)

- Remove line 443-445: `fetchRepoFile(path: string): Promise<string> { return fetchRepoFile(...) }`

---

## Task C.6: Verify tombstoned files are fully removed

### Problem

`src/types.ts` and `src/adapters/github/raw-types.ts` should have been deleted but may have stale references.

### Sub-tasks

#### C.6.1: Verify files don't exist

```bash
ls src/types.ts src/adapters/github/raw-types.ts 2>&1
```

Expected: "No such file" for both.

#### C.6.2: Check for stale imports of `src/types`

```bash
grep -r "from.*src/types" src/ --include="*.ts"
```

Expected: No results.

#### C.6.3: Check for stale imports of `raw-types`

```bash
grep -r "raw-types" src/ --include="*.ts"
```

Expected: No results.

#### C.6.4: Run lint

```bash
deno task lint
```

Expected: Pass with no errors.

---

## Execution Order

```
Recommended parallel execution:

Phase C Execution:
  C.2 (move pagination/resolver) ──┐
  C.4 (split github.ts) ───────────┤──→ C.1 (split interface) ──→ C.3 (split backend)
  C.1 (split interface) ───────────┤
  C.4 (split github.ts) ───────────┤──→ C.5 (remove fetchRepoFile)
  C.1 (split interface) ───────────┘
  All tasks ───────────────────────→ C.6 (verify tombstoned deletions)
```

### Sequential order with justification:

1. **C.2** (move pagination/resolver) — No dependencies. Low risk. Sets up C.3 and C.4.
2. **C.4** (split github.ts) — No dependencies. Can run in parallel with C.2.
3. **C.1** (split interface) — Depends on C.2 (import paths must be correct) and C.4 (http-client must exist for C.5).
4. **C.3** (split backend) — Depends on C.1 (interface split guides class decomposition) and C.4 (http-client imports).
5. **C.5** (remove fetchRepoFile) — Depends on C.1 (interface split) and C.4 (http-client exists).
6. **C.6** (verify) — Depends on all above.

### Parallel execution groups:

- **Group 1:** C.2 + C.4 (independent, no cross-dependencies)
- **Group 2:** C.1 (depends on Group 1)
- **Group 3:** C.3 + C.5 (depend on Group 2, can run in parallel)
- **Group 4:** C.6 (depends on all)
