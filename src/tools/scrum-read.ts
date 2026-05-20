// =============================================================================
// src/tools/scrum-read.ts — Thin tool handlers delegating to use-case functions
//
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
import { enrichError } from "../services/error-enrichment.ts";

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
        `Entry point — call this FIRST when connecting to a project or starting any workflow.

        Returns the current platform state (active sprint dates, field IDs, iteration list)
        and the declared Scrum vocabulary for this project (status options, priority tiers,
        sprint names). The vocabulary values returned here are the exact strings you must
        pass to write tools — they are project-specific and cannot be guessed.

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
      try {
        const result = await orientUseCase(backend, scrumConfig);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err: unknown) {
        return {
          content: [{ type: "text", text: enrichError(err) }],
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
      description: `Return sprint snapshots for the last N completed sprints, aligned with the
        SprintSnapshot shape used by scrum_get_sprint.

        Use for velocity calculations, retrospective prep, and trend analysis. Each
        snapshot includes lightweight item listing (no body/comments), totals by
        status, committed vs. completed story points, and velocity metrics.

        Args:
          window  integer 1-10, default 5 — how many completed sprints to look back

        Returns: {
          "sprints": [
            {
              "sprint": { "name": string, "start_date": "YYYY-MM-DD", "end_date": "YYYY-MM-DD", "duration_days": number, "days_remaining": 0 },
              "items": [
                { "ref": { "id": string, "key": string|null }, "title": string, "status": string|null, "story_points": number|null, "priority": null, "sprint": string|null, "writable": false }
              ],
              "total_count": number,
              "totals": { "by_status": {string: number}, "story_points": number, "committed_points": number, "completed_points": number },
              "impediments": []
            }
          ],
          "window": number,
          "average_completed_points": number
        }
        Each sprint snapshot has totals.committed_points and totals.completed_points.
        Items have ref.id for use in subsequent write calls (may be empty for history items).
        Note: history items have empty ref.id and cannot be used with write tools.`,
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
        const result = await getHistoryUseCase(backend, scrumConfig, params.window);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err: unknown) {
        return {
          content: [{ type: "text", text: enrichError(err) }],
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
      description: `Return all active stories not yet assigned to any sprint (the product backlog).

        Active items: excludes archived stories and Done stories with no sprint assigned.
        All filter arguments are optional and combinable. Results are sorted by priority
        descending, then story number ascending.

        Args:
          search    string — case-insensitive substring match on title + body
          labels    string[] — include only stories carrying ALL of these labels
          priority  string — vocabulary display name, e.g. "Must" (from scrum_orient)
          epic      string — Epic name to filter by (exact match on epic.name)
          limit     integer > 0, default 50

        Returns: {
          stories: StoryListing[],         — lightweight entries (no body or comments)
          total_count: number,
          readiness: { ready, partially_ready, not_ready },
          orphan_impediments: ImpedimentListing[],  — unresolved impediments with no story/sprint context
          epics: EpicListing[]                      — all project epics, regardless of story filter applied
        }
        Each story has ref.id for use in subsequent write calls.`,
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
        const result = await getBacklogUseCase(backend, scrumConfig, params);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err: unknown) {
        return {
          content: [{ type: "text", text: enrichError(err) }],
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
        `Return the sprint board: all stories for a sprint, grouped by status with point totals.

        For a single sprint, returns { sprint: SprintSnapshot }. For sprint="all", returns
        { sprints: SprintSnapshot[], total_count }. SprintSnapshot includes lightweight item
        listing (no body/comments) and totals by status.

        Args:
          sprint  "current" | "next" | "all" | "<sprint-name>" | null — defaults to "current"
                  Use scrum_orient to see the list of valid sprint names.
          limit   integer > 0, default 50 — max sprints to return when sprint="all"

        Returns: { sprint: SprintSnapshot } for single sprint,
                 { sprints: SprintSnapshot[], total_count: number } for sprint="all".`,
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
        const sprintParam = params.sprint ?? "current";
        const result = await getSprintUseCase(backend, sprintParam, params.limit);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err: unknown) {
        return {
          content: [{ type: "text", text: enrichError(err) }],
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
      description: `Return full details for a single story: content, all board fields, comments,
        linked PRs, and acceptance criteria.

        Args:
          ref  { number: integer } | { id: string } | { number, id }
               At least one of number or id is required.
               number = visible issue number (e.g. 42)
               id = opaque board item ID from a previous tool response

        Returns: Story object with full body, comments array, and linked PR list.`,
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
          content: [{ type: "text", text: enrichError(err) }],
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
      description: `Return a day-by-day burndown chart for a sprint.

        Completion timestamps are sourced from the GitHub audit log (org accounts) or
        inferred from issue close events (user accounts). When falling back to the
        issue-close proxy a "warning" field is included in the response.

        Args:
          sprint  "current" | "next" | "<sprint-name>" — defaults to "current"

        Returns: sprint date range, per-day remaining-points series, and completion events.`,
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
        const { sprint } = params;
        if (sprint === "all") {
          throw new Error(
            '"all" is not valid for scrum_get_burndown — use "current", "next", null, or an explicit sprint name.',
          );
        }
        const result = await getBurndownUseCase(backend, scrumConfig, { sprint });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err: unknown) {
        return {
          content: [{ type: "text", text: enrichError(err) }],
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
      description: `Fetch a Scrum ceremony artifact template by type.

        Returns a markdown template pre-populated with sprint context. Fill in the
        blank sections before presenting to the team.

        Args:
          artifact_type  one of:
            "sprint_review"   — demo and stakeholder feedback template
            "retrospective"   — what went well / delta / actions template
            "standup"         — daily sync format
            "sprint_planning" — capacity and commitment planning template
            "refinement"      — backlog grooming and estimation template

        Returns: markdown string — pre-populated ceremony template.`,
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
        const result = await getTemplateUseCase(backend, scrumConfig, params.artifact_type);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err: unknown) {
        return {
          content: [{ type: "text", text: enrichError(err) }],
          isError: true,
        };
      }
    },
  );
};
