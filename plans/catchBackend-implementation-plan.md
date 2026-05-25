# `catchBackend()` Implementation Plan

## Current State (after recent changes)

| Piece                                         | File                                                                         | Status                                                                         |
| --------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `AdapterError` base class                     | [`src/domain/errors.ts:56`](src/domain/errors.ts:56)                         | ✅ Defined with `backendName: SupportedBackend`, `code`, `recovery`, `context` |
| `GitHubApiError extends AdapterError`         | [`src/adapters/github/errors.ts:70`](src/adapters/github/errors.ts:70)       | ✅ Extends `AdapterError`, sets `backendName = "github"`                       |
| `catchBackend()` helper                       | [`src/services/error-enrichment.ts:47`](src/services/error-enrichment.ts:47) | ❌ References old name `BackendError` (should be `AdapterError`)               |
| `enrichError()`                               | [`src/services/error-enrichment.ts:32`](src/services/error-enrichment.ts:32) | ❌ Checks `instanceof GitHubApiError` (should check `instanceof AdapterError`) |
| `UnsupportedCapabilityError`                  | [`src/adapters/abstract-backend.ts:41`](src/adapters/abstract-backend.ts:41) | ❌ Extends bare `Error`, not `AdapterError`                                    |
| `SupportedBackend` (as const + derived union) | [`src/domain/types.ts:378`](src/domain/types.ts:378)                         | ✅ Done                                                                        |

## Implementation Order

### Step 1 — Fix `error-enrichment.ts` (prerequisite)

**File:** [`src/services/error-enrichment.ts`](src/services/error-enrichment.ts)

Two changes:

**1a.** `enrichError()` — replace `instanceof GitHubApiError` with `instanceof AdapterError`:

```typescript
export const enrichError = (err: unknown): string => {
  if (err instanceof AdapterError) {
    const detail = err.context ? `\nDetails: ${JSON.stringify(err.context)}` : "";
    return `[${err.code}] ${err.message}${detail}\n\n→ Recovery: ${err.recovery}`;
  }
  return err instanceof Error ? `Error: ${err.message}` : `Error: ${String(err)}`;
};
```

**1b.** `catchBackend()` — replace `instanceof BackendError` with `instanceof AdapterError`:

```typescript
if (err instanceof AdapterError) { /* ... */ }
```

Also clean up unused import: remove `import { GitHubApiError }` and `export { GitHubApiError }` — they are no longer needed since the code now checks `AdapterError` generically.

### Step 2 — Fix `UnsupportedCapabilityError` (prerequisite)

**File:** [`src/adapters/abstract-backend.ts`](src/adapters/abstract-backend.ts:41)

Change `extends Error` to `extends AdapterError`:

```typescript
import { AdapterError } from "../domain/errors.ts";
import type { SupportedBackend } from "../domain/types.ts";

export class UnsupportedCapabilityError extends AdapterError {
  override readonly name = "UnsupportedCapabilityError";
  override readonly backendName: SupportedBackend;
  override readonly code = "UNSUPPORTED_CAPABILITY";
  override readonly recovery: string;
  readonly method: string;

  constructor(platform: string, method: string) {
    const message = `Platform "\${platform}" does not support the "\${method}" operation.`;
    super(message);
    this.backendName = platform as SupportedBackend;
    this.recovery = `Use a different adapter that supports "\${method}", ` +
      `or check PlatformCapabilities before calling this method.`;
    this.method = method;
  }
}
```

Now all three throwable error types (`GitHubApiError`, `UnsupportedCapabilityError`) inherit from `AdapterError` and get caught by `catchBackend()`.

### Step 3 — Wire `catchBackend()` into Use-Cases

**Decision rule for each backend call:**

| Call type                       | Wrap with `catchBackend()`? | Why                                   |
| ------------------------------- | --------------------------- | ------------------------------------- |
| `backend.reload()`              | ❌ No                       | Must succeed — no state without it    |
| `backend.getPlatformState()`    | ❌ No                       | Must succeed — no response without it |
| `backend.getEpics()`            | ✅ Yes                      | Orient works without epic context     |
| `backend.getSprintCompletion()` | ✅ Yes                      | Orient works without workPct          |
| `backend.findItems()`           | ❌ No                       | The whole purpose of the call         |
| `backend.getStoryDetail()`      | ❌ No                       | The whole purpose of the call         |
| `backend.getAnalytics()`        | ❌ No                       | The whole purpose of the call         |
| `backend.createStory()`         | ❌ No                       | Must succeed                          |
| `backend.setField()`            | ✅ Yes                      | Already wrapped per-field in handler  |

