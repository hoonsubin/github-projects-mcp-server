// =============================================================================
// src/tools/scrum-read.ts - Thin tool handlers delegating to use-case functions
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

export const SCRUM_READ_TOOL_NAMES = [
  "scrum_orient",
  "scrum_find_items",
  "scrum_get_item_detail",
  "scrum_get_sprint_data",
] as const;

export const registerScrumReadTools = (
  server: McpServer,
  backend: ProjectBackend,
  scrumConfig: ScrumConfig,
  sessionCache: SessionCache,
): void => {
  server.registerTool(
    "scrum_orient",
    {
      title: "Orient to Project",
      description:
        `Call FIRST at session start. Loads team Scrum vocabulary, DoR/DoD, and active sprint window.

        WHEN TO USE: every new session; before any write that needs status/priority vocabulary.
        WHEN NOT TO USE: mid-session item lookups (use find_items / get_item_detail).

        Example: { "detail": "session" }

        Returns vocabulary maps (canonical → display), active sprint dates, label inventory.
        Use vocabulary.status values for scrum_set_field — never hardcode column names.`,
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

  server.registerTool(
    "scrum_get_item_detail",
    {
      title: "Get Item Detail",
      description:
        `DoR / deep inspection on a single PBI: body, acceptance criteria, comments, dependencies.

        WHEN TO USE: DoR check, content edit prep, verifying one item before sprint commitment.
        WHEN NOT TO USE: listing many items (use scrum_find_items); burndown (use get_sprint_data).

        Example: { "ref": { "number": 42 }, "detail": "dor" }

        detail "dor" (default) = truncated body + latest comment + AC.
        detail "full" = complete history — only when editing body/comments.`,
      inputSchema: GetStorySchema.shape,
      outputSchema: ItemDetailResultSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    (params: z.input<typeof GetStorySchema>) => handleGetItemDetail(backend, params),
  );

  server.registerTool(
    "scrum_find_items",
    {
      title: "Find Items",
      description:
        `Search the Product Backlog and Sprint Backlog. Prefer intent presets (Scrum views).

        Intents:
          sprint_board     — current Sprint Backlog (shows sprint assignment + column)
          backlog_ready    — Product Backlog items with estimates
          readiness_check  — sprint readiness + dependency_map
          blocked_items    — blocked work in current sprint + dependency_map
          search_backlog   — keyword search (requires search; do not combine with sprint_board)
          by_keys          — lookup by issue number ["42"]

        WHEN NOT TO USE: burndown metrics → scrum_get_sprint_data; full AC on one item → get_item_detail.

        Example: { "intent": "blocked_items" }
        Example: { "intent": "search_backlog", "search": "OAuth" }

        Writes: verify with find_items (compact) after scrum_set_field(response:"ack").`,
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

  server.registerTool(
    "scrum_get_sprint_data",
    {
      title: "Get Sprint Data",
      description:
        `Sprint health metrics and optional per-item completion facts for burndown/velocity.

        WHEN TO USE: sprint review metrics, burndown input, remaining scope in points.
        WHEN NOT TO USE: board overview (use find_items intent sprint_board); DoR on one item.

        Example: { "view": "summary" }
        Example: { "view": "items", "active_only": true }

        view "summary" (default) = counts and points only (small payload).
        view "items" = summary + per-item rows with completed_at timestamps.
        active_only true (default) = exclude Done/terminal columns.`,
      inputSchema: GetSprintDataSchema.shape,
      outputSchema: SprintRawDataSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    (params: z.input<typeof GetSprintDataSchema>) =>
      handleGetSprintData(backend, scrumConfig, params),
  );
};

export {
  handleFindItems,
  handleGetItemDetail,
  handleGetSprintData,
  handleOrient,
} from "./handlers/read.ts";
