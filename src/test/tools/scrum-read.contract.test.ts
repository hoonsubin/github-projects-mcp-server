// =============================================================================
// Tool-surface contract tests - scrum_* read handlers
// =============================================================================

import { assertEquals, assertExists } from "@std/assert";
import {
  committedConfigProfilePromise,
  committedFakeBackendPromise,
  committedScrumConfigPromise,
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

  const payload = assertHandlerSchema(
    await handleOrient(backend, boot.scrumConfig),
    OrientResultSchema,
    "scrum_orient",
  );
  assertOrientMatchesConfig(payload as OrientResult, profile);
  assertExists(payload.platform_state.iterations.active);
});

Deno.test("scrum_find_items - happy path schema + config contract", async () => {
  const profile = await committedConfigProfilePromise;
  const backend = await committedFakeBackendPromise;

  const payload = assertHandlerSchema(
    await handleFindItems(backend, { scope: "all", include_dependencies: false, limit: 50 }),
    ItemSearchResultSchema,
    "scrum_find_items",
  );
  assertFindItemsMatchesConfig(payload as ItemSearchResult, profile);
  assertEquals(payload.total_count >= payload.items.length, true);
});

Deno.test("scrum_find_items - include_dependencies variant", async () => {
  const backend = await committedFakeBackendPromise;

  const payload = assertHandlerSchema(
    await handleFindItems(backend, { scope: "all", include_dependencies: true, limit: 10 }),
    ItemSearchResultSchema,
    "scrum_find_items (deps)",
  );
  assertEquals(payload.dependency_map !== null, true);
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
    sprint_ref: null,
    include_dependencies: false,
    limit: 1,
  })).value!.items[0];

  const payload = assertHandlerSchema(
    await handleGetItemDetail(backend, { ref: { id: listing.ref.id } }),
    ItemDetailResultSchema,
    "scrum_get_item_detail",
  );
  assertEquals(payload.story.ref.id, listing.ref.id);
});

Deno.test("scrum_get_sprint_data - happy path schema", async () => {
  const backend = await committedFakeBackendPromise;

  const payload = assertHandlerSchema(
    await handleGetSprintData(backend, { sprint_ref: "current" }),
    SprintRawDataSchema,
    "scrum_get_sprint_data",
  );
  assertEquals(payload.sprint.name, "Sprint 1");
  assertEquals(typeof payload.sprint.id, "string");
  assertEquals(typeof payload.sprint.durationDays, "number");
  assertEquals(Array.isArray(payload.items), true);
  assertEquals(payload.items.length > 0, true);

  const item = payload.items[0];
  assertEquals(typeof item.id, "string");
  assertEquals(typeof item.number, "number");
  assertEquals(typeof item.title, "string");
  assertEquals(typeof item.hasAssignee, "boolean");
  assertEquals(typeof item.hasBlockers, "boolean");
  assertEquals(typeof item.storyPoints, "number");
});

Deno.test("scrum_get_sprint_data - config contract", async () => {
  const profile = await committedConfigProfilePromise;
  const backend = await committedFakeBackendPromise;

  const payload = assertHandlerSchema(
    await handleGetSprintData(backend, { sprint_ref: "current" }),
    SprintRawDataSchema,
    "scrum_get_sprint_data (contract)",
  );

  // Sprint name must be a non-empty string (exact names are config-dependent)
  assertEquals(payload.sprint.name.length > 0, true);

  // Item types and statuses must match config vocabulary where set
  const allowedStatuses = new Set(Object.values(profile.statusDisplay));
  const allowedTypes = new Set(Object.keys(profile.typeDisplay));

  for (const item of payload.items) {
    if (item.status !== null) {
      assertEquals(
        allowedStatuses.has(item.status),
        true,
        `status "${item.status}" must be a config display value`,
      );
    }
    if (item.type !== null) {
      assertEquals(
        allowedTypes.has(item.type),
        true,
        `type "${item.type}" must be a config type key`,
      );
    }
  }
});
