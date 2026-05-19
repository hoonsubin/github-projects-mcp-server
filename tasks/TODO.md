# Implementation Strategy: Phase 1 — Domain Layer Types & Port Contracts

**Tickets:** #75 (EpicRef / EpicListing), #96 (DependencyEntry / dependency fields), #101 (EpicPort / ProjectReader composition)
**Branch:** `feature/epics-type`
**Constraint:** Build must stay green throughout. No logic changes. No adapter changes. All new fields on existing interfaces use `?` (optional) to avoid breaking callers.

---

## What This Phase Does

Adds new types and port method signatures to exactly two files:

| File | What changes |
|---|---|
| `src/domain/types.ts` | Add `EpicRef`, `EpicListing`, `DependencyEntry`; extend `StoryBase`; remove stale comment |
| `src/scrum/ports.ts` | Add `EpicPort`; extend `StoryListing`, `StoryUpdates`, `ProjectReader` |

**Nothing else changes.** No use cases, no adapters, no tools, no tests, no GraphQL. After this phase, `GitHubProjectBackend` will have a TypeScript compile error for the missing `getEpics()` method — this is expected and intentional; it is resolved in Phase 3.

---

## Execution Order

Apply changes in this exact sequence. Each step must leave the file valid TypeScript.

### Step 1 — `src/domain/types.ts`: Remove stale comment

On **line 22**, delete the following line entirely:

```
// todo: need to handle epics as first-class object
```

### Step 2 — `src/domain/types.ts`: Add `EpicRef`

Insert after the closing `}` of `ImpedimentRef` (currently lines 28–30). Add a blank line separator, then:

```typescript
/**
 * A reference to a single Epic.
 * On GitHub: id is the Milestone node ID (MI_...).
 * Pass to story create/update tools as the epic identifier.
 */
export interface EpicRef {
  id: string;
}
```

### Step 3 — `src/domain/types.ts`: Add `EpicListing`

Insert directly after the closing `}` of `EpicRef`. Add a blank line separator, then:

```typescript
/**
 * Lightweight epic entry for planning contexts.
 * Returned in scrum_get_backlog alongside StoryListing[].
 * Full epic detail (child stories, history) is derived by the agent via
 * scrum_get_backlog filtered by epic name.
 */
export interface EpicListing {
  ref: EpicRef;
  name: string;
  description: string | null;
  priority: string | null; // team's vocabulary value, or null
  status: "open" | "in_progress" | "done" | null;
  story_count: number; // total stories under this epic (all statuses)
}
```

### Step 4 — `src/domain/types.ts`: Add `DependencyEntry`

Insert directly after the closing `}` of `EpicListing`. Add a blank line separator, then:

```typescript
/**
 * A single dependency link between two stories.
 * key is always present (human-readable issue number, e.g. "17").
 * ref.id is the project item ID when resolvable from in-memory context; null otherwise.
 * title is the story title when available; null if not yet resolved.
 */
export interface DependencyEntry {
  key: string;
  title: string | null;
  ref: { id: string | null };
}
```

### Step 5 — `src/domain/types.ts`: Extend `StoryBase`

Add two optional fields at the **end** of the `StoryBase` interface body, before its closing `}`:

```typescript
  blocked_by?: DependencyEntry[]; // stories that must be Done before this one starts
  blocks?: DependencyEntry[];     // stories that are downstream of this one
```

The fields are optional (`?`) intentionally — Phase 4 makes them required. Do not remove the `?` here.

---

### Step 6 — `src/scrum/ports.ts`: Update the import line

The current import at **line 16** is:

```typescript
import type { SprintRef, Story, StoryRef } from "../domain/types.ts";
```

Change it to:

```typescript
import type { EpicListing, SprintRef, Story, StoryRef } from "../domain/types.ts";
```

### Step 7 — `src/scrum/ports.ts`: Add `has_dependencies` to `StoryListing`

`StoryListing` currently ends with `writable: boolean`. Add one field after it, before the closing `}`:

```typescript
  has_dependencies: boolean; // true when the story body contains a ## Dependencies section
```

### Step 8 — `src/scrum/ports.ts`: Add `blocked_by` to `StoryUpdates`

`StoryUpdates` currently ends with `epic?: string | null`. Add one field after it, before the closing `}`:

```typescript
  blocked_by?: StoryRef[] | null; // null clears all; omit to leave unchanged
```

### Step 9 — `src/scrum/ports.ts`: Add `EpicPort` interface

Insert a new interface **before** the `BacklogPort` definition. Add it in the "Focused port interfaces" section, immediately before `BacklogPort`:

```typescript
/**
 * Epic port — returns all epics for the project.
 * Used by: getBacklogUseCase
 */
export interface EpicPort {
  getEpics(): Promise<EpicListing[]>;
}
```

### Step 10 — `src/scrum/ports.ts`: Compose `EpicPort` into `ProjectReader`

The current `ProjectReader` extends line is:

```typescript
export interface ProjectReader
  extends BacklogPort, SprintPort, StoryPort, HistoryPort, BurndownPort, ImpedimentPort {
```

Change it to:

```typescript
export interface ProjectReader
  extends BacklogPort, SprintPort, StoryPort, HistoryPort, BurndownPort, ImpedimentPort, EpicPort {
```

`ProjectBackend extends ProjectReader`, so it inherits `EpicPort` automatically — no explicit change needed there.

---

## Out of Scope (Do Not Touch)

- `IssueStory.epic` type — stays `string | null` until Phase 2
- `DraftStory` — no changes
- `parseDependencies` or `generateDependencySection` functions — Phase 5 (adapter layer)
- `DependencyPort` interface — not part of the six-phase plan; dependencies are parsed from story body text
- `blocks` write field on `StoryUpdates` — added in Phase 4 alongside making `blocked_by`/`blocks` required
- Any file outside `src/domain/types.ts` and `src/scrum/ports.ts`

---

## Verification Checklist

Run these after completing all ten steps:

```sh
deno lint
deno test
deno check src/domain/types.ts src/scrum/ports.ts
```

Expected outcomes:
- `deno lint` — passes with no warnings
- `deno test` — all existing tests pass (no logic changed)
- TypeScript check — `EpicRef`, `EpicListing`, `DependencyEntry`, `EpicPort` are all importable
- TypeScript check — **one expected error**: `GitHubProjectBackend` does not implement `getEpics()` from `EpicPort`. This error is intentional and will be resolved in Phase 3. Do not add a stub implementation to silence it.
