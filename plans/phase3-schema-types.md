# Phase 3: Schema Types — Implementation Plan

**Status:** Ready for implementation **Risk:** 🟢 Low — adds 3 new Zod schemas, updates 1 existing schema, removes 0 schemas. **Verification Gate:** `deno lint && deno test && deno check src/index.ts`

**Prerequisite:** P0 (Adapter Infrastructure), P1 (Domain Types), P2 (Port Types) all complete.

---

## Overview

Phase 3 adds the Zod input-validation schemas for the 3 new MCP tools planned for P6 (`scrum_find_items`, `scrum_get_analytics`, `scrum_get_board_health`), and updates the `StoryRefSchema` to accept a `{ number }` variant for direct lookup-by-number.

**Key deviation from TODO.md:** `GetTemplateSchema` is **not** removed in this phase. Removing it would break `src/tools/scrum-read.ts` (line 17 import, line 319 usage), which still references it. The schema removal belongs in P6 alongside the tool handler removal, when `scrum_get_template` is actually removed from the MCP tool surface.

---

## Task Breakdown

### Task 1: Add `FindItemsSchema`

| Property               | Type                             | Required | Default | Description                                         |
| ---------------------- | -------------------------------- | -------- | ------- | --------------------------------------------------- |
| `scope`                | `"backlog" \| "sprint" \| "all"` | No       | `"all"` | Scope to search                                     |
| `keys`                 | `string[]` (regex `^\d+$`)       | No       | —       | Numeric issue keys                                  |
| `search`               | `string`                         | No       | —       | Case-insensitive text search                        |
| `types`                | `ItemType[]`                     | No       | —       | Filter by item type                                 |
| `statuses`             | `string[]`                       | No       | —       | Filter by status                                    |
| `priority`             | `string`                         | No       | —       | Filter by priority                                  |
| `epic_id`              | `string`                         | No       | —       | Filter by epic                                      |
| `labels`               | `string[]`                       | No       | —       | Filter by labels (all must match)                   |
| `assignee`             | `string`                         | No       | —       | GitHub login                                        |
| `estimated`            | `boolean`                        | No       | —       | `true` = only estimated, `false` = only unestimated |
| `sprint_ref`           | `SprintRefSchema`                | No       | —       | Filter by sprint                                    |
| `include_dependencies` | `boolean`                        | No       | `false` | Resolve dependency graph                            |
| `limit`                | `number` (int, positive)         | No       | `50`    | Max results                                         |

**Location:** Insert after `GetBurndownSchema` (line 181) and before the `// ── Write tool schemas ──` comment (line 183).

**Zod implementation:**

```typescript
// ── New tool schemas (for P6 handlers) ────────────────────────────────────────

// scrum_find_items — unified item search across all PBIs
export const FindItemsSchema = z
  .object({
    scope: z
      .enum(["backlog", "sprint", "all"])
      .optional()
      .default("all")
      .describe('Scope to search. Defaults to "all".'),
    keys: z
      .array(z.string().regex(/^\d+$/, "Must be a numeric string"))
      .optional()
      .describe('Numeric issue keys to fetch directly, e.g. ["42", "123"].'),
    search: z
      .string()
      .optional()
      .describe("Case-insensitive substring match against story title and body."),
    types: z
      .array(z.string())
      .optional()
      .describe('Filter by item type canonical keys (e.g. ["feature", "bug"]).'),
    statuses: z
      .array(z.string())
      .optional()
      .describe('Filter by status display names (e.g. ["In Progress", "Done"]).'),
    priority: z
      .string()
      .optional()
      .describe('Filter by priority display name, e.g. "Must".'),
    epic_id: z
      .string()
      .optional()
      .describe("Filter by epic/milestone ID."),
    labels: z
      .array(z.string())
      .optional()
      .describe("Return only stories carrying ALL of these labels."),
    assignee: z
      .string()
      .optional()
      .describe("Filter by assignee GitHub login."),
    estimated: z
      .boolean()
      .optional()
      .describe("true = only estimated; false = only unestimated; omit = all."),
    sprint_ref: SprintRefSchema.optional().describe(
      'Filter by sprint. Pass "current", "next", or an explicit sprint name.',
    ),
    include_dependencies: z
      .boolean()
      .optional()
      .default(false)
      .describe("Resolve and include the full dependency graph in the response."),
    limit: z
      .number()
      .int()
      .positive()
      .optional()
      .default(50)
      .describe("Maximum number of items to return."),
  })
  .strict();
```

---

### Task 2: Add `GetAnalyticsSchema`

| Property         | Type                                         | Required | Default           | Description                    |
| ---------------- | -------------------------------------------- | -------- | ----------------- | ------------------------------ |
| `view`           | `"burndown" \| "history" \| "comprehensive"` | No       | `"comprehensive"` | Which analytics view           |
| `sprint_ref`     | `SprintRefSchema`                            | No       | —                 | Target sprint                  |
| `history_window` | `number` (1-10)                              | No       | `5`               | Sprints to include for history |

**Location:** After `FindItemsSchema`.

```typescript
// scrum_get_analytics — unified sprint analytics (burndown + history)
export const GetAnalyticsSchema = z
  .object({
    view: z
      .enum(["burndown", "history", "comprehensive"])
      .optional()
      .default("comprehensive")
      .describe(
        'Which analytics view to return. "burndown" = burndown chart data; ' +
          '"history" = completed sprint history; ' +
          '"comprehensive" = both (default).',
      ),
    sprint_ref: SprintRefSchema.optional().describe(
      'Target sprint for burndown. Defaults to "current" if omitted.',
    ),
    history_window: z
      .number()
      .int()
      .min(1)
      .max(10)
      .optional()
      .default(5)
      .describe("Number of completed sprints to include in history (1–10, default 5)."),
  })
  .strict();
```

