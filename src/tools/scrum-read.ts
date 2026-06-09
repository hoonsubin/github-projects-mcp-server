// =============================================================================
// src/tools/scrum-read.ts - Thin tool handlers delegating to use-case functions
//
// No handler imports graphql, rest, loadConfig, resolveSprint, or any GitHub raw type.
// =============================================================================

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ProjectBackend } from "../scrum/ports.ts";
import type { ScrumConfig } from "../domain/config.ts";
import {
  FindItemsSchema,
  GetAnalyticsSchema,
  GetBoardHealthSchema,
  GetSprintDataSchema,
  GetStorySchema,
} from "../schemas/scrum.ts";
import { z } from "zod";
import {
  DeprecationStubSchema,
  ItemDetailResultSchema,
  ItemSearchResultSchema,
  OrientResultSchema,
  SprintRawDataSchema,
} from "../schemas/scrum-outputs.ts";
import {
  handleFindItems,
  handleGetAnalytics,
  handleGetBoardHealth,
  handleGetItemDetail,
  handleGetSprintData,
  handleOrient,
} from "./handlers/read.ts";

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
  "scrum_get_sprint_data",
] as const;

// ── Tool registration ──────────────────────────────────────────────────────────

export const registerScrumReadTools = (
  server: McpServer,
  backend: ProjectBackend,
  scrumConfig: ScrumConfig,
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

        Key fields to cache for the session:
          platform_state.deadline_field - null when the project does not track deadlines via a
            custom field. When non-null, it is the exact key to use when reading deadline values
            from item.custom_fields[deadline_field]. Do not re-orient just to retrieve this value.
          vocabulary.status - canonical key → display label map; always resolve status values from
            here before passing to scrum_set_field. Never hardcode strings like "Done" or "In Progress".

        No arguments required. Pass {} or omit arguments entirely.`,
      inputSchema: z.object({ _: z.string().optional() }).shape,
      outputSchema: OrientResultSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    () => handleOrient(backend, scrumConfig),
  );

  // ── scrum_get_item_detail ─────────────────────────────────────────────────

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
      outputSchema: ItemDetailResultSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    (params: z.infer<typeof GetStorySchema>) => handleGetItemDetail(backend, params),
  );

  // ── scrum_find_items ───────────────────────────────────────────────────────

  // todo: improve this tool so epic can be a search scope
  // the search argument and method should also be improved so it's more generalized and flexible
  server.registerTool(
    "scrum_find_items",
    {
      title: "Find Items",
      description: `Unified item search across all PBIs.

        Search by scope, keys, text, type, status, priority, epic, labels, assignee,
        or sprint. Optionally include the full dependency graph.

        scope vs sprint_ref - two distinct filters, use the right one:
          scope: "sprint"        → items in the CURRENT active sprint ("what's in this sprint")
          sprint_ref: "Sprint 3" → items in a named or historical sprint (retro, cross-sprint queries)
          These are orthogonal. scope sets the query domain; sprint_ref targets a specific iteration.

        Args:
          scope  "backlog" | "sprint" | "all" - default: "all"
          keys   string[] - fetch specific items by issue number; MUST be strings: ["42", "123"] not [42, 123]
          search string - case-insensitive substring match on title + body
          types  string[] - filter by item type canonical keys (e.g. ["feature", "bug", "impediment"])
          statuses string[] - filter by status display names (e.g. ["In Progress"])
          priority string - filter by priority display name (e.g. "Must")
          epic_id string - filter by epic/milestone ID
          labels string[] - require ALL of these labels
          assignee string - filter by GitHub login
          estimated boolean - true = estimated only; false = unestimated only
          sprint_ref "current" | "next" | "<name>" - filter by sprint (named or historical)
          include_dependencies boolean (default false) - include dependency_map.
                   EXPENSIVE: triggers a full graph traversal. Only pass true for ReadinessCheck
                   (verify all blocked_by items are Done before sprint entry) or SprintReport
                   (count items with unresolved upstream dependencies). Default false for all other queries.
          limit number (default 50)

        Returns: {
          items: BacklogItemListing[],
          total_count: number,           ← top-level field, NOT inside scope_summary
          scope_summary: { sprint_count: number | null, backlog_count: number | null },
          dependency_map: DependencyMap | null  - populated only when include_dependencies=true
        }`,
      inputSchema: FindItemsSchema.shape,
      outputSchema: ItemSearchResultSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    (params: z.infer<typeof FindItemsSchema>) => handleFindItems(backend, params),
  );

  // ── scrum_get_analytics ────────────────────────────────────────────────────

  server.registerTool(
    "scrum_get_analytics",
    {
      title: "Get Sprint Analytics",
      description: `DEPRECATED — use scrum_get_sprint_data instead.

        This tool no longer returns analytics. The agent skill computes burndown,
        velocity, and sprint history from raw sprint data.

        Returns: { deprecated: true, use: "scrum_get_sprint_data" }`,
      inputSchema: GetAnalyticsSchema.shape,
      outputSchema: DeprecationStubSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    (params: z.infer<typeof GetAnalyticsSchema>) => handleGetAnalytics(backend, params),
  );

  // ── scrum_get_board_health ─────────────────────────────────────────────────

  server.registerTool(
    "scrum_get_board_health",
    {
      title: "Get Board Health",
      description: `DEPRECATED — use scrum_get_sprint_data and scrum_find_items instead.

        This tool no longer returns health metrics. The agent skill computes
        readiness and sprint risk from raw sprint data and item listings.

        Returns: { deprecated: true, use: "scrum_get_sprint_data" }`,
      inputSchema: GetBoardHealthSchema.shape,
      outputSchema: DeprecationStubSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    (params: z.infer<typeof GetBoardHealthSchema>) => handleGetBoardHealth(backend, params),
  );

  // ── scrum_get_sprint_data ──────────────────────────────────────────────────

  server.registerTool(
    "scrum_get_sprint_data",
    {
      title: "Get Sprint Data",
      description: `Returns raw sprint items with completion timestamps — flat per-item facts, ` +
        `no aggregation, no burndown series, no health computation. ` +
        `Use this tool when you need sprint-level raw data to compute your own ` +
        `burndown, velocity, readiness, or risk metrics.`,
      inputSchema: GetSprintDataSchema.shape,
      outputSchema: SprintRawDataSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    (params: z.infer<typeof GetSprintDataSchema>) => handleGetSprintData(backend, params),
  );
};

// Re-export handlers for contract tests
export {
  handleFindItems,
  handleGetAnalytics,
  handleGetBoardHealth,
  handleGetItemDetail,
  handleGetSprintData,
  handleOrient,
} from "./handlers/read.ts";
