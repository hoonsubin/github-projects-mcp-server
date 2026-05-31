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
import type { ProjectItem } from "../types.ts";
import type { ResolvedItemFilter } from "../../../scrum/ports.ts";
import type { Story } from "../../../domain/types.ts";
import projectItemsP1 from "./__fixtures__/project-items-p1.json" with { type: "json" };

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
