# Phases 0–3 Implementation Assessment: Smell Check & Architectural Integrity

**Assessment Date:** 2026-05-24\
**Scope:** Changes to files across phases 0 (Adapter Infrastructure), 1 (Domain Types), 2 (Port Types), and 3 (Schema Types)\
**Evaluator:** Clean Code Assistant (architect mode)

---

## Overall Verdict

The implementation is **structurally sound but incomplete in critical ways**. The new abstractions (`PlatformCapabilities`, `AbstractProjectBackend`, `AdapterFactory`, `SprintTotals` discriminated union, new schemas) are well-designed and follow Clean Architecture principles. However, the codebase is in a **mid-migration state** where old and new code coexist, and several promised changes from the TODO.md plan were not delivered in phases 0–3.

**Severity distribution:**

| Severity    | Count | Key areas                                                                                                                   |
| ----------- | ----- | --------------------------------------------------------------------------------------------------------------------------- |
| 🔴 Critical | 2     | Duplicate `storyToListing` still 3x; OrientResult still private                                                             |
| 🟡 Medium   | 6     | 13-arg constructor; RuntimeConfig coupling; concrete cast; parallel schema sets; duplicated date math; naming inconsistency |
| 🟢 Low      | 4     | Comment style preferences; tight vertical formatting; stub surface documentation                                            |

---

## 1. Code Smells

### 🔴 CRITICAL — F3: Function Duplication (`storyToListing` persists in 3 files)

**Files:** [`src/scrum/get-backlog.ts:39`](src/scrum/get-backlog.ts:39), [`src/scrum/get-sprint.ts:34`](src/scrum/get-sprint.ts:34), [`src/scrum/get-history.ts:25`](src/scrum/get-history.ts:25)

**Problem:** The plan (Issue 8) explicitly calls out this duplication and schedules a shared mapper in P4 (`src/scrum/listing-mappers.ts`). Phase 4 is not yet implemented, so the duplication remains as dead-weight technical debt for any developer touching these three files.

```typescript
// get-backlog.ts:39 — same shape as get-sprint.ts:34
const storyToListing = (story: Story): StoryListing => ({
  ref: { id: story.ref.id, key: story.key },
  title: story.title,
  status: story.status,
  story_points: story.story_points,
  priority: story.priority,
  sprint: story.sprint,
  writable: true,
  has_dependencies: story.blocked_by,
});
```

**Fix:** Extract to `src/scrum/listing-mappers.ts` (per the plan). Do NOT copy the pattern in any new code.

---

### 🔴 CRITICAL — G1: OrientResult Still Private

**File:** [`src/scrum/orient.ts:10`](src/scrum/orient.ts:10)

**Problem:** The plan (Issue 10, P5) says `OrientResult` must be exported from `src/domain/types.ts` and imported by `orient.ts`. But the actual code still has the private interface declaration inline. Any test or handler that needs the orient output type must re-declare it or use `z.infer<>`.

```typescript
// orient.ts:10 — still private
interface OrientResult { ... }
```

**Fix:** This is P5 work — export `OrientResult` from `src/domain/types.ts` and import it here.

---

### 🟡 MEDIUM — F1: Constructor Proliferation (13 positional params)

**File:** [`src/adapters/github/backend.ts:50`](src/adapters/github/backend.ts:50)

**Problem:** `GitHubProjectBackend` constructor takes **13 positional arguments**. This violates Function Rule #4 (fewer arguments: niladic > monadic > dyadic > triadic). Every new service injected adds a positional argument, and callers must remember the exact order. This is a maintenance hazard.

