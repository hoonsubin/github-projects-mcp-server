import { assertEquals } from "@std/assert";
import {
  extractLinkedPullRequestsFromFieldValues,
  mergeLinkedArtifacts,
  pullRequestNodesToLinkedArtifacts,
} from "./linked-pull-requests.ts";
import type { ItemFieldValue } from "./types.ts";

Deno.test("pullRequestNodesToLinkedArtifacts - maps PR nodes", () => {
  const linked = pullRequestNodesToLinkedArtifacts([
    { number: 12, title: "Fix bug", url: "https://github.com/o/r/pull/12", state: "OPEN", isDraft: false },
    null,
  ]);
  assertEquals(linked.length, 1);
  assertEquals(linked[0]?.number, 12);
  assertEquals(linked[0]?.is_draft, false);
});

Deno.test("extractLinkedPullRequestsFromFieldValues - reads Pull requests column", () => {
  const fieldValues: ItemFieldValue[] = [{
    __typename: "ProjectV2ItemFieldPullRequestValue",
    field: { id: "PVTF_pr", name: "Pull requests" },
    pullRequests: {
      nodes: [{
        number: 7,
        title: "Delivery PR",
        url: "https://github.com/o/r/pull/7",
        state: "MERGED",
        isDraft: false,
      }],
    },
  }];
  const linked = extractLinkedPullRequestsFromFieldValues(fieldValues);
  assertEquals(linked.length, 1);
  assertEquals(linked[0]?.state, "MERGED");
});

Deno.test("mergeLinkedArtifacts - deduplicates by PR number", () => {
  const artifact = {
    number: 3,
    title: "Same PR",
    url: "https://github.com/o/r/pull/3",
    state: "OPEN",
    is_draft: false,
  };
  const merged = mergeLinkedArtifacts([artifact], [artifact]);
  assertEquals(merged?.length, 1);
});
