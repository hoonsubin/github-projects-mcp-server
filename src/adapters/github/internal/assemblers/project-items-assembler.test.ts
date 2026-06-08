// =============================================================================
// src/adapters/github/internal/assemblers/project-items-assembler.test.ts
// =============================================================================

import { assertEquals, assertExists, assertStrictEquals, assertStringIncludes } from "@std/assert";
import { ProjectItemsAssembler } from "./project-items-assembler.ts";
import { BoardScanCoordinator } from "../read-services/board-scan-coordinator.ts";
import { ResultNormalizer } from "../query-strategies/result-normalizer.ts";
import { createGhSpy, makeConfig } from "@test/support/github-client.ts";
import type { ResolvedItemFilter } from "../../../../scrum/ports.ts";
import {
  FIXTURE_ITEM_WITH_CUSTOM_FIELDS,
  FIXTURE_PAGE_1,
  FIXTURE_PAGE_2,
  makePageEnvelope,
} from "@test/fixtures/github/index.ts";

const P1_NODES = FIXTURE_PAGE_1.user.projectV2.items.nodes;
const P2_NODES = FIXTURE_PAGE_2.user.projectV2.items.nodes;
const FIXTURE_TOTAL = P1_NODES.length + P2_NODES.length;

const config = makeConfig({
  ghConfig: { ...makeConfig().ghConfig, owner_type: "user" as const },
  live: {
    ...makeConfig().live,
    iterations: { active: null, next: null, completed: [], all: [] },
  },
});

// Config with an active sprint - triggers the sprint-filtered fetch branch.
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
  gh.enqueue(FIXTURE_PAGE_1, FIXTURE_PAGE_2);
  const output = await makeAssembler(gh).assemble(baseFilter());
  assertEquals(output.totalCount, FIXTURE_TOTAL);
  assertEquals(output.items.length, Math.min(FIXTURE_TOTAL, 50));
  const first = output.items[0];
  assertExists(first.custom_fields);
  assertStrictEquals(first.custom_fields["Status"], undefined);
});

Deno.test("ProjectItemsAssembler - second assemble reuses board cache", async () => {
  const gh = createGhSpy();
  gh.enqueue(FIXTURE_PAGE_1, FIXTURE_PAGE_2);
  const assembler = makeAssembler(gh);
  await assembler.assemble(baseFilter());
  await assembler.assemble(baseFilter());
  assertEquals(gh.graphqlCalls.length, 2);
});

Deno.test("ProjectItemsAssembler - scope=sprint uses full board scan (server-side iteration filter not supported)", async () => {
  const gh = createGhSpy();
  gh.enqueue(FIXTURE_PAGE_1, FIXTURE_PAGE_2);
  const output = await makeAssembler(gh, sprintConfig).assemble({
    ...baseFilter(),
    scope: "sprint",
  });
  assertEquals(gh.graphqlCalls.length, 2);
  assertEquals(output.items.length <= 50, true);
});

Deno.test("ProjectItemsAssembler - scope=sprint reuses full board cache on second call", async () => {
  const gh = createGhSpy();
  gh.enqueue(FIXTURE_PAGE_1, FIXTURE_PAGE_2);
  const assembler = makeAssembler(gh, sprintConfig);
  await assembler.assemble({ ...baseFilter(), scope: "sprint" });
  await assembler.assemble({ ...baseFilter(), scope: "sprint" });
  assertEquals(gh.graphqlCalls.length, 2);
});

Deno.test("ProjectItemsAssembler - non-canonical fields appear in custom_fields", async () => {
  const gh = createGhSpy();
  // Single page with the augmented fixture node (issue #187)
  gh.enqueue(makePageEnvelope([FIXTURE_ITEM_WITH_CUSTOM_FIELDS]));
  const output = await makeAssembler(gh).assemble(baseFilter());

  assertEquals(output.totalCount, 1);
  const item = output.items[0];
  assertEquals(item.ref.key, "187");

  // Canonical fields absent
  assertEquals(item.custom_fields["Status"], undefined);
  assertEquals(item.custom_fields["Story Points"], undefined);
  assertEquals(item.custom_fields["Type"], undefined);
  assertEquals(item.custom_fields["Priority"], undefined);

  // Non-canonical fields present (as JSON strings)
  assertExists(item.custom_fields["Deadline"], "Deadline should be in custom_fields");
  assertStringIncludes(item.custom_fields["Deadline"] as string, "2026-08-15");

  assertExists(
    item.custom_fields["Target Quarter"],
    "Target Quarter should be in custom_fields",
  );
  assertStringIncludes(item.custom_fields["Target Quarter"] as string, "Q3");

  // __typename always present
  assertEquals(item.custom_fields["__typename"], "Issue");
});