```typescript
constructor(
  private readonly labelResolver: LabelResolver,
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

**Fix:** Introduce a `GitHubBackendDependencies` interface (parameter object pattern). The factory builds this object and passes it. This is a low-risk refactor that eliminates ordering errors:

```typescript
export interface GitHubBackendDependencies {
  labelResolver: LabelResolver;
  fieldValueMutator: FieldValueMutator;
  burndownCalculator: BurndownCalculator;
  sprintHistoryService: SprintHistoryService;
  vocabularyManager: VocabularyManager;
  storyQueryService: StoryQueryService;
  storyMutationService: StoryMutationService;
  impedimentService: ImpedimentService;
  epicService: EpicService;
  config: RuntimeConfig;
  owner: string;
  repo: string;
  configReloader: ConfigReloader;
}
```

---

### 🟡 MEDIUM — G3: Duplicated Date Math (3 implementations)

**Files:** [`src/scrum/sprint-math.ts:16`](src/scrum/sprint-math.ts:16), [`src/scrum/sprint-math.ts:124`](src/scrum/sprint-math.ts:124), [`src/adapters/github/internal/burndown-calculator.ts:63`](src/adapters/github/internal/burndown-calculator.ts:63)

**Problem:** Sprint end-date computation and days-remaining calculation are implemented 3 different times, with **inconsistent timezone handling**:

| Function                                                          | Timezone | Method                                                    |
| ----------------------------------------------------------------- | -------- | --------------------------------------------------------- |
| `buildSprintMeta` (sprint-math.ts:25)                             | Local TZ | `new Date(startDate); endDate.setDate(...)`               |
| `buildSprintWindow` (sprint-math.ts:124)                          | UTC      | `startDate.setUTCHours(0,0,0,0); endDate.setUTCDate(...)` |
| `BurndownCalculator.getBurndownInput` (burndown-calculator.ts:63) | Local TZ | `new Date(startDate); endDate.setDate(...)`               |

This inconsistency will produce off-by-one errors when sprint boundaries cross DST transitions in non-UTC timezones.

**Fix:** Extract a shared `computeSprintEndDate(startDate: string, durationDays: number): string` function in `sprint-math.ts` that uses UTC consistently. All three call sites use this one function.

---

### 🟡 MEDIUM — DIP Violation: Concrete Config Cast in Port Method

**File:** [`src/adapters/github/backend.ts:95`](src/adapters/github/backend.ts:95)

**Problem:** `getPlatformState()` — a port method — casts `this.config.scrumConfig.backends.github as GitHubBackendConfig`. While this is within the adapter itself, it leaks GitHub-specific config knowledge into a method whose signature is defined by the port interface. If the config shape changes, this cast breaks silently.

```typescript
async getPlatformState(...): Promise<PlatformState> {
  const ghConfig = this.config.scrumConfig.backends.github as GitHubBackendConfig;
  // ... uses ghConfig.status_display, ghConfig.priority_display, ghConfig.type_display ...
}
```

**Fix:** `GitHubProjectBackend` should receive the already-resolved display config in its constructor or via a dedicated accessor, not cast from the opaque `backends` map at call time. The cast is acceptable as a P0/P1 intermediate, but should be resolved before P7.

---

### 🟡 MEDIUM — N4: Naming Inconsistency (camelCase vs snake_case at boundary)

**Files:** [`src/scrum/ports.ts:93`](src/scrum/ports.ts:93), [`src/scrum/orient.ts:15`](src/scrum/orient.ts:15)

**Problem:** Port interfaces use `camelCase` (`missingOptions`, `completedCount`, `typeDisplay`, `templateUris`). But the orient result — which is the JSON output sent to the agent — uses `snake_case` (`missing_options`, `completed_count`, `type_field`, `template_uris`). The mapping between them is a manual field-by-field copy with name transformation:

```typescript
// orient.ts:72 — manual mapping
missing_options: state.fields.status.missingOptions,  // camelCase → snake_case
```

This is error-prone and harder to read than necessary. Every new field requires two entries.

**Fix:** Either:

1. Make `PlatformState` use `snake_case` to match the wire format, or
2. Use a shared mapper function that transforms the entire object at once, rather than manual field copying.

---

### 🟡 MEDIUM — G2: Parallel Schema Definitions (dead schemas not removed)

**File:** [`src/schemas/scrum.ts`](src/schemas/scrum.ts)

**Problem:** The new schemas (`FindItemsSchema:197`, `GetAnalyticsSchema:259`, `GetBoardHealthSchema:285`) coexist with the old schemas (`GetBacklogSchema:126`, `GetSprintSchema:107`, `GetHistorySchema:173`, `GetBurndownSchema:186`, `GetTemplateSchema:533`). The plan says old schemas are removed in P3, but they remain — and `GetTemplateSchema` is specifically flagged for removal because templates move to MCP resources.

This means `src/schemas/scrum.ts` has **13 schemas** when the target is ~8. Maintainers must know which schemas are "current" and which are "legacy".

**Fix:** Remove the 5 old schemas flagged in the plan (P3 work). The old tool handlers in `scrum-read.ts` that reference them will need updating too — but that's P6 work, so mark them with `@deprecated` JSDoc tags until then.

---

### 🟢 LOW — F5: Stub Methods with Long Error Messages

**Files:** [`src/adapters/github/backend.ts:192`](src/adapters/github/backend.ts:192), [`src/adapters/github/backend.ts:200`](src/adapters/github/backend.ts:200), [`src/adapters/github/backend.ts:208`](src/adapters/github/backend.ts:208)

**Problem:** `findItems()`, `getAnalytics()`, and `getBoardHealth()` are stubs that throw errors with long instructional messages. While this is intentional (known intermediate state), it means any code path that calls these before P7 gets a runtime crash rather than a graceful degradation.

```typescript
findItems(_filter: ResolvedItemFilter): Promise<ItemSearchResult> {
  throw new Error(
    "findItems not yet implemented — " +
    "this stub exists so the port interface compiles. " +
    "Full implementation coming in P7 (GitHub Adapter Migration).",
  );
}
```

**Mitigation:** Acceptable as an intermediate state. Flag these with `@throws {Error}` in JSDoc so callers know.

---

### 🟢 LOW — C1: Comment-Heavy File Headers

**Files:** Multiple new files (`capabilities.ts`, `abstract-backend.ts`, `factory.ts`, `domain/types.ts`)

**Observation:** Every new file has an extensive ASCII-banner header comment (3-12 lines). While these explain intent well, they violate the clean-code maxim that "the best comment is no comment — rewrite code to be self-explanatory." The file names and type names already convey most of this information.

**Suggestion:** Remove the ASCII banners (`// ==================...`) and keep only the JSDoc `/** */` at the type/interface declaration level. The function and type names should speak for themselves.

