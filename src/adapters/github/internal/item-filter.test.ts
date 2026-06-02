// =============================================================================
// src/adapters/github/internal/item-filter.test.ts
//
// Unit tests for buildItemFilterFn — client-side filter parity with
// StoryQueryService.findItems() filter chain.
// =============================================================================

import { assertEquals } from "@std/assert";
import { buildItemFilterFn } from "./item-filter.ts";
import { makeConfig } from "./_test_utils.ts";
import { buildStoryFromRaw } from "../mappers.ts";
import type { ItemFieldValue, ProjectItem } from "../types.ts";
import type { ResolvedItemFilter } from "../../../scrum/ports.ts";
import type { Story } from "../../../domain/types.ts";
import projectItemsP1 from "../generated/__fixtures__/project-items-p1.json" with { type: "json" };

const allItems: ProjectItem[] =
  (projectItemsP1 as { user: { projectV2: { items: { nodes: unknown[] } } } })
    .user.projectV2.items.nodes as ProjectItem[];

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
  sprint_ref: null,
  include_dependencies: false,
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
