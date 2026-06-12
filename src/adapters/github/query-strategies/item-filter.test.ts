// =============================================================================
// src/adapters/github/item-filter.test.ts
//
// Unit tests for buildItemFilterFn - client-side filter parity with
// StoryQueryService.findItems() filter chain.
// =============================================================================

import { assertEquals } from "@std/assert";
import { buildItemFilterFn } from "./item-filter.ts";
import { makeConfig } from "@test/support/github-client.ts";
import { buildStoryFromRaw } from "../mappers.ts";
import type { ItemFieldValue, ProjectItem } from "../types.ts";
import type { ResolvedItemFilter } from "../../../scrum/ports.ts";
import type { Story } from "../../../domain/types.ts";
import { FIXTURE_NODES } from "@test/fixtures/github/index.ts";

const allItems: ProjectItem[] = [...FIXTURE_NODES];

const config = makeConfig({
  live: {
    ...makeConfig().live,
    iterations: {
      active: { id: "IT_active", title: "Sprint 5", startDate: "2026-01-01", duration: 14 },
      next: null,
      completed: [],
      all: [
        { id: "IT_active", title: "Sprint 5", startDate: "2026-01-01", duration: 14 },
      ],
    },
  },
});

const allStories: Story[] = allItems
  .map((item) => buildStoryFromRaw(item, config))
  .filter((s): s is Story => s !== null);

const applyFilter = (filter: ResolvedItemFilter): Story[] => {
  const fn = buildItemFilterFn(filter, config, allItems);
  return allStories.filter(fn);
};

const baseFilter = (): ResolvedItemFilter => ({
  scope: "all",
  keys: [],
  search: "",
  types: [],
  statuses: [],
  priority: "",
  epic_id: "",
  labels: [],
  assignee: "",
  estimated: undefined,
  has_blockers: undefined,
  sprint_ref: null,
  include_dependencies: false,
  fields: "full" as const,
  limit: 50,
});

Deno.test("buildItemFilterFn - keys bypass scope", () => {
  const sprintStory = allStories.find((s) => s.sprint !== null);
  const backlogStory = allStories.find((s) => s.sprint === null && s.kind === "issue");
  if (!sprintStory?.key || !backlogStory?.key) return;

  const filtered = applyFilter({
    ...baseFilter(),
    scope: "backlog",
    keys: [sprintStory.key, backlogStory.key],
  });

  assertEquals(filtered.length, 2);
});

Deno.test("buildItemFilterFn - scope=sprint excludes backlog items", () => {
  const filtered = applyFilter({ ...baseFilter(), scope: "sprint" });
  assertEquals(filtered.every((s) => s.sprint !== null), true);
});

Deno.test("buildItemFilterFn - scope=backlog excludes sprint items", () => {
  const filtered = applyFilter({ ...baseFilter(), scope: "backlog" });
  assertEquals(filtered.every((s) => s.sprint === null), true);
});

Deno.test("buildItemFilterFn - label AND semantics", () => {
  const withRefactor = allStories.filter((s) => s.labels.includes("refactor"));
  if (withRefactor.length === 0) return;

  const label = withRefactor[0].labels[0];
  const filtered = applyFilter({ ...baseFilter(), labels: [label] });
  assertEquals(filtered.length > 0, true);
  assertEquals(filtered.every((s) => s.labels.includes(label)), true);
});

Deno.test("buildItemFilterFn - search matches title or body", () => {
  const sample = allStories.find((s) => s.title.length > 5);
  if (!sample) return;
  const term = sample.title.split(" ")[0].slice(0, 6).toLowerCase();
  const filtered = applyFilter({ ...baseFilter(), search: term });
  assertEquals(filtered.some((s) => s.ref.id === sample.ref.id), true);
});

Deno.test("buildItemFilterFn - estimated=true requires story points > 0", () => {
  const filtered = applyFilter({ ...baseFilter(), estimated: true });
  assertEquals(filtered.every((s) => (s.story_points ?? 0) > 0), true);
});

Deno.test("buildItemFilterFn - invalid sprint_ref matches nothing", () => {
  const filtered = applyFilter({ ...baseFilter(), sprint_ref: "nonexistent-sprint-xyz" });
  assertEquals(filtered.length, 0);
});

