# Story 9: Implement scrum_get_story Read Tool

**Issue:** [#11](https://github.com/hoonsubin/github-projects-mcp-server/issues/11)
**Priority:** Should
**Size:** M
**Story Points:** 5
**Sprint:** Sprint 2
**Status:** In Progress

---

## Goal

The `scrum_get_story` tool is already registered and functional. This story is about
**refactoring** the existing handler into a clean, testable structure — and adding the test
coverage it currently lacks. No new observable behaviour changes.

The handler currently works, but it violates three core clean code principles:

1. **DRY** — the field-extraction loop and label/type-classification logic duplicate what
   `buildStoryFromRaw` does, just operating on a different GraphQL response shape.
2. **Functions do one thing** — the handler body fetches data, assembles a `Story`, maps
   comments, maps linked PRs, and parses AC — all inline. Each of those is a distinct
   responsibility.
3. **Handler should read as orchestration** — once extracted, the handler should be a
   five-line sequence of named calls, with zero inline logic.

---

## Acceptance Criteria

1. **Tool contract is unchanged** — `scrum_get_story` accepts `{ ref: StoryRef }` and
   returns `{ story, comments, linked_prs, acceptance_criteria }` with the same field shapes
   as today. Nothing the agent observes changes.

2. **`buildEnrichedStory` extracted** — a named, pure function assembles a `Story` from the
   issue node and field-value array. It does not call the network. It reuses `STORY_TYPES` and
   field-ID resolution from `RuntimeConfig`.

3. **`buildCommentList` extracted** — maps raw comment nodes to `Comment[]`. Pure. No network.

4. **`buildLinkedPrList` extracted** — maps raw timeline nodes to `LinkedPr[]`. Filters out
   non-PR cross-references. Pure. No network.

5. **`parseAcceptanceCriteria` exported** — the existing implementation is correct; it only
   needs to be exported so tests can import it directly.

6. **Handler reads as orchestration** — after refactor, the handler body contains only:
   config loading, `resolveStory`, parallel fetch, and calls to the four named helpers above.
   No inline field loops or object construction.

7. **No duplication with `buildStoryFromRaw`** — the two build functions serve different
   source shapes; they must not share a code path. But they must share `STORY_TYPES` and the
   field-ID resolution pattern without duplicating either.

8. **Named response interfaces** — `GetIssueDetailsResponse` and `GetItemFieldsResponse` are
   declared as named interfaces in the file, not inlined at call sites.

9. **Unit tests** in `src/tools/scrum-read_test.ts` cover all four extracted helpers and key
   handler paths. Each helper is tested without registering an MCP server or mocking a GitHub
   client.

10. **Type-check passes** — `deno check src/index.ts` returns no errors after all changes.

---

## Current Implementation Audit

The implementation lives in `src/tools/scrum-read.ts` at the `// ── Step 10` comment
(around line 1137). Here is what each section currently does and what is wrong with it.

### What is already right

- `resolveStory` is called correctly and its two resolution paths (by `number` and by `id`)
  work as designed.
- The parallel `Promise.all` fetch of issue data and item field values is the correct
  approach — there is no dependency between them.
- The `parseAcceptanceCriteria` regex is correct and handles both checked (`[x]`) and
  unchecked (`[ ]`) boxes.
- Error handling falls through to `formatError` consistently.

### Clean code issues

#### Issue 1 — Handler body does more than one thing (Functions, SRP)

The handler closure currently: resolves the story, fires two GraphQL calls, loops over field
values, constructs a `Story` inline, maps comments, maps linked PRs, parses AC, and assembles
the return value. That is six responsibilities in one function.

**Rule violated:** _A function should do one thing. If you can extract a meaningful named
function from it, the original function does more than one thing._

#### Issue 2 — Field-extraction loop duplicates `buildStoryFromRaw` (DRY)

Lines 1201–1222 in the handler:

```typescript
for (const fv of fieldValues) {
  const fieldId = fv.field?.id;
  if (!fieldId) continue;
  if (fieldId === statusFieldId && fv.name) {
    status = fv.name;
  } else if (fieldId === sprintFieldId && fv.title) {
    sprint = fv.title;
  }
  // ...
}
```

This is byte-for-byte the same pattern as the loop inside `buildStoryFromRaw` (lines
371–387). The only difference is the variable source: `buildStoryFromRaw` reads from a
`RawItem` (project-items query shape); the handler reads from a separate `GetItemFieldsResponse`
node. The extraction _logic_ is identical.

**Rule violated:** _Duplication is the root of most software evil. Every time you see
duplication, it represents a missed opportunity for abstraction._

The fix is not to merge the two code paths — they operate on different shapes. The fix is to
name each one clearly: `buildStoryFromRaw` (for the project-items path, used by
`scrum_get_sprint` and `scrum_get_backlog`) and a new `buildEnrichedStory` (for the
`scrum_get_story` path that fetches issue+item separately). The extraction _pattern_ is then
clearly encapsulated in each named function.

#### Issue 3 — `Story` assembly is inline with `let`/mutation pattern (Functions)

```typescript
let status: string | null = null;
let sprint: string | null = null;
// ... mutated in loop ...
const story: Story = { ref: ..., title: ..., status, sprint, ... };
```

Mutable locals and imperative assembly make it hard to test the shape logic in isolation.
Extracting into `buildEnrichedStory` converts this to a single pure-function return.

#### Issue 4 — `STORY_TYPES.has(l)` appears twice in the handler (DRY)

Lines 1225 and 1227:

```typescript
const type   = (allLabels.find((l) => STORY_TYPES.has(l)) ...) ?? null;
const labels =  allLabels.filter((l) => !STORY_TYPES.has(l));
```

This exact two-liner also appears inside `buildStoryFromRaw` (lines 390–392). The logic
belongs in a named helper:

```typescript
// Pure utility — splits label array into { type, labels }.
const classifyLabels = (
  allLabels: string[],
): { type: Story["type"]; labels: string[] } => ({
  type: (allLabels.find((l) => STORY_TYPES.has(l)) as Story["type"]) ?? null,
  labels: allLabels.filter((l) => !STORY_TYPES.has(l)),
});
```

`buildStoryFromRaw` and `buildEnrichedStory` both call `classifyLabels` — the duplication
collapses.

#### Issue 5 — `parseAcceptanceCriteria` is not exported (Testability)

The function exists at module scope and is correct, but because it is not exported,
unit tests cannot import it directly. It must be exported.

#### Issue 6 — No unit tests (Kent Beck's Rule 1: Runs all the tests)

The entire `scrum_get_story` handler has no test coverage. The absence of tests for the
extracted helpers is the most actionable gap, since each helper is independently testable
without a GitHub client mock.

---

## Refactoring Plan

### Refactor 1 — Extract `classifyLabels`

Add alongside `STORY_TYPES` in the `// ── Story builder ──` section:

```typescript
/**
 * Split a raw label name array into a typed `type` field and the remaining labels.
 * The type:* label (feature, bug, tech_debt, spike) is consumed; everything else
 * is surfaced in `labels`.
 */
const classifyLabels = (
  allLabels: string[],
): { type: Story["type"]; labels: string[] } => ({
  type: (allLabels.find((l) => STORY_TYPES.has(l)) as Story["type"]) ?? null,
  labels: allLabels.filter((l) => !STORY_TYPES.has(l)),
});
```

Then update `buildStoryFromRaw` to call it, eliminating those two lines there.

### Refactor 2 — Extract `extractBoardFields`

The field-value loop that produces `{ status, sprint, story_points, priority }` appears in
both `buildStoryFromRaw` and the `scrum_get_story` handler. The input type differs
(`RawItemFieldValue` vs `ProjectV2ItemFieldValue`) but the _shape_ of both types is
structurally equivalent for the fields we need: `{ field?: { id: string }, name?: string,
title?: string, number?: number }`.

Rather than creating a union, define the helper against a minimal interface:

```typescript
interface FieldValueNode {
  field?: { id: string };
  name?: string; // single-select option display name
  title?: string; // iteration title
  number?: number; // number field value
}

interface BoardFields {
  status: string | null;
  sprint: string | null;
  story_points: number | null;
  priority: string | null;
}

/**
 * Extract the four Scrum board fields from an array of field-value nodes.
 * Pure function. Works on any field-value shape that satisfies FieldValueNode.
 */
const extractBoardFields = (
  nodes: FieldValueNode[],
  fields: RuntimeConfig["fields"],
): BoardFields => {
  let status: string | null = null;
  let sprint: string | null = null;
  let story_points: number | null = null;
  let priority: string | null = null;

  for (const fv of nodes) {
    const id = fv.field?.id;
    if (!id) continue;
    if (id === fields.statusFieldId && fv.name) {
      status = fv.name;
    } else if (id === fields.sprintFieldId && fv.title) {
      sprint = fv.title;
    } else if (
      fields.storyPointsFieldId &&
      id === fields.storyPointsFieldId &&
      typeof fv.number === "number"
    ) {
      story_points = fv.number;
    } else if (
      fields.priorityFieldId &&
      id === fields.priorityFieldId &&
      fv.name
    ) {
      priority = fv.name;
    }
  }

  return { status, sprint, story_points, priority };
};
```

Then update `buildStoryFromRaw` to call `extractBoardFields(item.fieldValues.nodes, config.fields)`.

### Refactor 3 — Extract `buildEnrichedStory`

```typescript
/**
 * Build a Story from the issue node (GET_ISSUE_DETAILS_QUERY) and the
 * project item field values (GET_ITEM_FIELDS_QUERY).
 *
 * Distinct from buildStoryFromRaw: that function works on the compact RawItem
 * shape returned by the project-items list query; this function works on the
 * richer per-issue query response.
 *
 * Pure function — no network calls.
 */
const buildEnrichedStory = (
  issueNode: IssueDetailsNode,
  itemId: string,
  fieldValueNodes: FieldValueNode[],
  config: RuntimeConfig,
): Story => {
  const boardFields = extractBoardFields(fieldValueNodes, config.fields);
  const { type, labels } = classifyLabels(
    issueNode.labels?.nodes.map((l) => l.name) ?? [],
  );

  return {
    ref: { number: issueNode.number, id: itemId },
    title: issueNode.title ?? "",
    body: issueNode.body ?? "",
    type,
    status: boardFields.status,
    sprint: boardFields.sprint,
    story_points: boardFields.story_points,
    priority: boardFields.priority,
    assignees: issueNode.assignees?.nodes.map((a) => a.login) ?? [],
    labels,
    epic: issueNode.milestone?.title ?? null,
    created_at: issueNode.createdAt ?? "",
    updated_at: issueNode.updatedAt ?? "",
    url: issueNode.url ?? null,
  };
};
```

Where `IssueDetailsNode` is the typed inner node from `GetIssueDetailsResponse`:

```typescript
interface IssueDetailsNode {
  id: string;
  number: number;
  title: string | null;
  body: string | null;
  url: string | null;
  createdAt: string;
  updatedAt: string;
  assignees?: { nodes: Array<{ login: string }> };
  labels?: { nodes: Array<{ name: string }> };
  milestone?: { title: string } | null;
  comments?: { nodes: CommentNode[] };
  timelineItems?: { nodes: CrossReferencedEventNode[] };
}

interface GetIssueDetailsResponse {
  node?: IssueDetailsNode | null;
}
```

### Refactor 4 — Extract `buildCommentList`

```typescript
interface Comment {
  author: string;
  body: string;
  created_at: string;
  url: string;
}

interface CommentNode {
  author?: { login: string } | null;
  body: string;
  createdAt: string;
  url: string;
}

/**
 * Map raw comment nodes to the Comment shape the agent receives.
 * "(ghost)" is the conventional fallback for deleted accounts.
 * Pure function.
 */
const buildCommentList = (nodes: CommentNode[]): Comment[] =>
  nodes.map((c) => ({
    author: c.author?.login ?? "(ghost)",
    body: c.body,
    created_at: c.createdAt,
    url: c.url,
  }));
```

### Refactor 5 — Extract `buildLinkedPrList`

```typescript
interface LinkedPr {
  number: number;
  title: string;
  url: string;
  state: string;
  is_draft: boolean;
}

interface CrossReferencedEventNode {
  source?: {
    number?: number | null;
    title?: string | null;
    url?: string | null;
    state?: string | null;
    isDraft?: boolean | null;
  } | null;
}

/**
 * Map raw CROSS_REFERENCED_EVENT timeline nodes to linked-PR summaries.
 * Entries where source.number is null are non-PR references (e.g., issue
 * mentions) and are filtered out.
 * Pure function.
 */
const buildLinkedPrList = (nodes: CrossReferencedEventNode[]): LinkedPr[] =>
  nodes
    .filter((n) => n.source?.number != null)
    .map((n) => ({
      number: n.source!.number!,
      title: n.source!.title ?? "",
      url: n.source!.url ?? "",
      state: n.source!.state ?? "UNKNOWN",
      is_draft: n.source!.isDraft ?? false,
    }));
```

### Refactor 6 — Export `parseAcceptanceCriteria`

Change the declaration from `const` to `export const`:

```typescript
// Before
const parseAcceptanceCriteria = ...

// After
export const parseAcceptanceCriteria = ...
```

No implementation change. This is the minimum required for unit tests to import it.

### After all refactors — the handler reads as orchestration only

```typescript
async (params: z.infer<typeof GetStorySchema>) => {
  try {
    const { owner, ownerType, projectNumber } = getBootstrapConfig();
    const config = await loadConfig({
      github: gh, owner, ownerType, projectNumber, repo: getRepo(),
    });

    const resolved = await resolveStory(params.ref, config, gh);

    const [issueData, itemData] = await Promise.all([
      gh.graphql<GetIssueDetailsResponse>(GET_ISSUE_DETAILS_QUERY, { issueId: resolved.issueId }),
      gh.graphql<GetItemFieldsResponse>(GET_ITEM_FIELDS_QUERY,    { itemId: resolved.itemId  }),
    ]);

    const issueNode = issueData.node;
    if (!issueNode) throw new Error(missingIssueMessage(resolved.issueId));

    const story               = buildEnrichedStory(issueNode, resolved.itemId, itemData.node?.fieldValues?.nodes ?? [], config);
    const comments            = buildCommentList(issueNode.comments?.nodes ?? []);
    const linked_prs          = buildLinkedPrList(issueNode.timelineItems?.nodes ?? []);
    const acceptance_criteria = parseAcceptanceCriteria(story.body);

    return { content: [{ type: "text" as const, text: JSON.stringify({ story, comments, linked_prs, acceptance_criteria }, null, 2) }] };
  } catch (err: unknown) {
    return { content: [{ type: "text" as const, text: formatError(err) }], isError: true };
  }
},
```

Where `missingIssueMessage` is a named helper:

```typescript
const missingIssueMessage = (issueId: string): string =>
  `Issue ${issueId} could not be fetched. ` +
  "It may have been deleted or the token lacks Issues: Read access.";
```

---

## File Changes

| File                           | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/tools/scrum-read.ts`      | Add `classifyLabels`, `extractBoardFields`, `buildEnrichedStory`, `buildCommentList`, `buildLinkedPrList`, `missingIssueMessage`; add named interfaces `IssueDetailsNode`, `CommentNode`, `CrossReferencedEventNode`, `Comment`, `LinkedPr`, `FieldValueNode`, `BoardFields`; export `parseAcceptanceCriteria`; update `buildStoryFromRaw` to call `classifyLabels` and `extractBoardFields`; simplify `scrum_get_story` handler to orchestration only |
| `src/tools/scrum-read_test.ts` | Add unit tests for all extracted helpers                                                                                                                                                                                                                                                                                                                                                                                                               |

No other files change. `index.ts`, `types.ts`, `schemas/scrum.ts`, and `services/` are
untouched — this refactor is entirely within `scrum-read.ts` and its test file.

---

## Testing Plan

All tests go in `src/tools/scrum-read_test.ts`. Import extracted helpers directly — no MCP
server registration, no GitHub client mock needed.

### `classifyLabels`

| Test case                         | Input                    | Expected output                                                                                                          |
| --------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| One type label present            | `["feature", "backend"]` | `{ type: "feature", labels: ["backend"] }`                                                                               |
| No type label                     | `["backend", "api"]`     | `{ type: null, labels: ["backend", "api"] }`                                                                             |
| Multiple type labels (first wins) | `["bug", "feature"]`     | `{ type: "bug", labels: ["feature"] }` — note: second type label leaks into `labels`; document this as acceptable for v1 |
| Empty array                       | `[]`                     | `{ type: null, labels: [] }`                                                                                             |

### `extractBoardFields`

| Test case                              | Scenario                                                     |
| -------------------------------------- | ------------------------------------------------------------ |
| All four fields populated              | Returns correct `{ status, sprint, story_points, priority }` |
| `storyPointsFieldId` is null in config | Returns `story_points: null`; no crash                       |
| `priorityFieldId` is null in config    | Returns `priority: null`; no crash                           |
| Field value node with no `field.id`    | Skipped; no crash                                            |
| Empty nodes array                      | Returns all-null `BoardFields`                               |

### `buildEnrichedStory`

| Test case                    | Scenario                                 |
| ---------------------------- | ---------------------------------------- |
| Full issue node              | All Story fields populated correctly     |
| Null `title`/`body`          | Falls back to `""`                       |
| No assignees                 | Returns `assignees: []`                  |
| No milestone                 | Returns `epic: null`                     |
| `type` label in labels array | `type` set; label excluded from `labels` |

### `buildCommentList`

| Test case                       | Scenario                                               |
| ------------------------------- | ------------------------------------------------------ |
| Normal comment                  | `author`, `body`, `created_at`, `url` mapped correctly |
| Deleted account (`author` null) | `author` set to `"(ghost)"`                            |
| Empty array                     | Returns `[]`                                           |

### `buildLinkedPrList`

| Test case                                     | Scenario                         |
| --------------------------------------------- | -------------------------------- |
| PR cross-reference                            | All five fields mapped correctly |
| Non-PR cross-reference (`source.number` null) | Filtered out                     |
| `isDraft` absent                              | Defaults to `false`              |
| Empty array                                   | Returns `[]`                     |

### `parseAcceptanceCriteria`

| Test case                | Input                                       | Expected                                          |
| ------------------------ | ------------------------------------------- | ------------------------------------------------- |
| Unchecked item           | `"- [ ] Deploy to staging"`                 | `[{ text: "Deploy to staging", checked: false }]` |
| Checked item             | `"- [x] Unit tests pass"`                   | `[{ text: "Unit tests pass", checked: true }]`    |
| Uppercase `[X]`          | `"- [X] Done"`                              | `checked: true`                                   |
| No checkboxes in body    | `"Just prose"`                              | `[]`                                              |
| Mixed body with headings | Checkboxes extracted regardless of position | correct items only                                |

---

## Implementation Order

1. **Add `classifyLabels`** — add helper; update `buildStoryFromRaw` to call it (10 min)
2. **Add `FieldValueNode`, `BoardFields`, `extractBoardFields`** — add interfaces and helper;
   update `buildStoryFromRaw` to call it (15 min)
3. **Add `IssueDetailsNode`, `CommentNode`, `CrossReferencedEventNode`, `GetIssueDetailsResponse`
   interfaces** — replace inline type assertions in the query responses (10 min)
4. **Add `Comment`, `LinkedPr`, `buildCommentList`, `buildLinkedPrList`** — pure mappers (10 min)
5. **Add `buildEnrichedStory`** — depends on steps 1–4 (15 min)
6. **Add `missingIssueMessage`; export `parseAcceptanceCriteria`** (5 min)
7. **Simplify handler** — replace inline logic with calls to the extracted helpers (10 min)
8. **`deno check src/index.ts`** — verify no type errors (5 min)
9. **Write unit tests** — all cases from the Testing Plan above (45 min)
10. **Cross-check against README** — confirm return shape still matches the tool contract (5 min)

**Estimated total effort:** ~2 hours

---

## Dependencies

| Dependency                                    | Status  | Notes                                                   |
| --------------------------------------------- | ------- | ------------------------------------------------------- |
| `GetStorySchema` in `src/schemas/scrum.ts`    | ✅ Done | `z.object({ ref: StoryRefSchema }).strict()`            |
| `resolveStory` in `src/services/resolver.ts`  | ✅ Done | Both resolution paths (by number and by id) complete    |
| `loadConfig` / `RuntimeConfig`                | ✅ Done | Provides `fields.*FieldId` for all four board fields    |
| `formatError` in `src/services/formatters.ts` | ✅ Done | Used by all handlers for consistent error formatting    |
| `STORY_TYPES` constant                        | ✅ Done | Already in `scrum-read.ts`; shared via `classifyLabels` |

---

## Risk Assessment

| Risk                                                                                       | Impact | Mitigation                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------ | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `buildStoryFromRaw` callers break after extracting `classifyLabels` / `extractBoardFields` | Medium | Step-by-step refactor: update `buildStoryFromRaw` first; `deno check` after each step                                                                                       |
| `FieldValueNode` minimal interface misses a field used by one of the two query shapes      | Low    | The interface only declares the four fields the extraction reads; additional fields on the concrete type are structurally compatible in TypeScript                          |
| `GetItemFieldsResponse` node is null when item exists                                      | Low    | Already handled: `itemData.node?.fieldValues?.nodes ?? []` passes empty array to `extractBoardFields`, which returns all-null `BoardFields` — a valid, graceful degradation |
| Tests become coupled to internal representation                                            | Medium | Test only the exported helpers; never test through `registerScrumReadTools`                                                                                                 |

---

## Notes

- `buildStoryFromRaw` is not deleted or renamed. It remains the correct function for
  the project-items list path (`scrum_get_sprint`, `scrum_get_backlog`). The distinction
  between "list query" and "per-item query" shapes is a real structural difference, not
  an accident of the current code.
- `sub_tasks` is listed in the README as a return field (`sub_tasks: array of { title,
status } if the backend exposes sub-tasks`). GitHub Projects v2 does not natively expose
  sub-issues in GraphQL as of v1 scope. The field is omitted from the current implementation
  — this is correct, not a gap. Do not add it here.
- The `scrum_get_template` tool mentioned in earlier stories remains out of scope for
  Story 9.
