# Implementation Strategy: Phase 4 — Dependencies: Domain, Use Case & Tool Schema

**Tickets:** [#82](https://github.com/hoonsubin/github-projects-mcp-server/issues/82), [#81](https://github.com/hoonsubin/github-projects-mcp-server/issues/81), [#98](https://github.com/hoonsubin/github-projects-mcp-server/issues/98), [#104](https://github.com/hoonsubin/github-projects-mcp-server/issues/104) _(also covers Phase 5 adapter work)_
**Branch:** `feature/epics-type`
**Prerequisite:** Phase 3 complete (build is green, `getEpics()` is implemented)
**Constraint:** Phase 4 **intentionally breaks the TypeScript build** by making dependency fields required on `Story`. The compile errors in the adapter are the guided checklist for Phase 5. Treat Phases 4 and 5 as a single paired unit — do not stop between them.

---

## What This Phase Does

### Phase 4 (domain + use case + schema layer)
- Promotes `blocked_by` and `blocks` from optional (`?`) to **required** on `StoryBase`, immediately surfacing all adapter sites that must be updated (Phase 5's work).
- Explicitly declares both fields on `DraftStory` so the interface contract is self-documenting.
- Promotes `has_dependencies` from optional to **required** on `StoryListing`, and populates it in both `storyToListing` projections (`get-backlog.ts`, `get-sprint.ts`).
- Adds `blocks?: StoryRef[] | null` to `StoryUpdates` (the read direction is symmetric with `blocked_by`, which was added in Phase 1).
- Adds `blocked_by` and `blocks` Zod fields to `UpdateStorySchema` with precise agent-facing descriptions.
- Threads both fields from the `scrum_update_story` handler through to `StoryUpdates`.

### Phase 5 (GitHub adapter)
- Parses the `## Dependencies` body section into `blocked_by[]` and `blocks[]` in both story-building paths (`buildStoryFromRaw`, `buildEnrichedStory`).
- Sets `blocked_by: []` and `blocks: []` on `DraftStory` constructions.
- Best-effort resolution of `ref.id` for backlog and sprint contexts (in-memory, no extra queries).
- Writes the `## Dependencies` section when `blocked_by` or `blocks` is provided to `updateStory`.
- Resolves all Phase 4 TypeScript compile errors, restoring a green build.

---

## Dependency body convention (D5, D8)

The GitHub adapter uses a markdown section as the dependency store. This is the canonical format:

```markdown
## Dependencies

- Blocked by: #17
- Blocked by: #42
- Blocks: #55
```

**Parsing rules:**
- Lines matching `- Blocked by: #N` (case-insensitive) → `blocked_by` entries where `key = "N"`.
- Lines matching `- Blocks: #N` (case-insensitive) → `blocks` entries where `key = "N"`.
- Any other line in the section is ignored.
- Absent section → both arrays are `[]`.

**Write rules (atomic per-direction replacement):**
- Only `blocked_by` provided → rewrite all `- Blocked by: #N` lines; preserve all `- Blocks: #N` lines.
- Only `blocks` provided → rewrite all `- Blocks: #N` lines; preserve all `- Blocked by: #N` lines.
- Both provided → rewrite both directions atomically.
- A field is `null` → clear all lines for that direction; preserve the other direction.
- Both `null` → remove the entire `## Dependencies` section (including the heading).
- A field is an array → for each `StoryRef`, resolve it to an issue number, then write the corresponding line.

---

## Field mapping: `DependencyEntry`

| Source (body parse) | `DependencyEntry` field | Notes |
|---|---|---|
| matched issue number string | `key` | Always present; e.g. `"17"` |
| _(not yet resolved)_ | `ref.id` | `null` for `getStoryDetail`; filled from in-memory context for backlog/sprint |
| _(not yet resolved)_ | `title` | `null` in Phase 5; a future phase may resolve via issue title query |

---

## Execution Order

Apply changes in this exact sequence. Steps 1–7 are Phase 4 (domain/use case/schema). Steps 8–12 are Phase 5 (adapter). **Step 1 must precede Steps 2–7** because promoting `blocked_by`/`blocks` to required is what creates the compile errors that subsequent steps close. Do not run verification until all steps are complete.

---

## Phase 4 Steps

### Step 1 — `src/domain/types.ts`: Make dependency fields required; declare on `DraftStory`

**1a — Promote `StoryBase.blocked_by` and `StoryBase.blocks` to required.**

Current (`src/domain/types.ts`, lines 105–106):
```typescript
  blocked_by?: DependencyEntry[]; // stories that must be Done before this one starts
  blocks?: DependencyEntry[]; // stories that are downstream of this one
```

Replace with:
```typescript
  blocked_by: DependencyEntry[]; // stories that must be Done before this one starts
  blocks: DependencyEntry[]; // stories that are downstream of this one
```

Remove the `?` from both fields. Nothing else on those lines changes.

**1b — Add explicit declarations to `DraftStory`.**

Current `DraftStory` (`src/domain/types.ts`, lines 110–115):
```typescript
export interface DraftStory extends StoryBase {
  kind: "draft";
  key: null;
  url: null;
  epic: null;
}
```

Replace with:
```typescript
export interface DraftStory extends StoryBase {
  kind: "draft";
  key: null;
  url: null;
  epic: null;
  blocked_by: DependencyEntry[]; // always [] — Draft Issues have no tracked dependencies
  blocks: DependencyEntry[]; // always []
}
```

These explicit declarations are redundant at runtime (the fields are inherited from `StoryBase`) but serve as a contract anchor: any future structural divergence between `DraftStory` construction and `StoryBase` is caught at compile time.

---

### Step 2 — `src/scrum/ports.ts`: Make `has_dependencies` required; add `blocks` to `StoryUpdates`

**2a — Promote `StoryListing.has_dependencies` to required.**

Current (`src/scrum/ports.ts`, line 147):
```typescript
  has_dependencies?: boolean; // true when the story body contains a ## Dependencies section
```

Replace with:
```typescript
  has_dependencies: boolean; // true when the story body contains a ## Dependencies section
```

This ensures every `StoryListing` producer is forced to set it explicitly.

**2b — Add `blocks` to `StoryUpdates`.**

Current `StoryUpdates` (`src/scrum/ports.ts`, lines 109–116):
```typescript
export interface StoryUpdates {
  title?: string;
  body?: string;
  labels?: string[];
  assignees?: string[];
  epic?: string | null;
  blocked_by?: StoryRef[] | null; // null clears all; omit to leave unchanged
}
```

Replace with:
```typescript
export interface StoryUpdates {
  title?: string;
  body?: string;
  labels?: string[];
  assignees?: string[];
  epic?: string | null;
  blocked_by?: StoryRef[] | null; // null clears all; omit to leave unchanged
  blocks?: StoryRef[] | null;     // null clears all; omit to leave unchanged
}
```

---

### Step 3 — `src/scrum/get-backlog.ts`: Populate `has_dependencies` in `storyToListing`

Current `storyToListing` (`src/scrum/get-backlog.ts`, lines 31–39):
```typescript
const storyToListing = (story: Story): StoryListing => ({
  ref: { id: story.ref.id, key: story.key },
  title: story.title,
  status: story.status,
  story_points: story.story_points,
  priority: story.priority,
  sprint: story.sprint,
  writable: true, // Active backlog items are writable; see Step 7c.2 for future enhancement
});
```

Replace with:
```typescript
const storyToListing = (story: Story): StoryListing => ({
  ref: { id: story.ref.id, key: story.key },
  title: story.title,
  status: story.status,
  story_points: story.story_points,
  priority: story.priority,
  sprint: story.sprint,
  writable: true,
  has_dependencies: story.blocked_by.length > 0 || story.blocks.length > 0,
});
```

The comment on `writable` is removed as it references internal implementation notes; the field is self-explanatory.

---

### Step 4 — `src/scrum/get-sprint.ts`: Populate `has_dependencies` in both listing projections

**4a — Active sprint items (`storyToListing`).**

Current (`src/scrum/get-sprint.ts`, lines 29–37):
```typescript
const storyToListing = (story: Story): StoryListing => ({
  ref: { id: story.ref.id, key: story.key },
  title: story.title,
  status: story.status,
  story_points: story.story_points,
  priority: story.priority,
  sprint: story.sprint,
  writable: true, // active sprint item — safe to mutate
});
```

Replace with:
```typescript
const storyToListing = (story: Story): StoryListing => ({
  ref: { id: story.ref.id, key: story.key },
  title: story.title,
  status: story.status,
  story_points: story.story_points,
  priority: story.priority,
  sprint: story.sprint,
  writable: true,
  has_dependencies: story.blocked_by.length > 0 || story.blocks.length > 0,
});
```

**4b — Historical sprint items (`storyListingFromHistory`).**

`BurndownStoryInput` does not carry body content, so dependency state is unknowable for history items. The correct value is `false`.

Current (`src/scrum/get-sprint.ts`, lines 40–48):
```typescript
const storyListingFromHistory = (story: BurndownStoryInput): StoryListing => ({
  ref: { id: `<history>`, key: String(story.number) },
  title: story.title,
  status: story.status,
  story_points: story.points,
  priority: null, // BurndownStoryInput does not carry priority
  sprint: null, // set below with sprint name
  writable: false, // history item — not safe to mutate
});
```

Replace with:
```typescript
const storyListingFromHistory = (story: BurndownStoryInput): StoryListing => ({
  ref: { id: `<history>`, key: String(story.number) },
  title: story.title,
  status: story.status,
  story_points: story.points,
  priority: null,
  sprint: null,
  writable: false,
  has_dependencies: false,
});
```

---

### Step 5 — `src/scrum/get-story.ts`: Verify pass-through (no changes expected)

Open `src/scrum/get-story.ts`. Verify:
1. `GetStoryResult.story` is typed as `Story` (line 13) — already done in Phase 2.
2. The return object at lines 30–35 passes `detail.story` through directly without constructing a new object from its fields.

If the return is `{ story: detail.story, ... }`, no changes are needed — `blocked_by` and `blocks` are carried through automatically once the adapter populates them in Phase 5.

If the use case constructs a new story object (e.g. `{ ...detail.story, someField }`) and omits the dependency fields, add them explicitly. This is an error check, not a planned change.

---

### Step 6 — `src/schemas/scrum.ts`: Add `blocked_by` and `blocks` to `UpdateStorySchema`

The `UpdateStorySchema` currently ends at `src/schemas/scrum.ts`, line 263 (`.strict()`). Add both dependency fields immediately before the closing `.strict()`:

Current (`src/schemas/scrum.ts`, lines 221–263):
```typescript
export const UpdateStorySchema = z
  .object({
    ref: StoryRefSchema,
    title: z.string().optional().describe("Replacement title. Omit to leave unchanged."),
    body: z
      .string()
      .optional()
      .describe(
        "Replacement markdown body — REPLACES the entire body, does not append. " +
          "Call scrum_get_story first if you want to add to the existing body.",
      ),
    labels: z
      .array(z.string())
      .optional()
      .describe(
        "Replacement label set — REPLACES ALL existing labels. " +
          "Call scrum_get_story first to read current labels if you want to add without removing.",
      ),
    assignees: z
      .array(z.string())
      .optional()
      .describe(
        "Replacement assignee list of GitHub logins — REPLACES ALL existing assignees. " +
          "Call scrum_get_story first to read current assignees if you want to add without removing.",
      ),
    epic: z
      .string()
      .or(z.null())
      .optional()
      .describe(
        "Milestone title to assign to, or null to detach from the current epic. " +
          "Omit entirely to leave unchanged.",
      ),
    comment: z
      .string()
      .optional()
      .describe(
        "Post a comment on the story after updating. " +
          "Can be combined with content fields (title, body, etc.) in one call. " +
          "Use with only { ref, comment } to post a comment without changing story content.",
      ),
  })
  .strict();
```

Replace with (add `blocked_by` and `blocks` before `.strict()`):
```typescript
export const UpdateStorySchema = z
  .object({
    ref: StoryRefSchema,
    title: z.string().optional().describe("Replacement title. Omit to leave unchanged."),
    body: z
      .string()
      .optional()
      .describe(
        "Replacement markdown body — REPLACES the entire body, does not append. " +
          "Call scrum_get_story first if you want to add to the existing body.",
      ),
    labels: z
      .array(z.string())
      .optional()
      .describe(
        "Replacement label set — REPLACES ALL existing labels. " +
          "Call scrum_get_story first to read current labels if you want to add without removing.",
      ),
    assignees: z
      .array(z.string())
      .optional()
      .describe(
        "Replacement assignee list of GitHub logins — REPLACES ALL existing assignees. " +
          "Call scrum_get_story first to read current assignees if you want to add without removing.",
      ),
    epic: z
      .string()
      .or(z.null())
      .optional()
      .describe(
        "Milestone title to assign to, or null to detach from the current epic. " +
          "Omit entirely to leave unchanged.",
      ),
    comment: z
      .string()
      .optional()
      .describe(
        "Post a comment on the story after updating. " +
          "Can be combined with content fields (title, body, etc.) in one call. " +
          "Use with only { ref, comment } to post a comment without changing story content.",
      ),
    blocked_by: z
      .array(StoryRefSchema)
      .nullish()
      .describe(
        "Replace the full list of stories that block this story. " +
          "Each entry is a StoryRef ({ id }) obtained from a previous read tool. " +
          "Pass null to clear all upstream dependencies. Omit to leave dependencies unchanged.",
      ),
    blocks: z
      .array(StoryRefSchema)
      .nullish()
      .describe(
        "Replace the full list of stories that this story blocks (downstream dependencies). " +
          "Each entry is a StoryRef ({ id }) obtained from a previous read tool. " +
          "Pass null to clear all downstream dependencies. Omit to leave unchanged.",
      ),
  })
  .strict();
```

`StoryRefSchema` is already defined at line 19 of the same file and is in scope.

---

### Step 7 — `src/tools/scrum-write.ts`: Thread `blocked_by` and `blocks` through the handler

In the `scrum_update_story` handler, the update object is assembled at lines 171–178:

```typescript
const updates: Partial<z.infer<typeof UpdateStorySchema>> = {};
if (params.title !== undefined) updates.title = params.title;
if (params.body !== undefined) updates.body = params.body;
if (params.labels !== undefined) updates.labels = params.labels;
if (params.assignees !== undefined) updates.assignees = params.assignees;
if (params.epic !== undefined) updates.epic = params.epic;
```

Add `blocked_by` and `blocks` immediately after `epic`:

```typescript
const updates: Partial<z.infer<typeof UpdateStorySchema>> = {};
if (params.title !== undefined) updates.title = params.title;
if (params.body !== undefined) updates.body = params.body;
if (params.labels !== undefined) updates.labels = params.labels;
if (params.assignees !== undefined) updates.assignees = params.assignees;
if (params.epic !== undefined) updates.epic = params.epic;
if (params.blocked_by !== undefined) updates.blocked_by = params.blocked_by;
if (params.blocks !== undefined) updates.blocks = params.blocks;
```

`params.blocked_by` is `StoryRef[] | null | undefined` (Zod `.nullish()`). When it is not `undefined`, it is `StoryRef[] | null` — which matches `StoryUpdates.blocked_by?: StoryRef[] | null`. The existing cast `updates as StoryUpdates` at line 178 remains correct.

Also update the tool's `description` string to mention the two new arguments. Find the description block starting with `"Edit the content fields..."` and add to the Args section:

```
blocked_by  StoryRef[] | null — REPLACES all upstream dependencies; null clears; omit to leave unchanged
blocks      StoryRef[] | null — REPLACES all downstream dependencies; null clears; omit to leave unchanged
```

---

## Phase 5 Steps

### Step 8 — `src/adapters/github/mappers.ts`: Add `parseDependencies` helper

Add a module-private function (do not export) after the existing import block and before the first exported function:

```typescript
const DEPS_SECTION_RE = /^##\s+dependencies\s*$/im;
const BLOCKED_BY_RE = /^-\s+blocked\s+by:\s+#(\d+)\s*$/im;
const BLOCKS_RE = /^-\s+blocks:\s+#(\d+)\s*$/im;

const parseDependencies = (
  body: string,
): { blocked_by: DependencyEntry[]; blocks: DependencyEntry[] } => {
  const sectionMatch = body.match(/^##\s+dependencies\b.*$([\s\S]*?)(?=^##\s|\z)/im);
  if (!sectionMatch) return { blocked_by: [], blocks: [] };

  const section = sectionMatch[1];
  const blocked_by: DependencyEntry[] = [];
  const blocks: DependencyEntry[] = [];

  for (const line of section.split("\n")) {
    const blockedMatch = line.match(/^-\s+blocked\s+by:\s+#(\d+)\s*$/i);
    if (blockedMatch) {
      blocked_by.push({ key: blockedMatch[1], title: null, ref: { id: null } });
      continue;
    }
    const blocksMatch = line.match(/^-\s+blocks:\s+#(\d+)\s*$/i);
    if (blocksMatch) {
      blocks.push({ key: blocksMatch[1], title: null, ref: { id: null } });
    }
  }

  return { blocked_by, blocks };
};
```

Import `DependencyEntry` from `../../domain/types.ts` if not already imported.

**Update `buildStoryFromRaw`:** find where the story object is constructed and spread the result of `parseDependencies`:

```typescript
const deps = parseDependencies(content.body ?? "");

return {
  // ... existing fields ...
  blocked_by: deps.blocked_by,
  blocks: deps.blocks,
};
```

For the `DraftStory` branch of `buildStoryFromRaw` (where `content.__typename === "DraftIssue"`), set both fields to empty arrays:

```typescript
blocked_by: [],
blocks: [],
```

**Update `buildEnrichedStory`:** apply the same pattern — call `parseDependencies(issueNode.body ?? "")` and spread `blocked_by` and `blocks` into the returned object.

---

### Step 9 — `src/adapters/github/mappers.ts`: Add `resolveDependencyRefs` export

After `parseDependencies`, add an exported pure function. This function does a second pass over an already-built `Story[]` to fill in `ref.id` for dependency entries that were matched against in-memory project items:

```typescript
export const resolveDependencyRefs = (
  stories: Story[],
  allItems: ProjectItem[],
): Story[] => {
  // Build a lookup: issue number string → project item ID
  const keyToId = new Map<string, string>();
  for (const item of allItems) {
    const issueKey = item.content?.number != null ? String(item.content.number) : null;
    if (issueKey && item.id) keyToId.set(issueKey, item.id);
  }

  const resolve = (entries: DependencyEntry[]): DependencyEntry[] =>
    entries.map((e) =>
      e.ref.id === null && keyToId.has(e.key)
        ? { ...e, ref: { id: keyToId.get(e.key)! } }
        : e,
    );

  return stories.map((s) => ({
    ...s,
    blocked_by: resolve(s.blocked_by),
    blocks: resolve(s.blocks),
  }));
};
```

Adjust the `ProjectItem` type reference to match whatever the adapter's internal item shape is called. Import `Story` and `DependencyEntry` if not already present.

---

### Step 10 — GitHub adapter: Call `resolveDependencyRefs` in backlog and sprint paths

In the service or backend method that implements `getBacklogStories()`, after building `Story[]` from the project items, call:

```typescript
return resolveDependencyRefs(stories, rawItems);
```

where `rawItems` is the array of raw project items already in memory (no additional network calls).

Apply the same call at the end of `getSprintStories()`.

Do **not** call `resolveDependencyRefs` in `getStoryDetail()` — `ref.id` stays `null` in that context; a future phase can add targeted resolution.

---

### Step 11 — `src/adapters/github/internal/story-mutation-service.ts`: Write dependency section

Add dependency write support to `updateStory`. When `StoryUpdates.blocked_by` or `StoryUpdates.blocks` is defined (not `undefined`), rewrite the appropriate direction(s) in the body before applying the mutation.

```typescript
const rewriteDependencySection = (
  currentBody: string,
  blockedBy: StoryRef[] | null | undefined,
  blocks: StoryRef[] | null | undefined,
  resolveIssueNumber: (ref: StoryRef) => string,
): string => {
  // 1. Parse existing section to extract current lines for each direction
  // 2. For each direction that is defined (non-undefined):
  //      - null  → clear that direction's lines
  //      - array → map each StoryRef to an issue number and build new lines
  // 3. Reconstruct section from updated line sets
  // 4. If both directions are empty → remove section and heading entirely
  // 5. Otherwise → upsert the section (replace existing or append if absent)
};
```

Fetch the current story body first if neither `StoryUpdates.body` nor a prior read provides it. Use `GET_ISSUE_DETAILS_QUERY` or an equivalent query already in the service. Only do this fetch if `blocked_by` or `blocks` is non-`undefined` in `updates` — skip the fetch when neither field is present.

The `resolveIssueNumber` callback should call `resolveStory` from `resolver.ts` if available, or look up issue number from the `StoryRef.id` via an existing resolver pattern in the adapter. Resolve issue numbers before calling `rewriteDependencySection`.

---

### Step 12 — Verify adapter compile errors are resolved

After Steps 8–11, every site that constructs a `Story` (or its variants) now sets `blocked_by` and `blocks`. Run the TypeScript check to confirm:

```sh
deno check src/adapters/github/backend.ts \
           src/adapters/github/factory.ts \
           src/adapters/github/internal/story-mutation-service.ts \
           src/adapters/github/mappers.ts
```

Any remaining errors indicate a story-construction site that was missed. Find all `return { kind: "issue", ... }` and `return { kind: "draft", ... }` expressions and ensure they include both fields.

---

## Verification Checklist

Run in this order after completing **all twelve steps**:

```sh
deno lint
deno test
deno check src/domain/types.ts \
           src/scrum/ports.ts \
           src/scrum/get-backlog.ts \
           src/scrum/get-sprint.ts \
           src/scrum/get-story.ts \
           src/schemas/scrum.ts \
           src/tools/scrum-write.ts \
           src/adapters/github/backend.ts \
           src/adapters/github/mappers.ts \
           src/adapters/github/internal/story-mutation-service.ts
```

Expected outcomes:

| Check | Expected result |
|---|---|
| `deno lint` | Passes with no warnings |
| `deno test` | All existing tests pass (no new tests required in this phase) |
| `deno check` — `types.ts` | `StoryBase.blocked_by` and `StoryBase.blocks` are required `DependencyEntry[]`; `DraftStory` declares them explicitly |
| `deno check` — `ports.ts` | `StoryListing.has_dependencies` is required `boolean`; `StoryUpdates` has both `blocked_by` and `blocks` |
| `deno check` — `get-backlog.ts` | `storyToListing` produces `has_dependencies` from `story.blocked_by` and `story.blocks` |
| `deno check` — `get-sprint.ts` | Both `storyToListing` and `storyListingFromHistory` produce `has_dependencies` (`false` for history items) |
| `deno check` — `get-story.ts` | No changes needed; `Story` pass-through is compiler-validated end to end |
| `deno check` — `scrum.ts` | `UpdateStorySchema` includes `blocked_by` and `blocks` with `.nullish()` and agent-readable descriptions |
| `deno check` — `scrum-write.ts` | Handler forwards `blocked_by` and `blocks` from params to `StoryUpdates` |
| `deno check` — adapter files | No compile errors; all `Story` constructions include `blocked_by` and `blocks` |
| Manual smoke — `scrum_get_story` | Returns `blocked_by: []` and `blocks: []` for a story without a `## Dependencies` section |
| Manual smoke — `scrum_get_story` | Returns populated arrays for a story with a `## Dependencies` section |
| Manual smoke — `scrum_get_sprint` | Items with a `## Dependencies` section show `has_dependencies: true`; others show `false` |
| Manual smoke — `scrum_get_backlog` | Same as sprint check above |
| Manual smoke — `scrum_update_story` | Passing `blocked_by: [{ id: "..." }]` rewrites only the `Blocked by` lines; existing `Blocks` lines are preserved |
| Manual smoke — `scrum_update_story` | Passing `blocked_by: null, blocks: null` removes the entire `## Dependencies` section cleanly |
