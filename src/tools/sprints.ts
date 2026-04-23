// =============================================================================
// src/tools/sprints.ts
// SCRUM sprint tool layer — six tools that operate on the merged config produced
// by loadScrumConfig() rather than accepting owner/project_number as params.
//
// Tools:
//   github_get_sprint_status          — live sprint health snapshot
//   github_get_velocity               — historical velocity series
//   github_get_backlog_items          — paginated Product Backlog view
//   github_bulk_update_item_field     — batch field value mutations
//   github_close_sprint               — carry-over + archive ceremony (dry_run by default)
//   github_generate_sprint_report     — full sprint review/retro document
// =============================================================================

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp";
import { graphql, formatError } from "../services/github.ts";
import {
  loadScrumConfig,
  resolveFields,
  fetchAllItems,
  resolveTargetIteration,
  getFieldValue,
  getNumberFieldValue,
  getStatusValue,
  getIterationValue,
  sumStoryPoints,
  extractPriorityValue,
  isBacklogItem,
  getItemTitle,
  getItemNumber,
  getItemUrl,
  getItemAssignees,
  encodeCursor,
  decodeCursor,
  computeEndDate,
} from "../services/scrum.ts";
import {
  GetSprintStatusSchema,
  GetVelocitySchema,
  GetBacklogItemsSchema,
  BulkUpdateItemFieldSchema,
  CloseSprintSchema,
  GenerateSprintReportSchema,
  resolveFieldValue,
} from "../schemas/inputs.ts";
import type {
  ProjectV2Item,
  UpdateProjectItemFieldData,
  ArchiveProjectItemData,
  BulkUpdateResult,
  IterationVelocity,
} from "../types.ts";

// ---------------------------------------------------------------------------
// Shared mutation helpers
// ---------------------------------------------------------------------------

const UPDATE_FIELD_MUTATION = `
  mutation($input: UpdateProjectV2ItemFieldValueInput!) {
    updateProjectV2ItemFieldValue(input: $input) {
      projectV2Item { id }
    }
  }`;

const CLEAR_FIELD_MUTATION = `
  mutation($input: ClearProjectV2ItemFieldValueInput!) {
    clearProjectV2ItemFieldValue(input: $input) {
      projectV2Item { id }
    }
  }`;

const ARCHIVE_ITEM_MUTATION = `
  mutation($input: ArchiveProjectV2ItemInput!) {
    archiveProjectV2Item(input: $input) {
      item { id isArchived }
    }
  }`;

/**
 * Execute a single field value update or clear.
 * Returns null on success, or an error message string on failure.
 * Uses resolveFieldValue() from schemas/inputs.ts to handle the flat FieldValueUnion.
 */
