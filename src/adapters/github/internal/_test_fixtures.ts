// =============================================================================
// src/adapters/github/internal/_test_fixtures.ts
//
// Single import point for adapter unit test fixture data. Three representative
// project-item nodes extracted verbatim from captured fixture JSON, plus a page
// envelope builder. Replaces direct imports of the large generated fixture files
// (project-items-p1.json, project-items-p2.json) across 8 test files.
//
// FIXTURE_ITEM_WITH_CUSTOM_FIELDS is node #187 augmented with two synthetic
// non-canonical field entries ("Deadline" date + "Target Quarter" text) so that
// the custom-fields passthrough code path is exercised in unit tests.
// =============================================================================

import type { ProjectItem } from "../types.ts";

// ── Page envelope builder ─────────────────────────────────────────────────────

/** Build a full user.projectV2.items GraphQL response envelope from nodes. */
export const makePageEnvelope = (
  nodes: readonly ProjectItem[],
  opts?: { totalCount?: number; hasNextPage?: boolean; endCursor?: string | null },
) => ({
  user: {
    projectV2: {
      id: "PVT_kwHOAmfLjc4BWiTt",
      items: {
        totalCount: opts?.totalCount ?? nodes.length,
        pageInfo: {
          hasNextPage: opts?.hasNextPage ?? false,
          endCursor: opts?.endCursor ?? null,
        },
        nodes,
      },
    },
  },
});

// ── Fixture nodes (verbatim from project-items-p1.json and project-items-p2.json)

