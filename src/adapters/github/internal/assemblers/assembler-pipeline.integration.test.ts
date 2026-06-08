// =============================================================================
// src/adapters/github/internal/assemblers/assembler-pipeline.integration.test.ts
//
// End-to-end test chain: classifyFilter → assembler → AssemblerOutput
// Gates architectural integrity across routing, engine, and normalizer layers.
// =============================================================================

import { assertEquals, assertExists } from "@std/assert";
import { classifyFilter } from "../query-strategies/filter-strategy-router.ts";
import { ProjectItemsAssembler } from "./project-items-assembler.ts";
import { DirectLookupAssembler } from "./direct-lookup-assembler.ts";
import { SearchApiAssembler } from "./search-api-assembler.ts";
import { ExecutionEngine } from "../query-pipeline/execution-engine.ts";
import { ResultNormalizer } from "../query-strategies/result-normalizer.ts";
import { BoardScanCoordinator } from "../read-services/board-scan-coordinator.ts";
import { createGhSpy, makeConfig } from "@test/support/github-client.ts";
import type { ResolvedItemFilter } from "../../../../scrum/ports.ts";
import { FIXTURE_ITEM_222, FIXTURE_PAGE_1, FIXTURE_PAGE_2 } from "@test/fixtures/github/index.ts";

const config = makeConfig({
  ghConfig: { ...makeConfig().ghConfig, owner_type: "user" as const, project_number: 6 },
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
  limit: 5,
});

const buildPipeline = (gh: ReturnType<typeof createGhSpy>) => {
  const engine = new ExecutionEngine(gh);
  const normalizer = new ResultNormalizer(config);
  const ctx = {
    config,
    gh,
    owner: config.ghConfig.owner,
    repo: config.ghConfig.tracked_repos[0],
    ghConfig: config.ghConfig,
  };
  const projectItems = new ProjectItemsAssembler(
    new BoardScanCoordinator(ctx),
    normalizer,
    config,
  );
  return {
    projectItems,
    directLookup: new DirectLookupAssembler(gh, normalizer, config),
    searchApi: new SearchApiAssembler(engine, normalizer, projectItems, config),
  };
};

Deno.test({
  name: "pipeline - project_items profile through full chain",
  async fn() {
    const filter = { ...baseFilter(), statuses: ["In Progress"] };
    const profile = classifyFilter(filter);
    assertEquals(profile.kind, "project_items");

    const gh = createGhSpy();
    gh.enqueue(FIXTURE_PAGE_1, FIXTURE_PAGE_2);
    const { projectItems } = buildPipeline(gh);

    if (profile.kind !== "project_items") throw new Error("unexpected profile");
    const output = await projectItems.assemble(profile.filter);

    assertEquals(output.items.length <= filter.limit, true);
    assertEquals(output.totalCount >= output.items.length, true);
    for (const item of output.items) {
      assertExists(item.ref.id);
    }
  },
});

Deno.test({
  name: "pipeline - scope=all + search routes to project_items (not search_api)",
  async fn() {
    const filter = { ...baseFilter(), search: "config" };
    const profile = classifyFilter(filter);
    assertEquals(profile.kind, "project_items");

    const gh = createGhSpy();
    gh.enqueue(FIXTURE_PAGE_1, FIXTURE_PAGE_2);
    const { projectItems } = buildPipeline(gh);

    if (profile.kind !== "project_items") throw new Error("unexpected profile");
    const output = await projectItems.assemble(profile.filter);
    assertEquals(output.items.length <= filter.limit, true);
  },
});

Deno.test({
  name: "pipeline - scope=sprint routes to project_items (not search_api)",
  fn() {
    const filter = { ...baseFilter(), scope: "sprint" as const };
    const profile = classifyFilter(filter);
    assertEquals(profile.kind, "project_items");
  },
});

Deno.test({
  name: "pipeline - scope=backlog routes to project_items (not search_api)",
  fn() {
    const filter = { ...baseFilter(), scope: "backlog" as const };
    const profile = classifyFilter(filter);
    assertEquals(profile.kind, "project_items");
  },
});

Deno.test({
  name: "pipeline - scope=sprint + search routes to project_items (board scan + in-memory text)",
  fn() {
    const filter = { ...baseFilter(), scope: "sprint" as const, search: "auth" };
    const profile = classifyFilter(filter);
    assertEquals(profile.kind, "project_items");
  },
});

Deno.test({
  name: "pipeline - scope=all + labels routes to project_items and board-scans",
  async fn() {
    // scope=all with text filters uses the board scan (draft parity), not search_api.
    const filter: ResolvedItemFilter = {
      ...baseFilter(),
      scope: "all",
      labels: ["bug"],
    };
    const profile = classifyFilter(filter);
    assertEquals(profile.kind, "project_items");

    const gh = createGhSpy();
    gh.enqueue(FIXTURE_PAGE_1, FIXTURE_PAGE_2);
    const { projectItems } = buildPipeline(gh);

    if (profile.kind !== "project_items") throw new Error("unexpected profile");
    const output = await projectItems.assemble(profile.filter);

    assertEquals(output.items.length <= filter.limit, true);
    assertEquals(gh.graphqlCalls.length, 2); // two pages of board scan
  },
});

Deno.test({
  name: "pipeline - direct_lookup avoids multi-page board scan",
  async fn() {
    const filter = { ...baseFilter(), keys: ["222"], scope: "all" as const };
    const profile = classifyFilter(filter);
    assertEquals(profile.kind, "direct_lookup");

    // Use FIXTURE_ITEM_222 (#222) wrapped in a GetIssueProjectItem response envelope
    const sample = FIXTURE_ITEM_222;

    const gh = createGhSpy();
    gh.enqueue({
      repository: {
        issue: {
          projectItems: {
            nodes: [{ project: { number: 6 }, ...sample as unknown as Record<string, unknown> }],
          },
        },
      },
    });

    const { directLookup } = buildPipeline(gh);
    if (profile.kind !== "direct_lookup") throw new Error("unexpected profile");
    const output = await directLookup.assemble(profile, filter);

    assertEquals(gh.graphqlCalls.length, 1);
    assertEquals(output.items.length, 1);
    assertEquals(output.items[0].ref.key, "222");
  },
});
