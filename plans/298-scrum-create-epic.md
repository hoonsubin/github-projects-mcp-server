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

---

## 2. Implementation Tasks

### 2.1 New Schema — `CreateEpicSchema`

**File:** `src/schemas/scrum.ts` (add after `LogImpedimentSchema`)

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
});
```

- `.min(1)` enforces AC "Given no name, the tool call is rejected with a validation error before any platform write is attempted."
- No `status` field — epics are always created open. Status transitions go through `scrum_update_epic`.
- Zod validation at the handler boundary means the backend never receives empty names.

### 2.2 New Use-Case — `create-epic.ts`

**File:** `src/scrum/create-epic.ts` (new file)

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

**File:** `src/tools/handlers/write.ts` (add after `handleUpdateImpediment`)

```typescript
export const handleCreateEpic = async (
  backend: ProjectBackend,
  params: z.infer<typeof CreateEpicSchema>,
): Promise<McpTextResult> => {
  const input: CreateEpicInput = {
    name: params.name,
    ...(params.description !== undefined ? { description: params.description } : {}),
  };

  try {
    const epicRef = await createEpicUseCase(backend, input);
    return toMcpTextResult({ ref: { id: epicRef.id, number: epicRef.number } });
  } catch (err) {
    return toToolErrorResult(err);
  }
};
```

- Uses `createEpicUseCase` from `src/scrum/create-epic.ts`.
- Returns `EpicRef` shape directly — no need for `EpicListing` (the agent can call `scrum_orient` to get the full listing).
- Capability-unavailable errors propagate naturally: the `AbstractProjectBackend` default throws `UnsupportedCapabilityError`, which the handler catches and converts to structured text via `toToolErrorResult()`.

### 2.4 Tool Registration

**File:** `src/tools/scrum-write.ts`

**2.4.1 Add tool name constant** (line ~38):

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

**2.4.2 Import new handler + schema** (lines ~8-11, ~24-32):

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
  (params: z.infer<typeof CreateEpicSchema>) => handleCreateEpic(backend, params),
);
```

- No `outputSchema` needed — the returned `EpicRef` is a simple `{ id, number }` object.
- Annotations: `idempotentHint: false` because each call creates a new epic (not idempotent).

### 2.5 Cache Invalidation

After a successful create in `handleCreateEpic`, invalidate the orient cache so the next `scrum_orient` fetches the fresh epic list:

```typescript
export const handleCreateEpic = async (
  backend: ProjectBackend,
  sessionCache: SessionCache, // ← add param
  params: z.infer<typeof CreateEpicSchema>,
): Promise<McpTextResult> => {
  // ... create logic ...
  sessionCache.invalidateOrient(); // ← NEW
  return toMcpTextResult({ ref: { id: epicRef.id, number: epicRef.number } });
};
```

This satisfies AC: "The created epic appears in the next `scrum_orient` epic listing without requiring a manual refresh."

### 2.6 GitHub Adapter — `EpicMutationService.createMilestone()`

