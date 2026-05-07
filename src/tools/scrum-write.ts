// =============================================================================
// src/tools/scrum-write.ts — Phase 3: all 6 scrum_* write tools + deprecated github_graphql
//
// Implementation order (each builds on the previous):
//   Step 11: Stub all 6 write tools with "not yet implemented" errors + register github_graphql
//   Step 12: Swap index.ts to registerScrumReadTools + registerScrumWriteTools (server starts,
//            all 11 tools appear in tool list — minimum functioning build checkpoint)
//   Step 13: Implement write tools in this order:
//     13a. scrum_post_note    (simplest — only needs resolveStory + addComment mutation)
//     13b. scrum_set_field    (core primitive — all other write tools depend on it internally)
//     13c. scrum_update_story
//     13d. scrum_create_story
//     13e. scrum_plan_sprint
//     13f. scrum_log_impediment (composes create_story + post_note)
// =============================================================================

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp";

// todo: [Phase 3] Uncomment imports as each tool is implemented:
// import { loadConfig } from "../services/config.ts";
// import { resolveStory, resolveSprint } from "../services/resolver.ts";
// import { CreateStorySchema, UpdateStorySchema, SetFieldSchema } from "../schemas/scrum.ts";
// import { PlanSprintSchema, LogImpedimentSchema, PostNoteSchema } from "../schemas/scrum.ts";
// import { GraphQLQuerySchema } from "../schemas/inputs.ts";
// import type { Story, StoryRef } from "../types.ts";

/**
 * Register all 6 scrum_* write tools + deprecated github_graphql on the MCP server.
 *
 * todo: [Phase 3, step 13a] scrum_post_note
 *   - Call resolveStory to get the issue node ID
 *   - If kind !== "comment", prefix body with a bold tag: "**[Standup]**\n\n{body}"
 *   - Call addComment mutation via CreateCommentSchema handler (subject_id = issueId, type = "issue")
 *   - Return: { url: string } — the canonical URL of the new comment
 *
 * todo: [Phase 3, step 13b] scrum_set_field  [core primitive — implement before other write tools]
 *   Translates Scrum vocabulary to GitHub Projects v2 field mutations. Per field:
 *   - status:        resolve name → config.statusOptions[value]; call updateProjectV2ItemFieldValue
 *                    with singleSelectOptionId
 *   - sprint:        call resolveSprint → iteration ID or null; set or clear the iteration field
 *   - story_points:  set number field value, or clear if null
 *   - priority:      resolve name → config.priorityOptions[value]; set or clear singleSelectOptionId
 *   - assignee:      use updateIssue mutation (NOT a separate project field) — resolve login to user
 *                    node ID via GetUserNodeIdSchema handler, then call updateIssue with assignee_ids.
 *                    Setting null → pass empty array [] to clear all assignees.
 *   Return: the updated Story (call a shared readStoryFields helper to fetch current state)
 *
 * todo: [Phase 3, step 13c] scrum_update_story
 *   - Call resolveStory to get issueId and itemId
 *   - Call updateIssue mutation for any of: title, body, assignees (resolve logins to node IDs),
 *     labels (resolve label names to node IDs via graphql listing repo labels)
 *   - epic: resolve Milestone title to milestone node ID; use updateIssue milestone field
 *           Pass null to detach (set milestoneId: null in the mutation)
 *   - Return: the updated Story
 *
 * todo: [Phase 3, step 13d] scrum_create_story
 *   - Create issue via CreateIssueSchema handler (title, body, assignee_ids, label_ids)
 *     NOTE: resolve type label name → label node ID before calling (create label if it doesn't exist)
 *   - Add the new issue to the project via addProjectV2ItemById mutation
 *   - For each optional field (priority, story_points, sprint): call scrum_set_field logic inline
 *     (reuse the internal helper, not the registered tool — avoid double resolver calls)
 *   - Partial failure: if issue creation succeeds but a field-set fails, return a structured error
 *     that includes the partial StoryRef so the agent can retry field-sets without duplicating the story
 *   - Return: the newly created Story
 *
 * todo: [Phase 3, step 13e] scrum_plan_sprint
 *   - If replace:true — fetch all items currently in the target sprint and call resolveSprint +
 *     scrum_set_field(sprint: null) on each to clear them first
 *   - For each story in stories[]: call resolveStory, then apply scrum_set_field sprint logic
 *   - Collect results: assigned[] (succeeded) and skipped[] ({ ref, reason }) for failures
 *   - Return: { assigned: StoryRef[], skipped: [{ ref, reason }] }
 *
 * todo: [Phase 3, step 13f] scrum_log_impediment  [composes create_story + post_note]
 *   - Call scrum_create_story with:
 *       type: "spike"  (there is no "impediment" StoryType — use "spike" + "impediment" label)
 *       labels: ["impediment"]  (create label if it doesn't exist)
 *       status: "Blocked" (via set_field after creation, or inline)
 *       priority: args.priority ?? highest tier from config.yml
 *       raised_by: args.raised_by ?? configured Scrum Master login from config.yml
 *   - Call scrum_post_note on the *affected* story: "Impediment #N opened against this story."
 *   - Call scrum_post_note on the *new impediment* story: "This impediment affects story #M."
 *   - Return: impediment as Story + { linked_to: StoryRef }
 *
 * todo: [Phase 3, step 11] github_graphql (deprecated — register first as part of step 11 stub pass)
 *   - Schema: GraphQLQuerySchema from src/schemas/inputs.ts
 *   - Block any query string containing the word "mutation" (case-insensitive) — return an error
 *   - Otherwise forward the query to the GitHub GraphQL API and return the raw response
 *   - Tool description must include the deprecation notice:
 *       "DEPRECATED. Preserved for ad-hoc diagnostic GraphQL lookups only. Will be removed in a
 *        future version. Prefer the scrum_* tools for all agent workflows. Mutations are blocked."
 */
// todo: [Phase 3, step 11] export function registerScrumWriteTools(
// todo: [Phase 3]   server: McpServer,
// todo: [Phase 3]   github: { graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T> },
// todo: [Phase 3] ): void {
// todo: [Phase 3]   // Step 11: stub each tool + register deprecated github_graphql
// todo: [Phase 3]   // Step 13: implement in order: post_note → set_field → update_story
// todo: [Phase 3]   //                               → create_story → plan_sprint → log_impediment
// todo: [Phase 3] }
