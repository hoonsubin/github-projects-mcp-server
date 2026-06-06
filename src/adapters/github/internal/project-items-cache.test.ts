// Session cache for full-board project item fetches.

import { assertEquals } from "@std/assert";
import { ProjectItemsCache } from "./project-items-cache.ts";
import { createGhSpy, makeCtx } from "./_test_utils.ts";
import { FIXTURE_PAGE_1, FIXTURE_PAGE_2 } from "./_test_fixtures.ts";

const ctx = (gh: ReturnType<typeof createGhSpy>) =>
  makeCtx(gh, { ghConfig: { owner_type: "user" } });

Deno.test("ProjectItemsCache - deduplicates concurrent aggregate fetches", async () => {
  const gh = createGhSpy();
  gh.enqueue(FIXTURE_PAGE_1);
  gh.enqueue(FIXTURE_PAGE_2);

  const cache = new ProjectItemsCache(ctx(gh));
  const [first, second] = await Promise.all([
    cache.getOrFetchAggregateItems(),
    cache.getOrFetchAggregateItems(),
  ]);

  assertEquals(first.length, second.length);
  assertEquals(gh.graphqlCalls.length, 2);
});

Deno.test("ProjectItemsCache - aggregate is projected from full without second fetch", async () => {
  const gh = createGhSpy();
  gh.enqueue(FIXTURE_PAGE_1);
  gh.enqueue(FIXTURE_PAGE_2);

  const cache = new ProjectItemsCache(ctx(gh));
  await cache.getOrFetchAllItems();
  await cache.getOrFetchAggregateItems();

  assertEquals(gh.graphqlCalls.length, 2);
});

Deno.test("ProjectItemsCache - returns cached aggregate items without refetch", async () => {
  const gh = createGhSpy();
  gh.enqueue(FIXTURE_PAGE_1);
  gh.enqueue(FIXTURE_PAGE_2);

  const cache = new ProjectItemsCache(ctx(gh));
  await cache.getOrFetchAggregateItems();
  await cache.getOrFetchAggregateItems();

  assertEquals(gh.graphqlCalls.length, 2);
});

Deno.test("ProjectItemsCache - invalidate clears both profiles", async () => {
  const gh = createGhSpy();
  gh.enqueue(FIXTURE_PAGE_1);
  gh.enqueue(FIXTURE_PAGE_2);
  gh.enqueue(FIXTURE_PAGE_1);
  gh.enqueue(FIXTURE_PAGE_2);

  const cache = new ProjectItemsCache(ctx(gh));
  await cache.getOrFetchAggregateItems();
  cache.invalidate();
  await cache.getOrFetchAggregateItems();

  assertEquals(gh.graphqlCalls.length, 4);
});
