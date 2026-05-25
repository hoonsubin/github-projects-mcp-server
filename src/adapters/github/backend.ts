// =============================================================================
// src/adapters/github/backend.ts — GitHubProjectBackend Facade
//
// Thin facade: delegates to injected service objects.
// No business logic lives here — services own their domain.
// Extends AbstractProjectBackend for shared infrastructure (resolveRef, capability
// checks, optional method defaults). Constructor receives a single
// GitHubBackendDependencies parameter object (built by the factory).
// =============================================================================

import { GITHUB_CAPABILITIES } from "../capabilities.ts";
import { AbstractProjectBackend } from "../abstract-backend.ts";
import { StoryNotFoundError } from "../../domain/errors.ts";
import { type RuntimeConfig } from "./config-loader.ts";
import { LabelResolver } from "./internal/label-resolver.ts";
import { FieldValueMutator } from "./internal/field-value-mutator.ts";
import { VocabularyManager } from "./internal/vocabulary-manager.ts";
import { StoryQueryService } from "./internal/story-query-service.ts";
import { StoryMutationService } from "./internal/story-mutation-service.ts";
import { ImpedimentService } from "./internal/impediment-service.ts";
import { EpicService } from "./internal/epic-service.ts";
import { ConfigReloader } from "./internal/config-reloader.ts";
import { AnalyticsService } from "./internal/analytics-service.ts";
import { BoardHealthService } from "./internal/board-health-service.ts";
import { toSprintInfo } from "./mappers.ts";
import type {
  AnalyticsQuery,
  CreateStoryInput,
  ImpedimentListing,
  PlatformState,
  ResolvedItemFilter,
  StoryDetail,
  StoryUpdates,
  VocabularyKind,
} from "../../scrum/ports.ts";
import type {
  AnalyticsResult,
  BacklogHealth,
  EpicListing,
  ImpedimentRef,
  ItemSearchResult,
  SprintRef,
  StoryRef,
} from "../../domain/types.ts";

// ── Dependencies parameter object ────────────────────────────────────────────

/**
 * All dependencies needed to construct a GitHubProjectBackend.
 * AnalyticsService and BoardHealthService wrap the lower-level services
 * (BurndownCalculator, SprintHistoryService) behind the new port interfaces.
 */
export interface GitHubBackendDependencies {
  readonly labelResolver: LabelResolver;
  readonly fieldValueMutator: FieldValueMutator;
  readonly vocabularyManager: VocabularyManager;
  readonly storyQueryService: StoryQueryService;
  readonly storyMutationService: StoryMutationService;
  readonly impedimentService: ImpedimentService;
  readonly epicService: EpicService;
  readonly config: RuntimeConfig;
  readonly owner: string;
  readonly repo: string;
  readonly configReloader: ConfigReloader;
  readonly analyticsService: AnalyticsService;
  readonly boardHealthService: BoardHealthService;
  /** Pre-resolved display name maps (from GitHubBackendConfig) — no cast needed at call time. */
  readonly displayConfig: {
    readonly statusDisplay: Record<string, string>;
    readonly priorityDisplay: Record<string, string>;
    readonly typeDisplay: Record<string, string> | null;
  };
}

// ── GitHubProjectBackend ──────────────────────────────────────────────────────

export class GitHubProjectBackend extends AbstractProjectBackend {
  override readonly capabilities = GITHUB_CAPABILITIES;

  constructor(private readonly deps: GitHubBackendDependencies) {
    super();
  }

  // ── resolveRef (override AbstractProjectBackend default) ──────────────────

  /**
   * Resolve a { number } StoryRef by looking up the issue number via findItems.
   * { id } refs pass through unchanged (already resolved).
   */
  protected override async resolveRef(ref: StoryRef): Promise<StoryRef> {
    if ("id" in ref && !("number" in ref)) return ref;
    const result = await this.findItems({
      scope: "all",
      keys: [String(ref.number)],
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
    });
    if (result.items.length === 0) {
      throw new StoryNotFoundError(
        String(ref.number),
        `Story #${ref.number} not found on the project board. ` +
          "Verify the issue number and ensure it appears in the project.",
      );
    }
    return { id: result.items[0].ref.id };
  }

  // ── Platform state ────────────────────────────────────────────────────────

