// =============================================================================
// Bridge tests — fixture replay backend through tool handlers
// =============================================================================

import { assertEquals } from "@std/assert";
import { dirname, fromFileUrl, resolve } from "@std/path";
import {
  committedConfigProfilePromise,
  committedFixtureBackendPromise,
  committedScrumConfigPromise,
} from "../support/scrum-test-utils.ts";
import {
  assertFindItemsMatchesConfig,
  assertOrientMatchesConfig,
} from "../support/contract-assertions.ts";
import type { ItemSearchResult, OrientResult } from "../../domain/types.ts";
import { loadFixtureManifest } from "../../adapters/github/internal/fixture-replay/load-manifest.ts";
import { ItemSearchResultSchema, OrientResultSchema } from "../../schemas/scrum-outputs.ts";
import { assertHandlerSchema, parseHandlerPayload } from "./contract-test-utils.ts";
import { normalizeSnapshot } from "../../tools/_snapshot_normalize.ts";
import { handleFindItems, handleOrient } from "../../tools/scrum-read.ts";

const FIXTURES_DIR = resolve(
  dirname(fromFileUrl(import.meta.url)),
  "../../adapters/github/generated/__fixtures__",
);

Deno.test("bridge: fixture replay orient + find_items pass schema and config contracts", async () => {
  await loadFixtureManifest(FIXTURES_DIR);

  const boot = await committedScrumConfigPromise;
  const profile = await committedConfigProfilePromise;
  const backend = await committedFixtureBackendPromise;

  const orientPayload = assertHandlerSchema(
    await handleOrient(backend, boot.scrumConfig),
    OrientResultSchema,
    "bridge scrum_orient",
  );
  assertOrientMatchesConfig(orientPayload as OrientResult, profile);

  const findPayload = assertHandlerSchema(
    await handleFindItems(backend, { scope: "all", include_dependencies: false, limit: 50 }),
    ItemSearchResultSchema,
    "bridge scrum_find_items",
  );
  assertFindItemsMatchesConfig(findPayload as ItemSearchResult, profile);
  assertEquals(findPayload.items.length > 0, true);
});

Deno.test("bridge: orient handler matches captured scenario snapshot when present", async () => {
  const scenarioPath = resolve(FIXTURES_DIR, "scenarios/orient/handler-output.json");
  try {
    await Deno.stat(scenarioPath);
  } catch {
    return;
  }

  const boot = await committedScrumConfigPromise;
  const backend = await committedFixtureBackendPromise;
  const actual = normalizeSnapshot(
    parseHandlerPayload(await handleOrient(backend, boot.scrumConfig)),
  );
  const expected = normalizeSnapshot(JSON.parse(await Deno.readTextFile(scenarioPath)));

  assertEquals(actual, expected);
});