/** Real fixture: Issue #222 — Ready, 3 SP, Could, MCP Tool Surface epic */
export const FIXTURE_ITEM_222 = {
  id: "PVTI_lAHOAmfLjc4BWiTtzguSvrg",
  type: "ISSUE",
  createdAt: "2026-05-31T12:04:40Z",
  updatedAt: "2026-06-02T23:10:22Z",
  isArchived: false,
  content: {
    __typename: "Issue",
    id: "I_kwDOSJo3Ms8AAAABD6XGfw",
    number: 222,
    title:
      '[Story]: Agent can mark two items as "related" without implying a hard blocking dependency',
    url: "https://github.com/hoonsubin/github-projects-mcp-server/issues/222",
    state: "OPEN",
    body:
      'As the Scrum Master agent, I can mark two backlog items as "related" so that complementary or thematically linked stories remain discoverable on the board without implying one blocks the other.\n\n## Background\nThe current dependency model supports only `blocked_by`/`blocks` (hard upstream/downstream blocking). Items that share context, operate on the same component, or are complementary stories cannot be linked without incorrectly implying a sequencing constraint. Example: #187 ("pass through non-canonical fields in normalizer") and #216 ("strip canonical fields from normalizer") are two sides of the same component story — invisible to each other on the board.\n\n## Desired Behaviour\n`scrum_update_story` accepts a `related_to: StoryRef[]` field. Related items appear in `scrum_get_item_detail` responses and in `scrum_find_items` listings as a `related` array. No ordering, blocking, or sprint-planning semantics are implied.\n\n## Acceptance Criteria\n- [ ] `scrum_update_story` accepts `related_to: [{ id: string }]` to set related items (replaces existing related set, consistent with existing `blocked_by` behaviour)\n- [ ] `scrum_get_item_detail` response includes `related: [{ key, title }]` when related items exist\n- [ ] `scrum_find_items` listings include `related: [{ key }]` (keys only — no titles, to keep listing payload small)\n- [ ] Related links are bidirectional — linking A → B automatically surfaces B in A\'s related list and A in B\'s\n- [ ] Related links do not affect DoR checks, dependency graph traversal, or sprint risk counts\n- [ ] Tool description for `scrum_update_story` documents the `related_to` parameter',
    issueType: null,
    assignees: { nodes: [] },
    labels: {
      nodes: [
        { name: "feature", color: "a29bfe" },
        { name: "use case layer", color: "6958b7" },
      ],
    },
    milestone: {
      id: "MI_kwDOSJo3Ms4A9J0x",
      title: "MCP Tool Surface Modernization for Scrum Theory Alignment",
      dueOn: null,
    },
    repository: {
      name: "github-projects-mcp-server",
      nameWithOwner: "hoonsubin/github-projects-mcp-server",
    },
    blockedBy: { nodes: [] },
  },
  fieldValues: {
    nodes: [
      {
        __typename: "ProjectV2ItemFieldRepositoryValue",
        repository: {
          name: "github-projects-mcp-server",
          nameWithOwner: "hoonsubin/github-projects-mcp-server",
        },
        field: {
          id: "PVTF_lAHOAmfLjc4BWiTtzhR1seo",
          name: "Repository",
        },
      },
      {
        __typename: "ProjectV2ItemFieldLabelValue",
        labels: {
          nodes: [
            { name: "feature", color: "a29bfe" },
            { name: "use case layer", color: "6958b7" },
          ],
        },
        field: {
          id: "PVTF_lAHOAmfLjc4BWiTtzhR1sec",
          name: "Labels",
        },
      },
      {
        __typename: "ProjectV2ItemFieldMilestoneValue",
        milestone: {
          title: "MCP Tool Surface Modernization for Scrum Theory Alignment",
          dueOn: null,
        },
        field: {
          id: "PVTF_lAHOAmfLjc4BWiTtzhR1sek",
          name: "Milestone",
        },
      },
      {
        __typename: "ProjectV2ItemFieldTextValue",
        text:
          '[Story]: Agent can mark two items as "related" without implying a hard blocking dependency',
        field: {
          id: "PVTF_lAHOAmfLjc4BWiTtzhR1seQ",
          name: "Title",
        },
      },
      {
        __typename: "ProjectV2ItemFieldSingleSelectValue",
        name: "User Story",
        color: "YELLOW",
        optionId: "bf0dd60d",
        field: {
          id: "PVTSSF_lAHOAmfLjc4BWiTtzhS9YWs",
          name: "Type",
        },
      },
      {
        __typename: "ProjectV2ItemFieldSingleSelectValue",
        name: "Could",
        color: "YELLOW",
        optionId: "a69f4b15",
        field: {
          id: "PVTSSF_lAHOAmfLjc4BWiTtzhR1soA",
          name: "Priority",
        },
      },
      {
        __typename: "ProjectV2ItemFieldSingleSelectValue",
        name: "Ready",
        color: "YELLOW",
        optionId: "47fc9ee4",
        field: {
          id: "PVTSSF_lAHOAmfLjc4BWiTtzhR1seY",
          name: "Status",
        },
      },
      {
        __typename: "ProjectV2ItemFieldNumberValue",
        number: 3,
        field: {
          id: "PVTF_lAHOAmfLjc4BWiTtzhR1soI",
          name: "Story Points",
        },
      },
      {
        __typename: "ProjectV2ItemFieldIterationValue",
        title: "Sprint 4",
        startDate: "2026-06-02",
        duration: 11,
        iterationId: "07155ad6",
        field: {
          id: "PVTIF_lAHOAmfLjc4BWiTtzhR1soM",
          name: "Sprint",
        },
      },
    ],
  },
} as unknown as ProjectItem;

