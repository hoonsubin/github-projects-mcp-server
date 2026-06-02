// =============================================================================
// Declarative port-level capture scenarios for GitHub backend.
// =============================================================================

import type { ProjectBackend } from "../../../src/scrum/ports.ts";
import type { ScrumConfig } from "../../../src/domain/config.ts";
import type { FixtureCatalog } from "../../../src/adapters/github/internal/fixture-replay/types.ts";
import {
  handleFindItems,
  handleGetAnalytics,
  handleGetBoardHealth,
  handleGetItemDetail,
  handleOrient,
} from "../../../src/tools/scrum-read.ts";
import type { McpTextResult } from "../../../src/tools/_mcp_result.ts";

export interface CaptureScenarioContext {
  readonly backend: ProjectBackend;
  readonly scrumConfig: ScrumConfig;
  readonly catalog: FixtureCatalog;
}

export interface CaptureScenario {
  readonly name: string;
  readonly run: (ctx: CaptureScenarioContext) => Promise<unknown>;
  readonly captureHandler?: boolean;
}

export const CAPTURE_SCENARIOS: CaptureScenario[] = [
  {
    name: "orient",
    async run({ backend, scrumConfig }) {
      await backend.reload();
      const statusKeys = Object.keys(scrumConfig.scrum.status);
      const priorityKeys = scrumConfig.scrum.priority.map((p) => p.key);
      const platformState = await backend.getPlatformState({
        canonicalStatusKeys: statusKeys,
        canonicalPriorityKeys: priorityKeys,
      });
      const epics = await backend.getEpics();
      let sprintCompletion: { completed: number; total: number } | null = null;
      const activeId = platformState.value?.iterations.active?.id;
      if (activeId) {
        sprintCompletion = await backend.getSprintCompletion(activeId);
      }
      return { platformState, epics, sprintCompletion };
    },
    captureHandler: true,
  },
  {
    name: "find-items-all",
    async run({ backend }) {
      return backend.findItems({
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
        limit: 50,
      });
    },
    captureHandler: true,
  },
  {
    name: "find-items-deps",
    async run({ backend }) {
      return backend.findItems({
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
        include_dependencies: true,
        limit: 10,
      });
    },
  },
  {
    name: "board-health",
    async run({ backend }) {
      return backend.getBoardHealth("current");
    },
    captureHandler: true,
  },
  {
    name: "analytics-both",
    async run({ backend, scrumConfig }) {
      const window = scrumConfig.scrum.sprint?.velocity_window ?? 5;
      return backend.getAnalytics({
        view: "both",
        sprint_ref: "current",
        history_window: window,
      });
    },
    captureHandler: true,
  },
  {
    name: "get-story-detail",
    async run({ backend, catalog }) {
      if (!catalog.sampleItemRef) {
        return { skipped: true, reason: "no sample issue item on board" };
      }
      return backend.getStoryDetail({ id: catalog.sampleItemRef.id });
    },
    captureHandler: true,
  },
];

export const runHandlerSnapshot = async (
  scenarioName: string,
  ctx: CaptureScenarioContext,
  portOutput: unknown,
): Promise<McpTextResult | null> => {
  switch (scenarioName) {
    case "orient":
      return handleOrient(ctx.backend, ctx.scrumConfig);
    case "find-items-all":
      return handleFindItems(ctx.backend, {
        scope: "all",
        include_dependencies: false,
        limit: 50,
      });
    case "find-items-deps":
      return handleFindItems(ctx.backend, {
        scope: "all",
        include_dependencies: true,
        limit: 10,
      });
    case "board-health":
      return handleGetBoardHealth(ctx.backend, { sprint_scope: "current" });
    case "analytics-both": {
      const window = ctx.scrumConfig.scrum.sprint?.velocity_window ?? 5;
      return handleGetAnalytics(ctx.backend, {
        view: "both",
        sprint_ref: "current",
        history_window: window,
      });
    }
    case "get-story-detail": {
      if (!ctx.catalog.sampleItemRef) return null;
      return handleGetItemDetail(ctx.backend, { ref: { id: ctx.catalog.sampleItemRef.id } });
    }
    default:
      return null;
  }
};
