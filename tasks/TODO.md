# Implementation Strategy: Phase 3 — GitHub Adapter: Epic Implementation

**Ticket:** [#103](https://github.com/hoonsubin/github-projects-mcp-server/issues/103)
**Branch:** `feature/epics-type`
**Prerequisite:** Phase 2 complete (all in current branch state)
**Constraint:** Build must be green at the end of this phase. Resolves the `GitHubProjectBackend` compile error for the missing `getEpics()` method introduced in Phase 1.

---

## What This Phase Does

Implements `getEpics()` in the GitHub adapter by fetching GitHub Milestones from all tracked repositories and mapping them to `EpicListing[]`. Follows the same internal service pattern used throughout the adapter layer: a focused `EpicService` class injected into the `GitHubProjectBackend` facade via the factory.

GitHub Milestones are the backing concept for Epics (Design Decision D4). The mapping is:

| GitHub Milestone field | `EpicListing` field |
|---|---|
| `milestone.id` (node ID) | `ref.id` |
| `milestone.title` | `name` |
| `milestone.description` (empty string → `null`) | `description` |
| `milestone.state` (`OPEN` → `"open"`, `CLOSED` → `"done"`) | `status` |
| `openIssues.totalCount + closedIssues.totalCount` | `story_count` |
| _(no GitHub field)_ | `priority: null` |

| File | What changes |
|---|---|
| `src/adapters/github/operations.graphql` | Add `ListMilestones` query |
| `src/adapters/github/queries.ts` | Export `LIST_MILESTONES_QUERY` constant |
| `src/adapters/github/internal/epic-service.ts` | New file: `EpicService` class |
| `src/adapters/github/backend.ts` | Add `epicService` constructor param; add `getEpics()` delegation |
| `src/adapters/github/factory.ts` | Construct and wire `EpicService` |

**Nothing else changes.** No use-case, tool, or port modifications — those were completed in Phases 1 and 2.

---

## Execution Order

Apply changes in this exact sequence. **Step 1 must precede Step 2.** The `queries.ts` module validates all operation names at load time (`getQuery` throws immediately if the operation is absent from `operations.graphql`). Adding the export before the query would cause a startup crash.

---

### Step 1 — `src/adapters/github/operations.graphql`: Add `ListMilestones` query

Insert the new section after the `GetRepoLabels` query and before the `# QUERIES — Discussions` section. The insertion point is after line 478 (`}`).

```graphql
# ══════════════════════════════════════════════════════════════════════════════
# QUERIES — Milestones
# ══════════════════════════════════════════════════════════════════════════════

# ── ListMilestones ─────────────────────────────────────────────────────────────
# Fetch all milestones (open and closed) for a single repository.
# Called once per tracked repo by EpicService; results are merged and deduplicated.
# Fetches up to 100 milestones — sufficient for typical project sizes.

query ListMilestones($owner: String!, $repo: String!) {
  repository(owner: $owner, name: $repo) {
    milestones(first: 100, states: [OPEN, CLOSED]) {
      nodes {
        id
        title
        description
        state
        openIssues: issues(states: [OPEN]) { totalCount }
        closedIssues: issues(states: [CLOSED]) { totalCount }
      }
    }
  }
}
```

`openIssues` and `closedIssues` are GraphQL field aliases on `Milestone.issues` filtered by `IssueState`. Both `MilestoneState` and `IssueState` enums are unquoted values — do not add quotes around `OPEN` or `CLOSED`.

---

### Step 2 — `src/adapters/github/queries.ts`: Export `LIST_MILESTONES_QUERY`

Append one line at the end of the named constants block.

Before:
```typescript
export const GET_IMPEDIMENT_ISSUES_QUERY = getQuery("GetImpedimentIssues");
```

After:
```typescript
export const GET_IMPEDIMENT_ISSUES_QUERY = getQuery("GetImpedimentIssues");
export const LIST_MILESTONES_QUERY = getQuery("ListMilestones");
```

`getQuery` validates the name against the parsed `operations.graphql` at module load and throws if it is missing. This is the only change to this file.

---

### Step 3 — `src/adapters/github/internal/epic-service.ts`: Create EpicService

Create this new file. It follows the same constructor-injection pattern as `ImpedimentService` and `StoryQueryService`.

```typescript
// =============================================================================
// src/adapters/github/internal/epic-service.ts — Epic Read Operations
//
// Single responsibility: fetch GitHub Milestones across all tracked repositories
// and map them to EpicListing[]. Milestones are the GitHub backing concept for
// Epics (Design Decision D4 in tasks/REFACTORING.md).
//
// Results from multiple repos are merged and deduplicated by node ID so that
// milestones shared across repos appear only once.
// =============================================================================

import type { GitHubClient } from "./http-client.ts";
import { LIST_MILESTONES_QUERY } from "../queries.ts";
import type { EpicListing } from "../../../domain/types.ts";

interface MilestoneNode {
  id: string;
  title: string;
  description: string | null;
  state: "OPEN" | "CLOSED";
  openIssues: { totalCount: number };
  closedIssues: { totalCount: number };
}

interface ListMilestonesResponse {
  repository?: {
    milestones?: {
      nodes: MilestoneNode[];
    };
  } | null;
}

/**
 * Epic read operations: fetches all GitHub Milestones across tracked repositories
 * and maps them to EpicListing[]. Injected into GitHubProjectBackend via constructor (DIP).
 */
export class EpicService {
  constructor(
    private readonly gh: GitHubClient,
    private readonly owner: string,
    private readonly repos: string[],
  ) {}

  async getEpics(): Promise<EpicListing[]> {
    const results = await Promise.all(
      this.repos.map((repo) =>
        this.gh.graphql<ListMilestonesResponse>(LIST_MILESTONES_QUERY, {
          owner: this.owner,
          repo,
        })
      ),
    );

    const seen = new Set<string>();
    const epics: EpicListing[] = [];

    for (const result of results) {
      for (const m of result.repository?.milestones?.nodes ?? []) {
        if (seen.has(m.id)) continue;
        seen.add(m.id);
        epics.push(toEpicListing(m));
      }
    }

    return epics;
  }
}

function toEpicListing(m: MilestoneNode): EpicListing {
  return {
    ref: { id: m.id },
    name: m.title,
    description: m.description || null,
    priority: null,
    status: m.state === "OPEN" ? "open" : "done",
    story_count: m.openIssues.totalCount + m.closedIssues.totalCount,
  };
}
```

Notes:
- `m.description || null` converts both `null` and `""` to `null` — GitHub returns an empty string when no description is set.
- `repos` is an array to support multi-repo projects; `Promise.all` keeps the fetches parallel.
- The `seen` set deduplicates milestones that appear in multiple repos.

---

### Step 4 — `src/adapters/github/backend.ts`: Wire in EpicService

Four targeted edits. The constructor parameter list and constructor call in `factory.ts` (Step 5) must be updated together — the positional argument order must match exactly.

**4a — Add `EpicService` import:**

Add after the existing internal service imports (after the `ConfigReloader` import line):

```typescript
import { EpicService } from "./internal/epic-service.ts";
```

**4b — Add `EpicListing` to the domain types import:**

Before:
```typescript
import type { SprintRef, Story, StoryRef } from "../../domain/types.ts";
```

After:
```typescript
import type { EpicListing, SprintRef, Story, StoryRef } from "../../domain/types.ts";
```

**4c — Add `epicService` to the constructor parameter list:**

Insert `private readonly epicService: EpicService` after `impedimentService` and before `config`. The full constructor becomes:

```typescript
  constructor(
    private readonly labelResolver: LabelResolver,
    private readonly userMilestoneResolver: UserMilestoneResolver,
    private readonly fieldValueMutator: FieldValueMutator,
    private readonly burndownCalculator: BurndownCalculator,
    private readonly sprintHistoryService: SprintHistoryService,
    private readonly vocabularyManager: VocabularyManager,
    private readonly storyQueryService: StoryQueryService,
    private readonly storyMutationService: StoryMutationService,
    private readonly impedimentService: ImpedimentService,
    private readonly epicService: EpicService,
    private readonly config: RuntimeConfig,
    private readonly owner: string,
    private readonly repo: string,
    private readonly configReloader: ConfigReloader,
  ) {}
```

**4d — Add `getEpics()` delegation method:**

Add in the story read delegations section, after `getStoryDetail`:

```typescript
  getEpics(): Promise<EpicListing[]> {
    return this.epicService.getEpics();
  }
```

---

### Step 5 — `src/adapters/github/factory.ts`: Construct and wire EpicService

Three targeted edits. The `epicService` argument position in the constructor call must match Step 4c exactly.

**5a — Add `EpicService` import:**

Add after the existing internal service imports (after the `VocabularyManager` import line):

```typescript
import { EpicService } from "./internal/epic-service.ts";
```

**5b — Construct `EpicService`:**

Add after the `storyQueryService` construction and before the `storyMutationService` construction:

```typescript
  const epicService = new EpicService(ghClient, owner, gh.tracked_repos);
```

`gh.tracked_repos` is `string[]` from `GitHubBackendConfig` — this passes all configured repositories so milestones are fetched across the full project scope.

**5c — Pass `epicService` to `GitHubProjectBackend` constructor:**

Update the constructor call to include `epicService` after `impedimentService` and before `config`:

```typescript
  const backend = new GitHubProjectBackend(
    labelResolver,
    userMilestoneResolver,
    fieldValueMutator,
    burndownCalculator,
    sprintHistoryService,
    vocabularyManager,
    storyQueryService,
    storyMutationService,
    impedimentService,
    epicService,
    config,
    owner,
    primaryRepo,
    configReloader,
  );
```

---

## Verification Checklist

Run these commands after completing all five steps:

```sh
deno lint
deno test
deno check src/adapters/github/backend.ts src/adapters/github/factory.ts src/adapters/github/internal/epic-service.ts src/adapters/github/queries.ts
```

Expected outcomes:
- `deno lint` — passes with no warnings
- `deno test` — all existing tests pass (no new tests required in this phase — the `getEpics()` stub in the backlog test mock already returns `[]`)
- TypeScript check — `GitHubProjectBackend` now satisfies `ProjectBackend` (which extends `EpicPort` via `ProjectReader`); the Phase 1 compile error is resolved
- TypeScript check — `EpicService.getEpics()` return type is `Promise<EpicListing[]>`, matching `EpicPort`
- TypeScript check — no errors in any file in scope
- Manual smoke test (optional): calling `scrum_get_backlog` via the MCP inspector returns an `epics` array populated with milestones from the configured repos
