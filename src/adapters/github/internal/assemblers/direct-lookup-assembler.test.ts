// =============================================================================
// src/adapters/github/internal/assemblers/direct-lookup-assembler.test.ts
//
// Direct lookup path: targeted GetIssueProjectItem queries without board scan.
// =============================================================================

import { assertEquals, assertExists } from "@std/assert";
import { DirectLookupAssembler } from "./direct-lookup-assembler.ts";
import { ResultNormalizer } from "../result-normalizer.ts";
import { createGhSpy, makeConfig } from "../_test_utils.ts";
import p1Fixture from "../../generated/__fixtures__/project-items-p1.json" with { type: "json" };

const sampleItem = (p1Fixture as {
  user: {
    projectV2: {
      items: {
        nodes: Array<{
          id: string;
          content?: { number?: number; title?: string };
        }>;
      };
    };
  };
}).user.projectV2.items.nodes.find(
  (n) => n.content?.number !== undefined,
);

Deno.test({
  name: "DirectLookupAssembler - fetches keyed item without board scan",
  async fn() {
    if (!sampleItem?.content?.number) return;

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
              ...sampleItem,
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
      { kind: "direct_lookup", keys: [String(sampleItem.content.number)] },
      {
        scope: "all",
        keys: [String(sampleItem.content.number)],
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
    assertEquals(output.items[0].ref.key, String(sampleItem.content.number));
    assertExists(output.items[0].custom_fields?.["__typename"]);
    assertEquals(gh.graphqlCalls.length, 1);
    assertEquals(gh.graphqlCalls[0].variables.number, sampleItem.content.number);
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
