// =============================================================================
// src/test/support/fake-backend.ts
// In-memory ProjectBackend whose platform vocabulary is derived from scrum config.
// =============================================================================

import {
  AbstractProjectBackend,
  UnsupportedCapabilityError,
} from "../../adapters/abstract-backend.ts";
import { AdapterError } from "../../domain/errors.ts";
import type { PlatformCapabilities } from "../../adapters/capabilities.ts";
import type {
  AnalyticsResult,
  BacklogHealth,
  BacklogItemListing,
  EpicListing,
  ImpedimentRef,
  ImpedimentStatus,
  ItemSearchResult,
  ItemType,
  SprintRef,
  Story,
  StoryRef,
  SupportedBackend,
} from "../../domain/types.ts";
import type {
  AnalyticsQuery,
  CreateResult,
  CreateStoryInput,
  ImpedimentListing,
  PlatformState,
  ResolvedItemFilter,
  ScrumField,
  SprintInfo,
  StoryDetail,
  StorySnapshotOverrides,
  StoryUpdates,
  VocabularyKind,
} from "../../scrum/ports.ts";
import type { BackendCallResult } from "../../services/error-enrichment.ts";
import type { BootConfig } from "../../scrum/config-boot.ts";
import { type ConfigProfile, deriveConfigProfile } from "./config-profile.ts";
import { computeSprintEndDate } from "../../scrum/sprint-math.ts";

const FAKE_CAPABILITIES: PlatformCapabilities = {
  platform: "fake",
  supports: {
    auditLogBurndown: false,
    nativeSprints: true,
    dependencies: true,
    fileReader: false,
    stableItemKeys: true,
  },
};

export type FakeBackendCall = {
  method: string;
  args: unknown[];
};

export interface ConfigShapedFakeBackendOptions {
  items?: readonly BacklogItemListing[];
  epics?: readonly EpicListing[];
  sprintCompletion?: { completed: number; total: number };
  boardHealth?: BacklogHealth;
  analytics?: AnalyticsResult;
  storyDetail?: StoryDetail;
  /** When set, setField throws for this field (partial-failure contract tests). */
  setFieldFailureOn?: ScrumField;
}

const DEFAULT_SPRINT: SprintInfo = {
  id: "IT_fake_active",
  name: "Sprint 1",
  goal: "Config-shaped fake sprint",
  startDate: "2026-01-01",
  durationDays: 14,
  endDate: computeSprintEndDate("2026-01-01", 14),
};

const DEFAULT_NEXT_SPRINT: SprintInfo = {
  id: "IT_fake_next",
  name: "Sprint 2",
  goal: null,
  startDate: "2026-01-15",
  durationDays: 14,
  endDate: computeSprintEndDate("2026-01-15", 14),
};

export const buildCanonicalListingItems = (
  profile: ConfigProfile,
): readonly BacklogItemListing[] => {
  const inProgress = profile.statusDisplay.in_progress ?? "In Progress";
  const p0Display = profile.expectedP0Display;
  const featureType = (Object.keys(profile.typeDisplay)[0] ?? "user_story") as ItemType;

  return [{
    ref: { id: "PVTI_fake_1", key: "101" },
    title: "Config-shaped fixture story",
    type: featureType,
    status: inProgress,
    story_points: profile.expectedStoryPointValues?.[2] ?? 3,
    priority: p0Display,
    assignees: ["agent-tester"],
    labels: [],
    sprint: { name: DEFAULT_SPRINT.name, ref: { id: DEFAULT_SPRINT.id } },
    epic: null,
    blocked_by: [],
    blocks: [],
    custom_fields: {},
  }];
};

const buildDefaultStory = (profile: ConfigProfile): Story => {
  const listing = buildCanonicalListingItems(profile)[0];
  return {
    ref: { id: listing.ref.id },
    title: listing.title,
    body: "- [ ] Acceptance criterion one\n- [ ] Acceptance criterion two",
    type: listing.type as ItemType | null,
    status: listing.status,
    sprint: listing.sprint.name,
    story_points: listing.story_points,
    priority: listing.priority,
    assignees: listing.assignees,
    labels: listing.labels,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-02T00:00:00Z",
    blocked_by: [],
    kind: "issue",
    key: listing.ref.key,
    url: "https://example.com/issues/101",
    epic: null,
  };
};

const buildDefaultBoardHealth = (): BacklogHealth => ({
  readiness: {
    by_type: { feature: { ready: 1, not_ready: 0, total: 1 } },
    overall_pct: 100,
  },
  sprint_risk: {
    unestimated_count: 0,
    blocked_count: 0,
    no_assignee_count: 0,
  },
  impediments: { orphan_count: 0, open_count: 0 },
  ungroomed_count: 0,
});

const buildDefaultAnalytics = (profile: ConfigProfile): AnalyticsResult => ({
  burndown: null,
  history: null,
  window: profile.expectedVelocityWindow,
});

class FakeAdapterError extends AdapterError {
  readonly backendName: SupportedBackend = "github";
  readonly code = "NOT_FOUND";
  readonly recovery = "Simulated adapter failure for contract tests.";
}

