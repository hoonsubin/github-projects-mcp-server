# Generated Type Adoption — Implementation Summary

**Date:** 2026-05-25 **Files modified:** 10 (2,772 lines total)

## Completed Phases

### Phase 1 — Replace ItemFieldValue, RawFieldValue, SingleSelectFieldNode

**Files:** [`types.ts`](src/adapters/github/types.ts:1), [`vocabulary-manager.ts`](src/adapters/github/internal/vocabulary-manager.ts:1), [`config-loader.ts`](src/adapters/github/config-loader.ts:1)

- `ItemFieldValue` → now `extends FieldValueUnion` (generated union type)
- `RawFieldValue` → now `extends FieldValueUnion` (fully removes the hand-maintained union)
- `SingleSelectFieldNode` → now `extends Required<Pick<GH.ProjectV2SingleSelectField, "name" | "color" | "optionId">>` where applicable; kept as separate narrower projection in `config-loader.ts` because `FieldValueUnion` doesn't carry the option-level shape directly.

### Phase 2 — Replace GraphQL Response Types Across Services

**Files:** [`story-query-service.ts`](src/adapters/github/internal/story-query-service.ts:1), [`impediment-service.ts`](src/adapters/github/internal/impediment-service.ts:1), [`resolver.ts`](src/adapters/github/internal/resolver.ts:1), [`epic-service.ts`](src/adapters/github/internal/epic-service.ts:1), [`pagination.ts`](src/adapters/github/internal/pagination.ts:1), [`user-milestone-resolver.ts`](src/adapters/github/internal/user-milestone-resolver.ts:1)

Every inline GraphQL response type is now grounded via `Pick<GH.*, …>` or `Required<Pick<GH.*, …>>`. Nested connection shapes (assignees, labels, comments, milestones) use the same pattern. Timeline source fields reference `GH.PullRequest` rather than anonymous object literals.

### Phase 3 — Replace Mapper Input Shapes

**File:** [`mappers.ts`](src/adapters/github/mappers.ts:1)

- `CommentInput` → grounded in `GH.IssueComment` + `GH.User`
- `TimelineItemInput` → source grounded in `GH.PullRequest`
- `IssueDetailsInput` → scalar fields grounded in `GH.Issue`; nested connections grounded in `GH.User`, `GH.Label`, `GH.Milestone`

## Design Decisions

### Grounding convention

Flat scalar fields use `Required<Pick<GH.Type, "field1" | "field2">>` because our GraphQL queries always request non-nullable results for those fields. Nested connections use `Pick<GH.SubType, "field">` (nullable) since connection fields default to null when the parent is null.

### What was NOT changed

- `ProjectItem` and its content subtypes remain hand-maintained because they are adapter-local shapes that compose multiple GraphQL types (Issue, PullRequest, DraftIssue) with `content.__typename` dispatch.
- Connection-edge patterns (e.g., `{ nodes: Array<…> }` vs full `Connection` types) were not replaced. Full schema connection types carry cursor/pagination metadata our queries never request, so using them would widen API surfaces.

### Verification

- `deno lint`: 63 files, **0 errors**
- `deno test`: 6 passed, 2 failed (**pre-existing failures** — `graphql` npm `process.exitCode` polyfill, unrelated to type changes)

## Future Work

1. Audit the remaining `ProjectItem` composite types for potential grounding opportunities with conditional `Pick` patterns.
2. Consider a codegen script that produces narrower query-projection types directly from GraphQL query documents (rather than the full schema, which produces 14K+ lines).