Deno.test("buildItemFilterFn - sprint_ref=all includes items from every configured iteration", () => {
  const union = applyFilter({ ...baseFilter(), sprint_ref: "all" });
  const all = applyFilter(baseFilter());
  assertEquals(union.length <= all.length, true);
  assertEquals(union.every((s) => all.some((a) => a.ref.id === s.ref.id)), true);
});

Deno.test("buildItemFilterFn - scope=backlog excludes terminal-status Done items by default", () => {
  const cfg = makeConfig({
    scrumConfig: {
      project: { name: "Test" },
      scrum: {
        priority: [],
        status: { "done": { terminal: true, blocking: false } },
      },
      backends: { github: {} },
    },
    ghConfig: {
      auth: { token: "ghp_test" },
      owner: "test-owner",
      owner_type: "org" as const,
      project_number: 1,
      tracked_repos: ["test-repo"],
      type_mapping: {},
      field_mapping: { sprint: "Sprint", status: "Status" },
      status_display: { "done": "Done" },
      priority_display: { "p0": "Must" },
    },
  });

  const terminal: Story = {
    kind: "issue",
    ref: { id: "term1" },
    key: "t1",
    title: "Terminal done item",
    body: "",
    type: "bug",
    status: "Done",
    sprint: null,
    story_points: 3,
    priority: "Should" as const,
    assignees: [],
    labels: [],
    epic: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    url: "",
    blocked_by: [],
  };
  const active: Story = {
    ...terminal,
    ref: { id: "act1" },
    key: "a1",
    title: "Active backlog item",
    status: "In Progress",
  };

  const fn = buildItemFilterFn(
    { ...baseFilter(), scope: "backlog" },
    cfg,
    [],
  );
  const results = [terminal, active].filter(fn);
  assertEquals(results.length, 1);
  assertEquals(results[0].ref.id, "act1");
});

Deno.test("buildItemFilterFn - scope=backlog with explicit statuses bypasses terminal exclusion", () => {
  const cfg = makeConfig({
    scrumConfig: {
      project: { name: "Test" },
      scrum: {
        priority: [],
        status: { "done": { terminal: true, blocking: false } },
      },
      backends: { github: {} },
    },
    ghConfig: {
      auth: { token: "ghp_test" },
      owner: "test-owner",
      owner_type: "org" as const,
      project_number: 1,
      tracked_repos: ["test-repo"],
      type_mapping: {},
      field_mapping: { sprint: "Sprint", status: "Status" },
      status_display: { "done": "Done" },
      priority_display: { "p0": "Must" },
    },
  });

  const terminal: Story = {
    kind: "issue",
    ref: { id: "term2" },
    key: "t2",
    title: "Done item in backlog",
    body: "",
    type: "bug",
    status: "Done",
    sprint: null,
    story_points: 3,
    priority: "Should" as const,
    assignees: [],
    labels: [],
    epic: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    url: "",
    blocked_by: [],
  };

  const fn = buildItemFilterFn(
    { ...baseFilter(), scope: "backlog", statuses: ["Done"] },
    cfg,
    [],
  );
  const results = [terminal].filter(fn);
  assertEquals(results.length, 1);
  assertEquals(results[0].ref.id, "term2");
});

Deno.test("buildItemFilterFn - scope=all does not exclude terminal-status Done items", () => {
  const cfg = makeConfig({
    scrumConfig: {
      project: { name: "Test" },
      scrum: {
        priority: [],
        status: { "done": { terminal: true, blocking: false } },
      },
      backends: { github: {} },
    },
    ghConfig: {
      auth: { token: "ghp_test" },
      owner: "test-owner",
      owner_type: "org" as const,
      project_number: 1,
      tracked_repos: ["test-repo"],
      type_mapping: {},
      field_mapping: { sprint: "Sprint", status: "Status" },
      status_display: { "done": "Done" },
      priority_display: { "p0": "Must" },
    },
  });

  const terminal: Story = {
    kind: "issue",
    ref: { id: "term3" },
    key: "t3",
    title: "Done item",
    body: "",
    type: "bug",
    status: "Done",
    sprint: null,
    story_points: 3,
    priority: "Should" as const,
    assignees: [],
    labels: [],
    epic: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    url: "",
    blocked_by: [],
  };

  const fn = buildItemFilterFn(
    { ...baseFilter(), scope: "all" },
    cfg,
    [],
  );
  const results = [terminal].filter(fn);
  assertEquals(results.length, 1);
});