/**
 * In-memory backend for tool-surface contract tests.
 * Platform vocabulary and listing field values are derived from ConfigProfile.
 */
export class ConfigShapedFakeBackend extends AbstractProjectBackend {
  readonly capabilities = FAKE_CAPABILITIES;
  readonly profile: ConfigProfile;
  readonly calls: FakeBackendCall[] = [];

  private items: readonly BacklogItemListing[];
  private epics: readonly EpicListing[];
  private sprintCompletion: { completed: number; total: number };
  private boardHealth: BacklogHealth;
  private analytics: AnalyticsResult;
  private storyDetail: StoryDetail;
  private setFieldFailureOn?: ScrumField;

  constructor(profile: ConfigProfile, options: ConfigShapedFakeBackendOptions = {}) {
    super();
    this.profile = profile;
    this.items = options.items ?? buildCanonicalListingItems(profile);
    this.epics = options.epics ?? [{
      ref: { id: "MI_fake_epic" },
      name: "Config Epic",
      description: null,
      priority: profile.expectedP0Display,
      status: "open",
      story_count: 1,
      open_item_count: 1,
    }];
    this.sprintCompletion = options.sprintCompletion ?? { completed: 3, total: 10 };
    this.boardHealth = options.boardHealth ?? buildDefaultBoardHealth();
    this.analytics = options.analytics ?? buildDefaultAnalytics(profile);
    this.storyDetail = options.storyDetail ?? {
      story: buildDefaultStory(profile),
      comments: [],
      linked_artifacts: [],
    };
    this.setFieldFailureOn = options.setFieldFailureOn;
  }

  static fromBoot(
    boot: BootConfig,
    options?: ConfigShapedFakeBackendOptions,
  ): ConfigShapedFakeBackend {
    return new ConfigShapedFakeBackend(deriveConfigProfile(boot), options);
  }

  withItems(items: readonly BacklogItemListing[]): ConfigShapedFakeBackend {
    return new ConfigShapedFakeBackend(this.profile, {
      items,
      epics: this.epics,
      sprintCompletion: this.sprintCompletion,
      boardHealth: this.boardHealth,
      analytics: this.analytics,
      storyDetail: this.storyDetail,
      setFieldFailureOn: this.setFieldFailureOn,
    });
  }

  withSetFieldFailureOn(field: ScrumField): ConfigShapedFakeBackend {
    return new ConfigShapedFakeBackend(this.profile, {
      items: this.items,
      epics: this.epics,
      sprintCompletion: this.sprintCompletion,
      boardHealth: this.boardHealth,
      analytics: this.analytics,
      storyDetail: this.storyDetail,
      setFieldFailureOn: field,
    });
  }

  withAnalytics(analytics: AnalyticsResult): ConfigShapedFakeBackend {
    return new ConfigShapedFakeBackend(this.profile, {
      items: this.items,
      epics: this.epics,
      sprintCompletion: this.sprintCompletion,
      boardHealth: this.boardHealth,
      analytics,
      storyDetail: this.storyDetail,
      setFieldFailureOn: this.setFieldFailureOn,
    });
  }

  private log(method: string, ...args: unknown[]): void {
    this.calls.push({ method, args });
  }

  reload(): Promise<void> {
    this.log("reload");
    return Promise.resolve();
  }

  getPlatformState(_declaredVocabulary: {
    canonicalStatusKeys: string[];
    canonicalPriorityKeys: string[];
  }): Promise<BackendCallResult<PlatformState>> {
    this.log("getPlatformState", _declaredVocabulary);
    const p = this.profile;
    const statusOptions = Object.values(p.statusDisplay);
    const priorityOptions = Object.values(p.priorityDisplay);

    return Promise.resolve({
      value: {
        fields: {
          status: { exists: true, options: statusOptions, missingOptions: [] },
          sprint: { exists: true },
          story_points: { exists: true },
          priority: { exists: true, options: priorityOptions, missingOptions: [] },
          type: { exists: true, configured: Object.keys(p.typeDisplay).length > 0 },
        },
        labels: { existing: [], expected: [], missing: [] },
        iterations: {
          active: DEFAULT_SPRINT,
          next: DEFAULT_NEXT_SPRINT,
          completed: [],
          completedCount: 0,
        },
        vocabulary: {
          statusDisplay: p.statusDisplay,
          priorityDisplay: p.priorityDisplay,
          typeDisplay: p.typeDisplay,
          typeTemplatePaths: p.typeTemplatePaths,
        },
        epics: { active: [], totalCount: 0 },
        templateUris: p.expectedTemplateUris,
      },
      warnings: [],
    });
  }

  getEpics(_sprintIterationId?: string | null): Promise<EpicListing[]> {
    this.log("getEpics", _sprintIterationId);
    return Promise.resolve([...this.epics]);
  }

  getSprintCompletion(_iterationId: string): Promise<{ completed: number; total: number }> {
    this.log("getSprintCompletion", _iterationId);
    return Promise.resolve(this.sprintCompletion);
  }

