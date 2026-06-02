// Tests for targeted issue-number → project item resolution.

import { assertEquals, assertRejects } from "@std/assert";
import { GitHubApiError } from "../errors.ts";
import {
  fetchProjectItemIdByIssueNumber,
  resolveProjectItemIdByIssueNumber,
} from "./resolve-issue-number.ts";
import { createGhSpy, makeConfig } from "./_test_utils.ts";

const GH_CONFIG = {
  ...makeConfig().ghConfig,
  project_number: 1,
  tracked_repos: ["repo-a", "repo-b"],
};

Deno.test("resolveProjectItemIdByIssueNumber - returns item id from first matching repo", async () => {
  const gh = createGhSpy();
  gh.enqueue({
    repository: {
      issue: {
        projectItems: {
          nodes: [
            {
              id: "PVTI_1",
              type: "ISSUE",
              createdAt: "",
              updatedAt: "",
              isArchived: false,
              project: { number: 99 },
            },
            {
              id: "PVTI_target",
              type: "ISSUE",
              createdAt: "",
              updatedAt: "",
              isArchived: false,
              project: { number: 1 },
            },
          ],
        },
      },
    },
  });

  const id = await resolveProjectItemIdByIssueNumber(gh, GH_CONFIG, 42);
  assertEquals(id, "PVTI_target");
  assertEquals(gh.graphqlCalls.length, 1);
});

Deno.test("fetchProjectItemIdByIssueNumber - tries next repo when first has no match", async () => {
  const gh = createGhSpy();
  gh.enqueue({ repository: { issue: { projectItems: { nodes: [] } } } });
  gh.enqueue({
    repository: {
      issue: {
        projectItems: {
          nodes: [{
            id: "PVTI_from_b",
            type: "ISSUE",
            createdAt: "",
            updatedAt: "",
            isArchived: false,
            project: { number: 1 },
          }],
        },
      },
    },
  });

  const id = await fetchProjectItemIdByIssueNumber(gh, GH_CONFIG, 7);
  assertEquals(id, "PVTI_from_b");
  assertEquals(gh.graphqlCalls.length, 2);
});

Deno.test("resolveProjectItemIdByIssueNumber - throws NOT_FOUND when not on board", async () => {
  const gh = createGhSpy();
  gh.enqueue({ repository: { issue: { projectItems: { nodes: [] } } } });
  gh.enqueue({ repository: { issue: { projectItems: { nodes: [] } } } });

  const err = await assertRejects(
    () => resolveProjectItemIdByIssueNumber(gh, GH_CONFIG, 999),
    GitHubApiError,
  );
  assertEquals(err.code, "NOT_FOUND");
});
