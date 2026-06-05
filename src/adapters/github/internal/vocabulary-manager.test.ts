import { assertEquals, assertStringIncludes } from "@std/assert";
import { VocabularyManager } from "./vocabulary-manager.ts";
import { LabelResolver } from "./label-resolver.ts";
import { createGhSpy, makeCtx } from "./_test_utils.ts";

const createManager = (configOverrides?: Parameters<typeof makeCtx>[1]) => {
  const gh = createGhSpy();
  const ctx = makeCtx(gh, configOverrides);
  const labelResolver = new LabelResolver(ctx);
  const manager = new VocabularyManager(ctx, labelResolver);
  return { manager, gh, ctx };
};

Deno.test("addVocabulary - adds project board status option when field is not issue-backed", async () => {
  const { manager, gh } = createManager();
  gh.enqueue({ node: { options: [{ id: "opt1", name: "Done", color: "GREEN", description: "" }] } });
  gh.enqueue({ updateProjectV2Field: { projectV2Field: { id: "PVTF_status" } } });

  const result = await manager.addVocabulary("status_option", "New Status");

  assertEquals(result, { created: true });
  assertStringIncludes(gh.graphqlCalls[1].queryExcerpt, "UpdateField");
});

Deno.test("addVocabulary - adds org issue field option when status is issue-backed", async () => {
  const baseConfig = makeCtx(createGhSpy()).config;
  const { manager, gh, ctx } = createManager({
    live: {
      ...baseConfig.live,
      issueBackedFields: {
        "PVTF_status": { orgFieldId: "IF_status", options: { Done: "IFSO_done" } },
      },
    },
  });

  gh.enqueue({ node: { options: [{ id: "IFSO_done", name: "Done", color: "GREEN" }] } });
  gh.enqueue({
    updateIssueField: {
      issueField: {
        options: [
          { id: "IFSO_done", name: "Done", color: "GREEN" },
          { id: "IFSO_new", name: "New Status", color: "GRAY" },
        ],
      },
    },
  });

  const result = await manager.addVocabulary("status_option", "New Status");

  assertEquals(result, { created: true });
  assertStringIncludes(gh.graphqlCalls[1].queryExcerpt, "UpdateOrgIssueFieldCatalog");
  assertEquals(ctx.config.live.issueBackedFields["PVTF_status"]?.options?.["New Status"], "IFSO_new");
  assertEquals(ctx.config.live.statusOptions["New Status"], "IFSO_new");
});

Deno.test("addVocabulary - issue-backed option add is idempotent", async () => {
  const baseConfig = makeCtx(createGhSpy()).config;
  const { manager, gh } = createManager({
    live: {
      ...baseConfig.live,
      issueBackedFields: {
        "PVTF_status": { orgFieldId: "IF_status", options: { Done: "IFSO_done" } },
      },
    },
  });

  gh.enqueue({ node: { options: [{ id: "IFSO_done", name: "Done", color: "GREEN" }] } });

  const result = await manager.addVocabulary("status_option", "Done");

  assertEquals(result, { created: false });
  assertEquals(gh.graphqlCalls.length, 1);
});
