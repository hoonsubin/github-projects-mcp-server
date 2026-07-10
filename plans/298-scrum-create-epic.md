# #298 — `scrum_create_epic` Implementation Plan

## 1. Overview

| Attribute      | Value                                                                                             |
| -------------- | ------------------------------------------------------------------------------------------------- |
| **Status**     | Ready                                                                                             |
| **Type**       | User Story                                                                                        |
| **SP**         | 3                                                                                                 |
| **Blocked by** | [#297](https://github.com/hoonsubin/github-projects-mcp-server/issues/297) — Epic CRUD Foundation |
| **Blocks**     | Nothing                                                                                           |
| **Epic**       | MCP Tool Surface Modernization for Scrum Theory Alignment                                         |

### User Story

> As the agent, I want to create a new epic through a tool call so that I can bring a new initiative onto the board during sprint planning or grooming without asking the user to create it manually in the GitHub UI and report back.

### Tool Contract

```
scrum_create_epic(name: string, description?: string) → EpicRef { id, number }
```

### How It Fits the Tool Surface

This follows the **impediment pattern** (`scrum_log_impediment` + `scrum_update_impediment`): paired, special-purpose tools for domain-specific entities. Epics have only 3 writable fields (name, description, status) — the story pattern's complex content/board separation is unnecessary overhead.

The returned `EpicRef` can be immediately used in existing `scrum_update_story(epic: { id })` or `scrum_create_story(epic: { id })` to assign stories to the new epic.

### Pre-existing Port Types (from #297)

| Type                       | Location                                           | Shape                                          |
| -------------------------- | -------------------------------------------------- | ---------------------------------------------- |
| `CreateEpicInput`          | [`src/scrum/ports.ts:404`](src/scrum/ports.ts:404) | `{ name: string; description?: string }`       |
| `EpicRef`                  | [`src/domain/types.ts:49`](src/domain/types.ts:49) | `EntityRef & { number?: number }`              |
| `ProjectWriter.createEpic` | [`src/scrum/ports.ts:447`](src/scrum/ports.ts:447) | `(input: CreateEpicInput) => Promise<EpicRef>` |

No port changes are needed — #297 already declared everything.

---

## 2. Implementation Tasks

### 2.1 New Schema — `CreateEpicSchema`

**File:** [`src/schemas/scrum.ts`](src/schemas/scrum.ts) (add after `LogImpedimentSchema`)

```typescript
export const CreateEpicSchema = z.object({
  name: z
    .string()
    .min(1, "Epic name is required.")
    .describe("Epic name. Keep concise — one line describing the initiative."),
  description: z
    .string()
    .optional()
    .describe("Optional markdown description of the epic scope."),
}).strict(); // ← All 11 existing schemas use .strict(); must match convention
```

- `.min(1)` enforces AC "Given no name, the tool call is rejected with a validation error before any platform write is attempted."
- No `status` field — epics are always created open. Status transitions go through `scrum_update_epic`.
- `.strict()` rejects unknown keys before any platform write is attempted (consistent with all other schemas).
- Zod validation at the handler boundary means the backend never receives empty names.

### 2.2 New Use-Case — `create-epic.ts`

**File:** [`src/scrum/create-epic.ts`](src/scrum/create-epic.ts) (new file)

```typescript
// =============================================================================
// src/scrum/create-epic.ts - createEpicUseCase
//
// Creates a new epic (GitHub: milestone) via the platform's REST API.
// Returns an EpicRef the agent can use immediately for story assignment.
// =============================================================================

import type { CreateEpicInput, ProjectWriter } from "./ports.ts";
import type { EpicRef } from "../domain/types.ts";

export const createEpicUseCase = async (
  backend: ProjectWriter,
  input: CreateEpicInput,
): Promise<EpicRef> => {
  return backend.createEpic(input);
};
```

- Thin wrapper following the `update-impediment.ts` pattern (validate in handler, delegate to backend).
- `CreateEpicInput` and `ProjectWriter.createEpic` are declared by #297 — no port changes needed here.

### 2.3 New Write Handler — `handleCreateEpic`

**File:** [`src/tools/handlers/write.ts`](src/tools/handlers/write.ts:442) (add after `handleUpdateImpediment`)

```typescript
export const handleCreateEpic = async (
  backend: ProjectBackend,
  scrumConfig: ScrumConfig, // ← convention: all handlers take scrumConfig
  sessionCache: SessionCache, // ← needed for cache invalidation after create
  params: z.infer<typeof CreateEpicSchema>,
): Promise<McpTextResult> => {
  const input: CreateEpicInput = {
    name: params.name,
    ...(params.description !== undefined ? { description: params.description } : {}),
  };

  try {
    const epicRef = await createEpicUseCase(backend, input);
    sessionCache.invalidateOrient(); // ← AC: epic appears in next scrum_orient
    return toMcpTextResult({ ref: { id: epicRef.id, number: epicRef.number } });
  } catch (err) {
    return toToolErrorResult(err);
  }
};
```

- Follows the `(backend, scrumConfig, sessionCache, params)` parameter order used by every other handler in this file.
- Uses `createEpicUseCase` from [`src/scrum/create-epic.ts`](src/scrum/create-epic.ts).
- Returns `EpicRef` shape directly — no need for `EpicListing` (the agent can call `scrum_orient` to get the full listing).
- Capability-unavailable errors propagate naturally: the `AbstractProjectBackend` default throws `UnsupportedCapabilityError`, which the handler catches and converts to structured text via `toToolErrorResult()`.

**Required new imports in `write.ts`:**

```typescript
import { createEpicUseCase } from "../../scrum/create-epic.ts";
import { CreateEpicSchema } from "../../schemas/scrum.ts";
import type { CreateEpicInput } from "../../scrum/ports.ts";
import type { SessionCache } from "../../services/session-cache.ts";
```

### 2.4 Tool Registration

**File:** [`src/tools/scrum-write.ts`](src/tools/scrum-write.ts)

**2.4.1 Add tool name constant** (at the `SCRUM_WRITE_TOOL_NAMES` array, line ~38):

```typescript
export const SCRUM_WRITE_TOOL_NAMES = [
  "scrum_add_vocabulary",
  "scrum_create_story",
  "scrum_update_story",
  "scrum_set_field",
  "scrum_log_impediment",
  "scrum_update_impediment",
  "scrum_plan_sprint",
  "scrum_create_epic", // ← NEW
] as const;
```

`SCRUM_WRITE_TOOL_NAMES` is used by [`src/server.ts`](src/server.ts:148-153) for degraded-mode stub registration — adding `"scrum_create_epic"` ensures a stub is registered if the server starts in degraded mode.

**2.4.2 Import new handler + schema** (add to existing imports):

```typescript
import { CreateEpicSchema } from "../schemas/scrum.ts";
import { handleCreateEpic } from "./handlers/write.ts";
```

**2.4.3 Add tool registration** (after `scrum_create_story` block, before `scrum_plan_sprint`):

```typescript
server.registerTool(
  "scrum_create_epic",
  {
    title: "Create Epic",
    description: `Create a new epic on the project board.

        Args:
          name         string (required) - concise one-line title for the epic
          description  string (optional) - markdown description of the epic scope

        Returns: EpicRef — an { id, number } reference you can immediately pass
        to scrum_create_story(epic:) or scrum_update_story(epic:) to assign
        stories to the new epic. The epic also appears in the next scrum_orient
        listing automatically.

        Epics are created in the open state. Use scrum_update_epic to close them.`,
    inputSchema: CreateEpicSchema.shape,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  // Closure captures sessionCache + scrumConfig from registerScrumWriteTools scope
  (params: z.infer<typeof CreateEpicSchema>) =>
    handleCreateEpic(backend, scrumConfig, sessionCache, params),
);
```

- Annotations: `idempotentHint: false` because each call creates a new epic (not idempotent).
- The callback closure must capture `scrumConfig` and `sessionCache` from `registerScrumWriteTools`'s scope, matching the pattern of all other tool registrations in this file (see [`handleAddVocabulary` closure](src/tools/scrum-write.ts:83-99) for precedent).

### 2.5 Cache Invalidation

Handled inside `handleCreateEpic` (see §2.3). After a successful `backend.createEpic()` call, `sessionCache.invalidateOrient()` clears the cached orient data so the next `scrum_orient` call fetches fresh epic listings from the platform.

This satisfies AC: "The created epic appears in the next `scrum_orient` epic listing without requiring a manual refresh."

### 2.6 GitHub Adapter — `EpicMutationService.createMilestone()`

**File:** [`src/adapters/github/write-services/epic-mutation-service.ts`](src/adapters/github/write-services/epic-mutation-service.ts) (new file)

```typescript
// =============================================================================
// src/adapters/github/write-services/epic-mutation-service.ts
// Epic CRUD via GitHub REST API (milestones).
//
// All milestone writes are REST-only — the GraphQL API has no create/update
// mutations for milestones.  See spike #246 for the full API analysis.
// =============================================================================

import type { CreateEpicInput, EpicUpdates } from "../../../scrum/ports.ts";
import type { EpicListing, EpicRef } from "../../../domain/types.ts";
import type { GitHubInfraContext } from "../infra/infra-context.ts";

interface MilestoneResponse {
  id: number; // integer milestone number (REST path param)
  node_id: string; // MI_... GraphQL node ID
  title: string;
  description: string | null;
  state: "open" | "closed";
  open_issues: number;
  closed_issues: number;
}

export class EpicMutationService {
  constructor(
    private readonly ctx: GitHubInfraContext, // ← convention: uses ctx, not separate params
  ) {}

  async createMilestone(input: CreateEpicInput): Promise<EpicRef> {
    const { data } = await this.ctx.gh.rest<MilestoneResponse>(
      `repos/${this.ctx.owner}/${this.ctx.repo}/milestones`,
      {
        method: "POST",
        body: {
          title: input.name,
          ...(input.description ? { description: input.description } : {}),
          state: "open",
        },
      },
    );

    return { id: data.node_id, number: data.id };
  }
}
```

- **Uses `GitHubInfraContext`** (not separate `gh`/`owner`/`repo` params). This is the established convention — see [`StoryMutationService`](src/adapters/github/write-services/story-mutation-service.ts:156-162) which takes `private readonly ctx: GitHubInfraContext` as its first constructor parameter.
- Uses the existing `GitHubClient.rest()` method via `this.ctx.gh.rest<T>()` — no new HTTP infrastructure needed.
- `node_id` (MI_...) maps to `EpicRef.id`; `id` (integer) maps to `EpicRef.number`.
- Single-repo creation: the milestone is created in the primary repo only (`this.ctx.repo`). Per #246, milestones from secondary repos can still be updated/deleted by node ID but creation targets the primary.

### 2.7 Wire into `backend.ts`

**File:** [`src/adapters/github/backend.ts`](src/adapters/github/backend.ts)

**2.7.1 Add imports** (add to existing import block, ~line 21):

```typescript
import { EpicMutationService } from "./write-services/epic-mutation-service.ts";
import type { CreateEpicInput } from "../../scrum/ports.ts"; // ← needed for override signature
import type { EpicRef } from "../../domain/types.ts"; // ← needed for return type
```

`CreateEpicInput` and `EpicRef` are **not currently imported** in `backend.ts` — the plan must explicitly add them.

**2.7.2 Add to `GitHubBackendDependencies`** (at interface, ~line 75):

```typescript
export interface GitHubBackendDependencies {
  // ... existing fields ...
  readonly epicMutationService: EpicMutationService; // ← NEW
}
```

**2.7.3 Override `createEpic`** (add new method after `updateImpediment` at ~line 390):

```typescript
override async createEpic(input: CreateEpicInput): Promise<EpicRef> {
  return this.deps.epicMutationService.createMilestone(input);
}
```

- The `AbstractProjectBackend` default throws `UnsupportedCapabilityError` — this override gets called because the factory passes `GITHUB_CAPABILITIES` (which has all epic flags at `NATIVE`).

### 2.8 Wire into `create-backend.ts`

**File:** [`src/adapters/github/create-backend.ts`](src/adapters/github/create-backend.ts:165)

> **Note:** The original plan referenced `factory.ts`. The actual service wiring and `deps` construction lives in [`create-backend.ts`](src/adapters/github/create-backend.ts) (the `createGitHubBackend()` function). The file [`src/adapters/github/factory.ts`](src/adapters/github/factory.ts) contains the v2 `GitHubAdapterFactory` class which delegates to `create-backend.ts` via a `rest` adapter.

**2.8.1 Add import** (add to existing imports):

```typescript
import { EpicMutationService } from "./write-services/epic-mutation-service.ts";
```

**2.8.2 Create service instance** (before the `deps` object, after other service creation ~line 161):

```typescript
const epicMutationService = new EpicMutationService(ctx);
```

**2.8.3 Add to `deps` object** (inside `GitHubBackendDependencies`, ~line 165):

```typescript
const deps: GitHubBackendDependencies = {
  // ... existing fields ...
  epicMutationService, // ← NEW
};
```

### 2.9 Override `createEpic()` in Fake Backend

**File:** [`src/test/support/fake-backend.ts`](src/test/support/fake-backend.ts:384) (add after `createStory`)

```typescript
override async createEpic(input: CreateEpicInput): Promise<EpicRef> {
  this.recordCall("createEpic", input);
  const id = `fake-epic-${this.nextEpicId++}`;
  this.epics.set(id, {
    id,
    number: this.nextEpicId,
    name: input.name,
    description: input.description ?? null,
    status: "open",
  });
  return { id, number: this.nextEpicId - 1 };
}
```

**Required additions to the class:**

- `private nextEpicId = 1;` field
- `private readonly epics = new Map<string, EpicListing>();` field
- Import `CreateEpicInput` from `../../scrum/ports.ts`
- Import `EpicRef` from `../../domain/types.ts`

Without this override, `ConfigShapedFakeBackend` inherits the `AbstractProjectBackend` default that throws `UnsupportedCapabilityError`, preventing contract tests from exercising the success path.

### 2.10 Re-export Handler

**File:** [`src/tools/scrum-write.ts`](src/tools/scrum-write.ts) (re-export block, ~line 308)

```typescript
export {
  handleAddVocabulary,
  handleCreateEpic, // ← NEW
  handleCreateStory,
  handleLogImpediment,
  handlePlanSprint,
  handleSetField,
  handleUpdateImpediment,
  handleUpdateStory,
  resolveP0PriorityDisplay,
} from "./handlers/write.ts";
```

### 2.11 Contract Tests

**File:** [`src/test/tools/scrum-write.contract.test.ts`](src/test/tools/scrum-write.contract.test.ts) (add new tests)

Per [AGENTS.md §"Adding or changing a tool"](../../AGENTS.md), every new tool requires:

1. Output schema registered as `outputSchema` on the tool definition — **N/A for `scrum_create_epic`** (returns simple `{ ref: { id, number } }`, no complex schema)
2. Contract test using `assertHandlerSchema` validating `structuredContent`, text JSON, and MCP `.shape` parsing
3. For write tools, the existing `scrum-write.contract.test.ts` test pattern should be followed

**Test cases to add:**

```typescript
Deno.test("scrum_create_epic — schema validation", async () => {
  // Test 1: Valid input returns EpicRef shape
  const result = await handleCreateEpic(
    fakeBackend,
    mockScrumConfig,
    mockSessionCache,
    { name: "Test Epic", description: "Scope description" },
  );
  const parsed = parseToolText<{ ref: { id: string; number?: number } }>(result);
  assertEquals(typeof parsed.ref.id, "string");
  assertEquals(typeof parsed.ref.number, "number");

  // Test 2: Empty name rejected by Zod
  assertThrows(
    () => CreateEpicSchema.parse({ name: "", description: "test" }),
    ZodError,
  );

  // Test 3: Unknown fields rejected by .strict()
  assertThrows(
    () => CreateEpicSchema.parse({ name: "Valid", unknownField: "bad" }),
    ZodError,
  );
});

Deno.test("scrum_create_epic — capability unavailable", async () => {
  // Use fake backend with epicDescriptions: UNAVAILABLE
  const unavailableBackend = new ConfigShapedFakeBackend(profile, {
    capabilities: { ...FAKE_CAPABILITIES, epicDescriptions: "unavailable" },
  });
  const result = await handleCreateEpic(
    unavailableBackend,
    mockScrumConfig,
    mockSessionCache,
    { name: "Test" },
  );
  // Should return error text, not throw
  assertStringIncludes(result.content, "not supported");
});
```

**Required test imports:**

```typescript
import { CreateEpicSchema } from "../../schemas/scrum.ts";
import { handleCreateEpic } from "../../tools/handlers/write.ts";
import { CreateEpicInput } from "../../scrum/ports.ts";
```

---

## 3. File Change Summary

| # | File                                                                                                                         | Lines      | Change                                                                     |
| - | ---------------------------------------------------------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------- |
| 1 | [`src/schemas/scrum.ts`](src/schemas/scrum.ts)                                                                               | Add        | `CreateEpicSchema` Zod schema (with `.strict()`)                           |
| 2 | [`src/scrum/create-epic.ts`](src/scrum/create-epic.ts)                                                                       | **New**    | `createEpicUseCase` thin wrapper                                           |
| 3 | [`src/tools/handlers/write.ts`](src/tools/handlers/write.ts)                                                                 | Add        | `handleCreateEpic` handler + imports                                       |
| 4 | [`src/tools/scrum-write.ts`](src/tools/scrum-write.ts)                                                                       | Modify × 3 | (a) Constant array (b) Import (c) registerTool (d) Re-export               |
| 5 | [`src/adapters/github/write-services/epic-mutation-service.ts`](src/adapters/github/write-services/epic-mutation-service.ts) | **New**    | `EpicMutationService` class with `createMilestone()` via REST `POST`       |
| 6 | [`src/adapters/github/backend.ts`](src/adapters/github/backend.ts)                                                           | Modify     | Import `CreateEpicInput`/`EpicRef`/`EpicMutationService` + deps + override |
| 7 | [`src/adapters/github/create-backend.ts`](src/adapters/github/create-backend.ts)                                             | Modify     | Create and wire `EpicMutationService(ctx)` into `deps`                     |
| 8 | [`src/test/support/fake-backend.ts`](src/test/support/fake-backend.ts)                                                       | Modify     | Override `createEpic()` + fields for contract test support                 |
| 9 | [`src/test/tools/scrum-write.contract.test.ts`](src/test/tools/scrum-write.contract.test.ts)                                 | Add        | Contract tests: schema validation + capability-unavailable                 |

---

## 4. Call Chain

```
scrum_create_epic (MCP tool)
  → handleCreateEpic(backend, scrumConfig, sessionCache, params)  [handler — validates Zod schema]
    → createEpicUseCase(backend, input)                           [use-case — thin delegation]
      → backend.createEpic(input)                                 [GitHubProjectBackend override]
        → this.deps.epicMutationService.createMilestone(input)    [adapter write service]
          → ctx.gh.rest<MilestoneResponse>(                       [HTTP client]
              "POST /repos/{owner}/{repo}/milestones",
              { body: { title, description, state: "open" } }
            )
          → returns { id: data.node_id, number: data.id }
    → sessionCache.invalidateOrient()                             [clear cache for next orient]
  → toMcpTextResult({ ref: { id, number } })                     [structured text response]
```

---

## 5. AC Coverage

| # | AC                                                                 | Covered By                                             | Verification                                                     |
| - | ------------------------------------------------------------------ | ------------------------------------------------------ | ---------------------------------------------------------------- |
| 1 | Given name + optional description, creates open epic               | §2.6 `POST .../milestones` with `state: "open"`        | REST integration test + contract test                            |
| 2 | Returns `EpicRef` usable in `scrum_update_story(epic:)`            | §2.6 returns `{ id: node_id, number: id }`             | Contract test asserts `ref.id` is string, `ref.number` is number |
| 3 | Created epic appears in next `scrum_orient` without manual refresh | §2.3/§2.5 `sessionCache.invalidateOrient()` in handler | Contract test: create → verify cache invalidated                 |
| 4 | Platform doesn't support → capability-unavailable error            | §2.11 capability-unavailable contract test             | Fake backend with `epicDescriptions: UNAVAILABLE`                |
| 5 | No name → validation error before platform write                   | §2.1 `z.string().min(1)`                               | Zod schema test in §2.11                                         |
| 6 | Unknown fields → validation error before platform write            | §2.1 `.strict()` on schema                             | Zod schema test in §2.11                                         |

---

## 6. Notes

- **Shared service with #299:** `EpicMutationService` is created once and shared — #299's `updateMilestone()` goes in the same file. See [`plans/299-scrum-update-epic.md`](plans/299-scrum-update-epic.md) §2.5.
- **Single-repo creation:** Milestones are created in the primary repo only. This is documented in the tool description. Multi-repo creation would require knowing which repo each milestone targets — out of scope.
- **No outputSchema:** Unlike `scrum_log_impediment` (which returns a complex `ImpedimentListing`), `scrum_create_epic` returns a simple `{ ref: { id, number } }`. No `outputSchema` registration needed.
- **Template file not applicable:** Epics don't use PBI templates — the name/description fields are sufficient for milestone creation.
- **Handler parameter order:** All handlers in [`write.ts`](src/tools/handlers/write.ts) follow `(backend, scrumConfig, sessionCache, params)`. This handler must match.
- **`EpicMutationService` uses `GitHubInfraContext`:** Follows [`StoryMutationService`](src/adapters/github/write-services/story-mutation-service.ts:156-162) convention — `private readonly ctx: GitHubInfraContext` as the constructor parameter, not separate `gh`/`owner`/`repo` params.

---

## 7. Codebase Review Corrections (2026-07-10)

The following gaps were identified during a thorough review of the original plan against every referenced file in the codebase. Each correction has been folded into the relevant section above.

| # | Severity  | Section | Issue                                                                                          | Fix Applied                                                                                       |
| - | --------- | ------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 1 | Critical  | §2.1    | Schema missing `.strict()` — all 11 existing schemas in `scrum.ts` use `.strict()`             | Added `.strict()` to `CreateEpicSchema`                                                           |
| 2 | Critical  | §2.6    | `EpicMutationService` used separate `gh`/`owner`/`repo` params instead of `GitHubInfraContext` | Changed constructor to `private readonly ctx: GitHubInfraContext` matching `StoryMutationService` |
| 3 | Critical  | §2.7    | `backend.ts` missing `CreateEpicInput` and `EpicRef` imports for override signature            | Added explicit import requirements in §2.7.1                                                      |
| 4 | Critical  | §2.8    | Referenced `factory.ts` — actual wiring is in `create-backend.ts`                              | Changed all §2.8 references to `create-backend.ts` with explanatory note                          |
| 5 | Critical  | §2.3    | Handler signature missing `scrumConfig` and `sessionCache` params                              | Updated signature to `(backend, scrumConfig, sessionCache, params)` matching all other handlers   |
| 6 | Important | §2.4    | Tool registration closure didn't capture `sessionCache` and `scrumConfig`                      | Updated closure to `(params) => handleCreateEpic(backend, scrumConfig, sessionCache, params)`     |
| 7 | Important | (added) | `ConfigShapedFakeBackend` missing `createEpic()` override — contract tests would fail          | Added §2.9 with full fake backend override                                                        |
| 8 | Important | (added) | No contract tests in plan — AGENTS.md §"Adding or changing a tool" requires them               | Added §2.11 with contract test scenarios                                                          |