---

## 2. Architectural Integrity

### 2.1 Layer Compliance — ✅ GOOD

No inward adapter leaks discovered. Verified against the plan's verification gate:

```bash
grep -r "import.*from.*adapters/github" src/scrum/ src/domain/ src/schemas/
```

Result: Zero matches. The dependency direction is correct:

- `domain/types.ts` imports nothing → ✅ innermost layer
- `domain/config.ts` imports nothing → ✅
- `domain/errors.ts` imports nothing → ✅
- `scrum/ports.ts` imports from domain → ✅
- `schemas/scrum.ts` imports from domain → ✅ (imports `toSprintName`, `EpicRef`)
- `adapters/capabilities.ts` imports nothing → ✅
- `adapters/abstract-backend.ts` imports from ports + domain → ✅
- `adapters/factory.ts` imports from ports + domain + capabilities → ✅

### 2.2 Abstract Base Pattern — ✅ EXCELLENT

`AbstractProjectBackend` correctly:

1. **Uses `protected resolveRef()`** — keeps ref resolution as an adapter-internal concern, not part of the port interface. Use-case code never sees it.
2. **Throws `UnsupportedCapabilityError`** for optional operations — loud failures are better than silent no-ops.
3. **Declares `abstract capabilities`** — forces every concrete adapter to declare what it supports.
4. **Implements `ProjectReader & ProjectWriter` structurally** — TypeScript structural typing accepts the concrete adapter wherever a narrow port is expected.

### 2.3 Dependency Injection Style — ⚠️ MIXED

**Good:** All internal services use constructor injection (DIP). The `StoryMutationService` receives only what it needs through its constructor.

**Bad:** The facade `GitHubProjectBackend` receives 13 positional dependencies — this is a **God Constructor** anti-pattern. Clean Architecture advocates tell you to keep constructors small. A parameter object is the standard fix.

### 2.4 Migration State — ⚠️ INCOMPLETE

The codebase is in a transitional state between the old port interfaces and the new ones:

