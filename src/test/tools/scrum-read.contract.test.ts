// =============================================================================
// Tool-surface contract tests - scrum_* read handlers
// =============================================================================

import { assertEquals, assertExists } from "@std/assert";
import {
  committedConfigProfilePromise,
  committedFakeBackendPromise,
  committedScrumConfigPromise,
  testSessionCache,
} from "../support/scrum-test-utils.ts";
import {
  assertFindItemsMatchesConfig,
  assertOrientMatchesConfig,
} from "../support/contract-assertions.ts";
import type { ItemSearchResult, OrientResult } from "../../domain/types.ts";
import {
  ItemDetailResultSchema,
  ItemSearchResultSchema,
  OrientResultSchema,
  SprintRawDataSchema,
} from "../../schemas/scrum-outputs.ts";
import { assertHandlerSchema } from "../support/handler-assertions.ts";
import {
  handleFindItems,
  handleGetItemDetail,
  handleGetSprintData,
  handleOrient,
} from "../../tools/scrum-read.ts";

Deno.test("scrum_orient - happy path schema + config contract", async () => {
  const boot = await committedScrumConfigPromise;
  const profile = await committedConfigProfilePromise;
  const backend = await committedFakeBackendPromise;
  const cache = testSessionCache();

  const payload = assertHandlerSchema(
    await handleOrient(backend, boot.scrumConfig, cache, { detail: "full", refresh: true }),
    OrientResultSchema,
    "scrum_orient",
  );
  assertOrientMatchesConfig(payload as OrientResult, profile);
  assertExists(payload.platform_state.iterations.active);
});

Deno.test("scrum_orient - session cache skips reload on repeat", async () => {
  const boot = await committedScrumConfigPromise;
  const backend = await committedFakeBackendPromise;
  const cache = testSessionCache();

  await handleOrient(backend, boot.scrumConfig, cache);
  const originalReloadMetadata = backend.reloadMetadata.bind(backend);
  let metadataReloads = 0;
  backend.reloadMetadata = () => {
    metadataReloads++;
    return originalReloadMetadata();
  };

  await handleOrient(backend, boot.scrumConfig, cache, { detail: "session", refresh: false });
  assertEquals(metadataReloads, 0);

  await handleOrient(backend, boot.scrumConfig, cache, { detail: "session", refresh: true });
  assertEquals(metadataReloads >= 1, true);
});

Deno.test("scrum_find_items - happy path schema + config contract", async () => {
  const profile = await committedConfigProfilePromise;
  const backend = await committedFakeBackendPromise;

  const payload = assertHandlerSchema(
    await handleFindItems(backend, { include_dependencies: false, limit: 50 }),
    ItemSearchResultSchema,
    "scrum_find_items",
  );
  assertFindItemsMatchesConfig(payload as ItemSearchResult, profile);
  assertEquals(payload.total_count >= payload.items.length, true);
});

Deno.test("scrum_find_items - include_dependencies variant", async () => {
  const backend = await committedFakeBackendPromise;

  const payload = assertHandlerSchema(
    await handleFindItems(backend, { include_dependencies: true, limit: 10 }),
    ItemSearchResultSchema,
    "scrum_find_items (deps)",
  );
  assertEquals(payload.dependency_map !== null, true);
  assertEquals(Array.isArray(payload.dependency_map), true);
});

Deno.test("scrum_get_item_detail - happy path schema", async () => {
  const backend = await committedFakeBackendPromise;
  const listing = (await backend.findItems({
    scope: "all",
    keys: [],
    search: "",
    types: [],
    statuses: [],
    priority: "",
    epic_id: "",
    labels: [],
    assignee: "",
    estimated: undefined,
    has_blockers: undefined,
    sprint_ref: null,
    include_dependencies: false,
    fields: "full",
    limit: 1,
  })).value!.items[0];

  const payload = assertHandlerSchema(
    await handleGetItemDetail(backend, { ref: { id: listing.ref.id }, detail: "dor" }),
    ItemDetailResultSchema,
    "scrum_get_item_detail",
  );
  assertEquals(payload.story.ref.id, listing.ref.id);
});

Deno.test("scrum_get_sprint_data - happy path schema", async () => {
  const boot = await committedScrumConfigPromise;
  const backend = await committedFakeBackendPromise;

  const payload = assertHandlerSchema(
    await handleGetSprintData(backend, boot.scrumConfig, { sprint: "current" }),
    SprintRawDataSchema,
    "scrum_get_sprint_data",
  );
  assertEquals(payload.sprint!.name, "Sprint 1");
  assertEquals(typeof payload.sprint!.id, "string");
  assertEquals(typeof payload.sprint!.duration_days, "number");
  assertExists(payload.summary);
  assertEquals(typeof payload.summary!.total_count, "number");

  const itemsPayload = assertHandlerSchema(
    await handleGetSprintData(backend, boot.scrumConfig, { sprint: "current", view: "items" }),
    SprintRawDataSchema,
    "scrum_get_sprint_data items",
  );
  assertEquals(Array.isArray(itemsPayload.items), true);
  assertEquals(itemsPayload.items!.length > 0, true);
  const item = itemsPayload.items![0];
  assertEquals(typeof item.id, "string");
  assertEquals(typeof item.number, "number");
  assertEquals(typeof item.title, "string");
  assertEquals(typeof item.has_assignee, "boolean");
  assertEquals(typeof item.has_blockers, "boolean");
  assertEquals(typeof item.story_points, "number");
});

Deno.test("scrum_get_sprint_data - config contract", async () => {
  const profile = await committedConfigProfilePromise;
  const boot = await committedScrumConfigPromise;
  const backend = await committedFakeBackendPromise;

  const payload = assertHandlerSchema(
    await handleGetSprintData(backend, boot.scrumConfig, { sprint: "current", view: "items" }),
    SprintRawDataSchema,
    "scrum_get_sprint_data (contract)",
  );

  assertEquals(payload.sprint!.name.length > 0, true);

  const allowedStatuses = new Set(Object.values(profile.statusDisplay));
  const allowedTypes = new Set(Object.keys(profile.typeDisplay));

  for (const item of payload.items ?? []) {
    if (item.status !== null) {
      assertEquals(
        allowedStatuses.has(item.status),
        true,
        `status "${item.status}" must be a config display value`,
      );
    }
    if (typeof item.type === "string") {
      assertEquals(
        allowedTypes.has(item.type),
        true,
        `type "${item.type}" must be a config type key`,
      );
    }
  }
});

Deno.test("scrum_get_sprint_data - null sprint returns empty items", async () => {
  const boot = await committedScrumConfigPromise;
  const backend = await committedFakeBackendPromise;

  const payload = assertHandlerSchema(
    await handleGetSprintData(backend, boot.scrumConfig, { sprint: null }),
    SprintRawDataSchema,
    "scrum_get_sprint_data (null)",
  );
  assertEquals(payload.sprint, null);
  assertEquals(payload.summary, null);
  assertEquals(payload.items?.length ?? 0, 0);
});
