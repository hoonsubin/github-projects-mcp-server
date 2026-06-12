// =============================================================================
// src/scrum/find-items-intent.test.ts
// =============================================================================

import { assertEquals, assertThrows } from "@std/assert";
import {
  applyFindItemsIntent,
  normalizeFindItemsInput,
} from "./find-items-intent.ts";

Deno.test("normalizeFindItemsInput - coerces unscoped include_dependencies", () => {
  const { filter, hints } = normalizeFindItemsInput({ include_dependencies: true });
  assertEquals(filter.intent, undefined);
  assertEquals(filter.sprint, "current");
  assertEquals(filter.include_dependencies, true);
  assertEquals(hints.length, 1);
});

Deno.test("applyFindItemsIntent - blocked_items defaults", () => {
  const filter = applyFindItemsIntent({ intent: "blocked_items" });
  assertEquals(filter.sprint, "current");
  assertEquals(filter.has_blockers, true);
  assertEquals(filter.include_dependencies, true);
  assertEquals(filter.fields, "standard");
});

Deno.test('applyFindItemsIntent - by_keys requires keys', () => {
  assertThrows(
    () => applyFindItemsIntent({ intent: "by_keys" }),
    Error,
    'intent "by_keys" requires a non-empty keys array.',
  );
});
