// Session cache for full-board project item fetches.

import { assertEquals } from "@std/assert";
import { ProjectItemsCache } from "./project-items-cache.ts";
import { createGhSpy, makeCtx } from "./_test_utils.ts";
import p1Fixture from "./__fixtures__/project-items-p1.json" with { type: "json" };
import p2Fixture from "./__fixtures__/project-items-p2.json" with { type: "json" };

type ItemsPage = {
  user: {
    projectV2: {
      items: {
        totalCount: number;
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: unknown[];
      };
    };
  };
};

Deno.test("ProjectItemsCache - deduplicates concurrent getOrFetchAllItems calls", async () => {
  const gh = createGhSpy();
  gh.enqueue(p1Fixture as ItemsPage);
  gh.enqueue(p2Fixture as ItemsPage);

  const cache = new ProjectItemsCache(
    makeCtx(gh, { ghConfig: { owner_type: "user" } }),
  );
  const [first, second] = await Promise.all([
    cache.getOrFetchAllItems(),
    cache.getOrFetchAllItems(),
  ]);

  assertEquals(first.length, second.length);
  assertEquals(gh.graphqlCalls.length, 2);
});

Deno.test("ProjectItemsCache - returns cached items without refetch", async () => {
  const gh = createGhSpy();
  gh.enqueue(p1Fixture as ItemsPage);
  gh.enqueue(p2Fixture as ItemsPage);

  const cache = new ProjectItemsCache(
    makeCtx(gh, { ghConfig: { owner_type: "user" } }),
  );
  await cache.getOrFetchAllItems();
  await cache.getOrFetchAllItems();

  assertEquals(gh.graphqlCalls.length, 2);
});

Deno.test("ProjectItemsCache - invalidate forces a new fetch", async () => {
  const gh = createGhSpy();
  gh.enqueue(p1Fixture as ItemsPage);
  gh.enqueue(p2Fixture as ItemsPage);
  gh.enqueue(p1Fixture as ItemsPage);
  gh.enqueue(p2Fixture as ItemsPage);

  const cache = new ProjectItemsCache(
    makeCtx(gh, { ghConfig: { owner_type: "user" } }),
  );
  await cache.getOrFetchAllItems();
  cache.invalidate();
  await cache.getOrFetchAllItems();

  assertEquals(gh.graphqlCalls.length, 4);
});
