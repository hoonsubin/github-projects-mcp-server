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

const makeAssembler = (gh: ReturnType<typeof createGhSpy>) => {
  const ctx = {
    config,
    gh,
    owner: config.ghConfig.owner,
    repo: config.ghConfig.tracked_repos[0],
    ghConfig: config.ghConfig,
  };
  return new ProjectItemsAssembler(
    new BoardScanCoordinator(ctx),
    new ResultNormalizer(config),
    config,
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
