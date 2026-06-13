// =============================================================================
// Tool-surface tests against real captured port responses (Tier 2 fixtures).
// =============================================================================

import { assertEquals, assertExists } from "@std/assert";
import { CAPTURED } from "@test/fixtures/port/index.ts";
import {
  capturedBackendPromise,
  committedScrumConfigPromise,
  testSessionCache,
} from "../support/scrum-test-utils.ts";
import { assertHandlerSchema } from "../support/handler-assertions.ts";
import { ItemSearchResultSchema, OrientResultSchema } from "../../schemas/scrum-outputs.ts";
import { handleFindItems, handleOrient } from "../../tools/scrum-read.ts";

Deno.test("scrum_orient - captured board data schema", async () => {
  const boot = await committedScrumConfigPromise;
  const backend = await capturedBackendPromise;

  const payload = assertHandlerSchema(
    await handleOrient(backend, boot.scrumConfig, testSessionCache()),
    OrientResultSchema,
    "scrum_orient (captured)",
  );
  assertExists(payload.platform_state.iterations.active);
});

Deno.test("scrum_find_items - captured board data schema", async () => {
  const backend = await capturedBackendPromise;
  const captured = CAPTURED.profiles["config"].findItems;

  const payload = assertHandlerSchema(
    await handleFindItems(backend, { include_dependencies: false, limit: 50, fields: "full" }),
    ItemSearchResultSchema,
    "scrum_find_items (captured)",
  );
  assertEquals(payload.total_count, captured.total_count);
  assertEquals(payload.items.length > 0, true);
});
