// =============================================================================
// Tool-surface contract tests — scrum_* read handlers
// =============================================================================

import { assertEquals, assertExists } from "@std/assert";
import {
  committedConfigProfilePromise,
  committedFakeBackendPromise,
  committedScrumConfigPromise,
} from "../scrum/_test_utils.ts";
import { assertFindItemsMatchesConfig, assertOrientMatchesConfig } from "../scrum/_contract_assertions.ts";
import type { ItemSearchResult, OrientResult } from "../domain/types.ts";
import {
  AnalyticsResultSchema,
  BacklogHealthSchema,
  ItemDetailResultSchema,
  ItemSearchResultSchema,
  OrientResultSchema,
} from "../schemas/scrum-outputs.ts";
import { assertHandlerSchema } from "./_contract_test_utils.ts";
import {
  handleFindItems,
  handleGetAnalytics,
  handleGetBoardHealth,
  handleGetItemDetail,
  handleOrient,
} from "./scrum-read.ts";

Deno.test("scrum_orient — happy path schema + config contract", async () => {
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

Deno.test("scrum_find_items — happy path schema + config contract", async () => {
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

Deno.test("scrum_find_items — include_dependencies variant", async () => {
  const backend = await committedFakeBackendPromise;

  const payload = assertHandlerSchema(
    await handleFindItems(backend, { scope: "all", include_dependencies: true, limit: 10 }),
    ItemSearchResultSchema,
    "scrum_find_items (deps)",
  );
  assertEquals(payload.dependency_map !== null, true);
});

Deno.test("scrum_get_item_detail — happy path schema", async () => {
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

Deno.test("scrum_get_board_health — happy path schema", async () => {
  const backend = await committedFakeBackendPromise;

  assertHandlerSchema(
    await handleGetBoardHealth(backend, { sprint_scope: "current" }),
    BacklogHealthSchema,
    "scrum_get_board_health",
  );
});

Deno.test("scrum_get_board_health — explicit sprint name variant", async () => {
  const backend = await committedFakeBackendPromise;

  assertHandlerSchema(
    await handleGetBoardHealth(backend, { sprint_scope: "Sprint 1" }),
    BacklogHealthSchema,
    "scrum_get_board_health (named sprint)",
  );
});

Deno.test("scrum_get_analytics — both views schema", async () => {
  const profile = await committedConfigProfilePromise;
  const backend = await committedFakeBackendPromise;

  assertHandlerSchema(
    await handleGetAnalytics(backend, { view: "both", history_window: profile.expectedVelocityWindow }),
    AnalyticsResultSchema,
    "scrum_get_analytics (both)",
  );
});

Deno.test("scrum_get_analytics — history-only variant", async () => {
  const profile = await committedConfigProfilePromise;
  const historyOnly = {
    burndown: null,
    history: [],
    window: profile.expectedVelocityWindow,
  };
  const backend = (await committedFakeBackendPromise).withAnalytics(historyOnly);

  const payload = assertHandlerSchema(
    await handleGetAnalytics(backend, { view: "history", history_window: profile.expectedVelocityWindow }),
    AnalyticsResultSchema,
    "scrum_get_analytics (history)",
  );
  assertEquals(payload.burndown, null);
  assertEquals(payload.history, []);
});
