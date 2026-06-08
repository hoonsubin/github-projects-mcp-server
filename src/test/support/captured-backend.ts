// src/test/support/captured-backend.ts - CapturedDataBackend
//
// Read-only backend that replays real API responses from captured.json.
// Use when tests need to assert against actual board data rather than synthetic stubs.
// Write methods throw — this backend is for read-path testing only.

import { CapabilityStatus, type PlatformCapabilities } from "../../adapters/capabilities.ts";
import {
  AbstractProjectBackend,
  UnsupportedCapabilityError,
} from "../../adapters/abstract-backend.ts";
import type { CapturedProfile } from "@test/fixtures/port/index.ts";
import type { BackendCallResult } from "../../services/error-enrichment.ts";
import type {
  CreateStoryInput,
  ImpedimentListing,
  PlatformState,
  ResolvedItemFilter,
  ScrumField,
  SprintDataQuery,
  SprintRawData,
  SprintRawItem,
  StoryDetail,
  StorySnapshotOverrides,
  StoryUpdates,
  VocabularyKind,
} from "../../scrum/ports.ts";
import type {
  EpicListing,
  ItemSearchResult,
  SprintRef,
  Story,
  StoryRef,
} from "../../domain/types.ts";

// ── CAPTURED_CAPABILITIES ───────────────────────────────────────────────────────

/**
 * Capability declaration for the CapturedDataBackend.
 *
 * All features are UNAVAILABLE or EMULATED because captured data is a static
 * snapshot — no live API calls, no audit logs, no native sprint semantics.
 */
export const CAPTURED_CAPABILITIES: PlatformCapabilities = {
  platform: "captured",
  supports: {
    auditLogBurndown: CapabilityStatus.UNAVAILABLE,
    nativeSprints: CapabilityStatus.UNAVAILABLE,
    dependencies: CapabilityStatus.EMULATED,
    fileReader: CapabilityStatus.UNAVAILABLE,
    stableItemKeys: CapabilityStatus.EMULATED,
  },
};

// ── CapturedDataBackend ───────────────────────────────────────────────────────────

/**
 * Read-only backend that replays real API responses from captured.json.
 *
 * Construction:
 *   const backend = CapturedDataBackend.fromProfile(CAPTURED.profiles["config"]);
 */
export class CapturedDataBackend extends AbstractProjectBackend {
  readonly capabilities = CAPTURED_CAPABILITIES;

  constructor(readonly profile: CapturedProfile) {
    super();
  }

  static fromProfile(profile: CapturedProfile): CapturedDataBackend {
    return new CapturedDataBackend(profile);
  }

  // ── ProjectReader - platform state ───────────────────────────────────────

  reload(): Promise<void> {
    return Promise.resolve();
  }

  getPlatformState(_declaredVocabulary: {
    canonicalStatusKeys: string[];
    canonicalPriorityKeys: string[];
  }): Promise<BackendCallResult<PlatformState>> {
    return Promise.resolve({ value: this.profile.platformState, warnings: [] });
  }

  // ── ProjectReader - story read ───────────────────────────────────────────

  getStoryDetail(ref: StoryRef): Promise<BackendCallResult<StoryDetail>> {
    if (!("id" in ref)) {
      return Promise.reject(new Error(`Captured backend requires id refs, got number ref`));
    }
    const detail = this.profile.itemDetails[ref.id];
    if (!detail) {
      return Promise.reject(new Error(`Item not found in captured data: ${ref.id}`));
    }
    return Promise.resolve({ value: detail, warnings: [] });
  }

  composeStorySnapshot(
    ref: StoryRef,
    _overrides?: StorySnapshotOverrides,
  ): Promise<BackendCallResult<Story>> {
    if (!("id" in ref)) {
      return Promise.reject(new Error(`Captured backend requires id refs, got number ref`));
    }
    const detail = this.profile.itemDetails[ref.id];
    if (!detail) {
      return Promise.reject(new Error(`Item not found in captured data: ${ref.id}`));
    }
    return Promise.resolve({ value: detail.story, warnings: [] });
  }

