// =============================================================================
// src/tools/scrum-read.ts — Thin tool handlers delegating to use-case functions
//
// After Story B (Phase 5): handlers are thin — parse, delegate, format.
// No handler imports graphql, rest, loadConfig, resolveSprint, or any GitHub raw type.
// =============================================================================

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ProjectBackend } from "../scrum/ports.ts";
import type { ScrumConfigYml } from "../types.ts";

import {
  GetBacklogSchema,
  GetBurndownSchema,
  GetHistorySchema,
  GetSprintSchema,
  GetStorySchema,
  GetTemplateSchema,
} from "../schemas/scrum.ts";
import { z } from "zod";
import { formatError } from "../services/github.ts";

import { orientUseCase } from "../scrum/orient.ts";
import { getTemplateUseCase } from "../scrum/get-template.ts";
import { getStoryUseCase } from "../scrum/get-story.ts";
import { getSprintUseCase } from "../scrum/get-sprint.ts";
import { getBacklogUseCase } from "../scrum/get-backlog.ts";
import { getHistoryUseCase } from "../scrum/get-history.ts";
import { getBurndownUseCase } from "../scrum/get-burndown.ts";

// ── Tool registration ──────────────────────────────────────────────────────────

export const registerScrumReadTools = (
  server: McpServer,
  backend: ProjectBackend,
  yml: ScrumConfigYml,
): void => {
  // ── scrum_orient ───────────────────────────────────────────────────────────

  server.registerTool(
    "scrum_orient",
    {
      title: "Orient to Project",
      description:
        `Return the current platform state and declared Scrum vocabulary for this project.\n\n` +
        `No arguments required. Call this first when connecting to a new project.\n\n` +
        `Returns platform_state and declared_vocabulary sections.`,
      inputSchema: z.object({}).strict().shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async () => {
      try {
        const result = await orientUseCase(backend, yml);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err: unknown) {
        return { content: [{ type: "text", text: formatError(err) }], isError: true };
      }
    },
  );

  // ── scrum_get_history ──────────────────────────────────────────────────────

  server.registerTool(
    "scrum_get_history",
    {
      title: "Get Sprint History",
      description: `Return raw sprint snapshots for the last N completed sprints.\n\n` +
        `Args: window (integer 1-10, default 5) — how many completed sprints to include.`,
      inputSchema: GetHistorySchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: z.infer<typeof GetHistorySchema>) => {
      try {
        const result = await getHistoryUseCase(backend, yml, params.window);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err: unknown) {
        return { content: [{ type: "text", text: formatError(err) }], isError: true };
      }
    },
  );

  // ── scrum_get_backlog ──────────────────────────────────────────────────────

  server.registerTool(
    "scrum_get_backlog",
    {
      title: "Get Product Backlog",
      description: `Return all stories not yet assigned to any sprint (the backlog).\n\n` +
        `Args: search, labels, priority, epic, limit.`,
      inputSchema: GetBacklogSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: z.infer<typeof GetBacklogSchema>) => {
      try {
        const result = await getBacklogUseCase(backend, yml, params);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err: unknown) {
        return { content: [{ type: "text", text: formatError(err) }], isError: true };
      }
    },
  );

  // ── scrum_get_sprint ───────────────────────────────────────────────────────

  server.registerTool(
    "scrum_get_sprint",
    {
      title: "Get Sprint Board",
      description:
        `Return the sprint board: all stories for a sprint, grouped by status with point totals.\n\n` +
        `Args: sprint ("current"|"next"|null|sprint-name, optional, default "current").`,
      inputSchema: GetSprintSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: z.infer<typeof GetSprintSchema>) => {
      try {
        const result = await getSprintUseCase(backend, yml, params.sprint ?? "current");
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err: unknown) {
        return { content: [{ type: "text", text: formatError(err) }], isError: true };
      }
    },
  );

  // ── scrum_get_story ────────────────────────────────────────────────────────

  server.registerTool(
    "scrum_get_story",
    {
      title: "Get Story Details",
      description:
        `Return full details for a single story: content, board fields, comments, linked PRs, and AC.\n\n` +
        `Args: ref — { number: int } or { id: string }.`,
      inputSchema: GetStorySchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: z.infer<typeof GetStorySchema>) => {
      try {
        const result = await getStoryUseCase(backend, params.ref);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err: unknown) {
        return { content: [{ type: "text", text: formatError(err) }], isError: true };
      }
    },
  );

  // ── scrum_get_burndown ─────────────────────────────────────────────────────

  server.registerTool(
    "scrum_get_burndown",
    {
      title: "Get Sprint Burndown",
      description: `Return a day-by-day burndown chart for a sprint.\n\n` +
        `Args: sprint ("current"|"next"|null|sprint-name, optional, default "current").`,
      inputSchema: GetBurndownSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: z.infer<typeof GetBurndownSchema>) => {
      try {
        const result = await getBurndownUseCase(backend, yml, params);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err: unknown) {
        return { content: [{ type: "text", text: formatError(err) }], isError: true };
      }
    },
  );

  // ── scrum_get_template ─────────────────────────────────────────────────────

  server.registerTool(
    "scrum_get_template",
    {
      title: "Get Ceremony Template",
      description: `Fetch a ceremony artifact template by type.\n\n` +
        `Args: artifact_type — one of: sprint_review, retrospective, standup, sprint_planning, refinement.`,
      inputSchema: GetTemplateSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: z.infer<typeof GetTemplateSchema>) => {
      try {
        const result = await getTemplateUseCase(backend, yml, params.artifact_type);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err: unknown) {
        return { content: [{ type: "text", text: formatError(err) }], isError: true };
      }
    },
  );
};
