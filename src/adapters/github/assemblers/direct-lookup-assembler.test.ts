// =============================================================================
// src/adapters/github/assemblers/direct-lookup-assembler.test.ts
//
// Direct lookup path: targeted GetIssueProjectItem queries without board scan.
// =============================================================================

import { assertEquals, assertExists } from "@std/assert";
import { DirectLookupAssembler } from "./direct-lookup-assembler.ts";
import { ResultNormalizer } from "../query-strategies/result-normalizer.ts";
import { createGhSpy, makeConfig } from "@test/support/github-client.ts";
import { FIXTURE_ITEM_222 } from "@test/fixtures/github/index.ts";

Deno.test({
  name: "DirectLookupAssembler - fetches keyed item without board scan",
  async fn() {
    const config = makeConfig({
      ghConfig: {
        ...makeConfig().ghConfig,
        project_number: 6,
        tracked_repos: ["github-projects-mcp-server"],
      },
    });

    const gh = createGhSpy();
    gh.enqueue({
      repository: {
        issue: {
          projectItems: {
            nodes: [{
              project: { number: 6 },
              ...FIXTURE_ITEM_222 as unknown as Record<string, unknown>,
            }],
          },
        },
      },
    });

    const assembler = new DirectLookupAssembler(
      gh,
      new ResultNormalizer(config),
      config,
    );

    const output = await assembler.assemble(
      { kind: "direct_lookup", keys: ["222"] },
      {
        scope: "all",
        keys: ["222"],
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
      },
    );

    assertEquals(output.items.length, 1);
    assertEquals(output.totalCount, 1);
    assertEquals(output.items[0].ref.key, "222");
    assertExists(output.items[0].custom_fields?.["__typename"]);
    assertEquals(gh.graphqlCalls.length, 1);
    assertEquals(gh.graphqlCalls[0].variables.number, 222);
  },
});

Deno.test({
  name: "DirectLookupAssembler - missing issue returns empty set",
  async fn() {
    const config = makeConfig();
    const gh = createGhSpy();
    gh.enqueue({ repository: { issue: { projectItems: { nodes: [] } } } });

    const assembler = new DirectLookupAssembler(
      gh,
      new ResultNormalizer(config),
      config,
    );

    const output = await assembler.assemble(
      { kind: "direct_lookup", keys: ["999999"] },
      {
        scope: "all",
        keys: ["999999"],
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
      },
    );

    assertEquals(output.items.length, 0);
    assertEquals(output.totalCount, 0);
  },
});
