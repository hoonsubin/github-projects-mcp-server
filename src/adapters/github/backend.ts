// =============================================================================
// src/adapters/github/backend.ts — GitHubProjectBackend Facade
//
// Thin facade: delegates to injected service objects.
// No business logic lives here — services own their domain.
// Constructor receives a single GitHubBackendDependencies parameter object
// (built by the factory) — no positional-arg proliferation.
// =============================================================================

import { type RuntimeConfig } from "./config-loader.ts";
import { LabelResolver } from "./internal/label-resolver.ts";
import { FieldValueMutator } from "./internal/field-value-mutator.ts";
import { BurndownCalculator } from "./internal/burndown-calculator.ts";
import { SprintHistoryService } from "./internal/sprint-history-service.ts";
import { VocabularyManager } from "./internal/vocabulary-manager.ts";
import { StoryQueryService } from "./internal/story-query-service.ts";
import { StoryMutationService } from "./internal/story-mutation-service.ts";
import { ImpedimentService } from "./internal/impediment-service.ts";
import { EpicService } from "./internal/epic-service.ts";
import { ConfigReloader } from "./internal/config-reloader.ts";
import { toSprintInfo } from "./mappers.ts";
import type {
  AnalyticsQuery,
  BurndownInput,
  CompletionMap,
  CreateStoryInput,
  ImpedimentListing,
  PlatformState,
  ProjectBackend,
  Ref,
  ResolvedItemFilter,
  SprintHistoryEntry,
  SprintInfo,
  StoryDetail,
  StoryUpdates,
  VocabularyKind,
} from "../../scrum/ports.ts";
import type {
  AnalyticsResult,
  BacklogHealth,
  EpicListing,
  ItemSearchResult,
  SprintRef,
  Story,
  StoryRef,
} from "../../domain/types.ts";

// ── Dependencies parameter object ────────────────────────────────────────────

/**
 * All dependencies needed to construct a GitHubProjectBackend.
 * Replaces the 13-positional-arg constructor with a single parameter object,
 * eliminating ordering errors and making call sites self-documenting.
 *
 * displayConfig contains status_display, priority_display, and type_display
 * pre-resolved from GitHubBackendConfig at factory time — getPlatformState
 * never casts via the opaque `backends` map.
 */
export interface GitHubBackendDependencies {
  readonly labelResolver: LabelResolver;
  readonly fieldValueMutator: FieldValueMutator;
  readonly burndownCalculator: BurndownCalculator;
  readonly sprintHistoryService: SprintHistoryService;
  readonly vocabularyManager: VocabularyManager;
  readonly storyQueryService: StoryQueryService;
  readonly storyMutationService: StoryMutationService;
  readonly impedimentService: ImpedimentService;
  readonly epicService: EpicService;
  readonly config: RuntimeConfig;
  readonly owner: string;
  readonly repo: string;
  readonly configReloader: ConfigReloader;
  /** Pre-resolved display name maps (from GitHubBackendConfig) — no cast needed at call time. */
  readonly displayConfig: {
    readonly statusDisplay: Record<string, string>;
    readonly priorityDisplay: Record<string, string>;
    readonly typeDisplay: Record<string, string> | null;
  };
}

// ── GitHubProjectBackend ──────────────────────────────────────────────────────

export class GitHubProjectBackend implements ProjectBackend {
  constructor(private readonly deps: GitHubBackendDependencies) {}

  // ── Vocabulary & history delegations ─────────────────────────────────────
  // Kept as internal methods — not part of the port interface after P2.
  // The port interface now exposes findItems/getAnalytics/getBoardHealth.
  // These remain until adapter services are migrated in P7.

  getCompletedSprintHistory(window: number): Promise<SprintHistoryEntry[]> {
    return this.deps.sprintHistoryService.getCompletedSprintHistory(window);
  }

  getBurndownInput(sprint: SprintRef): Promise<BurndownInput> {
    return this.deps.burndownCalculator.getBurndownInput(sprint);
  }

  resolveCompletionTimestamps(input: BurndownInput): Promise<CompletionMap> {
    return this.deps.burndownCalculator.resolveCompletionTimestamps(input);
  }

