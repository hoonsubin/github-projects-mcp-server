// =============================================================================
// src/tools/scrum-read.ts - Thin tool handlers delegating to use-case functions
//
// No handler imports graphql, rest, loadConfig, resolveSprint, or any GitHub raw type.
// =============================================================================

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// ── Tool name constants ────────────────────────────────────────────────────────
// Single source of truth for every tool this module registers.
// Imported by src/server.ts for degraded-mode stub registration.

export const SCRUM_READ_TOOL_NAMES = [
  // Active tools
  "scrum_orient",
  "scrum_find_items",
  "scrum_get_item_detail",
  "scrum_get_board_health",
  "scrum_get_analytics",
] as const;
import type { FileReaderPort, ProjectBackend } from "../scrum/ports.ts";
import type { ScrumConfig } from "../domain/config.ts";

import {
  FindItemsSchema,
  GetAnalyticsSchema,
  GetBoardHealthSchema,
  GetStorySchema,
} from "../schemas/scrum.ts";
import { z } from "zod";

import { orientUseCase } from "../scrum/orient.ts";
import { getStoryUseCase } from "../scrum/get-story.ts";
import { findItemsUseCase } from "../scrum/find-items.ts";
import { getAnalyticsUseCase } from "../scrum/get-analytics.ts";
import { getBoardHealthUseCase } from "../scrum/get-board-health.ts";

// ── Tool registration ──────────────────────────────────────────────────────────

export const registerScrumReadTools = (
  server: McpServer,
  backend: ProjectBackend,
  scrumConfig: ScrumConfig,
  _fileReader: FileReaderPort | null,
): void => {
  // ── scrum_orient ───────────────────────────────────────────────────────────

  server.registerTool(
    "scrum_orient",
    {
      title: "Orient to Project",
      description:
        `Entry point - call this FIRST when connecting to a project or starting any workflow.

        Returns the current platform state (active sprint dates, field IDs, iteration list)
        and the declared Scrum vocabulary for this project (status options, priority tiers,
        sprint names). The vocabulary values returned here are the exact strings you must
        pass to write tools - they are project-specific and cannot be guessed.

        No arguments required. Pass {} or omit arguments entirely.`,
      inputSchema: z.object({ _: z.string().optional() }).shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async () => {
      const { data, warnings } = await orientUseCase(backend, scrumConfig);
      const response = warnings.length > 0 ? { ...data, warnings } : data;
      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
    },
  );

  // ── scrum_get_item_detail ─────────────────────────────────────────────────

  const getItemDetailHandler = async (params: z.infer<typeof GetStorySchema>) => {
    const { data, warnings } = await getStoryUseCase(backend, params.ref);
    const response = warnings.length > 0 ? { ...data, warnings } : data;
    return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
  };

  server.registerTool(
    "scrum_get_item_detail",
    {
      title: "Get Item Detail",
      description:
        `Return full details for a single backlog item: content, all board fields, comments,
        linked PRs, and acceptance criteria.

        Args:
          ref  { number: integer } | { id: string }
               At least one of number or id is required.
               number = visible issue number (e.g. 42) - use for direct user-driven lookups
               id = opaque board item ID from a previous tool response - use this when already held

        Returns: Story object with full body, comments array, and linked PR list.`,
      inputSchema: GetStorySchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    getItemDetailHandler,
  );

  // ── scrum_find_items ───────────────────────────────────────────────────────

  server.registerTool(
    "scrum_find_items",
    {
      title: "Find Items",
      description: `Unified item search across all PBIs.

        Search by scope, keys, text, type, status, priority, epic, labels, assignee,
        or sprint. Optionally include the full dependency graph.

        Args:
          scope  "backlog" | "sprint" | "all" - default: "all"
          keys   string[] - numeric issue keys to fetch directly, e.g. ["42", "123"]
          search string - case-insensitive substring match on title + body
          types  string[] - filter by item type canonical keys (e.g. ["feature", "bug"])
          statuses string[] - filter by status display names (e.g. ["In Progress"])
          priority string - filter by priority display name (e.g. "Must")
          epic_id string - filter by epic/milestone ID
          labels string[] - require ALL of these labels
          assignee string - filter by GitHub login
          estimated boolean - true = estimated only; false = unestimated only
          sprint_ref "current" | "next" | "<name>" - filter by sprint
          include_dependencies boolean (default false) - include dependency_map
          limit number (default 50)

        Returns: {
          items: ItemListing[],
          scope_summary: { total_count, limit, scope, filters_applied },
          dependency_map?: DependencyMap  - only if include_dependencies=true
        }`,
      inputSchema: FindItemsSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: z.infer<typeof FindItemsSchema>) => {
      const { data, warnings } = await findItemsUseCase(backend, params);
      const response = warnings.length > 0 ? { ...data, warnings } : data;
      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
    },
  );

  // ── scrum_get_analytics ────────────────────────────────────────────────────

  server.registerTool(
    "scrum_get_analytics",
    {
      title: "Get Sprint Analytics",
      description: `Unified sprint analytics - burndown + velocity history.

        Args:
          view   "burndown" | "history" | "both" - default: "both"
                 "burndown" = burndown chart data for the target sprint
                 "history" = completed sprint velocity snapshots
                 "both" = burndown + history
          sprint_ref "current" | "next" | "<name>" - target sprint for burndown
                     defaults to "current"
          history_window number 1-10, default 5 - how many completed sprints

        Returns: {
          burndown: BurndownResponse | null,
          history: SprintSnapshot[] | null,
          window: number
        }`,
      inputSchema: GetAnalyticsSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: z.infer<typeof GetAnalyticsSchema>) => {
      const { data, warnings } = await getAnalyticsUseCase(backend, {
        view: params.view ?? "both",
        sprint_ref: params.sprint_ref,
        history_window: params.history_window,
      });
      const response = warnings.length > 0 ? { ...data, warnings } : data;
      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
    },
  );

  // ── scrum_get_board_health ─────────────────────────────────────────────────

  server.registerTool(
    "scrum_get_board_health",
    {
      title: "Get Board Health",
      description: `Board health dashboard - aggregate metrics without item lists.

        Returns readiness breakdown (by PBI type with overall %), sprint risk counts
        (unestimated/blocked/no-assignee), impediment counts (orphan + open), and
        ungroomed count. No individual story data - use scrum_find_items
        for item-level queries.

        Args:
          sprint_scope string - "current" | "next" | "<name>" - which sprint to assess
                        defaults to "current"

        Returns: {
          readiness: { by_type: Record<ItemType, { ready, not_ready, total }>, overall_pct: number },
          sprint_risk: { unestimated_count, blocked_count, no_assignee_count } | null,
          impediments: { orphan_count, open_count },
          ungroomed_count: number
        }`,
      inputSchema: GetBoardHealthSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: z.infer<typeof GetBoardHealthSchema>) => {
      const { data, warnings } = await getBoardHealthUseCase(backend, params.sprint_scope);
      const response = warnings.length > 0 ? { ...data, warnings } : data;
      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
    },
  );
};
