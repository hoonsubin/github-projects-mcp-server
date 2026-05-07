// =============================================================================
// src/tools/scrum-read.ts — Phase 2: all 5 scrum_* read tools
//
// Implement tools in this order (each is independently testable):
//   Step 5:  scrum_get_config  (simplest — good integration test checkpoint)
//   Step 6:  scrum_get_velocity
//   Step 7:  scrum_get_backlog
//   Step 8:  scrum_get_board
//   Step 10: scrum_get_story   (requires resolveStory from step 9)
//
// All tools call loadConfig at the top of their handler — no shared state.
// owner / ownerType / projectNumber come from process.env or the server's
// startup config; pass them into each loadConfig call.
// =============================================================================

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp";

// todo: [Phase 2] Uncomment imports as each tool is implemented:
// import { loadConfig } from "../services/config.ts";
// import { resolveStory, resolveSprint } from "../services/resolver.ts";
// import { GetBoardSchema, GetBacklogSchema, GetStorySchema, GetVelocitySchema } from "../schemas/scrum.ts";
// import type { Story } from "../types.ts";

/**
 * Register all 5 scrum_* read tools on the MCP server.
 *
 * todo: [Phase 2, step 5] scrum_get_config
 *   - Call loadConfig(github, owner, ownerType, projectNumber)
 *   - Return: { definition_of_ready, definition_of_done, status_vocabulary, priority_vocabulary,
 *              story_point_values, sprint: { length_weeks, start_day }, team, ceremony_records_backend }
 *   - Source all values from config.yml (RuntimeConfig.yml) — no additional GraphQL calls needed
 *
 * todo: [Phase 2, step 6] scrum_get_velocity
 *   - Call loadConfig to get config.iterations.completed
 *   - Slice the completed list to the requested window (default 5)
 *   - For each completed iteration: fetch all project items assigned to that iteration
 *     (use the sprint field's iteration ID to filter), sum story_points field values,
 *     count how many have a "Done" status option (match via config.statusOptions)
 *   - Return: array of { sprint, committed_points, completed_points, completion_rate,
 *             started_count, completed_count } ordered most-recent-first, plus average_completed
 *
 * todo: [Phase 2, step 7] scrum_get_backlog
 *   - Call loadConfig to get config.fields.sprintFieldId
 *   - Fetch all project items where the sprint iteration field is unset (no value)
 *     NOTE: GitHub Projects v2 does not support server-side "field is empty" filtering.
 *     Fetch all items with pagination (100 per page) and filter client-side.
 *   - Apply optional filters client-side: search (title+body substring), labels (all must match),
 *     priority (vocabulary match), epic (Milestone title match), limit cap
 *   - Compute readiness summary: { sprint_ready (has points + AC checklist + priority),
 *     in_refinement (has some but not all), future_candidate (has none) }
 *   - Return: { stories: Story[], total_count, readiness }
 *
 * todo: [Phase 2, step 8] scrum_get_board
 *   - Accept optional sprint: SprintRef (default "current")
 *   - Call loadConfig, then resolveSprint to get the iteration ID
 *   - Fetch all project items where sprint field === that iteration ID (paginated)
 *   - Group by status in status_vocabulary order (use config.statusOptions key order from yml)
 *   - Sum story_points per group and overall
 *   - Compute totals: committed_points (all), completed_points (Done group),
 *     in_flight_points (In Progress group), blocked_points (Blocked group)
 *   - Return: { sprint: { name, goal, start_date, end_date, days_remaining, capacity_points },
 *              groups: [{ status, stories: Story[], points_sum }],
 *              totals: { committed_points, completed_points, in_flight_points, blocked_points } }
 *
 * todo: [Phase 2, step 10] scrum_get_story  [requires resolveStory from step 9]
 *   - Accept ref: StoryRef
 *   - Call resolveStory to get the issue node ID
 *   - Fetch the issue with a single GraphQL query including:
 *       issue { id number title body url createdAt updatedAt
 *         assignees { nodes { login } }
 *         labels { nodes { name } }
 *         milestone { title }
 *         comments(first: 50) { nodes { author { login } body createdAt url } }
 *         closingIssuesReferences(first: 10) — or timelineItems for linked PRs
 *       }
 *     Then a second query for the project item's field values (status, sprint, points, priority)
 *   - Parse AC from body: scan for "- [ ]" and "- [x]" markdown checkboxes
 *   - Return: Story + { comments, linked_prs, sub_tasks, acceptance_criteria }
 */
// todo: [Phase 2] export function registerScrumReadTools(
// todo: [Phase 2]   server: McpServer,
// todo: [Phase 2]   github: { graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T> },
// todo: [Phase 2] ): void {
// todo: [Phase 2]   // implement tools in step order: 5, 6, 7, 8, 10
// todo: [Phase 2] }