  addVocabulary(kind: VocabularyKind, value: string): Promise<{ created: boolean }> {
    return this.deps.vocabularyManager.addVocabulary(kind, value);
  }

  // ── Platform state ────────────────────────────────────────────────────────

  async getPlatformState(declaredVocabulary: {
    canonicalStatusKeys: string[];
    canonicalPriorityKeys: string[];
  }): Promise<PlatformState> {
    // Filter the pre-resolved display maps to only the canonical keys declared
    // by the use-case layer — no need to cast or reach into GitHubBackendConfig.
    const { statusDisplay, priorityDisplay, typeDisplay } = this.deps.displayConfig;

    const statusDisplayMap: Record<string, string> = {};
    for (const key of declaredVocabulary.canonicalStatusKeys) {
      if (statusDisplay[key]) statusDisplayMap[key] = statusDisplay[key];
    }
    const priorityDisplayMap: Record<string, string> = {};
    for (const key of declaredVocabulary.canonicalPriorityKeys) {
      if (priorityDisplay[key]) priorityDisplayMap[key] = priorityDisplay[key];
    }

    // Diff display names against live platform options (keys are display names)
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
      },
      // P2: epics and templateUris are populated by orientUseCase (P5).
      // The adapter returns empty defaults for now.
      epics: { active: [], totalCount: 0 },
      templateUris: null,
    };
  }

  reload(): Promise<void> {
    return this.deps.configReloader.reload();
  }

  // ── Story read delegations ────────────────────────────────────────────────

  getSprintStories(
    sprint: SprintRef,
  ): Promise<{ stories: Story[]; sprintInfo: SprintInfo }> {
    return this.deps.storyQueryService.getSprintStories(sprint);
  }

  getBacklogStories(): Promise<Story[]> {
    return this.deps.storyQueryService.getBacklogStories();
  }

  getStoryDetail(ref: StoryRef): Promise<StoryDetail> {
    return this.deps.storyQueryService.getStoryDetail(ref);
  }

  getEpics(): Promise<EpicListing[]> {
    return this.deps.epicService.getEpics();
  }

  // ── New port methods (P2) — stub implementations, full impl in P7 ─────────

  /**
   * Unified item search across all PBIs.
   * @throws {Error} Always — not yet implemented. Full impl in P7.
   */
  findItems(_filter: ResolvedItemFilter): Promise<ItemSearchResult> {
    throw new Error(
      "findItems not yet implemented — " +
        "this stub exists so the port interface compiles. " +
        "Full implementation coming in P7 (GitHub Adapter Migration).",
    );
  }

  /**
   * Unified sprint analytics (burndown + history).
   * @throws {Error} Always — not yet implemented. Full impl in P7.
   */
  getAnalytics(_query: AnalyticsQuery): Promise<AnalyticsResult> {
    throw new Error(
      "getAnalytics not yet implemented — " +
        "this stub exists so the port interface compiles. " +
        "Full implementation coming in P7 (GitHub Adapter Migration).",
    );
  }

  /**
   * Board health dashboard — aggregated metrics without item lists.
   * @throws {Error} Always — not yet implemented. Full impl in P7.
   */
  getBoardHealth(_sprintScope: string): Promise<BacklogHealth> {
    throw new Error(
      "getBoardHealth not yet implemented — " +
        "this stub exists so the port interface compiles. " +
        "Full implementation coming in P7 (GitHub Adapter Migration).",
    );
  }

  // ── Story write delegations ───────────────────────────────────────────────

  createStory(input: CreateStoryInput): Promise<StoryRef> {
    return this.deps.storyMutationService.createStory(input);
  }

  createImpediment(
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

  // ── Impediment delegations ────────────────────────────────────────────────

  getOrphanImpediments(): Promise<ImpedimentListing[]> {
    return this.deps.impedimentService.getOrphanImpediments();
  }

  getSprintImpediments(sprint: SprintRef): Promise<ImpedimentListing[]> {
    return this.deps.impedimentService.getSprintImpediments(sprint);
  }

  updateImpediment(
    ref: Ref,
    status: "open" | "in_progress" | "resolved",
    resolutionNotes?: string,
  ): Promise<ImpedimentListing> {
    return this.deps.impedimentService.updateImpediment(ref, status, resolutionNotes);
  }
}