| Component                   | Old State                   | New State                        | Status           |
| --------------------------- | --------------------------- | -------------------------------- | ---------------- |
| `GitHubProjectBackend`      | `implements ProjectBackend` | Extends `AbstractProjectBackend` | ❌ NOT DONE (P7) |
| `src/scrum/get-sprint.ts`   | Active use-case             | Replaced by `find-items.ts`      | ❌ NOT DONE (P4) |
| `src/scrum/get-backlog.ts`  | Active use-case             | Replaced by `find-items.ts`      | ❌ NOT DONE (P4) |
| `src/scrum/get-history.ts`  | Active use-case             | Replaced by `get-analytics.ts`   | ❌ NOT DONE (P4) |
| `src/scrum/get-burndown.ts` | Active use-case             | Replaced by `get-analytics.ts`   | ❌ NOT DONE (P4) |
| `src/scrum/get-template.ts` | Active use-case             | MCP resources                    | ❌ NOT DONE (P6) |
| `LegacyProjectBackendOps`   | N/A                         | Bridge interface                 | ✅ CREATED (P2)  |
| `FindItemsSchema`           | N/A                         | New schema                       | ✅ CREATED (P3)  |
| `GetAnalyticsSchema`        | N/A                         | New schema                       | ✅ CREATED (P3)  |
| `GetBoardHealthSchema`      | N/A                         | New schema                       | ✅ CREATED (P3)  |

The `LegacyProjectBackendOps` interface is a well-designed bridge — it keeps the existing code compiling while the new path is under construction. But **dual maintenance** is a real cost: every bug fix to `getSprintStories()` or `getBacklogStories()` must be replicated in the `findItems()` implementation.

### 2.5 Interface Segregation — ✅ GOOD

The port layer correctly uses narrow interfaces:

- `FindItemsPort` (1 method)
- `AnalyticsPort` (1 method)
- `BoardHealthPort` (1 method)
- `StoryPort` (1 method)
- `EpicPort` (1 method)
- `ImpedimentPort` (3 methods)
- `FileReaderPort` (1 method)

`ProjectReader` composes all read ports. `ProjectBackend` is the legacy union. This is textbook ISP — use-case functions depend only on what they need.

### 2.6 Port Schema Boundary — ⚠️ NOTABLE

`ItemFilter` and `AnalyticsQuery` are correctly placed in `ports.ts` as input types (they cross the port boundary). The plan explicitly calls this out as Issue 4. This is done correctly.

However, `GetBacklogSchema`, `GetSprintSchema`, `GetHistorySchema`, `GetBurndownSchema`, and `GetTemplateSchema` still exist alongside the new schemas. Since schemas are input validators for the MCP boundary, having both sets means:

- Old tool handlers validate via old schemas
- New tool handlers validate via new schemas
- The same parameter shape may be validated differently depending on which handler is called

This is acceptable during migration but must be resolved before P6 is considered complete.

### 2.7 Error Type Completeness — ✅ GOOD

| Error Type                   | Exists? | Location                              |
| ---------------------------- | ------- | ------------------------------------- |
| `StoryNotFoundError`         | ✅      | `src/domain/errors.ts:44`             |
| `SprintNotScheduledError`    | ✅      | `src/domain/errors.ts:30`             |
| `UnsupportedCapabilityError` | ✅      | `src/adapters/abstract-backend.ts:46` |
| `GitHubApiError`             | ✅      | `src/adapters/github/errors.ts`       |
| `assertNever`                | ✅      | `src/domain/errors.ts:20`             |

