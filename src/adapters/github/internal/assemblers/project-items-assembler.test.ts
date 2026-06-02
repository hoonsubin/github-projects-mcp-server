// =============================================================================
// src/adapters/github/internal/assemblers/project-items-assembler.test.ts
//
// Integration test: fixture pages → ExecutionEngine → ProjectItemsAssembler →
// AssemblerOutput with custom_fields enrichment.
// =============================================================================

import { assertEquals, assertExists } from "@std/assert";
import { ProjectItemsAssembler } from "./project-items-assembler.ts";
import { ProjectItemsQueryBuilder } from "../project-items-query-builder.ts";
import { ExecutionEngine } from "../execution-engine.ts";
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
  ghConfig: {
    ...makeConfig().ghConfig,
    owner_type: "user" as const,
  },
  live: {
    ...makeConfig().live,
    iterations: {
      active: null,
      next: null,
      completed: [],
      all: [],
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

Deno.test({
  name: "ProjectItemsAssembler - fixture pages produce enriched listings",
  async fn() {
    const gh = createGhSpy();
    gh.enqueue(p1Fixture, p2Fixture);

    const assembler = new ProjectItemsAssembler(
      new ExecutionEngine(gh),
      new ResultNormalizer(config),
      new ProjectItemsQueryBuilder("user"),
      config,
    );

    const output = await assembler.assemble(baseFilter());

    assertEquals(output.totalCount, FIXTURE_TOTAL);
    assertEquals(output.items.length, Math.min(FIXTURE_TOTAL, 50));
    assertEquals(output.items.length > 0, true);

    const first = output.items[0];
    assertExists(first.custom_fields);
    assertExists(first.custom_fields["__typename"]);
  },
});

Deno.test({
  name: "ProjectItemsAssembler - limit preserves pre-limit totalCount",
  async fn() {
    const gh = createGhSpy();
    gh.enqueue(p1Fixture, p2Fixture);

    const assembler = new ProjectItemsAssembler(
      new ExecutionEngine(gh),
      new ResultNormalizer(config),
      new ProjectItemsQueryBuilder("user"),
      config,
    );

    const output = await assembler.assemble({ ...baseFilter(), limit: 3 });

    assertEquals(output.totalCount, FIXTURE_TOTAL);
    assertEquals(output.items.length, 3);
  },
});

Deno.test({
  name: "ProjectItemsAssembler - include_dependencies builds dependency map",
  async fn() {
    const gh = createGhSpy();
    gh.enqueue(p1Fixture, p2Fixture);

    const assembler = new ProjectItemsAssembler(
      new ExecutionEngine(gh),
      new ResultNormalizer(config),
      new ProjectItemsQueryBuilder("user"),
      config,
    );

    const output = await assembler.assemble({
      ...baseFilter(),
      include_dependencies: true,
      limit: 10,
    });

    assertExists(output.dependencyMap);
    assertEquals(typeof output.dependencyMap, "object");
  },
});
