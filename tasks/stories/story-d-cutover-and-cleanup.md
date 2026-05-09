# Story D: Cutover and Cleanup (Phase 4)

**Epic:** [Refactoring Plan](../REFACTORING.md)\
**Priority:** P3 — Final cleanup\
**Dependencies:** Story C (write tool implementations) must be complete and verified first

---

## Title: Cutover to `scrum_*` Tools and Clean Up Legacy Code

As a **developer completing the refactoring**,\
I want to switch the server to serve `scrum_*` tools and remove all legacy code,\
So that the codebase is clean, the new architecture is complete, and there is no confusion about which tools to use.

---

## Acceptance Criteria

1. `index.ts` registers `registerScrumReadTools` and `registerScrumWriteTools` instead of legacy tool registrations
2. Legacy tool files (`projects.ts`, `items.ts`, `repository.ts`) are deleted
3. Service files gutted by Story B (`services/config.ts`, `services/resolver.ts`) are deleted
4. Dead schemas removed from `schemas/inputs.ts`
5. Legacy types removed from `types.ts`; domain types moved to `src/domain/`
6. `github_graphql` tool has deprecation marker
7. `deno check src/index.ts` passes clean
8. All existing tests pass
9. Server starts and all 13 tools (7 read + 6 write) respond correctly

---

## Subtasks

### D1: Swap `index.ts` to Register `scrum_*` Tools

**Title:** Swap `index.ts` to register `scrum_*` tools instead of legacy tools

As a **developer completing the cutover**,\
I want `index.ts` to register the new `scrum_*` tools,\
So that the server exposes the stable Scrum tool surface to agents.

**Acceptance Criteria:**

1. Remove imports of `registerProjectTools`, `registerItemTools`, `registerRepositoryTools`
2. Add imports of `registerScrumReadTools` and `registerScrumWriteTools`
3. Replace `registerProjectTools(server)` with `registerScrumReadTools(server, backend, yml)`
4. Replace `registerItemTools(server)` with `registerScrumWriteTools(server, backend, yml)`
5. Remove `registerRepositoryTools(server)` call
6. `deno check src/index.ts` passes
7. Server starts successfully
8. All 13 tools appear in tool list

**Before:**

```typescript
import { registerProjectTools } from "./tools/projects.ts";
import { registerItemTools } from "./tools/items.ts";
import { registerRepositoryTools } from "./tools/repository.ts";

// In createMcpServer():
registerProjectTools(server);
registerItemTools(server);
registerRepositoryTools(server);
```

**After:**

```typescript
import { registerScrumReadTools } from "./tools/scrum-read.ts";
import { registerScrumWriteTools } from "./tools/scrum-write.ts";

// In createMcpServer():
registerScrumReadTools(server, backend, yml);
registerScrumWriteTools(server, backend, yml);
```

**Files:**

- `src/index.ts` — swap imports and registrations

---

### D2: Delete Legacy Tool Files

**Title:** Delete legacy tool files that are no longer needed

As a **developer cleaning up the codebase**,\
I want to remove all legacy tool files,\
So that there is no confusion about which tools are active.

**Acceptance Criteria:**

1. `src/tools/projects.ts` deleted entirely
2. `src/tools/items.ts` deleted entirely
3. `src/tools/repository.ts` gutted — delete if no helpers remain
4. `src/services/config.ts` deleted — its contents (`loadConfig`, `RuntimeConfig`, `getBootstrapConfig`, `getRepo`) were moved to `src/adapters/github/config-loader.ts` in Story B (step B5)
5. `src/services/resolver.ts` deleted — its contents (`resolveSprint`, `resolveStory`) were moved to `src/adapters/github/backend.ts` as private methods in step B5
6. No remaining code references any of these files
7. `deno check src/index.ts` passes

**Files to Delete:**

