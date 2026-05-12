// =============================================================================
// src/tools/scrum-read.ts — Thin tool handlers delegating to use-case functions
//
// After Story B (Phase 5): handlers are thin — parse, delegate, format.
// No handler imports graphql, rest, loadConfig, resolveSprint, or any GitHub raw type.
// =============================================================================

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ProjectBackend } from "../scrum/ports.ts";
import type { ScrumConfig } from "../domain/config.ts";

import {
  GetBacklogSchema,
  GetBurndownSchema,
  GetHistorySchema,
  GetSprintSchema,
  GetStorySchema,
  GetTemplateSchema,
} from "../schemas/scrum.ts";
import { z } from "zod";
import { enrichError } from "../services/github.ts";

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
  scrumConfig: ScrumConfig,
): void => {
  // ── scrum_orient ───────────────────────────────────────────────────────────

  server.registerTool(
    "scrum_orient",
    {
      title: "Orient to Project",
      description:
        `Entry point — call this FIRST when connecting to a project or starting any workflow.\n\n` +
        `Returns the current platform state (active sprint dates, field IDs, iteration list) ` +
        `and the declared Scrum vocabulary for this project (status options, priority tiers, ` +
        `sprint names). The vocabulary values returned here are the exact strings you must ` +
        `pass to write tools — they are project-specific and cannot be guessed.\n\n` +
        `No arguments required. Pass {} or omit arguments entirely.`,
      inputSchema: z.object({ _: z.string().optional() }).shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async () => {
      try {
        const result = await orientUseCase(backend, scrumConfig);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err: unknown) {
        return {
          content: [{ type: "text", text: enrichError(err, { operation: "orient" }) }],
          isError: true,
        };
      }
    },
  );

  // ── scrum_get_history ──────────────────────────────────────────────────────

  server.registerTool(
    "scrum_get_history",
    {
      title: "Get Sprint History",
      description: `Return raw sprint snapshots for the last N completed sprints.\n\n` +
        `Use for velocity calculations, retrospective prep, and trend analysis. ` +
        `Each snapshot includes sprint dates, committed vs. completed story points, ` +
        `and per-story outcomes.\n\n` +
        `Args:\n` +
        `  window  integer 1-10, default 5 — how many completed sprints to look back\n\n` +
        `Returns: array of sprint snapshots ordered newest-first.`,
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
        return {
          content: [{ type: "text", text: enrichError(err, { operation: "get_history" }) }],
          isError: true,
        };
      }
    },
  );

  // ── scrum_get_backlog ──────────────────────────────────────────────────────

  server.registerTool(
    "scrum_get_backlog",
    {
      title: "Get Product Backlog",
      description: `Return all stories not yet assigned to any sprint (the product backlog).\n\n` +
        `All filter arguments are optional and combinable. Results are sorted by priority ` +
        `descending, then story number ascending.\n\n` +
        `Args:\n` +
        `  search    string — case-insensitive substring match on title + body\n` +
        `  labels    string[] — include only stories carrying ALL of these labels\n` +
        `  priority  string — vocabulary display name, e.g. "Must" (from scrum_orient)\n` +
        `  epic      string — Milestone title (exact match)\n` +
        `  limit     integer > 0, default 50\n\n` +
        `Returns: array of Story objects. Each story has ref.id ` +
        `for use in subsequent write calls.`,
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
        return {
          content: [{ type: "text", text: enrichError(err, { operation: "get_backlog" }) }],
          isError: true,
        };
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
        `Args:\n` +
        `  sprint  "current" | "next" | "<sprint-name>" | null — defaults to "current"\n` +
        `          Use scrum_orient to see the list of valid sprint names.\n\n` +
        `Returns: sprint metadata (dates, totals) plus per-status groups. ` +
        `Each story carries ref.id for use in write calls.`,
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
        return {
          content: [{ type: "text", text: enrichError(err, { operation: "get_sprint" }) }],
          isError: true,
        };
      }
    },
  );

  // ── scrum_get_story ────────────────────────────────────────────────────────

  server.registerTool(
    "scrum_get_story",
    {
      title: "Get Story Details",
      description: `Return full details for a single story: content, all board fields, comments, ` +
        `linked PRs, and acceptance criteria.\n\n` +
        `Args:\n` +
        `  ref  { number: integer } | { id: string } | { number, id }\n` +
        `       At least one of number or id is required.\n` +
        `       number = visible issue number (e.g. 42)\n` +
        `       id = opaque board item ID from a previous tool response\n\n` +
        `Returns: Story object with full body, comments array, and linked PR list.`,
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
        return {
          content: [{ type: "text", text: enrichError(err, { operation: "get_story" }) }],
          isError: true,
        };
      }
    },
  );

  // ── scrum_get_burndown ─────────────────────────────────────────────────────

  server.registerTool(
    "scrum_get_burndown",
    {
      title: "Get Sprint Burndown",
      description: `Return a day-by-day burndown chart for a sprint.\n\n` +
        `Completion timestamps are sourced from the GitHub audit log (org accounts) or ` +
        `inferred from issue close events (user accounts). When falling back to the ` +
        `issue-close proxy a "warning" field is included in the response.\n\n` +
        `Args:\n` +
        `  sprint  "current" | "next" | "<sprint-name>" — defaults to "current"\n\n` +
        `Returns: sprint date range, per-day remaining-points series, and completion events.`,
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
        return {
          content: [{ type: "text", text: enrichError(err, { operation: "get_burndown" }) }],
          isError: true,
        };
      }
    },
  );

  // ── scrum_get_template ─────────────────────────────────────────────────────

  server.registerTool(
    "scrum_get_template",
    {
      title: "Get Ceremony Template",
      description: `Fetch a Scrum ceremony artifact template by type.\n\n` +
        `Returns a markdown template pre-populated with sprint context. Fill in the ` +
        `blank sections before presenting to the team.\n\n` +
        `Args:\n` +
        `  artifact_type  one of:\n` +
        `    "sprint_review"   — demo and stakeholder feedback template\n` +
        `    "retrospective"   — what went well / delta / actions template\n` +
        `    "standup"         — daily sync format\n` +
        `    "sprint_planning" — capacity and commitment planning template\n` +
        `    "refinement"      — backlog grooming and estimation template`,
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
        return {
          content: [{ type: "text", text: enrichError(err, { operation: "get_template" }) }],
          isError: true,
        };
      }
    },
  );
};