**File:** `src/adapters/github/write-services/epic-mutation-service.ts` (new file)

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
import type { GitHubClient } from "../infra/http-client.ts";

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
    private readonly gh: GitHubClient,
    private readonly owner: string,
    private readonly repo: string,
  ) {}

  async createMilestone(input: CreateEpicInput): Promise<EpicRef> {
    const { data } = await this.gh.rest<MilestoneResponse>(
      `repos/${this.owner}/${this.repo}/milestones`,
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

- Uses the existing `GitHubClient.rest()` method — no new HTTP infrastructure needed.
- `node_id` (MI_...) maps to `EpicRef.id`; `id` (integer) maps to `EpicRef.number`.
- Single-repo creation: the milestone is created in the primary repo only (`this.repo`). Per #246, milestones from secondary repos can still be updated/deleted by node ID but creation targets the primary.

### 2.7 Wire into `backend.ts`

**File:** `src/adapters/github/backend.ts`

**2.7.1 Add to `GitHubBackendDependencies`** (line ~75):

```typescript
readonly epicMutationService: EpicMutationService;
```

**2.7.2 Import** (line ~21):

```typescript
import { EpicMutationService } from "./write-services/epic-mutation-service.ts";
```

**2.7.3 Override `createEpic`** (add new method after `updateImpediment`):

```typescript
override async createEpic(input: CreateEpicInput): Promise<EpicRef> {
  return this.deps.epicMutationService.createMilestone(input);
}
```

- The `AbstractProjectBackend` default throws `UnsupportedCapabilityError` — this override gets called because the factory passes `GITHUB_CAPABILITIES` (which has all epic flags at `NATIVE`).

### 2.8 Wire into `factory.ts`

**File:** `src/adapters/github/factory.ts`

Add `EpicMutationService` creation and pass it into dependencies:

```typescript
import { EpicMutationService } from "./write-services/epic-mutation-service.ts";

// Inside the factory function, after other service creation:
const epicMutationService = new EpicMutationService(gh, ownerArg, repoArg);

// Add to deps:
const deps: GitHubBackendDependencies = {
  // ... existing fields ...
  epicMutationService,
};
```

### 2.9 New Entry in `SCRUM_WRITE_TOOL_NAMES`

Already covered in §2.4.1 — the constant array in [`src/tools/scrum-write.ts`](src/tools/scrum-write.ts:38) is used by [`src/server.ts`](src/server.ts) for degraded-mode stub registration. Adding `"scrum_create_epic"` ensures stubs are registered if the server starts in degraded mode.

### 2.10 Re-export Handler

**File:** `src/tools/scrum-write.ts` (line ~308)

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

---

## 3. File Change Summary

| # | File                                                                                                                         | Lines   | Change                                                    |
| - | ---------------------------------------------------------------------------------------------------------------------------- | ------- | --------------------------------------------------------- |
| 1 | [`src/schemas/scrum.ts`](src/schemas/scrum.ts)                                                                               | Add     | `CreateEpicSchema` Zod schema                             |
| 2 | [`src/scrum/create-epic.ts`](src/scrum/create-epic.ts)                                                                       | **New** | `createEpicUseCase` thin wrapper                          |
| 3 | [`src/tools/handlers/write.ts`](src/tools/handlers/write.ts:442)                                                             | Add     | `handleCreateEpic` handler                                |
| 4 | [`src/tools/scrum-write.ts`](src/tools/scrum-write.ts:38)                                                                    | Modify  | Add `"scrum_create_epic"` to `SCRUM_WRITE_TOOL_NAMES`     |
| 5 | [`src/tools/scrum-write.ts`](src/tools/scrum-write.ts:214)                                                                   | Add     | `server.registerTool("scrum_create_epic", ...)`           |
| 6 | [`src/adapters/github/write-services/epic-mutation-service.ts`](src/adapters/github/write-services/epic-mutation-service.ts) | **New** | `EpicMutationService.createMilestone()` via REST `POST`   |
| 7 | [`src/adapters/github/backend.ts`](src/adapters/github/backend.ts:75)                                                        | Modify  | Add `epicMutationService` to deps + override `createEpic` |
| 8 | [`src/adapters/github/factory.ts`](src/adapters/github/factory.ts)                                                           | Modify  | Create and wire `EpicMutationService`                     |

---

## 4. Call Chain

```
scrum_create_epic (MCP tool)
  → handleCreateEpic (handler — validates schema)
    → createEpicUseCase (use-case — thin delegation)
      → backend.createEpic (GitHubProjectBackend override)
        → EpicMutationService.createMilestone()
          → GitHubClient.rest() → POST /repos/{owner}/{repo}/milestones
  → sessionCache.invalidateOrient()
  → returns { ref: { id, number } }
```

---

## 5. AC Coverage

| # | AC                                                                 | Covered By                                                         | Verification                                           |
| - | ------------------------------------------------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------ |
| 1 | Given name + optional description, creates open epic               | §2.6 `POST .../milestones` with `state: "open"`                    | REST integration test + captured test                  |
| 2 | Returns `EpicRef` usable in `scrum_update_story(epic:)`            | §2.6 returns `{ id: node_id, number: id }`                         | Tool surface contract test checks schema               |
| 3 | Created epic appears in next `scrum_orient` without manual refresh | §2.5 `sessionCache.invalidateOrient()`                             | Integration test: create → orient → verify in listing  |
| 4 | Platform doesn't support → capability-unavailable error            | §2.3 `toToolErrorResult(err)` catches `UnsupportedCapabilityError` | Fake backend test with `epicDescriptions: UNAVAILABLE` |
| 5 | No name → validation error before platform write                   | §2.1 `z.string().min(1)`                                           | Zod schema test                                        |

---

## 6. Notes

- **Shared service with #299:** `EpicMutationService` is created once and shared — #299's `updateMilestone()` goes in the same file. See [`plans/299-scrum-update-epic.md`](plans/299-scrum-update-epic.md) §2.5.
- **Single-repo creation:** Milestones are created in the primary repo only. This is documented in the tool description. Multi-repo creation would require knowing which repo each milestone targets — out of scope.
- **No outputSchema:** Unlike `scrum_log_impediment` (which returns a complex `ImpedimentListing`), `scrum_create_epic` returns a simple `{ ref: { id, number } }`. No `outputSchema` registration needed.
- **Template file not applicable:** Epics don't use PBI templates — the name/description fields are sufficient for milestone creation.