  async getPlatformState(declaredVocabulary: {
    canonicalStatusKeys: string[];
    canonicalPriorityKeys: string[];
  }): Promise<PlatformState> {
    const { statusDisplay, priorityDisplay, typeDisplay } = this.deps.displayConfig;

    const statusDisplayMap: Record<string, string> = {};
    for (const key of declaredVocabulary.canonicalStatusKeys) {
      if (statusDisplay[key]) statusDisplayMap[key] = statusDisplay[key];
    }
    const priorityDisplayMap: Record<string, string> = {};
    for (const key of declaredVocabulary.canonicalPriorityKeys) {
      if (priorityDisplay[key]) priorityDisplayMap[key] = priorityDisplay[key];
    }

    const liveStatusOptions = Object.keys(this.deps.config.statusOptions);
    const livePriorityOptions = Object.keys(this.deps.config.priorityOptions);
    const declaredStatusValues = Object.values(statusDisplayMap);
    const declaredPriorityValues = Object.values(priorityDisplayMap);

    const missingStatusOptions = declaredStatusValues.filter(
      (v) => !liveStatusOptions.includes(v),
    );
    const missingPriorityOptions = declaredPriorityValues.filter(
      (v) => !livePriorityOptions.includes(v),
    );

    const typeLabels = await this.deps.labelResolver.auditTypeLabels();
    const missingLabels = typeLabels.expected.filter((l) => !typeLabels.existing.includes(l));

    return {
      fields: {
        status: {
          exists: !!this.deps.config.fields.statusFieldId,
          options: liveStatusOptions,
          missingOptions: missingStatusOptions,
        },
        sprint: { exists: !!this.deps.config.fields.sprintFieldId },
        story_points: { exists: !!this.deps.config.fields.storyPointsFieldId },
        priority: {
          exists: !!this.deps.config.fields.priorityFieldId,
          options: livePriorityOptions,
          missingOptions: missingPriorityOptions,
        },
        type: {
          exists: !!this.deps.config.fields.typeFieldId,
          configured: Object.keys(this.deps.config.typeOptions).length > 0,
        },
      },
      labels: {
        existing: typeLabels.existing,
        expected: typeLabels.expected,
        missing: missingLabels,
      },
      iterations: {
        active: toSprintInfo(this.deps.config.iterations.active),
        next: toSprintInfo(this.deps.config.iterations.next),
        completed: this.deps.config.iterations.completed.map((i) => toSprintInfo(i)!),
        completedCount: this.deps.config.iterations.completed.length,
      },
      vocabulary: {
        statusDisplay: Object.keys(statusDisplayMap).length > 0 ? statusDisplayMap : null,
        priorityDisplay: Object.keys(priorityDisplayMap).length > 0 ? priorityDisplayMap : null,
        typeDisplay: typeDisplay,
        typeTemplatePaths: this.deps.config.typeTemplatePaths,
      },
      epics: { active: [], totalCount: 0 },
      templateUris: null,
    };
  }

  reload(): Promise<void> {
    return this.deps.configReloader.reload();
  }

  // ── Port methods (P7 — real implementations) ──────────────────────────────

  findItems(filter: ResolvedItemFilter): Promise<ItemSearchResult> {
    return this.deps.storyQueryService.findItems(filter);
  }

  getAnalytics(query: AnalyticsQuery): Promise<AnalyticsResult> {
    return this.deps.analyticsService.getAnalytics(query);
  }

  getBoardHealth(sprintScope: string): Promise<BacklogHealth> {
    return this.deps.boardHealthService.getBoardHealth(sprintScope);
  }

  // ── Story read delegations ────────────────────────────────────────────────

  getStoryDetail(ref: StoryRef): Promise<StoryDetail> {
    return this.deps.storyQueryService.getStoryDetail(ref);
  }

  getEpics(): Promise<EpicListing[]> {
    return this.deps.epicService.getEpics();
  }

  // ── Story write delegations ───────────────────────────────────────────────

  createStory(input: CreateStoryInput): Promise<StoryRef> {
    return this.deps.storyMutationService.createStory(input);
  }

  override createImpediment(
    input: CreateStoryInput,
  ): Promise<{ listing: ImpedimentListing; itemRef: StoryRef }> {
    return this.deps.impedimentService.createImpediment(input);
  }

  updateStory(ref: StoryRef, updates: StoryUpdates): Promise<void> {
    return this.deps.storyMutationService.updateStory(ref, updates);
  }

  setField(
    ref: StoryRef,
    field: "status" | "sprint" | "story_points" | "priority" | "assignee" | "type",
    value: string | number | SprintRef | null,
  ): Promise<void> {
    return this.deps.storyMutationService.setField(ref, field, value);
  }

  addComment(ref: StoryRef, body: string): Promise<void> {
    return this.deps.storyMutationService.addComment(ref, body);
  }

  addVocabulary(kind: VocabularyKind, value: string): Promise<{ created: boolean }> {
    return this.deps.vocabularyManager.addVocabulary(kind, value);
  }

  // ── Impediment delegations ────────────────────────────────────────────────

  getOrphanImpediments(): Promise<ImpedimentListing[]> {
    return this.deps.impedimentService.getOrphanImpediments();
  }

  getSprintImpediments(sprint: SprintRef): Promise<ImpedimentListing[]> {
    return this.deps.impedimentService.getSprintImpediments(sprint);
  }

  override updateImpediment(
    ref: ImpedimentRef,
    status: "open" | "in_progress" | "resolved",
    resolutionNotes?: string,
  ): Promise<ImpedimentListing> {
    return this.deps.impedimentService.updateImpediment(ref, status, resolutionNotes);
  }
}
