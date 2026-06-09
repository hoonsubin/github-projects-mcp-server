// src/test/fixtures/port/index.ts — port-level captured board responses

import capturedRaw from "./captured.json" with { type: "json" };
import type { PlatformState, StoryDetail } from "../../../scrum/ports.ts";
import type { ItemSearchResult } from "../../../domain/types.ts";

export interface CapturedProfile {
  readonly configPath: string;
  readonly platformState: PlatformState;
  readonly findItems: ItemSearchResult;
  readonly itemDetails: Record<string, StoryDetail>;
}

export interface CapturedFixtures {
  readonly capturedAt: string;
  readonly schemaVersion: number;
  readonly profiles: Record<string, CapturedProfile>;
}

export const CAPTURED = capturedRaw as unknown as CapturedFixtures;

// ── Convenience exports for the default profile (.github/scrum/config.yml) ──

const _default = Object.values(CAPTURED.profiles)[0];

/** Platform state captured from the default config's live backend. */
export const FIXTURE_PLATFORM_STATE: PlatformState = _default.platformState;

/** findItems({ scope: "all" }) result from the default config's live backend. */
export const FIXTURE_FIND_ITEMS: ItemSearchResult = _default.findItems;

/** All per-item StoryDetail responses, keyed by item ID. */
export const FIXTURE_ITEM_DETAILS: Record<string, StoryDetail> = _default.itemDetails;

/** First captured StoryDetail — useful for single-item tests. */
export const FIXTURE_FIRST_ITEM_DETAIL: StoryDetail = Object.values(_default.itemDetails)[0];
