# Ref Type Consolidation — Execution Plan

## Objective

Replace the loosely-named `ResolvedRef` with a precise type family that clarifies architectural intent: what each ref _is_, not how it was produced.

## Strategy — 4 Phases, each independently compilable

Each phase is a unit of work that leaves the project in a valid, compilable state. Within each phase, the steps are listed in dependency order.

---

## Phase 1 — Add new types alongside existing

**Goal:** Define the new types without breaking anything. No deletions yet.

**Files:** `src/domain/types.ts`

1. Rename `ResolvedRef` → `EntityRef` with `readonly` modifier.
   - Old: `export type ResolvedRef = { id: string };`
   - New: `export type EntityRef = { readonly id: string };`
2. Add backward-compat alias: `export type ResolvedRef = EntityRef;`
3. Redefine `EpicRef = EntityRef` (was `{ id: string }`; structurally identical).
4. Add `readonly` to `StoryRef`: `export type StoryRef = EntityRef | { readonly number: number };`
5. Add `ImpedimentRef = EntityRef` with JSDoc.
6. Add `ItemListingRef = { readonly id: string; readonly key: string }` with JSDoc.

**Verification:** `deno lint` passes. All old `ResolvedRef` imports still resolve via alias.

---

## Phase 2 — Migrate impediment types to `ImpedimentRef`

**Goal:** Replace `ResolvedRef` and inline `{ id: string }` with `ImpedimentRef` in impediment-specific code paths.

**Files (4):**

- `src/scrum/update-impediment.ts` — inline `{ id: string }` → `ImpedimentRef`
- `src/scrum/ports.ts` — `ImpedimentListing.ref` and `ImpedimentPort.updateImpediment(ref)` → `ImpedimentRef`
- `src/adapters/abstract-backend.ts` — `updateImpediment(ref)` → `ImpedimentRef`
- `src/adapters/github/backend.ts` — `updateImpediment(ref)` → `ImpedimentRef`
- `src/adapters/github/internal/impediment-service.ts` — `updateImpediment(ref)` → `ImpedimentRef`

**Verification:** `deno lint` passes. All impediment code uses the named `ImpedimentRef`.

---

## Phase 3 — Replace inline compound shapes with `ItemListingRef`

**Goal:** Name the compound `{ id + key }` shape so the output-only contract is visible in the type system.

**Files (1):** `src/domain/types.ts`

- `BacklogItemListing.ref` → `ItemListingRef`
- `BacklogItemListing.blocked_by[]` → `ItemListingRef`
- `BacklogItemListing.blocks[]` → `ItemListingRef`
- `BacklogItemListing.epic.ref` → `EpicRef` (was `ResolvedRef`)

**Also:** `src/scrum/ports.ts` — `StoryListing.ref` (deprecated) → `ItemListingRef`

**Also:** `src/scrum/listing-mappers.ts` — update mapper return values to match new shapes (refs, blocked_by, etc.)

**Verification:** `deno lint` passes. `grep -rn '{ id: string; key: string }' src/` returns zero results.

---

## Phase 4 — Remove `ResolvedRef` alias and rename boundary function

**Goal:** Eliminate `ResolvedRef` entirely. Rename `toResolvedRef` to `toEntityRef`.

**Files (6):**

- `src/domain/types.ts` — remove `export type ResolvedRef = EntityRef;` alias
- `src/scrum/ports.ts`:
  - `BurndownStoryInput.ref?` → `EntityRef`
  - Remove `ResolvedRef` from imports
- `src/scrum/listing-mappers.ts`:
  - `EMPTY_SPRINT_REF` → `EntityRef`
  - Remove `ResolvedRef` from imports
- `src/adapters/abstract-backend.ts`:
  - Remove `ResolvedRef` from imports (no remaining usages after Phase 2)
- `src/adapters/github/backend.ts`:
  - Remove `ResolvedRef` from imports
- `src/adapters/github/types.ts`:
  - `toResolvedRef` → `toEntityRef`: rename function, update JSDoc
  - Import `EntityRef` instead of `ResolvedRef`
- `src/adapters/github/internal/impediment-service.ts`:
  - Remove `ResolvedRef` from imports (now imports `ImpedimentRef` from Phase 2)

**Also: `src/domain/types.ts` remaining `ResolvedRef` → `EntityRef`:**

- `DependencyEntry.ref` — already `ResolvedRef`, already changed to `EntityRef` in Phase 1
- `EpicSummary.ref` — same
- `BacklogItemListing.sprint.ref` — same
- `StoryBase.ref` — same

**Verification:**

- `grep -r "ResolvedRef" src/` returns zero results
- `grep -r "toResolvedRef" src/` returns zero results
- `deno lint` passes
- `deno task test` passes

---

## Summary of All Changed Files

| # | File                                                 | Phase 1                  | Phase 2          | Phase 3                      | Phase 4                             |
| - | ---------------------------------------------------- | ------------------------ | ---------------- | ---------------------------- | ----------------------------------- |
| 1 | `src/domain/types.ts`                                | ✅ Add new types + alias | —                | ✅ ItemListingRef + EpicRef  | ✅ Remove alias                     |
| 2 | `src/scrum/ports.ts`                                 | —                        | ✅ ImpedimentRef | ✅ StoryListing.ref          | ✅ EntityRef for BurndownStoryInput |
| 3 | `src/scrum/update-impediment.ts`                     | —                        | ✅ ImpedimentRef | —                            | —                                   |
| 4 | `src/scrum/listing-mappers.ts`                       | —                        | —                | ✅ align with ItemListingRef | ✅ EntityRef for EMPTY_SPRINT_REF   |
| 5 | `src/adapters/abstract-backend.ts`                   | —                        | ✅ ImpedimentRef | —                            | ✅ remove ResolvedRef import        |
| 6 | `src/adapters/github/backend.ts`                     | —                        | ✅ ImpedimentRef | —                            | ✅ remove ResolvedRef import        |
| 7 | `src/adapters/github/types.ts`                       | —                        | —                | —                            | ✅ toEntityRef rename               |
| 8 | `src/adapters/github/internal/impediment-service.ts` | —                        | ✅ ImpedimentRef | —                            | ✅ remove ResolvedRef import        |

No changes needed:

- `src/schemas/scrum.ts` — uses `EpicRef` type only for `z.ZodType<EpicRef>`; structural typing preserves compatibility
- `src/adapters/github/mappers.ts` — does not use `ResolvedRef` or `toResolvedRef`
- `src/services/` — no ref type usage
- `src/tools/` — uses `StoryRef`, `EpicRef`, `SprintRef` (all structurally stable)
- Test files — no direct `ResolvedRef` references
