// Session cache for full-board project item fetches.

import { assertEquals } from "@std/assert";
import { ProjectItemsCache } from "./project-items-cache.ts";
import { createGhSpy, makeCtx } from "./_test_utils.ts";
import p1Fixture from "../generated/__fixtures__/project-items-p1.json" with { type: "json" };
import p2Fixture from "../generated/__fixtures__/project-items-p2.json" with { type: "json" };

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

const ctx = (gh: ReturnType<typeof createGhSpy>) =>
  makeCtx(gh, { ghConfig: { owner_type: "user" } });

Deno.test("ProjectItemsCache - deduplicates concurrent aggregate fetches", async () => {
  const gh = createGhSpy();
  gh.enqueue(p1Fixture as ItemsPage);
  gh.enqueue(p2Fixture as ItemsPage);

  const cache = new ProjectItemsCache(ctx(gh));
  const [first, second] = await Promise.all([
    cache.getOrFetchAggregateItems(),
    cache.getOrFetchAggregateItems(),
  ]);

  assertEquals(first.length, second.length);
  assertEquals(gh.graphqlCalls.length, 2);
});

Deno.test("ProjectItemsCache - aggregate and full profiles use separate caches", async () => {
  const gh = createGhSpy();
  gh.enqueue(p1Fixture as ItemsPage);
  gh.enqueue(p2Fixture as ItemsPage);
  gh.enqueue(p1Fixture as ItemsPage);
  gh.enqueue(p2Fixture as ItemsPage);

  const cache = new ProjectItemsCache(ctx(gh));
  await cache.getOrFetchAggregateItems();
  await cache.getOrFetchAllItems();

  assertEquals(gh.graphqlCalls.length, 4);
});

Deno.test("ProjectItemsCache - returns cached aggregate items without refetch", async () => {
  const gh = createGhSpy();
  gh.enqueue(p1Fixture as ItemsPage);
  gh.enqueue(p2Fixture as ItemsPage);

  const cache = new ProjectItemsCache(ctx(gh));
  await cache.getOrFetchAggregateItems();
  await cache.getOrFetchAggregateItems();

  assertEquals(gh.graphqlCalls.length, 2);
});

Deno.test("ProjectItemsCache - invalidate clears both profiles", async () => {
  const gh = createGhSpy();
  gh.enqueue(p1Fixture as ItemsPage);
  gh.enqueue(p2Fixture as ItemsPage);
  gh.enqueue(p1Fixture as ItemsPage);
  gh.enqueue(p2Fixture as ItemsPage);

  const cache = new ProjectItemsCache(ctx(gh));
  await cache.getOrFetchAggregateItems();
  cache.invalidate();
  await cache.getOrFetchAggregateItems();

  assertEquals(gh.graphqlCalls.length, 4);
});