**Files to modify in `src/scrum/`:**

| File                                                     | Backend calls to wrap                        |
| -------------------------------------------------------- | -------------------------------------------- |
| [`orient.ts`](src/scrum/orient.ts)                       | `getEpics()`, `getSprintCompletion()`        |
| [`get-story.ts`](src/scrum/get-story.ts)                 | None (getStoryDetail is the primary purpose) |
| [`find-items.ts`](src/scrum/find-items.ts)               | None (findItems is the primary purpose)      |
| [`get-analytics.ts`](src/scrum/get-analytics.ts)         | None (getAnalytics is the primary purpose)   |
| [`get-board-health.ts`](src/scrum/get-board-health.ts)   | None (getBoardHealth is the primary purpose) |
| [`template-resource.ts`](src/scrum/template-resource.ts) | None (fetchRepoFile is the primary purpose)  |

**Each use-case return type gets a `warnings: readonly string[]` field.**

### Step 4 — Simplify Handler Partial-Failure Code

**File:** [`src/tools/scrum-write.ts`](src/tools/scrum-write.ts)

Replace direct `enrichError()` calls with `catchBackend()` in the existing partial-failure patterns:

- `scrum_create_story` — lines 237, 248, 259, 273 (`failedFields.push({ reason: enrichError(err) })`)
- `scrum_plan_sprint` — lines 353, 368 (`skipped.push({ reason: enrichError(err) })`)

Change pattern:

```typescript
// Before:
try {
  await backend.setField(storyRef, "sprint", params.sprint);
} catch (err) {
  failedFields.push({ field: "sprint", reason: enrichError(err) });
}

// After:
const { warnings: sprintWarnings } = await catchBackend(
  "set sprint field",
  () => backend.setField(storyRef, "sprint", params.sprint),
);
if (sprintWarnings.length > 0) {
  failedFields.push({ field: "sprint", reason: sprintWarnings[0] });
}
```

## Verification

After all steps:

1. `enrichError()` handles any `AdapterError` subclass (not just `GitHubApiError`) → `UnsupportedCapabilityError` gets `[UNSUPPORTED_CAPABILITY]` formatting instead of generic `"Error: ..."`
2. `catchBackend()` catches any `AdapterError` subclass and converts to `warnings[]`
3. Use-cases with optional backend calls return partial data with warnings
4. Handler partial-failure patterns (`create_story`, `plan_sprint`) use `catchBackend` consistently instead of calling `enrichError()` directly
5. Hard failures (network, auth) still propagate through to the handler's `catch` block and `enrichError()`

## Mermaid Flow

```mermaid
flowchart TD
    subgraph Adapter["ADAPTER LAYER throws AdapterError"]
        GH["GitHubApiError<br/>backendName='github', code, recovery, context"]
        UC["UnsupportedCapabilityError<br/>backendName, code='UNSUPPORTED_CAPABILITY', recovery"]
    end

    subgraph UseCase["USE-CASE LAYER"]
        CB["catchBackend(label, fn)"]
        OPT["Optional calls: getEpics, getSprintCompletion, setField<br/>→ wrap with catchBackend"]
        HARD["Hard prereqs: getPlatformState, findItems, createStory<br/>→ NO wrap, let propagate"]
    end

    subgraph Handler["HANDLER LAYER"]
        CATCH["catch block<br/>(non-AdapterError only)"]
        EE["enrichError() → formatted text"]
        SEND["MCP isError:true response"]
    end

    Adapter --> OPT
    Adapter --> HARD
    OPT -->|AdapterError caught| CB
    HARD -->|AdapterError or other| CATCH
    CB -->|returns { value, warnings[] }| RESULT["partial data + warnings"]
    CATCH --> EE --> SEND
```