  composeStoryAfterSetField(
    _ref: StoryRef,
    _field: ScrumField,
    _value: string | number | SprintRef | null,
  ): Promise<BackendCallResult<Story>> {
    throw new UnsupportedCapabilityError(this.capabilities.platform, "composeStoryAfterSetField");
  }

  composeStoryAfterStoryUpdate(
    _ref: StoryRef,
    _updates: StoryUpdates,
  ): Promise<BackendCallResult<Story>> {
    throw new UnsupportedCapabilityError(
      this.capabilities.platform,
      "composeStoryAfterStoryUpdate",
    );
  }

  composeStoryAfterCreateStory(
    _ref: StoryRef,
    _input: CreateStoryInput,
  ): Promise<BackendCallResult<Story>> {
    throw new UnsupportedCapabilityError(
      this.capabilities.platform,
      "composeStoryAfterCreateStory",
    );
  }

  getEpics(_sprintIterationId?: string | null): Promise<EpicListing[]> {
    return Promise.resolve([]);
  }

  override getSprintData(query: SprintDataQuery): Promise<SprintRawData> {
    const { sprint_ref } = query;
    const iterations = this.profile.platformState.iterations;

    // Resolve the sprint reference to a SprintInfo from the captured data.
    let sprint: typeof iterations.active = null;
    if (sprint_ref === "current") {
      sprint = iterations.active;
    } else if (sprint_ref === "next") {
      sprint = iterations.next;
    } else if (sprint_ref === null) {
      throw new Error("Captured backend requires a sprint reference for getSprintData");
    } else {
      // SprintName — search by display name across all iteration buckets.
      if (iterations.active?.name === sprint_ref) sprint = iterations.active;
      else if (iterations.next?.name === sprint_ref) sprint = iterations.next;
      else {
        sprint = iterations.completed.find((s) => s.name === sprint_ref) ?? null;
      }
    }

    if (!sprint) {
      throw new Error(`Sprint not found in captured data: ${sprint_ref}`);
    }

    // Derive SprintRawItem[] from the captured findItems payload.
    // Filter items whose sprint.ref.id matches the resolved sprint id.
    const items: SprintRawItem[] = this.profile.findItems.items
      .filter((item) => item.sprint.ref.id === sprint!.id)
      .map((item) => ({
        id: item.ref.id,
        number: parseInt(item.ref.key, 10) || 0,
        title: item.title,
        type: item.type,
        status: item.status,
        storyPoints: item.story_points,
        hasAssignee: item.assignees.length > 0,
        hasBlockers: item.blocked_by.length > 0,
        completedAt: null,
      }));

    return Promise.resolve({ sprint, items });
  }

  findItems(_filter: ResolvedItemFilter): Promise<BackendCallResult<ItemSearchResult>> {
    return Promise.resolve({ value: this.profile.findItems, warnings: [] });
  }

  // ── ProjectReader - impediments ──────────────────────────────────────────

  getSprintImpediments(_sprint: SprintRef): Promise<ImpedimentListing[]> {
    return Promise.resolve([]);
  }

  getOrphanImpediments(): Promise<ImpedimentListing[]> {
    return Promise.resolve([]);
  }

  // ── ProjectWriter - story mutations (all throw) ──────────────────────────

  createStory(_input: CreateStoryInput): Promise<StoryRef> {
    throw new UnsupportedCapabilityError(this.capabilities.platform, "createStory");
  }

  updateStory(_ref: StoryRef, _updates: StoryUpdates): Promise<void> {
    throw new UnsupportedCapabilityError(this.capabilities.platform, "updateStory");
  }

  setField(
    _ref: StoryRef,
    _field: ScrumField,
    _value: string | number | SprintRef | null,
  ): Promise<void> {
    throw new UnsupportedCapabilityError(this.capabilities.platform, "setField");
  }

  addComment(_ref: StoryRef, _body: string): Promise<void> {
    throw new UnsupportedCapabilityError(this.capabilities.platform, "addComment");
  }

  addVocabulary(
    _kind: VocabularyKind,
    _value: string,
  ): Promise<{ readonly created: boolean }> {
    throw new UnsupportedCapabilityError(this.capabilities.platform, "addVocabulary");
  }
}
