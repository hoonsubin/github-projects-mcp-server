// =============================================================================
// src/adapters/github/internal/assemblers/project-items-assembler.test.ts
// =============================================================================

import { assertEquals, assertExists, assertStrictEquals } from "@std/assert";
import { ProjectItemsAssembler } from "./project-items-assembler.ts";
import { BoardScanCoordinator } from "../board-scan-coordinator.ts";
import { ResultNormalizer } from "../result-normalizer.ts";
import { createGhSpy, makeConfig } from "../_test_utils.ts";
import type { ResolvedItemFilter } from "../../../../scrum/ports.ts";
import p1Fixture from "../../generated/__fixtures__/project-items-p1.json" with { type: "json" };
import p2Fixture from "../../generated/__fixtures__/project-items-p2.json" with { type: "json" };

const P1_NODES = (p1Fixture as { user: { projectV2: { items: { nodes: unknown[] } } } })
  .user.projectV2.items.nodes;
const P2_NODES = (p2Fixture as { user: { projectV2: { items: { nodes: unknown[] } } } })
  .user.projectV2.items.nodes;
const FIXTURE_TOTAL = P1_NODES.length + P2_NODES.length;

const config = makeConfig({
  ghConfig: { ...makeConfig().ghConfig, owner_type: "user" as const },
  live: {
    ...makeConfig().live,
    iterations: { active: null, next: null, completed: [], all: [] },
  },
});

// Config with an active sprint — triggers the sprint-filtered fetch branch.
const sprintConfig = makeConfig({
  ghConfig: { ...makeConfig().ghConfig, owner_type: "user" as const },
  live: {
    ...makeConfig().live,
    iterations: {
      active: { id: "IT_sprint1", title: "Sprint 1", startDate: "2026-01-01", duration: 14 },
      next: { id: "IT_sprint2", title: "Sprint 2", startDate: "2026-01-15", duration: 14 },
      completed: [],
      all: [
        { id: "IT_sprint1", title: "Sprint 1", startDate: "2026-01-01", duration: 14 },
        { id: "IT_sprint2", title: "Sprint 2", startDate: "2026-01-15", duration: 14 },
      ],
    },
  },
});

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

const makeAssembler = (gh: ReturnType<typeof createGhSpy>, cfg = config) => {
  const ctx = {
    config: cfg,
    gh,
    owner: cfg.ghConfig.owner,
    repo: cfg.ghConfig.tracked_repos[0],
    ghConfig: cfg.ghConfig,
  };
  return new ProjectItemsAssembler(
    new BoardScanCoordinator(ctx),
    new ResultNormalizer(cfg),
    cfg,
  );
};

Deno.test("ProjectItemsAssembler - fixture pages produce enriched listings", async () => {
  const gh = createGhSpy();
  gh.enqueue(p1Fixture, p2Fixture);
  const output = await makeAssembler(gh).assemble(baseFilter());
  assertEquals(output.totalCount, FIXTURE_TOTAL);
  assertEquals(output.items.length, Math.min(FIXTURE_TOTAL, 50));
  const first = output.items[0];
  assertExists(first.custom_fields);
  assertStrictEquals(first.custom_fields["Status"], undefined);
});

Deno.test("ProjectItemsAssembler - second assemble reuses board cache", async () => {
  const gh = createGhSpy();
  gh.enqueue(p1Fixture, p2Fixture);
  const assembler = makeAssembler(gh);
  await assembler.assemble(baseFilter());
  await assembler.assemble(baseFilter());
  assertEquals(gh.graphqlCalls.length, 2);
});

Deno.test("ProjectItemsAssembler - scope=sprint uses full board scan (server-side iteration filter not supported)", async () => {
  // GitHub Projects v2 does not support iteration filtering via the query: argument.
  // scope=sprint always uses the full board scan; sprintItemIds filters client-side.
  const gh = createGhSpy();
  gh.enqueue(p1Fixture, p2Fixture);
  const output = await makeAssembler(gh, sprintConfig).assemble({
    ...baseFilter(),
    scope: "sprint",
  });
  assertEquals(gh.graphqlCalls.length, 2); // full board = two pages
  assertEquals(output.items.length <= 50, true);
});

Deno.test("ProjectItemsAssembler - scope=sprint reuses full board cache on second call", async () => {
  const gh = createGhSpy();
  gh.enqueue(p1Fixture, p2Fixture);
  const assembler = makeAssembler(gh, sprintConfig);
  await assembler.assemble({ ...baseFilter(), scope: "sprint" });
  await assembler.assemble({ ...baseFilter(), scope: "sprint" }); // second call — cache hit
  assertEquals(gh.graphqlCalls.length, 2); // still 2, not 4
});