Deno.test("buildItemFilterFn - scope=sprint with null sprint_ref excludes past-sprint items", () => {
  const sprintFieldId = "PVTF_sprint";
  const cfg = makeConfig({
    live: {
      ...makeConfig().live,
      fields: {
        ...makeConfig().live.fields,
        sprintFieldId,
      },
      iterations: {
        active: { id: "IT_current", title: "Sprint 5", startDate: "2026-01-01", duration: 14 },
        next: { id: "IT_next", title: "Sprint 6", startDate: "2026-01-15", duration: 14 },
        completed: [
          { id: "IT_past", title: "Sprint 4", startDate: "2025-12-18", duration: 14 },
        ],
        all: [
          { id: "IT_past", title: "Sprint 4", startDate: "2025-12-18", duration: 14 },
          { id: "IT_current", title: "Sprint 5", startDate: "2026-01-01", duration: 14 },
          { id: "IT_next", title: "Sprint 6", startDate: "2026-01-15", duration: 14 },
        ],
      },
    },
  });

  const makeProjectItem = (id: string, iterationId: string | null): ProjectItem => {
    const fvNodes: ItemFieldValue[] = [
      {
        __typename: "ProjectV2ItemFieldIterationValue",
        field: { id: sprintFieldId, name: "Sprint" },
        iterationId: iterationId ?? undefined,
        title: iterationId === "IT_current"
          ? "Sprint 5"
          : iterationId === "IT_past"
          ? "Sprint 4"
          : undefined,
        startDate: undefined,
        duration: undefined,
      },
    ];
    return {
      id,
      type: "ISSUE" as const,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      isArchived: false,
      content: null,
      fieldValues: { nodes: fvNodes },
    };
  };

  const currentSprintItem: Story = {
    kind: "issue",
    ref: { id: "current1" },
    key: "c1",
    title: "Current sprint item",
    body: "",
    type: "feature",
    status: "In Progress",
    sprint: "Sprint 5",
    story_points: 3,
    priority: "Must",
    assignees: [],
    labels: [],
    epic: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    url: "",
    blocked_by: [],
  };
  const pastSprintItem: Story = {
    ...currentSprintItem,
    ref: { id: "past1" },
    key: "p1",
    title: "Past sprint item",
    sprint: "Sprint 4",
  };
  const backlogItem: Story = {
    ...currentSprintItem,
    ref: { id: "backlog1" },
    key: "b1",
    title: "Backlog item",
    sprint: null,
  };

  const allItems: ProjectItem[] = [
    makeProjectItem("current1", "IT_current"),
    makeProjectItem("past1", "IT_past"),
    makeProjectItem("backlog1", null),
  ];

  const fn = buildItemFilterFn(
    { ...baseFilter(), scope: "sprint", sprint_ref: null },
    cfg,
    allItems,
  );

  const results = [currentSprintItem, pastSprintItem, backlogItem].filter(fn);
  assertEquals(results.length, 1);
  assertEquals(results[0].ref.id, "current1");
});

// ── Terminal-status exclusion for scope=sprint - fixture-based ────────────────
//
// Field IDs and iteration IDs are taken directly from the captured fixtures so
// buildStoryFromRaw produces populated sprint/status fields.  Sprint 4 is used
// as the "active" sprint because that is what the fixtures contain.

const FIXTURE_SPRINT_FIELD_ID = "PVTIF_lAHOAmfLjc4BWiTtzhR1soM";
const FIXTURE_STATUS_FIELD_ID = "PVTSSF_lAHOAmfLjc4BWiTtzhR1seY";
const FIXTURE_ACTIVE_SPRINT_ID = "07155ad6";
const FIXTURE_ACTIVE_SPRINT_TITLE = "Sprint 4";