---

### Task 3: Add `GetBoardHealthSchema`

| Property       | Type     | Required | Default     | Description                     |
| -------------- | -------- | -------- | ----------- | ------------------------------- |
| `sprint_scope` | `string` | No       | `"current"` | Which sprint's health to assess |

**Location:** After `GetAnalyticsSchema`.

```typescript
// scrum_get_board_health — board health dashboard (no item lists)
export const GetBoardHealthSchema = z
  .object({
    sprint_scope: z
      .string()
      .optional()
      .default("current")
      .describe(
        'Which sprint to assess. "current" = active sprint; "next" = upcoming; ' +
          'or an explicit sprint name (e.g. "Sprint 5"). Defaults to "current".',
      ),
  })
  .strict();
```

---

### Task 4: Update `StoryRefSchema` to accept `{ number: number }`

**Current (line 20-29):**

```typescript
const StoryRefSchema = z.object({
  id: z.string().describe(/* ... */),
});
```

**After:**

```typescript
const StoryRefSchema: z.ZodType<{ id: string } | { number: number }> = z.union([
  z.object({
    id: z.string().describe(
      "Opaque project-item handle returned by any read tool " +
        "(scrum_get_sprint, scrum_get_backlog, scrum_get_story, scrum_create_story, etc.). " +
        "Always present in Story.ref.id.",
    ),
  }),
  z.object({
    number: z.number().describe(
      "Human-readable issue number (e.g. 42). " +
        "The backend resolves this to an opaque project-item handle. " +
        "Use when you know the issue number but do not yet have its 'id'.",
    ),
  }),
]);
```

**Impact on downstream schemas:**

All schemas that use `StoryRefSchema` will now accept `{ number }` in addition to `{ id }`:

| Schema                | File           | Field                                                  | Impact                                       |
| --------------------- | -------------- | ------------------------------------------------------ | -------------------------------------------- |
| `CreateStorySchema`   | `scrum.ts:186` | `epic?: EpicRefSchema`                                 | No direct impact — EpicRefSchema is separate |
| `UpdateStorySchema`   | `scrum.ts:234` | `ref: StoryRefSchema` + `blocked_by: StoryRefSchema[]` | Both now accept `{ number }`                 |
| `SetFieldSchema`      | `scrum.ts:286` | `ref: StoryRefSchema`                                  | Now accepts `{ number }`                     |
| `PlanSprintSchema`    | `scrum.ts:306` | `stories: StoryRefSchema[]`                            | Now accepts `{ number }`                     |
| `LogImpedimentSchema` | `scrum.ts:337` | `affects.story: StoryRefSchema`                        | Now accepts `{ number }`                     |

This is **intentional** — the purpose of the extended schema is to let agents reference stories by number in addition to by opaque ID. The handler code will call `backend.resolveRef()` to convert `{ number }` → `{ id }` before passing to port methods.

**No runtime code changes are needed in the handlers** for this P3 change — the schemas are just validation. The handler-side resolution logic is part of P6 (tool handler migration).

---

### Task 5: Verification Gate

```bash
deno lint
deno test
deno check src/index.ts
grep -r "import.*from.*adapters/github" src/scrum/ src/domain/ src/schemas/
```

**Expected outcomes:**

- `deno lint` — passes (no formatting or type errors)
- `deno test` — passes (no regressions)
- `deno check src/index.ts` — passes (the new schemas exist but aren't referenced yet, which is fine since they're exported)
- `grep` — zero results (no inward adapter leaks)

---

## Risk Mitigation

| Risk                                                                         | Mitigation                                                                                                                                                                  |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `StoryRefSchema` union change breaks existing handler type inference         | Handlers use `z.infer<typeof Schema>` — Zod handles union inference correctly. The `{ number }` branch is accepted by the validator and passed through to the handler code. |
| `FindItemsSchema` has many optional fields, missing required combinations    | All fields are optional — an empty filter returns all items. This matches `ItemFilter` in `ports.ts`.                                                                       |
| `SprintRefSchema` inside `FindItemsSchema.sprint_ref` creates type ambiguity | `SprintRefSchema` already handles `"current" \| "next" \| "all" \| null \| string` — used as-is.                                                                            |
| New schemas are exported but unused until P6 — dead code concern             | They're intentionally additive. P6 will import them. No `@deprecated` needed.                                                                                               |

---

## Post-Phase-3: What Changes in P4+

After Phase 3 completes, subsequent phases will:

- **P4 (Use-Case Migration):** New use-cases will `import { FindItemsSchema, GetAnalyticsSchema, GetBoardHealthSchema }` and reference their inferred types
- **P5 (Orient Use-Case):** No schema changes — orient is stateless
- **P6 (Tool Handler Migration):** Import new schemas, register new MCP tools, remove old handlers, finally remove `GetTemplateSchema`

---

## File Change Summary

| File                   | Action     | What changes                                                                                          |
| ---------------------- | ---------- | ----------------------------------------------------------------------------------------------------- |
| `src/schemas/scrum.ts` | **Modify** | Add `FindItemsSchema`, `GetAnalyticsSchema`, `GetBoardHealthSchema`; update `StoryRefSchema` to union |
| `src/domain/types.ts`  | None       | Already has all domain types needed by new schemas                                                    |
| `src/scrum/ports.ts`   | None       | Already has `ItemFilter`, `ResolvedItemFilter`, `AnalyticsQuery` that these schemas map to            |

No new files. No deleted files. No test file changes.
