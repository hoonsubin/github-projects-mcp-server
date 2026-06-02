// =============================================================================
// src/adapters/github/internal/assemblers/assembler-pipeline.integration.test.ts
//
// End-to-end test chain: classifyFilter → assembler → AssemblerOutput
// Gates architectural integrity across routing, engine, and normalizer layers.
// =============================================================================

import { assertEquals, assertExists } from "@std/assert";
import { classifyFilter } from "../filter-strategy-router.ts";
import { ProjectItemsAssembler } from "./project-items-assembler.ts";
import { DirectLookupAssembler } from "./direct-lookup-assembler.ts";
import { SearchApiAssembler } from "./search-api-assembler.ts";
import { ExecutionEngine } from "../execution-engine.ts";
import { ResultNormalizer } from "../result-normalizer.ts";
import { ProjectItemsQueryBuilder } from "../project-items-query-builder.ts";
import { createGhSpy, makeConfig } from "../_test_utils.ts";
import type { ResolvedItemFilter } from "../../../../scrum/ports.ts";
import p1Fixture from "../../generated/__fixtures__/project-items-p1.json" with { type: "json" };
import p2Fixture from "../../generated/__fixtures__/project-items-p2.json" with { type: "json" };

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
  const projectItems = new ProjectItemsAssembler(
    engine,
    normalizer,
    new ProjectItemsQueryBuilder("user"),
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
    gh.enqueue(p1Fixture, p2Fixture);
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
    gh.enqueue(p1Fixture, p2Fixture);
    const { projectItems } = buildPipeline(gh);

    if (profile.kind !== "project_items") throw new Error("unexpected profile");
    const output = await projectItems.assemble(profile.filter);
    assertEquals(output.items.length <= filter.limit, true);
  },
});

Deno.test({
  name: "pipeline - search_api uses SearchIssues and project-membership filter",
  async fn() {
    const filter: ResolvedItemFilter = {
      ...baseFilter(),
      scope: "backlog",
      labels: ["refactor"],
    };
    const profile = classifyFilter(filter);
    assertEquals(profile.kind, "search_api");

    const sample =
      (p1Fixture as { user: { projectV2: { items: { nodes: Array<Record<string, unknown>> } } } })
        .user.projectV2.items.nodes[0];

    const gh = createGhSpy();
    gh.enqueue({
      search: {
        issueCount: 1,
        pageInfo: { hasNextPage: false, endCursor: null },
        nodes: [{
          ...(sample.content as object),
          id: (sample.content as { id: string }).id,
          number: (sample.content as { number: number }).number,
          projectItems: {
            nodes: [{
              project: { id: "PVT_x", number: 6 },
              id: sample.id,
              type: sample.type,
              createdAt: sample.createdAt,
              updatedAt: sample.updatedAt,
              isArchived: sample.isArchived,
              fieldValues: sample.fieldValues,
            }],
          },
        }],
      },
    });

    const { searchApi } = buildPipeline(gh);
    if (profile.kind !== "search_api") throw new Error("unexpected profile");
    const output = await searchApi.assemble(profile, filter);

    assertEquals(gh.graphqlCalls.length, 1);
    assertEquals(typeof gh.graphqlCalls[0].variables.query, "string");
    assertEquals(output.items.length <= filter.limit, true);
  },
});

Deno.test({
  name: "pipeline - direct_lookup avoids multi-page board scan",
  async fn() {
    const filter = { ...baseFilter(), keys: ["202"], scope: "all" as const };
    const profile = classifyFilter(filter);
    assertEquals(profile.kind, "direct_lookup");

    const sample =
      (p1Fixture as { user: { projectV2: { items: { nodes: Array<Record<string, unknown>> } } } })
        .user.projectV2.items.nodes.find(
          (n) => (n.content as { number?: number })?.number === 202,
        );
    if (!sample) return;

    const gh = createGhSpy();
    gh.enqueue({
      repository: {
        issue: {
          projectItems: {
            nodes: [{ project: { number: 6 }, ...sample }],
          },
        },
      },
    });

    const { directLookup } = buildPipeline(gh);
    if (profile.kind !== "direct_lookup") throw new Error("unexpected profile");
    const output = await directLookup.assemble(profile, filter);

    assertEquals(gh.graphqlCalls.length, 1);
    assertEquals(output.items.length, 1);
    assertEquals(output.items[0].ref.key, "202");
  },
});
