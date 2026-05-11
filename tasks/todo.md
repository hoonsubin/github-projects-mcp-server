# Agent's TODO List

---

## Verification Results: Unused Exports List

I've verified the unused exports list in [`docs/proj-diagram.md`](docs/proj-diagram.md:408-449). **The list is INCORRECT** — several exports are actually being used.

### Findings:

#### 1. [`src/scrum/sprint-math.ts`](src/scrum/sprint-math.ts)

**INCORRECTLY listed as unused:**

- **`SprintWindow`** (line 112) — USED by [`src/scrum/get-burndown.ts:16`](src/scrum/get-burndown.ts:16)

**Correctly listed as unused:**

- **`IdealDayPoint`** (line 152) — NOT imported anywhere
- **`BurndownDayPoint`** (line 179) — NOT imported anywhere

#### 2. [`src/schemas/scrum.ts`](src/schemas/scrum.ts)

**All correctly listed as unused:**

- **`StoryRefSchema`** (line 17)
- **`SprintRefSchema`** (line 41)
- **`ScrumFieldSchema`** (line 58)
- **`StoryTypeSchema`** (line 72)

#### 3. [`src/schemas/inputs.ts`](src/schemas/inputs.ts)

**INCORRECTLY listed as unused:**

- **`resolveFieldValue`** (line 169) — USED by [`src/schemas/inputs_test.ts:2`](src/schemas/inputs_test.ts:2)

**All correctly listed as unused:**

- **`PaginationSchema`** (line 5)
- **`OwnerTypeSchema`** (line 12)
- **`ListProjectsSchema`** (line 18)
- **`GetProjectSchema`** (line 27)
- **`UpdateProjectSchema`** (line 35)
- **`ListItemsSchema`** (line 53)
- **`AddItemSchema`** (line 68)
- **`AddDraftIssueSchema`** (line 76)
- **`DeleteItemSchema`** (line 88)
- **`ArchiveItemSchema`** (line 96)
- **`FieldValueUnion`** (line 120)
- **`ResolvedFieldValue`** (line 165)
- **`UpdateFieldValueSchema`** (line 219)
- **`GetProjectFieldsSchema`** (line 236)
- **`GetSprintStatusSchema`** (line 262)
- **`GetVelocitySchema`** (line 271)
- **`GetBacklogItemsSchema`** (line 277)
- **`BulkUpdateItemFieldSchema`** (line 287)
- **`CloseSprintSchema`** (line 308)
- **`GenerateSprintReportSchema`** (line 326)
- **`GetIssueNodeIdSchema`** (line 336)
- **`GetUserNodeIdSchema`** (line 345)
- **`GraphQLQuerySchema`** (line 357)
- **`GetRepoFileSchema`** (line 372)
- **`CreateIssueSchema`** (line 390)
- **`UpdateIssueSchema`** (line 410)
- **`CreateCommentSchema`** (line 440)
- **`WriteRepoFileSchema`** (line 463)

#### 4. [`src/types.ts`](src/types.ts)

**INCORRECTLY listed as unused:**

- **`ScrumField`** (line 30) — Referenced in comments and documentation, but not directly imported

**Correctly listed as unused:**

- **All other types** are correctly identified as unused

### Summary:

- **2 exports incorrectly marked as unused**: `SprintWindow` and `resolveFieldValue`
- **1 export correctly identified as unused**: `ScrumField` (though it's referenced in comments)
- **All other exports correctly listed as unused**

The unused exports list needs to be updated to remove `SprintWindow` and `resolveFieldValue` from the unused section.
