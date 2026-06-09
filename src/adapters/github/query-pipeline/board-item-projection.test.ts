import { assertEquals } from "@std/assert";
import { projectItemsToAggregateView } from "./board-item-projection.ts";
import type { ProjectItem } from "../types.ts";

Deno.test("projectItemsToAggregateView - strips Issue labels and keeps core fields", () => {
  const item = {
    id: "PVTI_1",
    type: "ISSUE",
    fieldValues: { nodes: [] },
    content: {
      __typename: "Issue" as const,
      id: "I_1",
      number: 42,
      title: "T",
      body: "B",
      state: "OPEN",
      issueType: { id: "t1", name: "Story" },
      assignees: { nodes: [{ login: "octocat" }] },
      labels: { nodes: [{ name: "bug", color: "red" }] },
    },
  } as unknown as ProjectItem;

  const [projected] = projectItemsToAggregateView([item]);
  const content = projected.content;
  assertEquals(content?.__typename, "Issue");
  if (content?.__typename === "Issue") {
    assertEquals(content.number, 42);
    assertEquals("assignees" in content, false);
    assertEquals("labels" in content, false);
  }
});
