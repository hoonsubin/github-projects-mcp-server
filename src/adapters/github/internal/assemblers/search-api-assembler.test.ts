import { assertEquals, assertStringIncludes } from "@std/assert";
import { SearchApiAssembler } from "./search-api-assembler.ts";
import { ProjectItemsAssembler } from "./project-items-assembler.ts";
import { ExecutionEngine } from "../execution-engine.ts";
import { ResultNormalizer } from "../result-normalizer.ts";
import { BoardScanCoordinator } from "../board-scan-coordinator.ts";
import { createGhSpy, makeConfig } from "../_test_utils.ts";
import { FIXTURE_PAGE_1, FIXTURE_PAGE_2 } from "../_test_fixtures.ts";

const config = makeConfig({
  ghConfig: { ...makeConfig().ghConfig, owner_type: "user" as const, project_number: 5 },
});

const buildAssembler = (gh: ReturnType<typeof createGhSpy>) => {
  const ctx = {
    config,
    gh,
    owner: config.ghConfig.owner,
    repo: config.ghConfig.tracked_repos[0],
    ghConfig: config.ghConfig,
  };
  const projectItems = new ProjectItemsAssembler(
    new BoardScanCoordinator(ctx),
    new ResultNormalizer(config),
    config,
  );
  return new SearchApiAssembler(
    new ExecutionEngine(gh),
    new ResultNormalizer(config),
    projectItems,
    config,
  );
};

Deno.test("SearchApiAssembler - falls back to board scan when search returns no results", async () => {
  const gh = createGhSpy();
  gh.enqueue({ search: { nodes: [] } });
  gh.enqueue(FIXTURE_PAGE_1, FIXTURE_PAGE_2);

  const assembler = buildAssembler(gh);
  const filter = {
    scope: "backlog" as const,
    keys: [] as string[],
    search: "audit",
    types: [] as string[],
    statuses: [] as string[],
    priority: "",
    epic_id: "",
    labels: [] as string[],
    assignee: "",
    estimated: undefined,
    sprint_ref: null,
    include_dependencies: false,
    limit: 5,
  };

  const output = await assembler.assemble(
    { kind: "search_api", search: "audit", labels: [], assignee: "" },
    filter,
  );

  assertEquals(gh.graphqlCalls.length, 3);
  assertStringIncludes(gh.graphqlCalls[0].queryExcerpt, "SearchIssues");
  assertEquals(
    output.warnings.some((w) => w.includes("board scan instead")),
    true,
  );
});