/** Real fixture: Issue #192 — Ready, 2 SP, Could, Adapter Layer Assembly epic. Blocked by #195 and #191. */
export const FIXTURE_ITEM_192 = {
  id: "PVTI_lAHOAmfLjc4BWiTtzgt_P2U",
  type: "ISSUE",
  createdAt: "2026-05-27T21:38:51Z",
  updatedAt: "2026-06-02T23:10:20Z",
  isArchived: false,
  content: {
    __typename: "Issue",
    id: "I_kwDOSJo3Ms8AAAABDlynAA",
    number: 192,
    title:
      "[User Story]: Developer has PlatformVocabularyMap interface + GitHub implementation — all Scrum concepts mapped to/from GitHub primitives",
    url: "https://github.com/hoonsubin/github-projects-mcp-server/issues/192",
    state: "OPEN",
    body:
      "### User Story\n\nAs a **developer adding a new backend integration**, I have **a `PlatformVocabularyMap` interface with a working GitHub implementation**, so that **I understand how Scrum concepts translate to platform primitives — and can replicate the pattern for my backend**.\n\n### Problem\n\nWithout a formal vocabulary mapping, each backend implements Scrum concept encoding/decoding ad-hoc. There's no contract for how `type`, `status`, `sprint`, `priority`, `story_points`, `epic`, `blocked_by`, and `labels` map between Scrum semantics and platform primitives.\n\n### Solution\n\nImplement `PlatformVocabularyMap` interface and GitHub concrete implementation:\n- For each Scrum concept: `support: CapabilityStatus`, `encode(ScrumValue) → PlatformValue`, `decode(PlatformValue) → ScrumValue`, `constraint?: string`\n- `isSpecialLabel(platformLabel) → boolean` — returns true if label encodes Scrum metadata\n- `extractUserLabels(allPlatformLabels) → string[]` — strips special labels, returns user-facing ones\n- GitHub implementation maps type/status/sprint/priority/story_points/epic/blocked_by through GitHub Projects V2 custom fields\n\n### Acceptance Criteria\n- [ ] `PlatformVocabularyMap` interface defined with encode/decode/constraint per Scrum concept\n- [ ] GitHub implementation decodes all concepts from project V2 field values correctly\n- [ ] `isSpecialLabel` correctly identifies Scrum metadata labels vs. user labels\n- [ ] `extractUserLabels` strips special labels, returns only user-facing ones\n- [ ] Normalizer uses vocabulary map for all field decode calls\n- [ ] Existing tests pass with the vocabulary map integrated\n\n### Dependencies\n- [ ] AbstractAssembler implemented\n- [ ] CapabilityStatus enum exists",
    issueType: null,
    assignees: { nodes: [] },
    labels: {
      nodes: [
        { name: "feature", color: "a29bfe" },
        { name: "adapter layer", color: "e69dd2" },
      ],
    },
    milestone: {
      id: "MI_kwDOSJo3Ms4A9dd1",
      title: "Adapter Layer Assembly Pattern",
      dueOn: null,
    },
    repository: {
      name: "github-projects-mcp-server",
      nameWithOwner: "hoonsubin/github-projects-mcp-server",
    },
    blockedBy: {
      nodes: [
        {
          id: "I_kwDOSJo3Ms8AAAABDlzDvA",
          number: 195,
          title:
            "[User Story]: Agent receives factual capability statements — NATIVE/EMULATED/UNAVAILABLE for every operation",
        },
        {
          id: "I_kwDOSJo3Ms8AAAABDlydKQ",
          number: 191,
          title:
            "[User Story]: Developer adding a new backend has AbstractAssembler with port method defaults — only implements assembly and normalization",
        },
      ],
    },
  },
  fieldValues: {
    nodes: [
      {
        __typename: "ProjectV2ItemFieldRepositoryValue",
        repository: {
          name: "github-projects-mcp-server",
          nameWithOwner: "hoonsubin/github-projects-mcp-server",
        },
        field: {
          id: "PVTF_lAHOAmfLjc4BWiTtzhR1seo",
          name: "Repository",
        },
      },
      {
        __typename: "ProjectV2ItemFieldLabelValue",
        labels: {
          nodes: [
            { name: "feature", color: "a29bfe" },
            { name: "adapter layer", color: "e69dd2" },
          ],
        },
        field: {
          id: "PVTF_lAHOAmfLjc4BWiTtzhR1sec",
          name: "Labels",
        },
      },
      {
        __typename: "ProjectV2ItemFieldMilestoneValue",
        milestone: {
          title: "Adapter Layer Assembly Pattern",
          dueOn: null,
        },
        field: {
          id: "PVTF_lAHOAmfLjc4BWiTtzhR1sek",
          name: "Milestone",
        },
      },
      {
        __typename: "ProjectV2ItemFieldTextValue",
        text:
          "[User Story]: Developer has PlatformVocabularyMap interface + GitHub implementation — all Scrum concepts mapped to/from GitHub primitives",
        field: {
          id: "PVTF_lAHOAmfLjc4BWiTtzhR1seQ",
          name: "Title",
        },
      },
      {
        __typename: "ProjectV2ItemFieldSingleSelectValue",
        name: "User Story",
        color: "YELLOW",
        optionId: "bf0dd60d",
        field: {
          id: "PVTSSF_lAHOAmfLjc4BWiTtzhS9YWs",
          name: "Type",
        },
      },
      {
        __typename: "ProjectV2ItemFieldSingleSelectValue",
        name: "Could",
        color: "YELLOW",
        optionId: "a69f4b15",
        field: {
          id: "PVTSSF_lAHOAmfLjc4BWiTtzhR1soA",
          name: "Priority",
        },
      },
      {
        __typename: "ProjectV2ItemFieldSingleSelectValue",
        name: "Ready",
        color: "YELLOW",
        optionId: "47fc9ee4",
        field: {
          id: "PVTSSF_lAHOAmfLjc4BWiTtzhR1seY",
          name: "Status",
        },
      },
      {
        __typename: "ProjectV2ItemFieldNumberValue",
        number: 2,
        field: {
          id: "PVTF_lAHOAmfLjc4BWiTtzhR1soI",
          name: "Story Points",
        },
      },
      {
        __typename: "ProjectV2ItemFieldIterationValue",
        title: "Sprint 4",
        startDate: "2026-06-02",
        duration: 11,
        iterationId: "07155ad6",
        field: {
          id: "PVTIF_lAHOAmfLjc4BWiTtzhR1soM",
          name: "Sprint",
        },
      },
    ],
  },
} as unknown as ProjectItem;

