// =============================================================================
// Golden snapshot tests - stable agent-visible JSON from config-shaped fake backend
// =============================================================================

import { assertSnapshot } from "@std/testing/snapshot";
import {
  committedFakeBackendPromise,
  committedScrumConfigPromise,
  testSessionCache,
} from "../support/scrum-test-utils.ts";
import { normalizeSnapshot } from "../../tools/_snapshot_normalize.ts";
import { parseHandlerPayload } from "../support/handler-assertions.ts";
import { handleFindItems, handleGetSprintData, handleOrient } from "../../tools/scrum-read.ts";

Deno.test("golden: scrum_orient handler output", async (t) => {
  const boot = await committedScrumConfigPromise;
  const backend = await committedFakeBackendPromise;

  const payload = normalizeSnapshot(
    parseHandlerPayload(await handleOrient(backend, boot.scrumConfig, testSessionCache())),
  );
  await assertSnapshot(t, JSON.stringify(payload, null, 2));
});

Deno.test("golden: scrum_get_sprint_data handler output", async (t) => {
  const boot = await committedScrumConfigPromise;
  const backend = await committedFakeBackendPromise;

  const payload = normalizeSnapshot(
    parseHandlerPayload(
      await handleGetSprintData(backend, boot.scrumConfig, { sprint: "current" }),
    ),
  );
  await assertSnapshot(t, JSON.stringify(payload, null, 2));
});

Deno.test("golden: scrum_find_items handler output", async (t) => {
  const backend = await committedFakeBackendPromise;

  const payload = normalizeSnapshot(
    parseHandlerPayload(
      await handleFindItems(backend, { include_dependencies: false, limit: 50 }),
    ),
  );
  await assertSnapshot(t, JSON.stringify(payload, null, 2));
});
