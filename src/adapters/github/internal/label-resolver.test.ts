// Session cache for repo label fetches.

import { assertEquals } from "@std/assert";
import { LabelResolver } from "./label-resolver.ts";
import { createGhSpy, makeCtx } from "./_test_utils.ts";

const LABELS_RESPONSE = {
  repository: {
    labels: {
      nodes: [
        { id: "L1", name: "bug", color: "ff0000", description: "" },
        { id: "L2", name: "feature", color: "00ff00", description: "" },
      ],
    },
  },
};

Deno.test("LabelResolver - fetchAllLabels uses session cache across resolve calls", async () => {
  const gh = createGhSpy();
  gh.enqueue(LABELS_RESPONSE);

  const resolver = new LabelResolver(makeCtx(gh));
  const first = await resolver.resolveExistingLabelNodeIds(["bug"]);
  const second = await resolver.resolveExistingLabelNodeIds(["feature"]);

  assertEquals(first, ["L1"]);
  assertEquals(second, ["L2"]);
  assertEquals(gh.graphqlCalls.length, 1);
});

Deno.test("LabelResolver - invalidateLabelCache forces a refetch", async () => {
  const gh = createGhSpy();
  gh.enqueue(LABELS_RESPONSE);
  gh.enqueue(LABELS_RESPONSE);

  const resolver = new LabelResolver(makeCtx(gh));
  await resolver.auditTypeLabels();
  resolver.invalidateLabelCache();
  await resolver.auditTypeLabels();

  assertEquals(gh.graphqlCalls.length, 2);
});