The error hierarchy is complete. `StoryNotFoundError` is in the domain layer (good — both use-cases and adapters can throw it). `UnsupportedCapabilityError` is in the adapter layer (appropriate — it's an adapter concern).

### 2.8 `SprintTotals` Discriminated Union — ✅ FIXED

The plan's Issue 7 is resolved. The old runtime guard (`"committed_points" in s.totals`) is replaced by a proper discriminated union:

```typescript
export type SprintTotals =
  | { kind: "active"; by_status: Record<string, number>; story_points: number }
  | {
    kind: "completed";
    by_status: Record<string, number>;
    story_points: number;
    committed_points: number;
    completed_points: number;
  };
```

And in `get-history.ts:106`, the narrowing works correctly:

```typescript
s.totals.kind === "completed" ? (s.totals.completed_points ?? 0) : 0;
```

---

## 3. Summary of Issues by Severity

### 🔴 Must Fix Before P4 Begins

| # | Issue                                     | File                                                | Smell Code |
| - | ----------------------------------------- | --------------------------------------------------- | ---------- |
| 1 | `storyToListing` duplicated 3x            | `get-backlog.ts`, `get-sprint.ts`, `get-history.ts` | F3/DRY     |
| 2 | `OrientResult` still private in orient.ts | `src/scrum/orient.ts:10`                            | G1         |

### 🟡 Should Fix Before P6

| # | Issue                                                                                          | File                                                                   | Smell Code       |
| - | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ---------------- |
| 3 | 13-positional-arg constructor                                                                  | `src/adapters/github/backend.ts:50`                                    | F1               |
| 4 | Concrete `GitHubBackendConfig` cast in port method                                             | `src/adapters/github/backend.ts:95`                                    | DIP              |
| 5 | Date math duplicated 3x with inconsistent TZ                                                   | `sprint-math.ts:16`, `sprint-math.ts:124`, `burndown-calculator.ts:63` | G3               |
| 6 | camelCase/snake_case naming inconsistency                                                      | `ports.ts` ↔ `orient.ts`                                               | N4               |
| 7 | 5 dead schemas coexisting with 3 new ones                                                      | `src/schemas/scrum.ts`                                                 | G2               |
| 8 | `GitHubProjectBackend` still `implements ProjectBackend`, not `extends AbstractProjectBackend` | `src/adapters/github/backend.ts:50`                                    | C1 (P7 not done) |

### 🟢 Consider Before P8

| #  | Issue                                 | File                 | Smell Code |
| -- | ------------------------------------- | -------------------- | ---------- |
| 9  | ASCII-banner file headers             | Multiple new files   | C1         |
| 10 | Stub methods with long error messages | `backend.ts:192-214` | F5         |

---

## 4. What's Done Well

1. **Zero inward adapter leaks** — the verification gate passes. `src/scrum/`, `src/domain/`, and `src/schemas/` have no imports from `src/adapters/github/`.

2. **`SprintTotals` discriminated union** — Issue 7 is cleanly resolved. No more fragile runtime type guards.

3. **`LegacyProjectBackendOps` bridge** — well-designed migration mechanism that keeps the old code compiling while the new port surface is built.

4. **Interface Segregation** — the 6 narrow port interfaces (`FindItemsPort`, `AnalyticsPort`, `BoardHealthPort`, `StoryPort`, `EpicPort`, `ImpedimentPort`, `FileReaderPort`) follow ISP correctly.

5. **`UnsupportedCapabilityError`** — loud failure for optional operations is the right design choice.

6. **`resolveRef()` is `protected`** — kept as an adapter-internal concern, not exposed on any port interface.

7. **Config relocation** — `ArtifactType` correctly moved from `types.ts` to `config.ts`, breaking the circular import.

---

## 5. Action Items for Phases 4+

### P4 (Use-Case Migration)

- [ ] Extract shared `listing-mappers.ts` — resolves smell #1 (highest priority)
- [ ] Remove local `GetStoryResult`, `GetHistoryResult`, `GetBacklogResult`, `GetBurndownParams`, `SprintSingleResult`, `SprintAllResult`

### P5 (Orient Use-Case)

- [ ] Export `OrientResult` from `domain/types.ts` — resolves smell #2
- [ ] Add `getEpics()` call to `orientUseCase`
- [ ] Use `sprintContextFromSprintInfo()` factory

### P6 (Tool Handler Migration)

- [ ] Remove `GetTemplateSchema` from `schemas/scrum.ts` — resolves smell #7
- [ ] Remove/replace 5 old tool registrations from `scrum-read.ts`
- [ ] Undead schema removal (smell #7)

### P7 (GitHub Adapter Migration)

- [ ] Extend `AbstractProjectBackend` instead of `implements ProjectBackend` — resolves smell #8
- [ ] Implement `findItems()`, `getAnalytics()`, `getBoardHealth()` — resolves stub surface
- [ ] Resolve `GitHubBackendConfig` cast in `getPlatformState()` — resolves smell #4
- [ ] Consider parameter object for constructor — resolves smell #3

### P8 (Composition Root)

- [ ] Should resolve naturally once P0-P7 are done
