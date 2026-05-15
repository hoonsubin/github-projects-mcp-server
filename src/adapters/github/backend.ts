// =============================================================================
// src/adapters/github/backend.ts — GitHubProjectBackend Facade
//
// Thin facade: delegates to injected service objects.
// No business logic lives here — services own their domain.
// Constructor receives pre-built service instances (DIP via composition root).
// =============================================================================

import { fetchRepoFile } from "./internal/contents.ts";
import { type RuntimeConfig } from "./config-loader.ts";
import { LabelResolver } from "./internal/label-resolver.ts";
import { UserMilestoneResolver } from "./internal/user-milestone-resolver.ts";
import { FieldValueMutator } from "./internal/field-value-mutator.ts";
import { BurndownCalculator } from "./internal/burndown-calculator.ts";
import { SprintHistoryService } from "./internal/sprint-history-service.ts";
import { VocabularyManager } from "./internal/vocabulary-manager.ts";
import { StoryQueryService } from "./internal/story-query-service.ts";
import { StoryMutationService } from "./internal/story-mutation-service.ts";
import { ImpedimentService } from "./internal/impediment-service.ts";
import { toSprintInfo } from "./mappers.ts";
import type {
  BurndownInput,
  CompletionMap,
  CreateStoryInput,
  ImpedimentListing,
  PlatformState,
  ProjectBackend,
  Ref,
  SprintHistoryEntry,
  SprintInfo,
  StoryDetail,
  StoryUpdates,
  VocabularyKind,
} from "../../scrum/ports.ts";
import type { SprintRef, Story, StoryRef } from "../../domain/types.ts";

// ── GitHubProjectBackend ──────────────────────────────────────────────────────

export class GitHubProjectBackend implements ProjectBackend {
  constructor(
    private readonly labelResolver: LabelResolver,
    private readonly userMilestoneResolver: UserMilestoneResolver,
    private readonly fieldValueMutator: FieldValueMutator,
    private readonly burndownCalculator: BurndownCalculator,
    private readonly sprintHistoryService: SprintHistoryService,
    private readonly vocabularyManager: VocabularyManager,
    private readonly storyQueryService: StoryQueryService,
    private readonly storyMutationService: StoryMutationService,
    private readonly impedimentService: ImpedimentService,
    private readonly config: RuntimeConfig,
    private readonly owner: string,
    private readonly repo: string,
  ) {}

  // ── Vocabulary & history delegations ─────────────────────────────────────

  getCompletedSprintHistory(window: number): Promise<SprintHistoryEntry[]> {
    return this.sprintHistoryService.getCompletedSprintHistory(window);
  }

  getBurndownInput(sprint: SprintRef): Promise<BurndownInput> {
    return this.burndownCalculator.getBurndownInput(sprint);
  }

  resolveCompletionTimestamps(input: BurndownInput): Promise<CompletionMap> {
    return this.burndownCalculator.resolveCompletionTimestamps(input);
  }

  addVocabulary(kind: VocabularyKind, value: string): Promise<{ created: boolean }> {
    return this.vocabularyManager.addVocabulary(kind, value);
  }

  // ── Platform state ────────────────────────────────────────────────────────

  async getPlatformState(declaredVocabulary: {
    statusValues: string[];
    priorityValues: string[];
  }): Promise<PlatformState> {
    const liveStatusOptions = Object.keys(this.config.statusOptions);
    const livePriorityOptions = Object.keys(this.config.priorityOptions);

    const missingStatusOptions = declaredVocabulary.statusValues.filter(
      (v) => !liveStatusOptions.includes(v),
    );
    const missingPriorityOptions = declaredVocabulary.priorityValues.filter(
      (v) => !livePriorityOptions.includes(v),
    );

    const typeLabels = await this.labelResolver.auditTypeLabels();
    const missingLabels = typeLabels.expected.filter((l) => !typeLabels.existing.includes(l));

    return {
      fields: {
        status: {
          exists: !!this.config.fields.statusFieldId,
          options: liveStatusOptions,
          missingOptions: missingStatusOptions,
        },
        sprint: { exists: !!this.config.fields.sprintFieldId },
        story_points: { exists: !!this.config.fields.storyPointsFieldId },
        priority: {
          exists: !!this.config.fields.priorityFieldId,
          options: livePriorityOptions,
          missingOptions: missingPriorityOptions,
        },
      },
      labels: {
        existing: typeLabels.existing,
        expected: typeLabels.expected,
        missing: missingLabels,
      },
      iterations: {
        active: toSprintInfo(this.config.iterations.active),
        next: toSprintInfo(this.config.iterations.next),
        completed: this.config.iterations.completed.map((i) => toSprintInfo(i)!),
        completedCount: this.config.iterations.completed.length,
      },
    };
  }

  // ── Story read delegations ────────────────────────────────────────────────

  getSprintStories(
    sprint: SprintRef,
  ): Promise<{ stories: Story[]; sprintInfo: SprintInfo | null }> {
    return this.storyQueryService.getSprintStories(sprint);
  }

  getBacklogStories(): Promise<Story[]> {
    return this.storyQueryService.getBacklogStories();
  }

  getStoryDetail(ref: StoryRef): Promise<StoryDetail> {
    return this.storyQueryService.getStoryDetail(ref);
  }

  // ── Story write delegations ───────────────────────────────────────────────

  createStory(input: CreateStoryInput): Promise<StoryRef> {
    return this.storyMutationService.createStory(input);
  }

  createImpediment(
    input: CreateStoryInput,
  ): Promise<{ listing: ImpedimentListing; itemRef: StoryRef }> {
    return this.impedimentService.createImpediment(input);
  }

  updateStory(ref: StoryRef, updates: StoryUpdates): Promise<void> {
    return this.storyMutationService.updateStory(ref, updates);
  }

  setField(
    ref: StoryRef,
    field: "status" | "sprint" | "story_points" | "priority" | "assignee" | "type",
    value: string | number | SprintRef | null,
  ): Promise<void> {
    return this.storyMutationService.setField(ref, field, value);
  }

  addComment(ref: StoryRef, body: string): Promise<void> {
    return this.storyMutationService.addComment(ref, body);
  }

  // ── Impediment delegations ────────────────────────────────────────────────

  getOrphanImpediments(): Promise<ImpedimentListing[]> {
    return this.impedimentService.getOrphanImpediments();
  }

  getSprintImpediments(sprint: SprintRef): Promise<ImpedimentListing[]> {
    return this.impedimentService.getSprintImpediments(sprint);
  }

  updateImpediment(
    ref: Ref,
    status: "open" | "in_progress" | "resolved",
    resolutionNotes?: string,
  ): Promise<ImpedimentListing> {
    return this.impedimentService.updateImpediment(ref, status, resolutionNotes);
  }

  // ── Repo file ─────────────────────────────────────────────────────────────

  fetchRepoFile(path: string): Promise<string> {
    return fetchRepoFile(this.owner, this.repo, path);
  }
}
