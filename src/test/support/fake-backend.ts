// =============================================================================
// src/test/support/fake-backend.ts
// In-memory ProjectBackend whose platform vocabulary is derived from scrum config.
// =============================================================================

import { AbstractProjectBackend } from "../../adapters/abstract-backend.ts";
import { AdapterError } from "../../domain/errors.ts";
import { CapabilityStatus, type PlatformCapabilities } from "../../adapters/capabilities.ts";
import {
  type BacklogItemListing,
  type EpicListing,
  type ImpedimentRef,
  type ImpedimentStatus,
  type ItemType,
  type SprintRef,
  type Story,
  type StoryRef,
  type SupportedBackend,
  toIssueKey,
} from "../../domain/types.ts";
import type {
  CreateResult,
  CreateStoryInput,
  ImpedimentListing,
  ItemSearchResultRaw,
  PlatformState,
  ResolvedItemFilter,
  ScrumField,
  SprintDataQuery,
  SprintInfo,
  SprintRawData,
  StoryDetail,
  StorySnapshotOverrides,
  StoryUpdates,
  VocabularyKind,
} from "../../scrum/ports.ts";
import type { BackendCallResult } from "../../services/error-enrichment.ts";
import type { BootConfig } from "../../scrum/config-boot.ts";
import { type ConfigProfile, deriveConfigProfile } from "./config-profile.ts";
import { computeSprintEndDate } from "../../scrum/utils/sprint-math.ts";

const FAKE_CAPABILITIES: PlatformCapabilities = {
  platform: "fake",
  supports: {
    auditLogBurndown: CapabilityStatus.EMULATED,
    nativeSprints: CapabilityStatus.NATIVE,
    dependencies: CapabilityStatus.NATIVE,
    fileReader: CapabilityStatus.UNAVAILABLE,
    stableItemKeys: CapabilityStatus.NATIVE,
    epicDescriptions: CapabilityStatus.NATIVE,
    epicStatusTracking: CapabilityStatus.NATIVE,
  },
};

export type FakeBackendCall = {
  method: string;
  args: unknown[];
};

export interface ConfigShapedFakeBackendOptions {
  items?: readonly BacklogItemListing[];
  epics?: readonly EpicListing[];
  storyDetail?: StoryDetail;
  /** When set, setField throws for this field (partial-failure contract tests). */
  setFieldFailureOn?: ScrumField;
  /** Config-declared status display names absent from the platform (orient gaps). */
  missingStatusOptions?: readonly string[];
  /** Config-declared priority display names absent from the platform (orient gaps). */
  missingPriorityOptions?: readonly string[];
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
  private storyDetail: StoryDetail;
  private setFieldFailureOn?: ScrumField;
  private missingStatusOptions: readonly string[];
  private missingPriorityOptions: readonly string[];

  constructor(profile: ConfigProfile, options: ConfigShapedFakeBackendOptions = {}) {
    super();
    this.profile = profile;
    this.items = options.items ?? buildCanonicalListingItems(profile);
    this.missingStatusOptions = options.missingStatusOptions ?? [];
    this.missingPriorityOptions = options.missingPriorityOptions ?? [];
    this.epics = options.epics ?? [{
      ref: { id: "MI_fake_epic" },
      name: "Config Epic",
      description: null,
      priority: profile.expectedP0Display,
      status: "open",
      story_count: 1,
      open_item_count: 1,
    }];
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

  withSetFieldFailureOn(field: ScrumField): ConfigShapedFakeBackend {
    return new ConfigShapedFakeBackend(this.profile, {
      items: this.items,
      epics: this.epics,
      storyDetail: this.storyDetail,
      setFieldFailureOn: field,
      missingStatusOptions: this.missingStatusOptions,
      missingPriorityOptions: this.missingPriorityOptions,
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
    const statusOptions = Object.values(p.statusDisplay).filter(
      (name) => !this.missingStatusOptions.includes(name),
    );
    const priorityOptions = Object.values(p.priorityDisplay).filter(
      (name) => !this.missingPriorityOptions.includes(name),
    );

    return Promise.resolve({
      value: {
        fields: {
          status: {
            exists: true,
            options: statusOptions,
            missingOptions: [...this.missingStatusOptions],
          },
          sprint: { exists: true },
          story_points: { exists: true },
          priority: {
            exists: true,
            options: priorityOptions,
            missingOptions: [...this.missingPriorityOptions],
          },
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

  findItems(filter: ResolvedItemFilter): Promise<BackendCallResult<ItemSearchResultRaw>> {
    this.log("findItems", filter);
    const items = filter.limit > 0 ? this.items.slice(0, filter.limit) : [...this.items];
    return Promise.resolve({
      value: {
        items,
        total_count: this.items.length,
        scope_summary: { sprint_count: this.items.length, backlog_count: 0 },
        dependency_map: filter.include_dependencies
          ? {
            "99": {
              key: toIssueKey("99"),
              title: "Fixture blocker",
              status: "Blocked",
              ref: { id: "PVTI_fake_blocker" },
            },
          }
          : null,
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

  override getSprintData(_query: SprintDataQuery): Promise<SprintRawData> {
    this.log("getSprintData", _query);
    return Promise.resolve({
      sprint: DEFAULT_SPRINT,
      items: [{
        id: "PVTI_fake_1",
        number: 101,
        title: "Config-shaped fixture story",
        type: (Object.keys(this.profile.typeDisplay)[0] ?? "user_story") as string,
        status: Object.values(this.profile.statusDisplay)[0] ?? "In Progress",
        story_points: 3,
        has_assignee: true,
        has_blockers: false,
        completed_at: null,
      }],
    });
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
}