/**
 * Real fixture: Issue #187 — Backlog, 3 SP, Must, Adapter Layer Assembly epic.
 * Augmented with 2 synthetic non-canonical field entries appended to fieldValues.nodes:
 *   - "Deadline" (ProjectV2ItemFieldDateValue)
 *   - "Target Quarter" (ProjectV2ItemFieldTextValue)
 * These exercise the non-canonical custom-fields passthrough code path.
 */
export const FIXTURE_ITEM_WITH_CUSTOM_FIELDS = {
  id: "PVTI_lAHOAmfLjc4BWiTtzgt_Oro",
  type: "ISSUE",
  createdAt: "2026-05-27T21:33:50Z",
  updatedAt: "2026-06-02T22:32:25Z",
  isArchived: false,
  content: {
    __typename: "Issue",
    id: "I_kwDOSJo3Ms8AAAABDlw8vA",
    number: 187,
    title:
      "[Bug]: Non-canonical project fields (deadlines, custom scores, flags) silently dropped in scrum_find_items — custom_fields sparsely populated",
    url: "https://github.com/hoonsubin/github-projects-mcp-server/issues/187",
    state: "OPEN",
    body:
      "## Problem\n\n`scrum_find_items` responses include a `custom_fields` field in `BacklogItemListing` but it is sparsely populated. Non-canonical project fields — deadlines, custom numeric scores, non-standard flags, and any board field outside the Scrum vocabulary — are silently dropped in the mapping layer.\n\nThe query and mapper are coupled to a fixed set of canonical field types (iteration, single-select, number, and a small named set). Any ProjectV2 field a team configures outside that set is invisible in `scrum_find_items` output, even when it contains decision-relevant data. There is no error or warning — the fields are simply absent.\n\n## Impact\n\nAgents cannot filter, sort, or act on project-specific metadata that teams commonly use: due dates, custom priority scores, effort estimates in non-standard fields. The data exists in GitHub Projects but never reaches the agent.\n\n## Context — relationship to #216\n\nBoth issues affect `custom_fields` but in opposite directions:\n\n| Issue | Problem |\n|---|---|\n| #216 | Canonical fields *incorrectly included* in `custom_fields` (duplication, noise) |\n| This issue | Non-canonical fields *incorrectly excluded* from `custom_fields` (missing signal) |\n\nThe correct end state: `custom_fields` contains *only* non-canonical fields, and *all* of them. These two issues should be resolved together or in immediate sequence.\n\n## Affected file\n\n`src/adapters/github/internal/result-normalizer.ts` — field value mapping in `enrichListingCustomFields()`\n\n## Acceptance Criteria\n- [ ] All non-canonical field value types from the GraphQL response appear in `custom_fields`\n- [ ] No non-canonical field type is silently dropped in the mapping layer\n- [ ] Canonical fields (Title, Status, Type, Priority, Story Points, Sprint, Assignees, Labels, Milestone, Repository) are not present in `custom_fields` (handled by #216)\n- [ ] Existing tests pass; new tests cover passthrough of non-canonical field typ...",
    issueType: null,
    assignees: { nodes: [] },
    labels: {
      nodes: [
        { name: "feature", color: "a29bfe" },
        { name: "adapter layer", color: "e69dd2" },
      ],
    },
    milestone: {
      id: "MI_kwDOSJo3Ms4A9dd1",
      title: "Adapter Layer Assembly Pattern",
      dueOn: null,
    },
    repository: {
      name: "github-projects-mcp-server",
      nameWithOwner: "hoonsubin/github-projects-mcp-server",
    },
    blockedBy: {
      nodes: [
        {
          id: "I_kwDOSJo3Ms8AAAABDlwG0A",
          number: 185,
          title:
            "[Tech Debt]: Extract fragment library — catalog recurring field selections into named, composable fragments",
        },
      ],
    },
  },
  fieldValues: {
    nodes: [
      // ── Original 9 canonical field values (verbatim from fixture) ──────
      {
        __typename: "ProjectV2ItemFieldRepositoryValue",
        repository: {
          name: "github-projects-mcp-server",
          nameWithOwner: "hoonsubin/github-projects-mcp-server",
        },
        field: {
          id: "PVTF_lAHOAmfLjc4BWiTtzhR1seo",
          name: "Repository",
        },
      },
      {
        __typename: "ProjectV2ItemFieldLabelValue",
        labels: {
          nodes: [
            { name: "feature", color: "a29bfe" },
            { name: "adapter layer", color: "e69dd2" },
          ],
        },
        field: {
          id: "PVTF_lAHOAmfLjc4BWiTtzhR1sec",
          name: "Labels",
        },
      },
      {
        __typename: "ProjectV2ItemFieldMilestoneValue",
        milestone: {
          title: "Adapter Layer Assembly Pattern",
          dueOn: null,
        },
        field: {
          id: "PVTF_lAHOAmfLjc4BWiTtzhR1sek",
          name: "Milestone",
        },
      },
      {
        __typename: "ProjectV2ItemFieldTextValue",
        text:
          "[Bug]: Non-canonical project fields (deadlines, custom scores, flags) silently dropped in scrum_find_items — custom_fields sparsely populated",
        field: {
          id: "PVTF_lAHOAmfLjc4BWiTtzhR1seQ",
          name: "Title",
        },
      },
      {
        __typename: "ProjectV2ItemFieldSingleSelectValue",
        name: "User Story",
        color: "YELLOW",
        optionId: "bf0dd60d",
        field: {
          id: "PVTSSF_lAHOAmfLjc4BWiTtzhS9YWs",
          name: "Type",
        },
      },
      {
        __typename: "ProjectV2ItemFieldSingleSelectValue",
        name: "Must",
        color: "RED",
        optionId: "457ca5cd",
        field: {
          id: "PVTSSF_lAHOAmfLjc4BWiTtzhR1soA",
          name: "Priority",
        },
      },
      {
        __typename: "ProjectV2ItemFieldSingleSelectValue",
        name: "Backlog",
        color: "PURPLE",
        optionId: "f75ad846",
        field: {
          id: "PVTSSF_lAHOAmfLjc4BWiTtzhR1seY",
          name: "Status",
        },
      },
      {
        __typename: "ProjectV2ItemFieldNumberValue",
        number: 3,
        field: {
          id: "PVTF_lAHOAmfLjc4BWiTtzhR1soI",
          name: "Story Points",
        },
      },
      {
        __typename: "ProjectV2ItemFieldIterationValue",
        title: "Sprint 4",
        startDate: "2026-06-02",
        duration: 11,
        iterationId: "07155ad6",
        field: {
          id: "PVTIF_lAHOAmfLjc4BWiTtzhR1soM",
          name: "Sprint",
        },
      },
      // ── Synthetic non-canonical field entries ──────────────────────────
      {
        __typename: "ProjectV2ItemFieldDateValue",
        date: "2026-08-15",
        field: {
          id: "PVTF_lAHOAmfLjc4BWiTtzhR1seC",
          name: "Deadline",
        },
      },
      {
        __typename: "ProjectV2ItemFieldTextValue",
        text: "Q3",
        field: {
          id: "PVTF_lAHOAmfLjc4BWiTtzhR1seD",
          name: "Target Quarter",
        },
      },
    ],
  },
} as unknown as ProjectItem;

