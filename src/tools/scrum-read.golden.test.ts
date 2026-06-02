// =============================================================================
// Golden snapshot tests — stable agent-visible JSON from config-shaped fake backend
// =============================================================================

import { assertSnapshot } from "@std/testing/snapshot";
import { committedFakeBackendPromise, committedScrumConfigPromise } from "../scrum/_test_utils.ts";
import { normalizeSnapshot } from "./_snapshot_normalize.ts";
import { parseHandlerPayload } from "./_contract_test_utils.ts";
import { handleFindItems, handleOrient } from "./scrum-read.ts";

Deno.test("golden: scrum_orient handler output", async (t) => {
  const boot = await committedScrumConfigPromise;
  const backend = await committedFakeBackendPromise;

  const payload = normalizeSnapshot(
    parseHandlerPayload(await handleOrient(backend, boot.scrumConfig)),
  );
  await assertSnapshot(t, JSON.stringify(payload, null, 2));
});

Deno.test("golden: scrum_find_items handler output", async (t) => {
  const backend = await committedFakeBackendPromise;

  const payload = normalizeSnapshot(
    parseHandlerPayload(
      await handleFindItems(backend, { scope: "all", include_dependencies: false, limit: 50 }),
    ),
  );
  await assertSnapshot(t, JSON.stringify(payload, null, 2));
});
