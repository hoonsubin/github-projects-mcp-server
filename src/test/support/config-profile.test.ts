// =============================================================================
// src/test/support/config-profile.test.ts - committed config boot smoke test
// =============================================================================

import { assertEquals, assertExists } from "@std/assert";
import { committedScrumConfigPromise } from "./scrum-test-utils.ts";
import { deriveConfigProfile } from "./config-profile.ts";

Deno.test("committed config loads and derives profile", async () => {
  const boot = await committedScrumConfigPromise;
  const profile = deriveConfigProfile(boot);

  assertExists(profile.statusDisplay.in_progress);
  assertEquals(profile.expectedVelocityWindow, boot.scrumConfig.scrum.sprint?.velocity_window ?? 5);
  assertEquals(
    profile.expectedStoryPointValues,
    boot.scrumConfig.scrum.sprint?.story_point_values ?? null,
  );
});