- `src/tools/projects.ts`
- `src/tools/items.ts`
- `src/tools/repository.ts` (if empty after gutting)
- `src/services/config.ts` (gutted by B5)
- `src/services/resolver.ts` (gutted by B5)

---

### D3: Clean Up `schemas/inputs.ts`

**Title:** Remove dead schemas from `schemas/inputs.ts`

As a **developer maintaining schemas**,\
I want to remove schemas that are no longer used by any active tool,\
So that the schema file is clean and only contains relevant definitions.

**Acceptance Criteria:**

1. Remove: `GetSprintStatusSchema`, `GetVelocitySchema` (old), `GetBacklogItemsSchema`, `BulkUpdateItemFieldSchema`, `CloseSprintSchema`, `GenerateSprintReportSchema`
2. For the "keep temporarily" schemas, run the verification command below and delete any with zero usages
3. No remaining code references the removed schemas
4. `deno check src/index.ts` passes

**Schemas to Remove:**

- `GetSprintStatusSchema`
- `GetVelocitySchema` (old version)
- `GetBacklogItemsSchema`
- `BulkUpdateItemFieldSchema`
- `CloseSprintSchema`
- `GenerateSprintReportSchema`

**Schemas to Verify Before Keeping:**

Run this command to check each for active usages. Delete any that return zero hits outside of `inputs.ts` itself:

```bash
grep -rn "GetIssueNodeIdSchema\|GetUserNodeIdSchema\|GraphQLQuerySchema\|GetRepoFileSchema" src/ \
  | grep -v "src/schemas/inputs.ts"
```

Expected survivors after write tools are implemented:
- `GraphQLQuerySchema` — used by the deprecated `github_graphql` tool registration in `scrum-write.ts`
- `GetIssueNodeIdSchema`, `GetUserNodeIdSchema`, `GetRepoFileSchema` — delete if no write-tool internals reference them

**Files:**

- `src/schemas/inputs.ts` — remove dead schemas

---

### D4: Clean Up `types.ts`

**Title:** Clean up `types.ts` — remove legacy types, move domain types

As a **developer organizing types**,\
I want `types.ts` to contain only types that are still needed in shared locations,\
So that the type system is clean and types are co-located with their consumers.

**Acceptance Criteria:**

1. Move domain types to `src/domain/`:
   - `Story`, `StoryRef`, `SprintRef`, `ScrumField`, `StoryType` → `src/domain/story.ts`
   - `IterationEntry`, `DefinitionCriteria` → `src/domain/sprint.ts`
   - `ScrumConfigYml`, `ArtifactType` → `src/domain/config.ts`
2. Inline types in their use case files:
   - `SprintHistoryResponse`, `SprintSnapshot`, `SprintStory`, `SprintSummary` → `src/scrum/get-history.ts`
   - `GetBacklogResult` → `src/scrum/get-backlog.ts`
   - `BurndownResponse`, `BurndownSprintMeta`, `BurndownDayPoint`, `IdealDayPoint`, `BurndownStory` → `src/scrum/get-burndown.ts`
   - `TemplateResponse` → `src/scrum/get-template.ts`
3. Delete legacy types:
   - `BoardConfig`, `GhFieldBase`, `GhSingleSelectField`, `GhIterationField`, `GhProjectResponse`
   - `MergedScrumConfig`, `ResolvedScrumFields`
   - `SprintIteration`, `SprintStatusResult`, `BulkUpdateResult`, `IterationVelocity`
   - `StoryReadiness` (replaced by `ReadinessLevel` type)
4. `deno check src/index.ts` passes
5. All imports updated

**Types to Move:**

| Type                                                        | From       | To                     |
| ----------------------------------------------------------- | ---------- | ---------------------- |
| `Story`, `StoryRef`, `SprintRef`, `ScrumField`, `StoryType` | `types.ts` | `src/domain/story.ts`  |
| `IterationEntry`, `DefinitionCriteria`                      | `types.ts` | `src/domain/sprint.ts` |
| `ScrumConfigYml`, `ArtifactType`                            | `types.ts` | `src/domain/config.ts` |

