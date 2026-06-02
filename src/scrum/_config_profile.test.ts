// =============================================================================
// src/scrum/_config_profile.test.ts - Smoke tests for Phase 0 test infrastructure
// =============================================================================

import { assertEquals, assertExists } from "@std/assert";
import {
  committedConfigProfilePromise,
  committedFakeBackendPromise,
  committedScrumConfigPromise,
} from "./_test_utils.ts";
import { deriveConfigProfile } from "./_config_profile.ts";
import { handleFindItems, handleOrient } from "../tools/scrum-read.ts";
import { parseToolText } from "../tools/_mcp_result.ts";
import { ItemSearchResultSchema, OrientResultSchema } from "../schemas/scrum-outputs.ts";
import { formatZodError } from "../tools/_mcp_result.ts";
import { assertFindItemsMatchesConfig, assertOrientMatchesConfig } from "./_contract_assertions.ts";
import type { ItemSearchResult, OrientResult } from "../domain/types.ts";

Deno.test("Phase 0: committed config loads and derives profile", async () => {
  const boot = await committedScrumConfigPromise;
  const profile = deriveConfigProfile(boot);

  assertExists(profile.statusDisplay.in_progress);
  assertEquals(profile.expectedVelocityWindow, boot.scrumConfig.scrum.sprint?.velocity_window ?? 5);
  assertEquals(
    profile.expectedStoryPointValues,
    boot.scrumConfig.scrum.sprint?.story_point_values ?? null,
  );
});

Deno.test("Phase 0: config-shaped fake backend → orient handler → contract", async () => {
  const boot = await committedScrumConfigPromise;
  const profile = await committedConfigProfilePromise;
  const backend = await committedFakeBackendPromise;

  const result = await handleOrient(backend, boot.scrumConfig);
  const payload = parseToolText<OrientResult>(result);

  const parsed = OrientResultSchema.safeParse(payload);
  if (!parsed.success) {
    throw new Error(formatZodError(parsed.error));
  }

  assertOrientMatchesConfig(payload, profile);
});

Deno.test("Phase 0: config-shaped fake backend → findItems handler → contract", async () => {
  const profile = await committedConfigProfilePromise;
  const backend = await committedFakeBackendPromise;

  const result = await handleFindItems(backend, {
    scope: "all",
    include_dependencies: false,
    limit: 50,
  });
  const payload = parseToolText<ItemSearchResult>(result);

  const parsed = ItemSearchResultSchema.safeParse(payload);
  if (!parsed.success) {
    throw new Error(formatZodError(parsed.error));
  }

  assertFindItemsMatchesConfig(payload, profile);
  assertEquals(payload.total_count, payload.items.length);
});
