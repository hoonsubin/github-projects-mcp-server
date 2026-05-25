// src/adapters/abstract-backend.ts — AbstractProjectBackend
//
// Abstract base class for platform adapters. Provides default (throwing)
// implementations for optional port methods so each adapter only overrides
// what it supports. Capability-gated callers should check the adapter's
// PlatformCapabilities before calling optional methods.

import type { PlatformCapabilities } from "./capabilities.ts";
import type {
  AnalyticsQuery,
  CreateStoryInput,
  ImpedimentListing,
  PlatformState,
  ProjectReader,
  ProjectWriter,
  ResolvedItemFilter,
  StoryDetail,
  StoryUpdates,
  VocabularyKind,
} from "../scrum/ports.ts";
import type {
  AnalyticsResult,
  BacklogHealth,
  EpicListing,
  ItemSearchResult,
  ResolvedRef,
  SprintRef,
  StoryRef,
} from "../domain/types.ts";

// ── UnsupportedCapabilityError ───────────────────────────────────────────────

/**
 * Thrown when an optional port method is called on an adapter that does not
 * implement it. Carries the adapter's platform name so error messages can
 * guide the agent toward a platform-appropriate alternative.
 *
 * Example: calling updateImpediment() on a mock adapter used in tests.
 * The agent reads the message and knows the feature is unavailable.
 */
export class UnsupportedCapabilityError extends Error {
  override readonly name = "UnsupportedCapabilityError";

  /** The platform that lacks this capability (e.g. "mock", "linear"). */
  readonly platform: string;

  /** The method that was called but is unsupported. */
  readonly method: string;

  constructor(platform: string, method: string) {
    super(
      `Platform "${platform}" does not support the "${method}" operation. ` +
        `Check the platform's capabilities before calling this method.`,
    );
    this.platform = platform;
    this.method = method;
  }
}

// ── AbstractProjectBackend ───────────────────────────────────────────────────

/**
 * Abstract base for platform adapters. Implements {@link ProjectReader} and
 * {@link ProjectWriter} structurally. Concrete adapters (e.g. GitHub) extend
 * this and override every abstract method plus any optional method they support.
 *
 * Three methods have default implementations that throw
 * {@link UnsupportedCapabilityError} because they are optional features not
 * available on every platform:
 *
 *   - {@link resolveRef} — protected helper for converting `{ number }` refs
 *   - {@link createImpediment} — impediment logging support
 *   - {@link updateImpediment} — impediment resolution support
 *
 * All other {@link ProjectReader} and {@link ProjectWriter} methods are
 * declared abstract — the compiler enforces that every concrete adapter
 * provides them.
 */
export abstract class AbstractProjectBackend implements ProjectReader, ProjectWriter {
  // ── Capability declaration (override in subclass) ────────────────────────

  /** Each adapter MUST declare its platform capabilities. Read-only. */
  abstract readonly capabilities: PlatformCapabilities;

  // ── ProjectReader — platform state ───────────────────────────────────────

  abstract getPlatformState(declaredVocabulary: {
    canonicalStatusKeys: string[];
    canonicalPriorityKeys: string[];
  }): Promise<PlatformState>;

  abstract reload(): Promise<void>;

  // ── ProjectReader — story read ───────────────────────────────────────────

  abstract getStoryDetail(ref: StoryRef): Promise<StoryDetail>;

  abstract getEpics(): Promise<EpicListing[]>;

  // ── ProjectReader — unified search & analytics ───────────────────────────

  /**
   * Unified item search across all PBIs.
   * Replaces getSprintStories() and getBacklogStories().
   */
  abstract findItems(filter: ResolvedItemFilter): Promise<ItemSearchResult>;

  /**
   * Unified sprint analytics (burndown + history).
   * Replaces getCompletedSprintHistory(), getBurndownInput(), and
   * resolveCompletionTimestamps().
   */
  abstract getAnalytics(query: AnalyticsQuery): Promise<AnalyticsResult>;

  /**
   * Board health dashboard — aggregated metrics without item lists.
   */
  abstract getBoardHealth(sprintScope: string): Promise<BacklogHealth>;

  // ── ProjectReader — impediments ──────────────────────────────────────────

  abstract getSprintImpediments(
    sprint: SprintRef,
  ): Promise<ImpedimentListing[]>;

  abstract getOrphanImpediments(): Promise<ImpedimentListing[]>;

  // ── ProjectWriter — story mutations ──────────────────────────────────────

  abstract createStory(input: CreateStoryInput): Promise<StoryRef>;

  abstract updateStory(ref: StoryRef, updates: StoryUpdates): Promise<void>;

  abstract setField(
    ref: StoryRef,
    field: "status" | "sprint" | "story_points" | "priority" | "assignee" | "type",
    value: string | number | SprintRef | null,
  ): Promise<void>;

  abstract addComment(ref: StoryRef, body: string): Promise<void>;

  abstract addVocabulary(
    kind: VocabularyKind,
    value: string,
  ): Promise<{ created: boolean }>;

  // ── Optional ProjectWriter operations ────────────────────────────────────

  /**
   * Create an impediment story and cross-link it to the affected item.
   *
   * Default: throws {@link UnsupportedCapabilityError}.
   * Override in adapters that support impediment logging.
   */
  createImpediment(
    _input: CreateStoryInput,
  ): Promise<{ listing: ImpedimentListing; itemRef: StoryRef }> {
    throw new UnsupportedCapabilityError(this.capabilities.platform, "createImpediment");
  }

  /**
   * Update an impediment's status and optionally add resolution notes.
   *
   * Default: throws {@link UnsupportedCapabilityError}.
   * Override in adapters that support impediment resolution.
   */
  updateImpediment(
    _ref: ResolvedRef,
    _status: "open" | "in_progress" | "resolved",
    _resolutionNotes?: string,
  ): Promise<ImpedimentListing> {
    throw new UnsupportedCapabilityError(this.capabilities.platform, "updateImpediment");
  }

  // ── Internal helpers (not part of the port interface) ────────────────────

  /**
   * Resolve a {@link StoryRef} union (`{ id }` or `{ number }`) to a
   * canonical `{ id }` ref for use in port method calls.
   *
   * Default: throws {@link UnsupportedCapabilityError} for `{ number }` refs.
   * Adapters that support stable item keys (see
   * {@link PlatformCapabilities.supports.stableItemKeys}) should override
   * this to delegate `{ number }` lookups to a `findItems` query.
   *
   * Design note: this is `protected` — an internal adapter concern, not
   * exposed on any port interface. Use-case code never sees ref resolution.
   */
  protected resolveRef(
    ref: StoryRef,
  ): Promise<StoryRef> {
    // { id } refs are already resolved — pass through
    if ("id" in ref && !("number" in ref)) {
      return Promise.resolve(ref);
    }

    throw new UnsupportedCapabilityError(
      this.capabilities.platform,
      "resolveRef({ number })",
    );
  }
}