const fixtureTerminalConfig = makeConfig({
  scrumConfig: {
    project: { name: "Test" },
    scrum: {
      priority: [],
      status: { "done": { terminal: true, blocking: false } },
    },
    backends: { github: {} },
  },
  ghConfig: {
    ...makeConfig().ghConfig,
    status_display: { "done": "Done" },
  },
  live: {
    ...makeConfig().live,
    fields: {
      ...makeConfig().live.fields,
      sprintFieldId: FIXTURE_SPRINT_FIELD_ID,
      statusFieldId: FIXTURE_STATUS_FIELD_ID,
    },
    iterations: {
      active: {
        id: FIXTURE_ACTIVE_SPRINT_ID,
        title: FIXTURE_ACTIVE_SPRINT_TITLE,
        startDate: "2025-01-01",
        duration: 14,
      },
      next: null,
      completed: [],
      all: [{
        id: FIXTURE_ACTIVE_SPRINT_ID,
        title: FIXTURE_ACTIVE_SPRINT_TITLE,
        startDate: "2025-01-01",
        duration: 14,
      }],
    },
  },
});

const allFixtureItems: ProjectItem[] = [...FIXTURE_NODES];

const allFixtureStories: Story[] = allFixtureItems
  .map((item) => buildStoryFromRaw(item, fixtureTerminalConfig))
  .filter((s): s is Story => s !== null);

Deno.test("buildItemFilterFn - scope=sprint excludes Done items from active sprint", () => {
  const fn = buildItemFilterFn(
    { ...baseFilter(), scope: "sprint" },
    fixtureTerminalConfig,
    allFixtureItems,
  );
  const sprint4Stories = allFixtureStories.filter((s) => s.sprint === FIXTURE_ACTIVE_SPRINT_TITLE);
  const filtered = sprint4Stories.filter(fn);

  // There are Done items in Sprint 4 in the fixture; none should survive.
  assertEquals(sprint4Stories.some((s) => s.status === "Done"), true);
  assertEquals(filtered.every((s) => s.status !== "Done"), true);
  // Non-terminal sprint items must be present.
  assertEquals(filtered.length > 0, true);
});

Deno.test("buildItemFilterFn - scope=sprint with statuses=[Done] includes Done sprint items", () => {
  const fn = buildItemFilterFn(
    { ...baseFilter(), scope: "sprint", statuses: ["Done"] },
    fixtureTerminalConfig,
    allFixtureItems,
  );
  const filtered = allFixtureStories.filter(fn);

  // Explicit status filter bypasses terminal exclusion.
  assertEquals(filtered.every((s) => s.status === "Done"), true);
  assertEquals(filtered.length > 0, true);
});

Deno.test("buildItemFilterFn - scope=sprint with keys bypasses terminal exclusion", () => {
  // Find a Done item in Sprint 4 from the fixture.
  const doneSprintStory = allFixtureStories.find(
    (s) => s.sprint === FIXTURE_ACTIVE_SPRINT_TITLE && s.status === "Done" && s.key,
  );
  if (!doneSprintStory?.key) return;

  const fn = buildItemFilterFn(
    { ...baseFilter(), scope: "sprint", keys: [doneSprintStory.key] },
    fixtureTerminalConfig,
    allFixtureItems,
  );
  const filtered = allFixtureStories.filter(fn);
  assertEquals(filtered.length, 1);
  assertEquals(filtered[0].ref.id, doneSprintStory.ref.id);
});

Deno.test("buildItemFilterFn - has_blockers=true keeps only blocked stories", () => {
  const blocked = allStories.filter((s) => s.blocked_by.length > 0);
  if (blocked.length === 0) return;

  const filtered = applyFilter({ ...baseFilter(), has_blockers: true });
  assertEquals(filtered.every((s) => s.blocked_by.length > 0), true);
  assertEquals(filtered.length, blocked.length);
});

Deno.test("buildItemFilterFn - priority accepts canonical keys", () => {
  const priorityConfig = makeConfig({
    ghConfig: {
      ...makeConfig().ghConfig,
      priority_display: { p0: "Must", p1: "Should" },
    },
  });
  const mustStory = allStories.find((s) => s.priority === "Must");
  if (!mustStory) return;

  const fn = buildItemFilterFn(
    { ...baseFilter(), priority: "p0" },
    priorityConfig,
    allItems,
  );
  const filtered = allStories.filter(fn);
  assertEquals(filtered.some((s) => s.ref.id === mustStory.ref.id), true);
  assertEquals(filtered.every((s) => s.priority === "Must"), true);
});
