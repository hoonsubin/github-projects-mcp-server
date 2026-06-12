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
  GetSprintDataSchema,
  GetStorySchema,
  OrientSchema,
} from "../schemas/scrum.ts";
import type { SessionCache } from "../services/session-cache.ts";
import { z } from "zod";
import {
  ItemDetailResultSchema,
  ItemSearchResultSchema,
  OrientResultSchema,
  SprintRawDataSchema,
} from "../schemas/scrum-outputs.ts";
import {
  handleFindItems,
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
  "scrum_get_sprint_data",
] as const;

// ── Tool registration ──────────────────────────────────────────────────────────

export const registerScrumReadTools = (
  server: McpServer,
  backend: ProjectBackend,
  scrumConfig: ScrumConfig,
  sessionCache: SessionCache,
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

        Args (all optional):
          detail  "session" (default) | "full"
                  session = vocabulary + sprint; omits team/DoR/DoD/autonomy/templates.
                  full = complete platform_state; use only when templates or team roster are needed.
          refresh  true = bypass session cache and reload platform metadata`,
      inputSchema: OrientSchema.shape,
      outputSchema: OrientResultSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    (params: z.infer<typeof OrientSchema>) =>
      handleOrient(backend, scrumConfig, sessionCache, params),
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
      description:
        `Search PBIs. Omit unused filters. Prefer intent presets over manual filter assembly.

        Intents (recommended):
          sprint_board     current sprint, fields compact
          backlog_ready    backlog with estimates
          readiness_check  current sprint + dependency_map (DoR/dependency analysis)
          blocked_items    current sprint items with blockers + dependency_map
          by_keys          direct lookup — requires keys: ["42"]

        Args:
          sprint  "current" | "next" | "backlog" | "all" | "<name>" — omit for entire board
          keys    ["42"] issue numbers as strings
          has_blockers  true | false — filter by blocked_by presence
          priority  display name or canonical key (e.g. "Must" or "p0")
          fields  "compact" (default) | "standard" | "full"
          include_dependencies  adds dependency_map; unscoped use coerces to readiness_check
          limit   default 50

        Returns compact listings by default. Verify writes via find_items or get_item_detail.`,
      inputSchema: FindItemsSchema.shape,
      outputSchema: ItemSearchResultSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    (params: z.input<typeof FindItemsSchema>) => handleFindItems(backend, params),
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
  handleGetItemDetail,
  handleGetSprintData,
  handleOrient,
} from "./handlers/read.ts";
