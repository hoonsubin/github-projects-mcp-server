// =============================================================================
// src/adapters/github/backend.ts - GitHubProjectBackend Facade
//
// Thin facade: delegates to injected service objects.
// No business logic lives here - services own their domain.
// Extends AbstractProjectBackend for shared infrastructure (resolveRef, capability
// checks, optional method defaults). Constructor receives a single
// GitHubBackendDependencies parameter object (built by the factory).
// =============================================================================

import { GITHUB_CAPABILITIES } from "../capabilities.ts";
import { AbstractProjectBackend } from "../abstract-backend.ts";
import { assertNever } from "../../domain/errors.ts";
import { type GitHubBootState } from "./bootstrap.ts";
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
import { resolveSprintGoal } from "./mappers.ts";
import { classifyFilter } from "./internal/filter-strategy-router.ts";
import { DirectLookupAssembler } from "./internal/assemblers/direct-lookup-assembler.ts";
import { ProjectItemsAssembler } from "./internal/assemblers/project-items-assembler.ts";
import { SearchApiAssembler } from "./internal/assemblers/search-api-assembler.ts";
import { MixedAssembler } from "./internal/assemblers/mixed-assembler.ts";
import { BoardScanCoordinator } from "./internal/board-scan-coordinator.ts";
import { SprintDataService } from "./internal/read-services/sprint-data-service.ts";
import {
  storySnapshotOverridesFromCreateStory,
  storySnapshotOverridesFromSetField,
  storySnapshotOverridesFromStoryUpdates,
} from "./mappers.ts";
import { resolveProjectItemIdByIssueNumber } from "./internal/resolve-issue-number.ts";
import type { GitHubClient } from "./internal/http-client.ts";
import type { GitHubBackendConfig } from "./types.ts";
import type {
  AnalyticsQuery,
  CreateResult,
  CreateStoryInput,
  ImpedimentListing,
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
import { type BackendCallResult, catchBackend } from "../../services/error-enrichment.ts";
import type {
  AnalyticsResult,
  BacklogHealth,
  EntityRef,
  EpicListing,
  ImpedimentRef,
  ImpedimentStatus,
  ItemSearchResult,
  IterationEntry,
  SprintRef,
  Story,
  StoryRef,
} from "../../domain/types.ts";

// ── Dependencies parameter object ────────────────────────────────────────────

/**
 * All dependencies needed to construct a GitHubProjectBackend.
 *
 * Item search flows through assembler instances (direct lookup, project items,
 * search API, mixed) wired to ExecutionEngine + ResultNormalizer.
 */
export interface GitHubBackendDependencies {
  readonly gh: GitHubClient;
  readonly boardScan: BoardScanCoordinator;
  readonly labelResolver: LabelResolver;
  readonly fieldValueMutator: FieldValueMutator;
  readonly vocabularyManager: VocabularyManager;
  readonly storyQueryService: StoryQueryService;
  readonly storyMutationService: StoryMutationService;
  readonly impedimentService: ImpedimentService;
  readonly epicService: EpicService;
  readonly config: GitHubBootState;
  readonly ghConfig: GitHubBackendConfig;
  readonly owner: string;
  readonly repo: string;
  readonly configReloader: ConfigReloader;
  readonly analyticsService: AnalyticsService;
  readonly boardHealthService: BoardHealthService;
  readonly directLookupAssembler: DirectLookupAssembler;
  readonly projectItemsAssembler: ProjectItemsAssembler;
  readonly searchApiAssembler: SearchApiAssembler;
  readonly sprintDataService: SprintDataService;
  readonly mixedAssembler: MixedAssembler;
}

// ── GitHubProjectBackend ──────────────────────────────────────────────────────

export class GitHubProjectBackend extends AbstractProjectBackend {
  override readonly capabilities = GITHUB_CAPABILITIES;

  constructor(private readonly deps: GitHubBackendDependencies) {
    super();
  }

  // ── resolveRef (override AbstractProjectBackend default) ──────────────────

  /**
   * Resolve a { number } StoryRef via GetIssueProjectItem (no board scan).
   * { id } refs pass through unchanged (already resolved).
   */
  protected override async resolveRef(ref: StoryRef): Promise<StoryRef> {
    if (!("number" in ref)) return ref;
    const id = await resolveProjectItemIdByIssueNumber(
      this.deps.gh,
      this.deps.ghConfig,
      ref.number,
    );
    return { id };
  }

  // ── Platform state ────────────────────────────────────────────────────────

  async getPlatformState(declaredVocabulary: {
    canonicalStatusKeys: string[];
    canonicalPriorityKeys: string[];
  }): Promise<BackendCallResult<PlatformState>> {
    const warnings: string[] = [];

    const buildSprintInfo = async (iter: IterationEntry | null): Promise<SprintInfo | null> => {
      if (!iter) return null;
      const { value: goal, warnings: gw } = await catchBackend(
        (): Promise<string> => resolveSprintGoal(iter),
      );
      warnings.push(...gw);
      const endDate = new Date(iter.startDate);
      endDate.setDate(endDate.getDate() + iter.duration);
      return {
        id: iter.id,
        name: iter.title,
        goal,
        startDate: iter.startDate,
        durationDays: iter.duration,
        endDate: endDate.toISOString().slice(0, 10),
      };
    };

    const statusDisplay = this.deps.ghConfig.status_display ?? {};
    const priorityDisplay = this.deps.ghConfig.priority_display ?? {};
    const typeDisplay: Record<string, string> | null = this.deps.ghConfig.type_mapping
      ? Object.fromEntries(
        Object.entries(this.deps.ghConfig.type_mapping).map(([k, v]) => [k, v.display]),
      )
      : null;

    const statusDisplayMap: Record<string, string> = {};
    for (const key of declaredVocabulary.canonicalStatusKeys) {
      if (statusDisplay[key]) statusDisplayMap[key] = statusDisplay[key];
    }
    const priorityDisplayMap: Record<string, string> = {};
    for (const key of declaredVocabulary.canonicalPriorityKeys) {
      if (priorityDisplay[key]) priorityDisplayMap[key] = priorityDisplay[key];
    }

    const liveStatusOptions = Object.keys(this.deps.config.live.statusOptions);
    const livePriorityOptions = Object.keys(this.deps.config.live.priorityOptions);
    const missingStatusOptions = Object.values(statusDisplayMap).filter(
      (v) => !liveStatusOptions.includes(v),
    );
    const missingPriorityOptions = Object.values(priorityDisplayMap).filter(
      (v) => !livePriorityOptions.includes(v),
    );

    const typeLabels = await this.deps.labelResolver.auditTypeLabels();
    const missingLabels = typeLabels.expected.filter((l) => !typeLabels.existing.includes(l));

    const [active, next, ...completedOrNull] = await Promise.all([
      buildSprintInfo(this.deps.config.live.iterations.active),
      buildSprintInfo(this.deps.config.live.iterations.next),
      ...this.deps.config.live.iterations.completed.map((i) => buildSprintInfo(i)),
    ]);
    const completed = completedOrNull.filter((info): info is SprintInfo => info !== null);

    const value: PlatformState = {
      fields: {
        status: {
          exists: !!this.deps.config.live.fields.statusFieldId,
          options: liveStatusOptions,
          missingOptions: missingStatusOptions,
        },
        sprint: { exists: !!this.deps.config.live.fields.sprintFieldId },
        story_points: { exists: !!this.deps.config.live.fields.storyPointsFieldId },
        priority: {
          exists: !!this.deps.config.live.fields.priorityFieldId,
          options: livePriorityOptions,
          missingOptions: missingPriorityOptions,
        },
        type: {
          exists: this.deps.config.live.typeResolution !== null,
          configured: Object.keys(this.deps.config.live.typeOptions).length > 0,
        },
      },
      labels: {
        existing: typeLabels.existing,
        expected: typeLabels.expected,
        missing: missingLabels,
      },
      iterations: {
        active: active ?? null,
        next: next ?? null,
        completed,
        completedCount: this.deps.config.live.iterations.completed.length,
      },
      vocabulary: {
        statusDisplay: Object.keys(statusDisplayMap).length > 0 ? statusDisplayMap : null,
        priorityDisplay: Object.keys(priorityDisplayMap).length > 0 ? priorityDisplayMap : null,
        typeDisplay: typeDisplay,
        typeTemplatePaths: this.deps.config.live.typeTemplatePaths,
      },
      epics: { active: [], totalCount: 0 },
      templateUris: null,
    };

    return { value, warnings: [...new Set(warnings)] };
  }

  override async reloadMetadata(): Promise<void> {
    await this.deps.configReloader.reload();
    this.deps.labelResolver.invalidateLabelCache();
  }

  override async reload(): Promise<void> {
    await this.reloadMetadata();
    this.deps.boardScan.invalidate();
  }

  // ── Port methods (P7 - real implementations) ──────────────────────────────

  async findItems(filter: ResolvedItemFilter): Promise<BackendCallResult<ItemSearchResult>> {
    const profile = classifyFilter(filter);
    const { items, totalCount, scopeSummary, dependencyMap, warnings } = await (() => {
      switch (profile.kind) {
        case "direct_lookup":
          return this.deps.directLookupAssembler.assemble(profile, filter);
        case "search_api":
          return this.deps.searchApiAssembler.assemble(profile, filter);
        case "project_items":
          return this.deps.projectItemsAssembler.assemble(profile.filter);
        case "mixed":
          return this.deps.mixedAssembler.assemble(profile.filter);
        default:
          return assertNever(profile);
      }
    })();

    return {
      value: {
        items,
        total_count: totalCount,
        scope_summary: {
          sprint_count: scopeSummary.sprint_count,
          backlog_count: scopeSummary.backlog_count,
        },
        dependency_map: dependencyMap,
      },
      warnings: [...warnings],
    };
  }

  getAnalytics(query: AnalyticsQuery): Promise<AnalyticsResult> {
    return this.deps.analyticsService.getAnalytics(query);
  }

  override getSprintData(query: SprintDataQuery): Promise<SprintRawData> {
    return this.deps.sprintDataService.getSprintData(query);
  }

  getBoardHealth(sprintScope: string): Promise<BacklogHealth> {
    return this.deps.boardHealthService.getBoardHealth(sprintScope);
  }

  // ── Story read delegations ────────────────────────────────────────────────

  async getStoryDetail(ref: StoryRef): Promise<BackendCallResult<StoryDetail>> {
    const resolved = await this.resolveRef(ref);
    return this.deps.storyQueryService.getStoryDetail(resolved);
  }

  async composeStorySnapshot(
    ref: StoryRef,
    overrides?: StorySnapshotOverrides,
  ): Promise<BackendCallResult<Story>> {
    const resolved = await this.resolveRef(ref) as EntityRef;
    return this.deps.storyQueryService.composeStorySnapshot(resolved, overrides);
  }

  composeStoryAfterSetField(
    ref: StoryRef,
    field: ScrumField,
    value: string | number | SprintRef | null,
  ): Promise<BackendCallResult<Story>> {
    return this.composeStorySnapshot(
      ref,
      storySnapshotOverridesFromSetField(field, value, this.deps.config),
    );
  }

  composeStoryAfterStoryUpdate(
    ref: StoryRef,
    updates: StoryUpdates,
  ): Promise<BackendCallResult<Story>> {
    return this.composeStorySnapshot(ref, storySnapshotOverridesFromStoryUpdates(updates));
  }

  composeStoryAfterCreateStory(
    ref: StoryRef,
    input: CreateStoryInput,
  ): Promise<BackendCallResult<Story>> {
    return this.composeStorySnapshot(
      ref,
      storySnapshotOverridesFromCreateStory(input, this.deps.config),
    );
  }

  getEpics(sprintIterationId?: string | null): Promise<EpicListing[]> {
    return this.deps.epicService.getEpics(sprintIterationId);
  }

  getSprintCompletion(iterationId: string): Promise<{ completed: number; total: number }> {
    return this.deps.storyQueryService.computeSprintCompletion(iterationId);
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

  async updateStory(ref: StoryRef, updates: StoryUpdates): Promise<void> {
    const resolved = await this.resolveRef(ref);
    return this.deps.storyMutationService.updateStory(resolved, updates);
  }

  async setField(
    ref: StoryRef,
    field: ScrumField,
    value: string | number | SprintRef | null,
  ): Promise<void> {
    const resolved = await this.resolveRef(ref);
    return this.deps.storyMutationService.setField(resolved, field, value);
  }

  async addComment(ref: StoryRef, body: string): Promise<void> {
    const resolved = await this.resolveRef(ref);
    return this.deps.storyMutationService.addComment(resolved, body);
  }

  addVocabulary(kind: VocabularyKind, value: string): Promise<CreateResult> {
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
    status: ImpedimentStatus,
    resolutionNotes?: string,
  ): Promise<ImpedimentListing> {
    return this.deps.impedimentService.updateImpediment(ref, status, resolutionNotes);
  }
}