/**
 * Synthetic fixture: a Done-status item in Sprint 4 — needed for terminal-exclusion
 * filter tests in item-filter.test.ts. Uses real field IDs from captured fixtures
 * so buildStoryFromRaw resolves status/sprint correctly.
 */
export const FIXTURE_ITEM_DONE = {
  id: "PVTI_lAHOAmfLjc4BWiTtzguDONE",
  type: "ISSUE",
  createdAt: "2026-04-01T00:00:00Z",
  updatedAt: "2026-04-10T00:00:00Z",
  isArchived: false,
  content: {
    __typename: "Issue",
    id: "I_kwDOSJo3Ms8AAAABD000000",
    number: 999,
    title: "Done Story",
    url: "https://github.com/hoonsubin/github-projects-mcp-server/issues/999",
    state: "CLOSED",
    body: "A completed story for terminal-exclusion filter tests.",
    issueType: null,
    assignees: { nodes: [] },
    labels: { nodes: [{ name: "bug", color: "e1012b" }] },
    milestone: null,
    repository: {
      name: "github-projects-mcp-server",
      nameWithOwner: "hoonsubin/github-projects-mcp-server",
    },
    blockedBy: { nodes: [] },
  },
  fieldValues: {
    nodes: [
      {
        __typename: "ProjectV2ItemFieldRepositoryValue",
        repository: {
          name: "github-projects-mcp-server",
          nameWithOwner: "hoonsubin/github-projects-mcp-server",
        },
        field: { id: "PVTF_lAHOAmfLjc4BWiTtzhR1seo", name: "Repository" },
      },
      {
        __typename: "ProjectV2ItemFieldLabelValue",
        labels: { nodes: [{ name: "bug", color: "e1012b" }] },
        field: { id: "PVTF_lAHOAmfLjc4BWiTtzhR1sec", name: "Labels" },
      },
      {
        __typename: "ProjectV2ItemFieldTextValue",
        text: "Done Story",
        field: { id: "PVTF_lAHOAmfLjc4BWiTtzhR1seQ", name: "Title" },
      },
      {
        __typename: "ProjectV2ItemFieldSingleSelectValue",
        name: "Bug",
        color: "RED",
        optionId: "bug_id",
        field: { id: "PVTSSF_lAHOAmfLjc4BWiTtzhS9YWs", name: "Type" },
      },
      {
        __typename: "ProjectV2ItemFieldSingleSelectValue",
        name: "Must",
        color: "RED",
        optionId: "457ca5cd",
        field: { id: "PVTSSF_lAHOAmfLjc4BWiTtzhR1soA", name: "Priority" },
      },
      {
        __typename: "ProjectV2ItemFieldSingleSelectValue",
        name: "Done",
        color: "GREEN",
        optionId: "done_id",
        field: { id: "PVTSSF_lAHOAmfLjc4BWiTtzhR1seY", name: "Status" },
      },
      {
        __typename: "ProjectV2ItemFieldNumberValue",
        number: 5,
        field: { id: "PVTF_lAHOAmfLjc4BWiTtzhR1soI", name: "Story Points" },
      },
      {
        __typename: "ProjectV2ItemFieldIterationValue",
        title: "Sprint 4",
        startDate: "2026-06-02",
        duration: 11,
        iterationId: "07155ad6",
        field: { id: "PVTIF_lAHOAmfLjc4BWiTtzhR1soM", name: "Sprint" },
      },
    ],
  },
} as unknown as ProjectItem;

// ── Convenience aggregates ────────────────────────────────────────────────────

/** All four nodes as an array — for tests that need diverse items. */
export const FIXTURE_NODES: readonly ProjectItem[] = [
  FIXTURE_ITEM_222,
  FIXTURE_ITEM_192,
  FIXTURE_ITEM_WITH_CUSTOM_FIELDS,
  FIXTURE_ITEM_DONE,
];

/** Pre-built first-page envelope for board-scan tests (2 canonical nodes). hasNextPage=true so paginator fetches page 2. */
export const FIXTURE_PAGE_1 = makePageEnvelope([FIXTURE_ITEM_222, FIXTURE_ITEM_192], {
  hasNextPage: true,
  endCursor: "Y3Vyc29yOnYyOpKrMDAwMDAwMDAuMDHOCzXmIQ==",
});

/** Pre-built second-page envelope for pagination / custom-fields tests (1 augmented node + 1 Done node). */
export const FIXTURE_PAGE_2 = makePageEnvelope([
  FIXTURE_ITEM_WITH_CUSTOM_FIELDS,
  FIXTURE_ITEM_DONE,
]);