**Types to Inline:**

| Type                                                                                           | From       | To                          |
| ---------------------------------------------------------------------------------------------- | ---------- | --------------------------- |
| `SprintHistoryResponse`, `SprintSnapshot`, `SprintStory`, `SprintSummary`                      | `types.ts` | `src/scrum/get-history.ts`  |
| `GetBacklogResult`                                                                             | `types.ts` | `src/scrum/get-backlog.ts`  |
| `BurndownResponse`, `BurndownSprintMeta`, `BurndownDayPoint`, `IdealDayPoint`, `BurndownStory` | `types.ts` | `src/scrum/get-burndown.ts` |
| `TemplateResponse`                                                                             | `types.ts` | `src/scrum/get-template.ts` |

**Types to Delete:**

| Type                                                                          | Reason                                                  |
| ----------------------------------------------------------------------------- | ------------------------------------------------------- |
| `BoardConfig`                                                                 | Sync-script-specific, sync script retired               |
| `GhFieldBase`, `GhSingleSelectField`, `GhIterationField`, `GhProjectResponse` | Sync-script-only shapes                                 |
| `MergedScrumConfig`                                                           | Replaced by `RuntimeConfig`                             |
| `ResolvedScrumFields`                                                         | Replaced by `RuntimeConfig`                             |
| `SprintIteration`                                                             | Replaced by `IterationEntry` used internally in adapter |
| `SprintStatusResult`                                                          | Implementation detail that leaked into shared types     |
| `BulkUpdateResult`                                                            | Internal to sprint close operations                     |
| `IterationVelocity`                                                           | Internal to velocity handler (deleted)                  |
| `StoryReadiness`                                                              | Replace with `ReadinessLevel` type                      |

**Files:**

- `src/types.ts` — remove legacy types
- `src/domain/story.ts` — create with domain types
- `src/domain/sprint.ts` — create with domain types
- `src/domain/config.ts` — create with domain types
- `src/scrum/get-history.ts` — inline types
- `src/scrum/get-backlog.ts` — inline types
- `src/scrum/get-burndown.ts` — inline types
- `src/scrum/get-template.ts` — inline types

---

### D5: Update `github_graphql` Deprecation Marker

**Title:** Ensure `github_graphql` tool has proper deprecation notice

As a **developer maintaining tool surface**,\
I want the deprecated `github_graphql` tool to have a clear deprecation notice,\
So that agents know to prefer `scrum_*` tools and understand the tool's limited scope.

**Acceptance Criteria:**

1. Tool description reads:
   > **DEPRECATED.** Preserved for ad-hoc diagnostic GraphQL lookups only. Will be removed in a future version. Prefer the `scrum_*` tools for all agent workflows. Mutations are blocked.
2. Mutation blocking is enforced (reject any query containing "mutation" case-insensitive)
3. Tool is registered in `scrum-write.ts`

**Files:**

- `src/tools/scrum-write.ts` — update tool description

---

## Verification Checklist

- [ ] D1: `index.ts` swapped to register `scrum_*` tools
- [ ] D2: Legacy tool files deleted (`projects.ts`, `items.ts`, `repository.ts`)
- [ ] D2: `src/services/config.ts` deleted
- [ ] D2: `src/services/resolver.ts` deleted
- [ ] D3: Dead schemas removed from `schemas/inputs.ts`
- [ ] D3: "Keep temporarily" schemas verified via grep — unused ones deleted
- [ ] D4: `types.ts` cleaned up — legacy types removed, domain types moved
- [ ] D5: `github_graphql` deprecation marker updated
- [ ] `deno check src/index.ts` passes clean
- [ ] All existing tests pass
- [ ] Server starts and all 13 tools respond correctly
- [ ] No remaining references to deleted files or types
