# Generated Type Adoption Plan

## Goal

Replace or extend hand-rolled types in the GitHub adapter layer with types derived from the auto-generated schema types in `src/adapters/github/generated/github-types.ts` (imported as `GH`).

## Current State

The adapter already has a good foundation:

- `ProjectItemIssueContent`, `ProjectItemPRContent`, `ProjectItemDraftContent` use `Required<Pick<GH.X, ...>>` pattern
- `ItemContentType` = `GH.ProjectV2ItemType`
- State fields (`IssueState`, `PullRequestState`) reference generated enums
- The `GH` namespace is imported in `types.ts`

However, many files still define their own inline response interfaces, input shapes, and structural types that duplicate information in the generated schema.

## Adoption Categories

### A — Direct Type Replacement (high priority)

Replace hand-rolled loose types with the generated discriminated union or stricter derivations.

| #  | File                                               | Current Type                                     | Target                                                       |
| -- | -------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------ |
| A1 | `types.ts:183`                                     | `ItemFieldValue` (flat interface, TODO exists)   | Derive from `GH.ProjectV2ItemFieldValue` discriminated union |
| A2 | `pagination.ts:90`                                 | `RawFieldValue` (code clone of `ItemFieldValue`) | Reuse `ItemFieldValue` or share a common base                |
| A3 | `config-loader.ts:89` + `vocabulary-manager.ts:19` | `SingleSelectFieldNode` (duplicated in 2 files)  | Define once in `types.ts` or use generated type              |

### B — GraphQL Response Type Harmonization (medium priority)

Replace inline response interfaces with `Pick<>` from generated types.

| #  | File                         | Current Type                               | Target                                 |
| -- | ---------------------------- | ------------------------------------------ | -------------------------------------- |
| B1 | `story-query-service.ts:47`  | `GetIssueDetailsResponse`                  | `Pick<GH.Issue, ...>`                  |
| B2 | `story-query-service.ts:82`  | `GetItemFieldsResponse`                    | `Pick<GH.ProjectV2Item, ...>`          |
| B3 | `story-query-service.ts:191` | `GetDraftIssueDetailsResponse`             | `Pick<GH.ProjectV2Item, ...>`          |
| B4 | `impediment-service.ts:36`   | `ImpedimentIssueNode`                      | `Pick<GH.Issue, ...>`                  |
| B5 | `impediment-service.ts:48`   | `ImpedimentIssuesResponse`                 | Use `GH.Repository.issues`             |
| B6 | `resolver.ts:36`             | `ItemByIdResponse`                         | `Pick<GH.ProjectV2Item, ...>`          |
| B7 | `vocabulary-manager.ts:26`   | `GetFieldOptionsResponse`                  | Use generated field types              |
| B8 | `epic-service.ts:16-31`      | `MilestoneNode` + `ListMilestonesResponse` | `Pick<GH.Milestone, ...>`              |
| B9 | `pagination.ts:48-88`        | `ProjectItemsResponse` + `RawProjectItem`  | Derive from generated connection types |

### C — Mapper Input Shape Upgrade (medium priority)

Replace mapper input interfaces with generated type picks.

| #  | File            | Current Type        | Target                                           |
| -- | --------------- | ------------------- | ------------------------------------------------ |
| C1 | `mappers.ts:25` | `CommentInput`      | `Pick<GH.IssueComment, ...>`                     |
| C2 | `mappers.ts:33` | `TimelineItemInput` | Investigate if `GH.CrossReferencedEvent` matches |
| C3 | `mappers.ts:68` | `IssueDetailsInput` | `Pick<GH.Issue, ...>`                            |

### D — Connection Shape Pattern (low priority)

Inline nested connection shapes could reference generated connection types.

| #  | File     | Pattern                               | Target                                                                  |
| -- | -------- | ------------------------------------- | ----------------------------------------------------------------------- |
| D1 | Multiple | `{ nodes: Array<{ login: string }> }` | Discuss: keep query-projection shapes lean or reference generated types |

## Risk Assessment

| Risk                          | Description                                                                                                                                               | Mitigation                                                                                                  |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **Type drift**                | Generated types have _all_ fields optional — replacing mandatory inline fields with optional generated fields loses the "required for our query" contract | Use `Required<Pick<GH.X, K>>` pattern (already used for content types) — this preserves mandatory semantics |
| **Query projection mismatch** | Inline response types model exactly what the GraphQL query returns, which may differ from the full schema type                                            | Pin selections explicitly in the `Pick` — do not widen to the full generated type                           |
| **Backward compat**           | Response fields like `__typename` are string discriminators in the adapter but not present in generated types                                             | Keep `__typename` as a manual discriminator on the projection type; it's a query-level construct            |
| **Upgrade burden**            | Every `deno task codegen` may introduce new generated types or change existing ones                                                                       | Use `Pick` not `extends` — narrow selections won't break on schema additions. Add a CI lint check if needed |

## Design Principles

1. **Picks, not extends**: `Required<Pick<GH.X, "field1" | "field2">>` not `extends GH.X` — this narrows to exactly what the fragment fetches and won't break when the schema grows.
2. **One type per concern**: A GraphQL response wrapper (with `data?` / `errors?`) and the data projection are separate concerns — keep the response wrapper as a local interface, derive the data projection from generated types.
3. **Keep `__typename` discriminators**: These are query-level constructs that don't exist in the schema types — they must remain as manual annotations on projection types.
4. **Don't widen in the adapter**: The adapter is the boundary where precision matters most. A type that claims a field exists when it might not (because the schema says `?`) is a bug vector.

## Execution Order

Phase 1 (P1): Types A1-A3 (ItemFieldValue, RawFieldValue, SingleSelectFieldNode)

- Highest blast radius: ItemFieldValue is the most-used type in the adapter
- RawFieldValue duplication is a maintenance smell
- SingleSelectFieldNode duplication is low-hanging fruit

Phase 2 (P2): Types B1-B9 (all GraphQL response types)

- Medium risk, mechanical changes
- Each file can be done independently

Phase 3 (P3): Types C1-C3 (mapper input shapes)

- Dependent on understanding generated type coverage for CrossReferencedEvent
- Requires some investigation

Phase 4 (P4): Type D1 (connection shape pattern)

- Lowest priority, least safety gain
- Design discussion needed before execution
