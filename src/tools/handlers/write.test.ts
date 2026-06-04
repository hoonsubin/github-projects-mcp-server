// =============================================================================
// src/tools/handlers/write.test.ts
// =============================================================================

import { assertEquals } from "@std/assert";
import { toCreateStoryInput } from "./write.ts";

Deno.test("toCreateStoryInput - maps story_points to storyPoints", () => {
  const input = toCreateStoryInput({
    title: "T",
    body: "B",
    type: "feature",
    story_points: 5,
  });
  assertEquals(input.storyPoints, 5);
  assertEquals("story_points" in input, false);
});