const executeFieldUpdate = async (
  projectId: string,
  itemId: string,
  fieldId: string,
  value: Parameters<typeof resolveFieldValue>[0],
): Promise<string | null> => {
  const resolved = resolveFieldValue(value);
  if (typeof resolved === "string") return resolved; // validation error

  try {
    if (resolved.isClear) {
      await graphql<{ clearProjectV2ItemFieldValue: { projectV2Item: { id: string } } }>(
        CLEAR_FIELD_MUTATION,
        { input: { projectId, itemId, fieldId } },
      );
    } else {
      await graphql<UpdateProjectItemFieldData>(UPDATE_FIELD_MUTATION, {
        input: { projectId, itemId, fieldId, value: resolved.fieldValue },
      });
    }
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
};

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

const statusIcon = (name: string): string => {
  const n = name.toLowerCase();
  if (n.includes("done") || n.includes("closed")) return "✅";
  if (n.includes("block")) return "🔴";
  if (n.includes("progress")) return "🔵";
  if (n.includes("review")) return "🟡";
  return "⬜";
};

const fmtItem = (item: ProjectV2Item, pts: number | null): string => {
  const num = getItemNumber(item);
  const url = getItemUrl(item);
  const title = getItemTitle(item);
  const assignees = getItemAssignees(item);
  const titleStr = url ? `[${title}](${url})` : title;
  const numStr = num !== null ? `#${num} ` : "";
  const ptsStr = pts !== null ? ` — ${pts} pts` : "";
  const assigneeStr = assignees.length > 0 ? ` — @${assignees.join(", @")}` : "";
  return `- ${numStr}${titleStr}${ptsStr}${assigneeStr}`;
};

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export const registerSprintTools = (server: McpServer): void => {
  // ── github_get_sprint_status ─────────────────────────────────────────────────

  server.registerTool(
    "github_get_sprint_status",
    {
      title: "Get Sprint Status",
      description: `Single-call sprint health check. The primary read before standup, sprint review,
or any "how are we doing" query.

Project coordinates are resolved from scrum.config.yml — no owner/project_number needed.
Requires project-board.config.json to be present (run \`deno task sync-config\` first).

Args:
  - iteration_id (string, optional): Iteration node ID to query.
    Omit to auto-detect the active iteration by today's date.

Returns: Sprint progress (points, %), blocked items, carry-over risk.`,
      inputSchema: GetSprintStatusSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        const config = await loadScrumConfig();
        const { owner, owner_type, project_number } = config.project;
        const resolvedFields = resolveFields(config);
        const { sprintFieldId, statusFieldId, storyPointsFieldId, impedimentFieldId } =
          resolvedFields;

        const allIterations = config._board.sprint.all_iterations;
        const target = resolveTargetIteration(allIterations, params.iteration_id);

        const allItems = await fetchAllItems(owner, owner_type, project_number);

        // Items assigned to this sprint, not archived
        const sprintItems = allItems.filter((item) => {
          if (item.isArchived) return false;
          const iv = getIterationValue(item, sprintFieldId);
          return iv?.iterationId === target.id;
        });

        // Group by status
        const byStatus: Record<string, ProjectV2Item[]> = {};
        for (const item of sprintItems) {
          const sv = getStatusValue(item, statusFieldId);
          const label = sv?.name ?? "No Status";
          (byStatus[label] ??= []).push(item);
        }

        // Resolve Done and Blocked option names from board config
        const sv = config._board.status_values as Record<string, unknown>;
        const doneName = (sv.done as string | undefined) ?? "Done";
        const blockedName = (sv.blocked as string | undefined) ?? "Blocked";

        const doneItems = byStatus[doneName] ?? [];
        const blockedItems = impedimentFieldId
          ? sprintItems.filter((item) => {
              const fv = getFieldValue(item, impedimentFieldId);
              return fv !== undefined && fv.name !== undefined;
            })
          : (byStatus[blockedName] ?? []);

        const committedPoints = sumStoryPoints(sprintItems, storyPointsFieldId);
        const completedPoints = sumStoryPoints(doneItems, storyPointsFieldId);
        const completionPct =
          committedPoints > 0
            ? Math.round((completedPoints / committedPoints) * 100)
            : 0;

        // Carry-over risk: not done and days remaining < threshold
        const carryThreshold = config.sprint?.carry_over_threshold_days ?? 3;
        const carryOverItems = sprintItems.filter((item) => {
          const svEntry = getStatusValue(item, statusFieldId);
          return svEntry?.name !== doneName && target.daysRemaining <= carryThreshold;
        });

        // Build output
        const lines: string[] = [
          `## Sprint Status: ${target.title}  (${target.startDate} → ${target.endDate})`,
          "",
          `**Progress**: ${completedPoints} / ${committedPoints} pts  (${completionPct}%)   ·   ${target.daysRemaining} day${target.daysRemaining === 1 ? "" : "s"} remaining`,
          `**Items**: ${sprintItems.length} total`,
        ];

        // Blocked items section
        if (blockedItems.length > 0) {
          lines.push("", `### 🔴 Blocked (${blockedItems.length})`);
          for (const item of blockedItems) {
            const pts = getNumberFieldValue(item, storyPointsFieldId ?? "");
            lines.push(fmtItem(item, pts));
          }
        }

        // Items by status
        for (const [statusName, items] of Object.entries(byStatus)) {
          if (statusName === blockedName && blockedItems.length > 0) continue; // already shown
          if (items.length === 0) continue;
          lines.push("", `### ${statusIcon(statusName)} ${statusName} (${items.length})`);
          for (const item of items) {
            const pts = getNumberFieldValue(item, storyPointsFieldId ?? "");
            lines.push(fmtItem(item, pts));
          }
        }

        // Carry-over risk
        if (target.daysRemaining <= carryThreshold && carryOverItems.length > 0) {
          const carryPts = sumStoryPoints(carryOverItems, storyPointsFieldId);
          lines.push(
            "",
            `### ⚠️ Carry-over Risk  (${carryOverItems.length} items · ${carryPts} pts · ${target.daysRemaining} days left)`,
          );
          for (const item of carryOverItems) {
            const pts = getNumberFieldValue(item, storyPointsFieldId ?? "");
            const statusEntry = getStatusValue(item, statusFieldId);
            const statusLabel = statusEntry?.name ?? "No Status";
            lines.push(fmtItem(item, pts) + ` _(${statusLabel})_`);
          }
        } else if (target.daysRemaining <= carryThreshold) {
          lines.push("", `### ✅ No carry-over risk — all items completed.`);
        }

        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (err) {
        return { content: [{ type: "text", text: formatError(err) }] };
      }
    },
  );

  // ── github_get_velocity ──────────────────────────────────────────────────────

  server.registerTool(
    "github_get_velocity",
    {
      title: "Get Velocity",
      description: `Velocity report over the last N completed sprints.

Answers "how fast are we moving?" for sprint planning and capacity forecasting.
Points are attributed to whichever iteration is currently assigned on each item —
carryover items count toward the iteration in which they reached Done.

Project coordinates are resolved from scrum.config.yml.

Args:
  - iterations_count (number): Number of completed iterations to include (1-10, default 4)

Returns: Table of committed vs completed points per sprint, average velocity, trend.`,
      inputSchema: GetVelocitySchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        const config = await loadScrumConfig();
        const { owner, owner_type, project_number } = config.project;
        const resolvedFields = resolveFields(config);
        const { sprintFieldId, statusFieldId, storyPointsFieldId } = resolvedFields;

        const allIterations = config._board.sprint.all_iterations;
        const completedIterations = allIterations.filter((it) => it.completed);
        const activeIteration = config._board.sprint.active_sprint;

        // Take the last N completed iterations
        const selectedCompleted = completedIterations
          .slice()
          .sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime())
          .slice(0, params.iterations_count);

        // Resolve Done option name
        const sv = config._board.status_values as Record<string, unknown>;
        const doneName = (sv.done as string | undefined) ?? "Done";

        const allItems = await fetchAllItems(owner, owner_type, project_number);

        // Build velocity entries for completed sprints
        const velocityRows: IterationVelocity[] = selectedCompleted
          .reverse() // oldest first for table
          .map((it) => {
            const iterItems = allItems.filter((item) => {
              if (item.isArchived) return false;
              const iv = getIterationValue(item, sprintFieldId);
              return iv?.iterationId === it.id;
            });
            const committed = sumStoryPoints(iterItems, storyPointsFieldId);
            const doneItems = iterItems.filter((item) => {
              const svEntry = getStatusValue(item, statusFieldId);
              return svEntry?.name === doneName;
            });
            const completed = sumStoryPoints(doneItems, storyPointsFieldId);
            const endDate = computeEndDate(it.startDate, it.duration);
            return {
              iterationId: it.id,
              title: it.title,
              startDate: it.startDate,
              durationDays: it.duration,
              endDate,
              committedPoints: committed,
              completedPoints: completed,
              completionRate: committed > 0 ? completed / committed : 0,
              isCurrent: false,
            };
          });

        // Add the active sprint (if any) as a "current" row
        if (activeIteration) {
          const activeItems = allItems.filter((item) => {
            if (item.isArchived) return false;
            const iv = getIterationValue(item, sprintFieldId);
            return iv?.iterationId === activeIteration.id;
          });
          const committed = sumStoryPoints(activeItems, storyPointsFieldId);
          const doneItems = activeItems.filter((item) => {
            const svEntry = getStatusValue(item, statusFieldId);
            return svEntry?.name === doneName;
          });
          const completed = sumStoryPoints(doneItems, storyPointsFieldId);
          const endDate = computeEndDate(activeIteration.startDate, activeIteration.duration);
          velocityRows.push({
            iterationId: activeIteration.id,
            title: `${activeIteration.title} (active)`,
            startDate: activeIteration.startDate,
            durationDays: activeIteration.duration,
            endDate,
            committedPoints: committed,
            completedPoints: completed,
            completionRate: committed > 0 ? completed / committed : 0,
            isCurrent: true,
          });
        }

        // Compute averages from completed rows only
        const completedRows = velocityRows.filter((r) => !r.isCurrent);
        const avgVelocity =
          completedRows.length > 0
            ? Math.round(
                completedRows.reduce((sum, r) => sum + r.completedPoints, 0) /
                  completedRows.length,
              )
            : null;

        // Trend: most recent completed sprint vs average
        let trendStr = "n/a";
        if (completedRows.length >= 2 && avgVelocity !== null) {
          const recent = completedRows[completedRows.length - 1].completedPoints;
          const diff = recent - avgVelocity;
          trendStr = diff > 0 ? `↑ ${diff} pts above avg` : diff < 0 ? `↓ ${Math.abs(diff)} pts below avg` : "→ at avg";
        }

        // Render table
        const lines = [
          `## Velocity Report — Last ${params.iterations_count} Sprint${params.iterations_count === 1 ? "" : "s"}`,
          "",
          "| Sprint | Dates | Committed | Completed | Rate |",
          "|---|---|---|---|---|",
        ];

        for (const row of velocityRows) {
          const dates = `${row.startDate} → ${row.endDate}`;
          const rate = row.isCurrent
            ? "_(in progress)_"
            : `${Math.round(row.completionRate * 100)}%`;
          lines.push(
            `| ${row.title} | ${dates} | ${row.committedPoints} pts | ${row.completedPoints} pts | ${rate} |`,
          );
        }

        lines.push("");
        if (avgVelocity !== null) {
          lines.push(`**Average velocity**: ${avgVelocity} pts/sprint  (trend: ${trendStr})`);
          const safeTarget = Math.round(avgVelocity * 0.8);
          lines.push(
            `**Planning guidance**: target ≤ ${safeTarget} pts (80% of avg) to account for variance.`,
          );
        } else {
          lines.push(`**Average velocity**: n/a (no completed sprints)`);
          lines.push(
            `**Planning guidance**: use team capacity × 0.7 as the first-sprint target.`,
          );
        }

        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (err) {
        return { content: [{ type: "text", text: formatError(err) }] };
      }
    },
  );

  // ── github_get_backlog_items ─────────────────────────────────────────────────

  server.registerTool(
    "github_get_backlog_items",
    {
      title: "Get Backlog Items",
      description: `The agent's view of the Product Backlog — items not assigned to any sprint.

Items are sorted by priority (MoSCoW order from project-board.config.json),
then estimated before unestimated, then oldest first.

Supports client-side pagination with base64 cursors (GitHub server cursors cannot be
reused after client-side filtering).

Args:
  - include_estimated_only (boolean): Return only items with story points set (sprint-ready)
  - first (number): Items to return (1-100, default 20)
  - after (string, optional): Pagination cursor from a previous response

Returns: Backlog items grouped by sprint-ready / needs estimation.`,
      inputSchema: GetBacklogItemsSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        const config = await loadScrumConfig();
        const { owner, owner_type, project_number } = config.project;
        const resolvedFields = resolveFields(config);
        const { sprintFieldId, storyPointsFieldId, priorityFieldId } = resolvedFields;

        const allItems = await fetchAllItems(owner, owner_type, project_number);

        // Backlog = not archived, no sprint assigned
        let backlog = allItems.filter((item) => isBacklogItem(item, sprintFieldId));

        if (params.include_estimated_only) {
          backlog = backlog.filter(
            (item) => getNumberFieldValue(item, storyPointsFieldId ?? "") !== null,
          );
        }

        // Sort: priority asc, then estimated before unestimated, then createdAt asc
        const priorityOpts = (
          config._board.priority as { options_ordered?: string[] }
        ).options_ordered ?? [];

        backlog.sort((a, b) => {
          const pa = extractPriorityValue(a, priorityFieldId, priorityOpts);
          const pb = extractPriorityValue(b, priorityFieldId, priorityOpts);
          if (pa !== pb) return pa - pb;

          const hasA = getNumberFieldValue(a, storyPointsFieldId ?? "") !== null ? 0 : 1;
          const hasB = getNumberFieldValue(b, storyPointsFieldId ?? "") !== null ? 0 : 1;
          if (hasA !== hasB) return hasA - hasB;

          return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        });

        // Client-side pagination
        const startIndex = params.after ? decodeCursor(params.after) + 1 : 0;
        const page = backlog.slice(startIndex, startIndex + params.first);
        const hasNextPage = startIndex + params.first < backlog.length;
        const endCursor = page.length > 0 ? encodeCursor(startIndex + page.length - 1) : null;

        // Separate estimated vs unestimated
        const estimated = page.filter(
          (item) => getNumberFieldValue(item, storyPointsFieldId ?? "") !== null,
        );
        const unestimated = page.filter(
          (item) => getNumberFieldValue(item, storyPointsFieldId ?? "") === null,
        );

        const totalEstimatedPts = sumStoryPoints(
          backlog.filter(
            (item) => getNumberFieldValue(item, storyPointsFieldId ?? "") !== null,
          ),
          storyPointsFieldId,
        );

        const lines: string[] = [
          `## Product Backlog — ${backlog.length} item${backlog.length === 1 ? "" : "s"} unassigned to any sprint`,
          "",
          `**Unestimated**: ${backlog.filter((i) => getNumberFieldValue(i, storyPointsFieldId ?? "") === null).length} items  |  **Estimated**: ${backlog.filter((i) => getNumberFieldValue(i, storyPointsFieldId ?? "") !== null).length} items · ${totalEstimatedPts} pts total`,
        ];

        if (hasNextPage && endCursor) {
          lines.push(`_Next page cursor: \`${endCursor}\`_`);
        }

        if (estimated.length > 0) {
          lines.push(
            "",
            "### Sprint-Ready (estimated, ordered by priority)",
            "| # | Title | Points | Priority |",
            "|---|---|---|---|",
          );
          for (const item of estimated) {
            const num = getItemNumber(item) ?? "—";
            const title = getItemTitle(item);
            const url = getItemUrl(item);
            const titleStr = url ? `[${title}](${url})` : title;
            const pts = getNumberFieldValue(item, storyPointsFieldId ?? "") ?? "—";
            const pFv = getFieldValue(item, priorityFieldId ?? "");
            const priority = pFv?.name ?? "—";
            lines.push(`| ${num} | ${titleStr} | ${pts} | ${priority} |`);
          }
        }

        if (unestimated.length > 0 && !params.include_estimated_only) {
          lines.push(
            "",
            "### Needs Estimation",
            "| # | Title | Type |",
            "|---|---|---|",
          );
          for (const item of unestimated) {
            const num = getItemNumber(item) ?? "—";
            const title = getItemTitle(item);
            const url = getItemUrl(item);
            const titleStr = url ? `[${title}](${url})` : title;
            lines.push(`| ${num} | ${titleStr} | ${item.type} |`);
          }
        }

        if (page.length === 0) {
          lines.push("", "_No backlog items found._");
        }

        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (err) {
        return { content: [{ type: "text", text: formatError(err) }] };
      }
    },
  );

  // ── github_bulk_update_item_field ────────────────────────────────────────────

  server.registerTool(
    "github_bulk_update_item_field",
    {
      title: "Bulk Update Item Field",
      description: `Set the same field value on multiple project items in one call.

The primary write tool for sprint planning — use with type='iteration' + iteration_id
to commit items to a sprint. Mutations are sequential (no parallelism) to stay within
GitHub's secondary rate limits.

⚠️ SAFETY: When invoked from unstructured natural language, the confirm-mutation prompt
MUST have been invoked first and the user MUST have typed "confirm". This is enforced by
the prompt layer. Direct-command invocations are subject to the autonomy level in scrum://config.

Args:
  - project_id (string, optional): Project node ID (PVT_kwDO...).
    Omit to auto-resolve from scrum://config (project-board.config.json).
    Do NOT substitute owner or project_number — this must be a node ID or omitted.
  - item_ids (string[]): Project item node IDs (PVTI_lADO...) — max 50
  - field_id (string): Field node ID to update
  - value (object): New value — same format as github_update_item_field
  - stop_on_error (boolean): Abort on first failure (default false = best-effort)

Returns: Per-item success/failure summary.`,
      inputSchema: BulkUpdateItemFieldSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        // Resolve project_id: use explicit param or fall back to scrum config
        let projectId = params.project_id;
        if (!projectId) {
          const config = await loadScrumConfig();
          const resolvedId = config._board.project.id;
          if (!resolvedId) {
            return {
              content: [{
                type: "text",
                text:
                  "Error: project_id was not provided and could not be resolved from " +
                  "project-board.config.json (project.id is missing). " +
                  "Run `deno task sync-config` first, or pass project_id explicitly.",
              }],
            };
          }
          projectId = resolvedId;
        }

        const results: BulkUpdateResult[] = [];

        for (const itemId of params.item_ids) {
          const errMsg = await executeFieldUpdate(
            projectId,
            itemId,
            params.field_id,
            params.value,
          );
          results.push({
            item_id: itemId,
            title: itemId, // title not available without a separate fetch
            success: errMsg === null,
            error: errMsg ?? undefined,
          });

          if (errMsg !== null && params.stop_on_error) break;
        }

        const succeeded = results.filter((r) => r.success).length;
        const failed = results.filter((r) => !r.success).length;

        const valueDesc =
          params.value.type === "iteration"
            ? `iteration \`${params.value.iteration_id}\``
            : params.value.type === "single_select"
              ? `option \`${params.value.option_id}\``
              : params.value.type === "clear"
                ? "cleared"
                : String((params.value as Record<string, unknown>).value ?? params.value.type);

        const lines: string[] = [
          `## Bulk Update — ${succeeded} / ${results.length} succeeded`,
          "",
          `Field \`${params.field_id}\` → ${valueDesc} on ${results.length} item${results.length === 1 ? "" : "s"}`,
          "",
        ];

        for (const r of results) {
          const icon = r.success ? "✅" : "❌";
          const detail = r.error ? `  ⚠️ ${r.error}` : "";
          lines.push(`${icon} \`${r.item_id}\`${detail}`);
        }

        if (failed > 0) {
          lines.push("", `${failed} item${failed === 1 ? "" : "s"} failed. Re-run or use github_update_item_field individually.`);
        }

        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (err) {
        return { content: [{ type: "text", text: formatError(err) }] };
      }
    },
  );

  // ── github_close_sprint ──────────────────────────────────────────────────────

  server.registerTool(
    "github_close_sprint",
    {
      title: "Close Sprint",
      description: `Sprint close ceremony: move incomplete items to the next sprint or backlog,
optionally archive Done items.

⚠️ SAFETY: dry_run defaults to true. ALWAYS call with dry_run: true first to preview
the operation. Only pass dry_run: false after the user has typed the literal "confirm"
in response to the confirm-mutation prompt. This rule applies regardless of autonomy level.

Args:
  - closing_iteration_id (string): Iteration node ID of the sprint being closed
  - target_iteration_id (string, optional): Move incomplete items here.
    Omit to clear the Sprint field entirely (items return to backlog).
  - archive_done (boolean): Archive Done items after moving (default false)
  - dry_run (boolean): Preview without executing (DEFAULT TRUE)

Returns: Preview or execution summary.`,
      inputSchema: CloseSprintSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        const config = await loadScrumConfig();
        const { owner, owner_type, project_number } = config.project;
        const projectId = config._board.project.id;

        if (!projectId) {
          return {
            content: [{
              type: "text",
              text: "Error: project node ID not found in project-board.config.json. Run `deno task sync-config` first.",
            }],
          };
        }

        const resolvedFields = resolveFields(config);
        const { sprintFieldId, statusFieldId, storyPointsFieldId } = resolvedFields;

        const sv = config._board.status_values as Record<string, unknown>;
        const doneName = (sv.done as string | undefined) ?? "Done";

        const allItems = await fetchAllItems(owner, owner_type, project_number);

        // Items in the closing sprint
        const sprintItems = allItems.filter((item) => {
          if (item.isArchived) return false;
          const iv = getIterationValue(item, sprintFieldId);
          return iv?.iterationId === params.closing_iteration_id;
        });

        const doneItems = sprintItems.filter((item) => {
          const svEntry = getStatusValue(item, statusFieldId);
          return svEntry?.name === doneName;
        });
        const incompleteItems = sprintItems.filter((item) => {
          const svEntry = getStatusValue(item, statusFieldId);
          return svEntry?.name !== doneName;
        });

        // Resolve target iteration title for preview
        const allIterations = config._board.sprint.all_iterations;
        const targetIter = params.target_iteration_id
          ? allIterations.find((it) => it.id === params.target_iteration_id)
          : null;

        // ── Dry-run preview ─────────────────────────────────────────────────
        if (params.dry_run) {
          const carryTarget = targetIter?.title ?? "Backlog";
          const lines: string[] = [
            `## Sprint Close Preview`,
            "",
            `**Closing sprint**: \`${params.closing_iteration_id}\``,
            `**Carry incomplete to**: ${carryTarget}`,
            `**Archive Done items**: ${params.archive_done ? "Yes" : "No"}`,
            "",
            `**Would carry over**: ${incompleteItems.length} item${incompleteItems.length === 1 ? "" : "s"} (${sumStoryPoints(incompleteItems, storyPointsFieldId)} pts) → ${carryTarget}`,
          ];

          for (const item of incompleteItems) {
            const pts = getNumberFieldValue(item, storyPointsFieldId ?? "");
            const statusEntry = getStatusValue(item, statusFieldId);
            const statusLabel = statusEntry?.name ?? "No Status";
            lines.push(`  ${fmtItem(item, pts)} _(${statusLabel})_`);
          }

          lines.push(
            "",
            `**Would ${params.archive_done ? "archive" : "leave"}**: ${doneItems.length} Done item${doneItems.length === 1 ? "" : "s"}`,
          );

          lines.push(
            "",
            `---`,
            `Run with \`dry_run: false\` to execute (requires confirm-mutation confirmation first).`,
          );

          return { content: [{ type: "text", text: lines.join("\n") }] };
        }

        // ── Execute ─────────────────────────────────────────────────────────
        const moveResults: BulkUpdateResult[] = [];
        const archiveResults: BulkUpdateResult[] = [];

        for (const item of incompleteItems) {
          let errMsg: string | null = null;
          if (params.target_iteration_id) {
            errMsg = await executeFieldUpdate(projectId, item.id, sprintFieldId, {
              type: "iteration",
              iteration_id: params.target_iteration_id,
            });
          } else {
            errMsg = await executeFieldUpdate(projectId, item.id, sprintFieldId, {
              type: "clear",
            });
          }
          moveResults.push({
            item_id: item.id,
            title: getItemTitle(item),
            success: errMsg === null,
            error: errMsg ?? undefined,
          });
        }

        if (params.archive_done) {
          for (const item of doneItems) {
            try {
              await graphql<ArchiveProjectItemData>(ARCHIVE_ITEM_MUTATION, {
                input: { projectId, itemId: item.id, archived: true },
              });
              archiveResults.push({ item_id: item.id, title: getItemTitle(item), success: true });
            } catch (err) {
              archiveResults.push({
                item_id: item.id,
                title: getItemTitle(item),
                success: false,
                error: err instanceof Error ? err.message : String(err),
              });
            }
          }
        }

        const moveSucceeded = moveResults.filter((r) => r.success).length;
        const archiveSucceeded = archiveResults.filter((r) => r.success).length;
        const carryTarget = targetIter?.title ?? "Backlog";

        const lines: string[] = [
          `## Sprint Closed`,
          "",
          `**Carried to ${carryTarget}**: ${moveSucceeded} / ${moveResults.length} items`,
        ];

        for (const r of moveResults) {
          lines.push(`  ${r.success ? "✅" : "❌"} \`${r.item_id}\` ${r.title}${r.error ? `  ⚠️ ${r.error}` : ""}`);
        }

        if (params.archive_done) {
          lines.push("", `**Archived**: ${archiveSucceeded} / ${archiveResults.length} Done items`);
          for (const r of archiveResults) {
            lines.push(`  ${r.success ? "✅" : "❌"} \`${r.item_id}\` ${r.title}${r.error ? `  ⚠️ ${r.error}` : ""}`);
          }
        }

        lines.push(
          "",
          `💡 Next step: archive \`config/sprint-current.md\` as \`config/sprint-archive-N.md\`, then update it for the next sprint.`,
        );

        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (err) {
        return { content: [{ type: "text", text: formatError(err) }] };
      }
    },
  );

  // ── github_generate_sprint_report ────────────────────────────────────────────

  server.registerTool(
    "github_generate_sprint_report",
    {
      title: "Generate Sprint Report",
      description: `Synthesise a full sprint review / retrospective document from live board data
and the sprint-current.md goal document.

Output is structured Markdown ready to paste into sprint-current.md, share as a report,
or archive as sprint-archive-{N}.md.

Args:
  - iteration_id (string, optional): Iteration node ID. Omit to use the active iteration.
  - include_retrospective_scaffold (boolean): Include Start/Stop/Continue table (default true)

Returns: Sprint review document with goal assessment, velocity, item outcomes, carry-over, and retro scaffold.`,
      inputSchema: GenerateSprintReportSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        const config = await loadScrumConfig();
        const { owner, owner_type, project_number } = config.project;
        const resolvedFields = resolveFields(config);
        const { sprintFieldId, statusFieldId, storyPointsFieldId } = resolvedFields;

        const allIterations = config._board.sprint.all_iterations;
        const target = resolveTargetIteration(allIterations, params.iteration_id);

        const sv = config._board.status_values as Record<string, unknown>;
        const doneName = (sv.done as string | undefined) ?? "Done";

        const allItems = await fetchAllItems(owner, owner_type, project_number);

        const sprintItems = allItems.filter((item) => {
          if (item.isArchived) return false;
          const iv = getIterationValue(item, sprintFieldId);
          return iv?.iterationId === target.id;
        });

        const doneItems = sprintItems.filter((item) => {
          const svEntry = getStatusValue(item, statusFieldId);
          return svEntry?.name === doneName;
        });
        const incompleteItems = sprintItems.filter((item) => {
          const svEntry = getStatusValue(item, statusFieldId);
          return svEntry?.name !== doneName;
        });

        const committedPoints = sumStoryPoints(sprintItems, storyPointsFieldId);
        const completedPoints = sumStoryPoints(doneItems, storyPointsFieldId);
        const completionPct =
          committedPoints > 0
            ? Math.round((completedPoints / committedPoints) * 100)
            : 0;

        // Velocity context — last few completed sprints
        const completedIterations = allIterations
          .filter((it) => it.completed)
          .sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime())
          .slice(0, config.sprint?.velocity_window ?? 3);

        const velocityRows = completedIterations.reverse().map((it) => {
          const itItems = allItems.filter((item) => {
            if (item.isArchived) return false;
            const iv = getIterationValue(item, sprintFieldId);
            return iv?.iterationId === it.id;
          });
          const committed = sumStoryPoints(itItems, storyPointsFieldId);
          const done = sumStoryPoints(
            itItems.filter((item) => {
              const svEntry = getStatusValue(item, statusFieldId);
              return svEntry?.name === doneName;
            }),
            storyPointsFieldId,
          );
          const endDate = computeEndDate(it.startDate, it.duration);
          return { title: it.title, startDate: it.startDate, endDate, committed, done };
        });

        // Read sprint-current.md for sprint goal context
        let sprintGoal = "_Sprint goal not available (config/sprint-current.md not found)_";
        try {
          const doc = await Deno.readTextFile("./config/sprint-current.md");
          // Extract the first paragraph or heading after "Sprint Goal"
          const goalMatch = doc.match(/#+\s*Sprint Goal\s*\n+([\s\S]*?)(?:\n#|\n\n)/i);
          if (goalMatch) {
            sprintGoal = goalMatch[1].trim();
          } else {
            sprintGoal = doc.slice(0, 400).trim();
          }
        } catch {
          // File absent — use placeholder
        }

        // Determine Scrum Master for this sprint
        let smName = "—";
        if (config.team?.members && config.sprint) {
          // Sprint number heuristic: count position in all_iterations (1-based)
          const sprintIdx = allIterations.findIndex((it) => it.id === target.id);
          const sprintNum = sprintIdx >= 0 ? sprintIdx + 1 : 1;
          const smMember = config.team.members.find(
            (m) => m.scrum_master_sprint === sprintNum,
          );
          smName = smMember?.name ?? "—";
        }

        const poName = config.team?.product_owner?.name ?? "—";
        const today = new Date().toISOString().slice(0, 10);

        // Goal assessment
        const goalAchieved =
          incompleteItems.length === 0
            ? "✅ Fully achieved"
            : doneItems.length > 0
              ? `⚠️ Partially achieved — ${doneItems.length} of ${sprintItems.length} items completed`
              : "❌ Not achieved";

        // --- Build the report ---
        const lines: string[] = [
          `# ${target.title} Review — ${config.product?.name ?? project_number}`,
          `**Date**: ${today}  |  **SM**: ${smName}  |  **PO**: ${poName}`,
          "",
          `## Sprint Goal`,
          `> ${sprintGoal}`,
          "",
          `**Goal Achieved**: ${goalAchieved}`,
          "",
          `## Velocity`,
          "| Sprint | Dates | Committed | Completed | Rate |",
          "|---|---|---|---|---|",
        ];

        for (const row of velocityRows) {
          const rate = row.committed > 0 ? `${Math.round((row.done / row.committed) * 100)}%` : "—";
          lines.push(
            `| ${row.title} | ${row.startDate} → ${row.endDate} | ${row.committed} pts | ${row.done} pts | ${rate} |`,
          );
        }
        lines.push(
          `| **${target.title}** | **${target.startDate} → ${target.endDate}** | **${committedPoints} pts** | **${completedPoints} pts** | **${completionPct}%** |`,
        );

        lines.push("", `## Item Outcomes`);
        lines.push("| # | Title | Status | Points |", "|---|---|---|---|");

        for (const item of sprintItems) {
          const num = getItemNumber(item) ?? "—";
          const title = getItemTitle(item);
          const url = getItemUrl(item);
          const titleStr = url ? `[${title}](${url})` : title;
          const statusEntry = getStatusValue(item, statusFieldId);
          const isDone = statusEntry?.name === doneName;
          const statusLabel = isDone ? `✅ ${statusEntry?.name}` : `⚠️ ${statusEntry?.name ?? "No Status"}`;
          const pts = getNumberFieldValue(item, storyPointsFieldId ?? "") ?? "—";
          lines.push(`| ${num} | ${titleStr} | ${statusLabel} | ${pts} |`);
        }

        if (incompleteItems.length > 0) {
          const carryPts = sumStoryPoints(incompleteItems, storyPointsFieldId);
          lines.push("", `## Carry-over to Next Sprint`);
          lines.push(
            `${incompleteItems.length} item${incompleteItems.length === 1 ? "" : "s"} · ${carryPts} pts`,
          );
          for (const item of incompleteItems) {
            const pts = getNumberFieldValue(item, storyPointsFieldId ?? "");
            lines.push(fmtItem(item, pts));
          }
        }

        // DoD checklist
        if (config.definition_of_done) {
          lines.push("", `## Definition of Done Checklist`);
          lines.push(`_v${config.definition_of_done.version} — verify each Done item against:_`);
          for (const criterion of config.definition_of_done.criteria) {
            lines.push(`- [ ] ${criterion}`);
          }
        }

        // Retrospective scaffold
        if (params.include_retrospective_scaffold) {
          lines.push(
            "",
            `## Retrospective — Start / Stop / Continue`,
            "| | Observations |",
            "|---|---|",
            "| ✅ What went well | |",
            "| ⚠️ Needs improvement | |",
            "| 🚀 Start doing | |",
            "| 🛑 Stop doing | |",
          );
        }

        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (err) {
        return { content: [{ type: "text", text: formatError(err) }] };
      }
    },
  );
};