  findItems(filter: ResolvedItemFilter): Promise<BackendCallResult<ItemSearchResult>> {
    this.log("findItems", filter);
    const items = filter.limit > 0 ? this.items.slice(0, filter.limit) : [...this.items];
    return Promise.resolve({
      value: {
        items,
        total_count: this.items.length,
        scope_summary: { sprint_count: this.items.length, backlog_count: 0 },
        dependency_map: filter.include_dependencies ? {} : null,
      },
      warnings: [],
    });
  }

  getStoryDetail(ref: StoryRef): Promise<BackendCallResult<StoryDetail>> {
    this.log("getStoryDetail", ref);
    return Promise.resolve({ value: this.storyDetail, warnings: [] });
  }

  composeStorySnapshot(
    ref: StoryRef,
    overrides?: StorySnapshotOverrides,
  ): Promise<BackendCallResult<Story>> {
    this.log("composeStorySnapshot", ref, overrides);
    const story = { ...this.storyDetail.story, ...overrides } as Story;
    return Promise.resolve({ value: story, warnings: [] });
  }

  composeStoryAfterSetField(
    ref: StoryRef,
    field: ScrumField,
    value: string | number | SprintRef | null,
  ): Promise<BackendCallResult<Story>> {
    this.log("composeStoryAfterSetField", ref, field, value);
    return Promise.resolve({ value: this.storyDetail.story, warnings: [] });
  }

  composeStoryAfterStoryUpdate(
    ref: StoryRef,
    updates: StoryUpdates,
  ): Promise<BackendCallResult<Story>> {
    this.log("composeStoryAfterStoryUpdate", ref, updates);
    const story = {
      ...this.storyDetail.story,
      ...updates,
      blocked_by: updates.blocked_by === null
        ? []
        : updates.blocked_by === undefined
        ? this.storyDetail.story.blocked_by
        : [],
    } as Story;
    return Promise.resolve({ value: story, warnings: [] });
  }

  composeStoryAfterCreateStory(
    ref: StoryRef,
    input: CreateStoryInput,
  ): Promise<BackendCallResult<Story>> {
    this.log("composeStoryAfterCreateStory", ref, input);
    return Promise.resolve({ value: this.storyDetail.story, warnings: [] });
  }

  getAnalytics(query: AnalyticsQuery): Promise<AnalyticsResult> {
    this.log("getAnalytics", query);
    return Promise.resolve(this.analytics);
  }

  getBoardHealth(sprintScope: string): Promise<BacklogHealth> {
    this.log("getBoardHealth", sprintScope);
    return Promise.resolve(this.boardHealth);
  }

  getSprintImpediments(_sprint: SprintRef): Promise<ImpedimentListing[]> {
    this.log("getSprintImpediments", _sprint);
    return Promise.resolve([]);
  }

  getOrphanImpediments(): Promise<ImpedimentListing[]> {
    this.log("getOrphanImpediments");
    return Promise.resolve([]);
  }

  override updateImpediment(
    ref: ImpedimentRef,
    status: ImpedimentStatus,
    resolutionNotes?: string,
  ): Promise<ImpedimentListing> {
    this.log("updateImpediment", ref, status, resolutionNotes);
    return Promise.resolve({
      ref,
      description: "Config-shaped impediment",
      status,
      raised_by: null,
      raised_at: "2026-01-01T00:00:00Z",
      resolved_at: status === "resolved" ? "2026-01-02T00:00:00Z" : null,
    });
  }

  createStory(input: CreateStoryInput): Promise<StoryRef> {
    this.log("createStory", input);
    return Promise.resolve({ id: "PVTI_fake_new" });
  }

  override createImpediment(
    input: CreateStoryInput,
  ): Promise<{ listing: ImpedimentListing; itemRef: StoryRef }> {
    this.log("createImpediment", input);
    const itemRef = { id: "PVTI_fake_imp" };
    return Promise.resolve({
      listing: {
        ref: itemRef,
        description: input.body,
        status: "open",
        raised_by: null,
        raised_at: "2026-01-01T00:00:00Z",
        resolved_at: null,
      },
      itemRef,
    });
  }

  updateStory(ref: StoryRef, updates: StoryUpdates): Promise<void> {
    this.log("updateStory", ref, updates);
    return Promise.resolve();
  }

  setField(
    ref: StoryRef,
    field: ScrumField,
    value: string | number | SprintRef | null,
  ): Promise<void> {
    this.log("setField", ref, field, value);
    if (this.setFieldFailureOn === field) {
      return Promise.reject(new FakeAdapterError(`Simulated failure setting ${field}`));
    }
    return Promise.resolve();
  }

  addComment(ref: StoryRef, body: string): Promise<void> {
    this.log("addComment", ref, body);
    return Promise.resolve();
  }

  addVocabulary(kind: VocabularyKind, value: string): Promise<CreateResult> {
    this.log("addVocabulary", kind, value);
    return Promise.resolve({ created: true });
  }

  /** Write helpers not yet needed for read contract tests. */
  unsupported(method: string): never {
    throw new UnsupportedCapabilityError(this.capabilities.platform, method);
  }
}
