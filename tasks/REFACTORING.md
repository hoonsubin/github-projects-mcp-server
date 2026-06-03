# QueryBuilder Architecture Design

**Context:** `scrum-master-toolkit` — Deno/TypeScript MCP server exposing `scrum_*` tools backed by GitHub Projects v2. **Companion spikes:** [#190](https://github.com/hoonsubin/github-projects-mcp-server/issues/190) (call graph audit), [#220](https://github.com/hoonsubin/github-projects-mcp-server/issues/220) (query formation audit). **Source docs:** `docs/AUDIT.md`, `tasks/REFACTORING.md`.

---

## 1. Problem diagnosis (mostly resolved)

### 1.1 Two compounding problems

The current implementation suffers from two orthogonal problems that multiply each other:

**Problem A — Redundant call count.** A single agent session calling `orient` → `board_health` → `analytics(both)` burns at minimum **5 full board scans** (`ProjectItems×P`):

- `scrum_orient`: 1 scan (sprint completion)
- `scrum_get_board_health`: 2 scans (one in `StoryQueryService.fetchAllItems`, one in `ImpedimentService.getSprintImpediments`)
- `scrum_get_analytics(both)`: 2 scans (`SprintHistoryService` + `BurndownCalculator` independently)

Each scan pages up to 20 × 100 items. No cross-tool or cross-service cache exists.

**Problem B — Maximum payload per call.** `ProjectItemsQueryBuilder` has exactly one query shape: `ItemContent` + `ItemFieldValues` — always, regardless of caller intent. This fetches ~55 field paths per item but aggregation-only callers (`computeSprintCompletion`, burndown, history) consume only ~5–6. Waste: **~80–85% per page** for aggregation callers.

**Compounded:** 5 full board scans × ~80% waste = the server is doing roughly **25× more data transfer work** than necessary for a normal agent session.

### 1.2 The assembler pipeline is narrow

The `classifyFilter → Assembler → ExecutionEngine` pipeline governs only `scrum_find_items`. Every other board-scan caller bypasses it entirely:

| Caller                                      | Bypass method                          |
| ------------------------------------------- | -------------------------------------- |
| `StoryQueryService.fetchAllItems`           | `PaginatedProjectItemFetcher` directly |
| `StoryQueryService.computeSprintCompletion` | Same                                   |
| `BurndownCalculator`                        | Same                                   |
| `SprintHistoryService`                      | Same                                   |
| `ImpedimentService` (board cross-ref)       | Same                                   |

All bypass callers get the same over-fetched `ItemContent` + `ItemFieldValues` payload with no filtering — even when they only need 2–3 field values.

### 1.3 The mapper null-guard is a hidden blocker

`buildStoryFromRaw` in `mappers.ts` returns `null` when `content.labels` or `content.assignees` is missing on Issue/PR nodes. This forces **all callers** — including aggregation-only paths that have no use for label/assignee data — to request the full `ItemContent` fragment. Any attempt to introduce a lean aggregate query profile fails silently (all items map to `null`) without first addressing this guard.

### 1.4 Post-mutation re-reads (write tools)

**Root cause:** Tool handlers call `getStoryDetail` after every mutation to return the updated story as a response payload. This adds 2–3 GraphQL calls per invocation but the mutation result is already confirmed by the adapter — the re-read is purely for response composition.

| ID | Tool / Handler                                       | Redundancy                                             | Extra calls           |
| -- | ---------------------------------------------------- | ------------------------------------------------------ | --------------------- |
| R1 | [`scrum_set_field`](src/tools/scrum-write.ts:111)    | `getStoryDetail` after `setField` mutation             | +2–3 GraphQL per call |
| S1 | [`scrum_update_story`](src/tools/scrum-write.ts:161) | `getStoryDetail` after `updateStory` + `addComment`    | +2–3 GraphQL per call |
| S2 | [`scrum_create_story`](src/tools/scrum-write.ts:235) | `getStoryDetail` after `createStory` + optional fields | +2–3 GraphQL per call |

**Impact:** Every write tool invocation pays a full detail-read penalty that its return value contract (returning the updated `Story` object) requires. Fixing this requires changing the tool's API contract to return `void` or a lightweight acknowledgment. The three instances share the same surgical fix (Step 7).

### 1.5 Duplicate resolution paths

**Root cause:** The adapter performs the same node-ID or item-resolution query multiple times in a single call chain because intermediate results from the first resolution are not reused.

| ID | Location                                                                                            | Redundancy                                                                                                                                                        | Extra calls                                         |
| -- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| S6 | [`FieldValueMutator.resolveIssueNodeId()`](src/adapters/github/internal/field-value-mutator.ts:274) | Duplicates `resolveStory()` from [`resolver.ts:152`](src/adapters/github/internal/resolver.ts:152) — fetches `GET_PROJECT_ITEM_BY_ID` again for the same `itemId` | +1 GraphQL per type write                           |
| S8 | [`getStoryDetail`](src/adapters/github/backend.ts:289)                                              | Second `resolveRef` for `{number}` refs, called after `setField` already resolved the same ref                                                                    | +1 board scan per `scrum_set_field` with `{number}` |
| R3 | [`resolveRef({number})`](src/adapters/github/backend.ts:103)                                        | Routes through full `findItems` board scan instead of direct `GetIssueProjectItem` lookup                                                                         | +1 board scan per invocation                        |

**Impact:** S6 and R3 are independent surgical fixes. S8's duplicate `resolveRef` is eliminated automatically when R1's `getStoryDetail` removal (Step 7) is implemented, since there will be no second call path to trigger it.

### 1.6 Uncached service lookups

**Root cause:** Several adapter services query the GitHub API every time they need static or slowly-changing data (repo labels, user node IDs, field options). No in-memory cache exists, so repeated calls in the same tool invocation or session re-fetch identical data.

| ID | Service                                                                                                    | Redundancy                                                                                                                                                                                                                     | Extra calls                     |
| -- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------- |
| S4 | [`LabelResolver`](src/adapters/github/internal/label-resolver.ts:67)                                       | Re-fetches all repo labels (`GET_REPO_LABELS_QUERY`) on every `resolveExistingLabelNodeIds`, `resolveOrCreateBatch`, `addLabel`, and `auditTypeLabels` call. Can fire twice per `createStory` when labels + type are both set. | +1–2 GraphQL per mutation       |
| S5 | [`UserMilestoneResolver.resolveUserNodeIds()`](src/adapters/github/internal/user-milestone-resolver.ts:40) | Resolves assignees **sequentially** via individual `GET_USER_NODE_ID` calls instead of in parallel                                                                                                                             | N×RTT wall time for N assignees |
| S9 | [`VocabularyManager.addSingleSelectOption()`](src/adapters/github/internal/vocabulary-manager.ts:84)       | Fetches all current field options (`GET_FIELD_OPTIONS_QUERY`) before appending a single new one, then writes the full list back via `UPDATE_FIELD_MUTATION`                                                                    | +1 GraphQL per vocabulary add   |

**Impact:** S4 is the highest-impact item here — a single `scrum_create_story` with labels and type can fire 2 label fetches when 1 would suffice. S5 is a performance issue (wall time) rather than call count. S9 is minor but affects an admin tool that may be called rarely.

### 1.7 Inefficient service composition

**Root cause:** Services are composed in ways that trigger redundant or wasted work — either through unnecessary board scans or processing items that are immediately discarded.

| ID | Service                                                                                              | Redundancy                                                                                                                                                                                                                            | Extra calls                                     |
| -- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| S3 | [`EpicService.getEpics()`](src/adapters/github/internal/epic-service.ts:39)                          | When `sprintIterationId` is provided, fetches the full board (`ProjectItems×P`) just to extract epic ref IDs, then filters milestones against them. **Latent** — currently not triggered from `orient` but a risk for future callers. | +1 board scan per call with `sprintIterationId` |
| S7 | [`ResultNormalizer.normalize()`](src/adapters/github/internal/result-normalizer.ts:92)               | Maps **every** fetched item to a full `Story` object via `buildStoryFromRaw` before applying the client-side filter. Filtered-out items are mapped and immediately discarded.                                                         | 0 (CPU waste, not API calls)                    |
| R2 | [`BoardHealthService.getBoardHealth()`](src/adapters/github/internal/board-health-service.ts:40)     | Calls `fetchStoriesForScope` (1 board scan) + `computeImpedimentCounts` calls `ImpedimentService.getSprintImpediments` (1 board scan) — two independent scans for different data from the same board.                                 | 1 redundant board scan                          |
| R4 | [`AnalyticsService.getAnalytics(view='both')`](src/adapters/github/internal/analytics-service.ts:63) | `buildBurndown()` and `buildHistory()` run independently, each triggering its own full board scan via `BurndownCalculator` and `SprintHistoryService`.                                                                                | 1 redundant board scan                          |
| R5 | [`orientUseCase`](src/scrum/orient.ts:94)                                                            | Calls `backend.getSprintCompletion()` → `StoryQueryService.computeSprintCompletion()` → `fetchAllItems()` — a full board scan for just 2 field values (completed points, total points).                                               | Pays full payload for 2 fields                  |

**Impact:** R2, R4, and R5 share the same root cause (no unified aggregation path) and are eliminated by `getAggregates(scope)` in the target architecture. S7 is a CPU-efficiency concern, not an API cost concern. S3 is latent and should be audited before any future change to `orientUseCase`.

### 1.8 Immediately fixable redundancies

| ID | Issue                                                                | Category                | Impact                                              | Fix type                     |
| -- | -------------------------------------------------------------------- | ----------------------- | --------------------------------------------------- | ---------------------------- |
| R1 | `scrum_set_field` calls `getStoryDetail` after every mutation        | Post-mutation re-read   | +3 GraphQL calls per invocation                     | Surgical (Step 7)            |
| S1 | `scrum_update_story` calls `getStoryDetail` after every mutation     | Post-mutation re-read   | +3 GraphQL calls per invocation                     | Surgical                     |
| S2 | `scrum_create_story` calls `getStoryDetail` after setup              | Post-mutation re-read   | +3 GraphQL calls per invocation                     | Surgical                     |
| R3 | `resolveRef({number})` routes through full `findItems` router        | Duplicate resolution    | +1 board scan per write tool with `{number}` ref    | Surgical (Step 8)            |
| S6 | `FieldValueMutator.resolveIssueNodeId()` duplicates `resolveStory()` | Duplicate resolution    | +1 GraphQL call per `setField(type)`                | Surgical                     |
| S4 | `LabelResolver` has no in-memory cache for repo labels               | Uncached lookup         | +1–2 GraphQL calls per mutation                     | Surgical                     |
| R2 | `BoardHealthService` runs `ProjectItems×P` twice in one tool call    | Inefficient composition | 1 redundant full scan per `board_health` invocation | Architecture (getAggregates) |
| R4 | `AnalyticsService view=both` fetches full board twice                | Inefficient composition | 1 redundant full scan per `analytics(both)`         | Architecture (getAggregates) |
| R5 | `orient` sprint completion runs full board scan                      | Inefficient composition | Pays full `ItemContent` payload for 2 field values  | Architecture (getAggregates) |

**Surgical fixes** are self-contained changes within a single file or class. **Architecture fixes** require the unified `getAggregates(scope)` port method from the target architecture. S4 and S6 are newly identified surgical fixes not in the original plan.

### 1.9 BackendPort is leaking adapter internals

The current port interface (`ProjectReader`) has separate methods for `getBoardHealth`, `getAnalytics`, and `getSprintCompletion` that map 1:1 to internal adapter services (`BoardHealthService`, `AnalyticsService`, `StoryQueryService`). This means the port is shaped by the implementation rather than by what use cases need — the wrong dependency direction.

---

## 2. GitHub server-side filtering capabilities (live research findings)

As of June 2026, after live schema + community research:

| Filter mechanism                                  | Status           | Notes                                                  |
| ------------------------------------------------- | ---------------- | ------------------------------------------------------ |
| `items(query: "is:unarchived")`                   | ✅ Works         | Eliminates archived items server-side                  |
| `items(query: "status:\"In Progress\"")`          | ✅ Partial       | Single-value status filter; multi-value not documented |
| `items(query:)` iteration/sprint filter           | ❌ Not supported | No documented syntax; client-side only                 |
| `items(query:)` story points / number fields      | ❌ Not supported | Client-side only                                       |
| `fieldValueFilters` argument on `items()`         | ❌ Not in schema | Feature request #16106 open since May 2022, unresolved |
| `ProjectV2Item.fieldValueByName(name:)`           | ✅ Available     | Reduces field payload per item, not item count         |
| `search(query:)` (issues)                         | ✅ Available     | Filters text/label/assignee/repo — not board fields    |
| Org issue fields (`ProjectV2ItemIssueFieldValue`) | ✅ Readable      | Not filterable server-side                             |

**Key conclusion:** Full custom-field server-side filtering is not achievable. The tiered approach (server coarse filter via `query:` arg + client-side fine filter) is the ceiling of what the API supports today. The `query:` arg is worth using for `is:unarchived` (always) and single-status filters where applicable, but it cannot replace client-side iteration/sprint filtering.

**Implication for the architecture:** Client-side pagination + in-memory filtering remains mandatory. The optimization target is therefore **reducing per-page payload** (query profiles) and **eliminating redundant full scans** (session-scoped aggregation), not eliminating pagination.

---

## 3. Target architecture

### 3.1 Core principle

> **`ProjectItemsQueryBuilder` is the single source of truth for all `ProjectItems` board scans.** No service, assembler, or use case calls `PaginatedProjectItemFetcher` or `gh.graphql()` with a board-scan document directly. All board-scan concerns — query shape, server-side `query:` arg, field selection — are owned by `ProjectItemsQueryBuilder`.

### 3.2 Layer diagram (target state)

[![](https://img.plantuml.biz/plantuml/dsvg/tLbVRnot4N-_Jy5A3za3l9Bjk8sX06bEqfqZm5PadPoqyFc1jykxstgNt91SNQ-E0J_bEIZo2VhGbtw0FlJD7qMVf3D3BlVFdG4XBG981q7O7SuCPuR3uM-uNnlBjQsAd5rnlHIMZNIoogn8RAK5k_dm2vickYhO2swiqEnAgVnjPWU_iojH25RcF9C3ypQJ9TUyO2LFtlAbcDfDBfW69LmkSz5YICM2LxcTA6cdsTy4U_IeDJZIMgrFLAuqstz2l_xWrIfBtafX37jqyBWrcAYYL598ozuD63i6AvPQLJ9rohv7Xv2kT2gqd-3tz1kytxRUwMZpFgKVKCbkScwkyXI41v-ncry-tCK_iFpvwC_ZI_Q8LXaNbaqhlU29kCDErKkur_Q7CMPqScY1P0xt63UC7jd--EdaoUIKrlkrmJIFjU3fWJKpkU8opOKsXvxo1iM8vn88ZS1QGsvr9MfI8_8zKkv7jZocR7bb13lXHfWxx558bU2CpnDQCfSdbH49ZUoFJoTVZ7sgA9r1gG4nbA9LTXGSMsGoFREYCEtXG4IEkU8w_KRmtAxQF2qoSd79yutDaewUG4GEIZEqa969CnabaAj0-lXlLfMfVpB2JZAHfpEPg-LPKOeqAx1EmX1Fq-zKmkT3qatgNfs0van2fQTziuULLCZqGcaxaqriIdWtbFI_8l0p6S8HBR8SvXhE99myKwlqvbHOdkMH5Wj772sNMYp15nEPH9LYoDZDJpypATOpIUwI53lq7jCRMEgT1ZeuUQ8ATBaVWLgc8T6Ct-eITd9312VhG5Kvfxc0Qrp2Ab2AO2mWQ591l7MsN5cc5aHa-vF9v7Zy1nXahElA4Cv6E3eJOOvezER3Fv3Zk4c1QDWU6DNhtYLFImrh1UwLkR2Padvqck6XotWzNrng1O4MK8ku90wpubgaRBxnYVkWdNqFY0MAMPDkJPOTm20a1BbxFmhQvrJGJbK1I8P5cPH25yfOeah5L6NN41e0BgKPtc5tGxNpdhfIbzABgtNkcRBswVWBL-difXIuqR5S90esxf9slG0ifckwhd9X3jyqAgvGw3ubnpG1i0lkHGWJyrpaW1-yhrz2jSJyY9NCD_SdIMgFwmEHtboQ-9TkdW22hlo9u60HR1jFeKC8QGqYGWKJA4Zt94cUK98yo-mtrPoDKbx2aNQ7tGf9qFN8vm9tR-PmcTbLDNSvuOcG4wUJpoSJo0bC2YT_eTLVe17qI09GIeR75Psih0Kl70YPEmAArm5aT2gobvM0i_SYAqMUIV4R1HVC2D7OQGPZ4HG4vdqaJCCMmaA6cw531pKdz1hZXvE7BZGjjG4B0SckzcgqU04l4Cw7qA6CQ8lXxxM3Ix6n6exrvIQ67XVUQTj5ISwDoHQRYODK54utNakNpieum-bYu1R5F2VnDyxKKKqYYVVEqfxO3nY0U5vbUUfd_Z_6UoRFpeyWE1wlH7bcB82P7mEK0L18lf0L8xtyetztPrC5e8Pm7vv0vxn0KFpjgwiZzWwgTL8LX7IkkSuuE6dOUtARL1qxVtPwd71OJXTZ0406S5PCK1GnGLgLUPPm15ypkTQyD6pyLv5KI1ZB9IoyMmZIuRMBcY4MnE5KbnoUIH7BbIgT6B8wDKwMGEPSMQiAH9bjqpjeCs10eoeDE1vuhQuWenQgpeQjj2K4I12HG1x-pXMq3_ew0mtpJOa90vtpAlFZ0GRwLEbks7WAcjZKYPlVhXXkRTck8NkXrPfU9zZL-Kr9AsEmU_0PxXqFXzOFnl6GRBmYfDndcgyyKm3EBOwPd5TQfcej8QFo17e9cCsTc0JZOmWipTzJoirruhHceIVfg8tSoYLQ6HDZuqHYm6osLkOSaixLCQml06ZSilgr3xKAZpDi0YMc8y-7h1VNdXgAgLJIaVPFJw1idOIO2gwJLSpBh5DnmEmfZPmPKq6nT44coiWKJZJDy0OnXktmjYhxqi-49T5M3ZibJiefwNh_eh9kWuMiZ03WDta__9-oj1sWhPaeH4LbAUbw0Q95Bxn4PsKNMClYQvvNmZ6eKAn92gPnEd8-5pcilL7vDGM8HLHnKgYNrw5pZGl8owKF87HqEYuGX5abHLkMz9D6fv-2-BhWPIdqhsxwFrtnwIYXldsYLN79rz0TKuyBRRwl_vufDD0D8pA5mu4CztQYoG9wzEvEUGxwNjG-6tOvdbxvGWkii3Pt7O-E_tGrlZmVFR_3JgJSyZat3Vny1gVgwkLpDheucqb_Cd_t-83EveXgzH4Kh7y-O7m1MEU89PKsIZlqjLo1rDrUqjFnnVZyT7n-SZQUtc57mFJEZVpDJtzlNIA7UtKMqm7vLNsXkZtGNALkZxMlKBT7cylJvau-3DQtdxli3Eq_TRa08FCifM8zt35BkxlTCKzx6EPghfvn8ko3M6HN0DZmDg5rzSGMKFAQMxZXmCKdgALBoAQLw91RKUaEDDTx7R8FHPUuPMjpOOOsVWbuSiqt1c6bMiEv4mm41UrRePQDlP6EcRqncBrUXDrp-qbRqTsbW-ABHuRlErbeHMav1tHhUu1k7tnLjwBiY7tyLzEoVlmFAghbqPZZBdQAWeV3GQsYZgHhnq3ZrWNuJgKnWf8QWKFwTUwGjxK3H0NLk-xCjrW1gDwM5U7dRNaHStwAj-SWGaYFEX52RZjJGy5sj5ZaoAnkWBTD2EZFsT7wfi0EcGSvbs8HlPDLCHVw_PPXDNJROPA7NA3PVMXndnx2rnPwtPAgWHH8qIFTXn4c8qc3MAKluz48SpxGfmOqiub35wyFV5x5zFa1TsohasyzDmoTnl6eXbbrtqqXsP6069wNRKcw-rXdi6431gjrm5w4TFpKX5li0yp8stDJKjwUdVBozkpWViTDzFi4uJGzzVhxGKTTlOAktwV_pQgscldFMXjWXzBGc7NjwBLbWsQJx9YZsGcx3UXFYMRKDtu0cXhc81_GLDWZFI4MkKdhRoUjrceGTazNMzWUNNBO0TjpEtoFEuS-OCst4zMbdXUi-m5Ai1xDfL6Fw9AbHnny3VkpAlB1Vm40)](https://editor.plantuml.com/uml/tLbVRnot4N-_Jy5A3za3l9Bjk8sX06bEqfqZm5PadPoqyFc1jykxstgNt91SNQ-E0J_bEIZo2VhGbtw0FlJD7qMVf3D3BlVFdG4XBG981q7O7SuCPuR3uM-uNnlBjQsAd5rnlHIMZNIoogn8RAK5k_dm2vickYhO2swiqEnAgVnjPWU_iojH25RcF9C3ypQJ9TUyO2LFtlAbcDfDBfW69LmkSz5YICM2LxcTA6cdsTy4U_IeDJZIMgrFLAuqstz2l_xWrIfBtafX37jqyBWrcAYYL598ozuD63i6AvPQLJ9rohv7Xv2kT2gqd-3tz1kytxRUwMZpFgKVKCbkScwkyXI41v-ncry-tCK_iFpvwC_ZI_Q8LXaNbaqhlU29kCDErKkur_Q7CMPqScY1P0xt63UC7jd--EdaoUIKrlkrmJIFjU3fWJKpkU8opOKsXvxo1iM8vn88ZS1QGsvr9MfI8_8zKkv7jZocR7bb13lXHfWxx558bU2CpnDQCfSdbH49ZUoFJoTVZ7sgA9r1gG4nbA9LTXGSMsGoFREYCEtXG4IEkU8w_KRmtAxQF2qoSd79yutDaewUG4GEIZEqa969CnabaAj0-lXlLfMfVpB2JZAHfpEPg-LPKOeqAx1EmX1Fq-zKmkT3qatgNfs0van2fQTziuULLCZqGcaxaqriIdWtbFI_8l0p6S8HBR8SvXhE99myKwlqvbHOdkMH5Wj772sNMYp15nEPH9LYoDZDJpypATOpIUwI53lq7jCRMEgT1ZeuUQ8ATBaVWLgc8T6Ct-eITd9312VhG5Kvfxc0Qrp2Ab2AO2mWQ591l7MsN5cc5aHa-vF9v7Zy1nXahElA4Cv6E3eJOOvezER3Fv3Zk4c1QDWU6DNhtYLFImrh1UwLkR2Padvqck6XotWzNrng1O4MK8ku90wpubgaRBxnYVkWdNqFY0MAMPDkJPOTm20a1BbxFmhQvrJGJbK1I8P5cPH25yfOeah5L6NN41e0BgKPtc5tGxNpdhfIbzABgtNkcRBswVWBL-difXIuqR5S90esxf9slG0ifckwhd9X3jyqAgvGw3ubnpG1i0lkHGWJyrpaW1-yhrz2jSJyY9NCD_SdIMgFwmEHtboQ-9TkdW22hlo9u60HR1jFeKC8QGqYGWKJA4Zt94cUK98yo-mtrPoDKbx2aNQ7tGf9qFN8vm9tR-PmcTbLDNSvuOcG4wUJpoSJo0bC2YT_eTLVe17qI09GIeR75Psih0Kl70YPEmAArm5aT2gobvM0i_SYAqMUIV4R1HVC2D7OQGPZ4HG4vdqaJCCMmaA6cw531pKdz1hZXvE7BZGjjG4B0SckzcgqU04l4Cw7qA6CQ8lXxxM3Ix6n6exrvIQ67XVUQTj5ISwDoHQRYODK54utNakNpieum-bYu1R5F2VnDyxKKKqYYVVEqfxO3nY0U5vbUUfd_Z_6UoRFpeyWE1wlH7bcB82P7mEK0L18lf0L8xtyetztPrC5e8Pm7vv0vxn0KFpjgwiZzWwgTL8LX7IkkSuuE6dOUtARL1qxVtPwd71OJXTZ0406S5PCK1GnGLgLUPPm15ypkTQyD6pyLv5KI1ZB9IoyMmZIuRMBcY4MnE5KbnoUIH7BbIgT6B8wDKwMGEPSMQiAH9bjqpjeCs10eoeDE1vuhQuWenQgpeQjj2K4I12HG1x-pXMq3_ew0mtpJOa90vtpAlFZ0GRwLEbks7WAcjZKYPlVhXXkRTck8NkXrPfU9zZL-Kr9AsEmU_0PxXqFXzOFnl6GRBmYfDndcgyyKm3EBOwPd5TQfcej8QFo17e9cCsTc0JZOmWipTzJoirruhHceIVfg8tSoYLQ6HDZuqHYm6osLkOSaixLCQml06ZSilgr3xKAZpDi0YMc8y-7h1VNdXgAgLJIaVPFJw1idOIO2gwJLSpBh5DnmEmfZPmPKq6nT44coiWKJZJDy0OnXktmjYhxqi-49T5M3ZibJiefwNh_eh9kWuMiZ03WDta__9-oj1sWhPaeH4LbAUbw0Q95Bxn4PsKNMClYQvvNmZ6eKAn92gPnEd8-5pcilL7vDGM8HLHnKgYNrw5pZGl8owKF87HqEYuGX5abHLkMz9D6fv-2-BhWPIdqhsxwFrtnwIYXldsYLN79rz0TKuyBRRwl_vufDD0D8pA5mu4CztQYoG9wzEvEUGxwNjG-6tOvdbxvGWkii3Pt7O-E_tGrlZmVFR_3JgJSyZat3Vny1gVgwkLpDheucqb_Cd_t-83EveXgzH4Kh7y-O7m1MEU89PKsIZlqjLo1rDrUqjFnnVZyT7n-SZQUtc57mFJEZVpDJtzlNIA7UtKMqm7vLNsXkZtGNALkZxMlKBT7cylJvau-3DQtdxli3Eq_TRa08FCifM8zt35BkxlTCKzx6EPghfvn8ko3M6HN0DZmDg5rzSGMKFAQMxZXmCKdgALBoAQLw91RKUaEDDTx7R8FHPUuPMjpOOOsVWbuSiqt1c6bMiEv4mm41UrRePQDlP6EcRqncBrUXDrp-qbRqTsbW-ABHuRlErbeHMav1tHhUu1k7tnLjwBiY7tyLzEoVlmFAghbqPZZBdQAWeV3GQsYZgHhnq3ZrWNuJgKnWf8QWKFwTUwGjxK3H0NLk-xCjrW1gDwM5U7dRNaHStwAj-SWGaYFEX52RZjJGy5sj5ZaoAnkWBTD2EZFsT7wfi0EcGSvbs8HlPDLCHVw_PPXDNJROPA7NA3PVMXndnx2rnPwtPAgWHH8qIFTXn4c8qc3MAKluz48SpxGfmOqiub35wyFV5x5zFa1TsohasyzDmoTnl6eXbbrtqqXsP6069wNRKcw-rXdi6431gjrm5w4TFpKX5li0yp8stDJKjwUdVBozkpWViTDzFi4uJGzzVhxGKTTlOAktwV_pQgscldFMXjWXzBGc7NjwBLbWsQJx9YZsGcx3UXFYMRKDtu0cXhc81_GLDWZFI4MkKdhRoUjrceGTazNMzWUNNBO0TjpEtoFEuS-OCst4zMbdXUi-m5Ai1xDfL6Fw9AbHnny3VkpAlB1Vm40)

### 3.3 `ProjectItemsQueryBuilder` interface (blackbox spec)

```typescript
type QueryProfile = "listing" | "aggregate";

interface BuildQueryOptions {
  profile: QueryProfile;
  queryArg?: string; // items(query: "…") server-side coarse filter
  configuredFieldTypeNames: string[]; // from config.live.fields — trims ItemFieldValues
}

// Output passed to ExecutionEngine
interface BoardScanRequest {
  document: string;
  variables: { login: string; number: number; queryArg?: string };
}
```

**`listing` profile:** Full `ItemContent` minus unused fields (`state`, `repository.*`, `labels.color`, `milestone.dueOn`). Conditional `body` (only when `filter.search` is set). Conditional `blockedBy` (only when `include_dependencies`). Used by `scrum_find_items`.

**`aggregate` profile:** No `ItemContent`. Minimal `fieldValues` with only: `ProjectV2ItemFieldIterationValue`, `ProjectV2ItemFieldSingleSelectValue`, `ProjectV2ItemFieldNumberValue`. Plus `assignees { totalCount }` and `blockedBy { totalCount }`. Estimated payload reduction: **60–80%** vs current shape. Used by all non-listing board scans.

**`buildQueryArg(filter)` helper:**

```typescript
buildQueryArg(filter: ResolvedItemFilter): string {
  const parts = ['is:unarchived']; // always, unless filter.includeArchived
  if (filter.statuses?.length === 1) {
    parts.push(`status:"${filter.statuses[0]}"`);
  }
  return parts.join(' ');
}
```

### 3.4 Clean BackendPort interface

The port is defined by what use cases need, not by adapter internals:

```typescript
interface BackendPort {
  // Bootstrap
  reload(): Promise<void>;
  getPlatformState(vocab: VocabularyFilter): Promise<BackendCallResult<PlatformState>>;

  // Read
  findItems(filter: ResolvedItemFilter): Promise<BackendCallResult<ItemSearchResult>>;
  getStoryDetail(ref: StoryRef): Promise<BackendCallResult<StoryDetail>>;
  getAggregates(scope: BoardScope): Promise<BoardAggregates>; // ← replaces getBoardHealth + getAnalytics + getSprintCompletion

  // Mutations
  createStory(input: CreateStoryInput): Promise<StoryRef>;
  updateStory(ref: StoryRef, updates: StoryUpdates): Promise<void>;
  setField(ref: StoryRef, field: ScrumField, value: FieldValue): Promise<void>;
  addComment(ref: StoryRef, body: string): Promise<void>;
  logImpediment(input: ImpedimentInput): Promise<ImpedimentRef>;
  updateImpediment(ref: ImpedimentRef, update: ImpedimentUpdate): Promise<ImpedimentListing>;
  getOrphanImpediments(): Promise<ImpedimentListing[]>;
  addVocabulary(kind: VocabularyKind, value: string): Promise<CreateResult>;

  // Epic
  getEpics(sprintIterationId?: string | null): Promise<EpicListing[]>;
}
```

**Key change:** `getAggregates(scope)` replaces three separate port methods (`getBoardHealth`, `getAnalytics`, `getSprintCompletion`). Use cases call it once and extract what they need. The adapter implements it with a single aggregate-profile board scan.

`getOrphanImpediments` stays separate — it is a label-based issue query (`GetImpedimentIssues`), not a board scan, so it correctly does not go through `ProjectItemsQueryBuilder`.

### 3.5 `BoardAggregates` type spec

`BoardAggregates` is the output of `getAggregates()` — pure facts from a single aggregate board scan. No Scrum judgments; those belong in use cases.

```typescript
/**
 * Lean per-item projection from the aggregate query profile.
 * No body, label list, assignee list, or repository data.
 * `sprintId` maps from the platform's iteration concept (platform-agnostic term at port boundary).
 */
interface ItemAggregate {
  readonly id: string;
  readonly type: string | null; // board Type field value
  readonly status: string | null; // board Status field value
  readonly sprintId: string | null; // null = backlog
  readonly storyPoints: number | null;
  readonly hasBlockers: boolean; // blockedBy totalCount > 0
  readonly hasAssignee: boolean; // assignees totalCount > 0
  readonly issueNumber: number | null; // null for draft issues; used by burndown REST
  readonly isArchived: boolean;
}

/**
 * Pre-grouped per-sprint summary. Adapter computes counts using
 * terminal-status mapping from config — use cases read, don't re-iterate.
 */
interface SprintSummary {
  readonly sprintId: string;
  readonly sprintName: string;
  readonly items: readonly ItemAggregate[];
  readonly totalItems: number;
  readonly totalPoints: number;
  readonly completedPoints: number; // points in terminal (done) statuses
  readonly itemsByStatus: Record<string, number>;
  readonly pointsByStatus: Record<string, number>;
  readonly unestimatedCount: number;
  readonly blockedCount: number;
  readonly unassignedCount: number;
}

/**
 * Output of a single aggregate board scan.
 * Items live inside SprintSummary.items and backlog[] — not as a flat root array,
 * because no use case needs the full board as an unstructured list.
 *
 * Orphan impediments (label-tracked, off-board) are NOT here.
 * They come from getOrphanImpediments() and are composed by the use case.
 */
interface BoardAggregates {
  readonly sprintSummaries: readonly SprintSummary[]; // all sprints, newest-first
  readonly backlog: readonly ItemAggregate[]; // sprintId === null
  readonly meta: {
    readonly totalCount: number;
    readonly truncated: boolean; // hit pagination ceiling — counts are incomplete
    readonly fetchedAt: string; // ISO-8601
  };
}
```

**How use cases read it:**

```
orientUseCase (sprint completion):
  sprintSummaries.find(s => s.sprintId === activeSprintId)
  → { completed: s.completedPoints, total: s.totalPoints }

boardHealthUseCase:
  active = sprintSummaries.find(active sprint)
  → SprintRisk { unestimated_count: active.unestimatedCount,
                 blocked_count: active.blockedCount,
                 no_assignee_count: active.unassignedCount }
  all items across summaries + backlog → readiness by_type

analyticsUseCase (history):
  sprintSummaries.filter(completedSprintIds)
  → map to SprintSnapshot via SprintInfo from PlatformState

analyticsUseCase (burndown):
  sprintSummaries.find(active).items
  → BurndownStoryInput[] { issueNumber, storyPoints, status }
  → then parallel REST timeline per issueNumber
```

### 3.6 Mapper split (prerequisite)

Before the aggregate profile can be used, `buildStoryFromRaw` in `mappers.ts` must be split:

```typescript
// Existing — listing profile; requires full ItemContent; null-guard stays
buildStoryFromRaw(item, config): Story | null

// New — aggregate profile; only fieldValues needed; no null-guard on labels/assignees
buildAggregateFromRaw(item, config): ItemAggregate
```

`buildAggregateFromRaw` does not return `null` — aggregate items without labels/assignees are valid and expected.

---

## 4. Sequenced implementation plan

Dependencies flow top to bottom; each step unblocks the next.

| Step | Change                                                                                                       | Layer                                      | Unblocks                                                                               |
| ---- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------ | -------------------------------------------------------------------------------------- |
| 1    | Add `buildAggregateFromRaw` in `mappers.ts`; relax null-guard for aggregate callers                          | Adapter (`mappers.ts`)                     | Everything below                                                                       |
| 2    | Add `profile` + `buildQueryArg` to `ProjectItemsQueryBuilder`; extend `PlatformRequest` to carry `queryArg?` | Adapter (`project-items-query-builder.ts`) | Steps 3, 4                                                                             |
| 3    | Wire all bypass callers to the board query pipeline with aggregate profile                                   | Adapter (services)                         | Eliminates R2, R4, R5; `PaginatedProjectItemFetcher` becomes dead code for board scans |
| 4    | Wire `buildQueryArg` output into `ProjectItemsAssembler.assemble()`                                          | Adapter (assembler)                        | `is:unarchived` + single-status server filter for `findItems`                          |
| 5    | Add `getAggregates(scope)` to `BackendPort`; implement in `GitHubProjectBackend`                             | Port + Adapter                             | Clean port interface; collapses getBoardHealth + getAnalytics + getSprintCompletion    |
| 6    | Update use cases to call `getAggregates` + read from `BoardAggregates`                                       | Use case layer                             | Removes platform-specific calls from use cases                                         |
| 7    | R1: Remove `getStoryDetail` post-mutation re-read in `set_field` handler                                     | Tool handler                               | −3 GraphQL calls per `scrum_set_field`                                                 |
| 8    | R3: Bypass router for `resolveRef({number})` — direct `GetIssueProjectItem`                                  | Adapter                                    | Removes router overhead on all write tools using issue numbers                         |

Steps 1–4 are adapter-only (no port or use-case changes). Step 5 requires a port change. Steps 7–8 are independent and can run in parallel with any of the above.

---

## 5. Unresolved questions

**Q1 — `getAggregates` scope parameter.** Should it always return all sprints (full board) or accept a `BoardScope` that limits which sprints are loaded? `boardHealth` and `burndown` only need the active sprint; `history` needs completed sprints. A scope parameter could halve the item set for health/burndown but adds a branching code path. Decision needed before implementing Step 5.

**Q2 — `items(query:)` iteration syntax.** The research confirms `status:"X"` works but iteration/sprint filtering via `query:` is undocumented and likely unsupported. A live probe with a real token is required before investing in a `buildQueryArg` sprint-filter path. If it works, page count for sprint-scoped queries could drop dramatically. If it doesn't, the `queryArg` benefit is limited to `is:unarchived` + single-status.

**Q3 — Request-scoped cache.** Even with a single `getAggregates` call per tool invocation, back-to-back tool calls in a session (e.g. `orient` then `board_health`) still each trigger a full board scan. A session-scoped `BoardAggregates` cache keyed by `fetchedAt` TTL would eliminate this. Adds complexity; worth a separate spike.

**Q4 — `BoardScope` definition.** The `getAggregates(scope: BoardScope)` signature was agreed but `BoardScope` not yet defined. Minimum viable: `{ sprint: 'active' | 'all' }`. Needs to be defined before Step 5 is implementable.

**Q5 — `EpicPort` / `getEpics`.** Epics are fetched via `ListMilestones` (REST, per repo), not a board scan. They're currently called in `orientUseCase`. Not affected by this refactor but the port interface consolidation in Step 5 is a good time to audit whether `EpicPort` should remain a separate interface or merge into `BackendPort` directly.

**Q6 — Parallel REST calls in burndown.** `BurndownCalculator` currently calls REST issue timeline **sequentially** per sprint story. With the aggregate profile supplying `issueNumber[]`, these REST calls become parallelizable (`Promise.all`). This is a separate optimization that can be done as part of Step 3 or deferred.

---

## 6. What this does NOT change

- **Tool names and parameter shapes** — zero changes to the MCP tool surface. Agents using these tools see no difference.
- **`SearchApiAssembler` and `DirectLookupAssembler`** — not board scans; correctly bypass `ProjectItemsQueryBuilder`.
- **Mutation paths** — `StoryMutationService`, `FieldValueMutator`, `LabelResolver`, `VocabularyManager` — unaffected.
- **`getOrphanImpediments`** — label-based issue query; stays separate from board scan pipeline.
- **`ConfigReloader` / bootstrap** — orient still pays one `GetUserProjectFieldsBootstrap` call per invocation; that's a use-case-layer concern out of scope here.
