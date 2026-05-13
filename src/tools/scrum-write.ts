// =============================================================================
// src/tools/scrum-write.ts — Register all scrum_* write tools + deprecated github_graphql
//
// Implementation order (each builds on the previous):
//   Step 11: Stub all 5 write tools + scrum_add_vocabulary + register github_graphql
//   Step 12: Swap index.ts to registerScrumReadTools + registerScrumWriteTools (server starts,
//            all 11 tools appear in tool list — minimum functioning build checkpoint)
//   Step 13: Implement write tools in this order:
//     13a. scrum_add_vocabulary  (simplest — single field/label mutation, no resolver needed)
//     13b. scrum_set_field       (core primitive — all other write tools depend on it internally)
//     13c. scrum_update_story
//     13d. scrum_create_story  (C4)
//     13e. scrum_plan_sprint   (C5)
//     13f. scrum_log_impediment (C6)
// =============================================================================

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CreateStoryInput, ProjectBackend, StoryUpdates } from "../scrum/ports.ts";
import type { Story, StoryRef } from "../domain/types.ts";
import type { ScrumConfig } from "../domain/config.ts";
import {
  AddVocabularySchema,
  CreateStorySchema,
  LogImpedimentSchema,
  PlanSprintSchema,
  SetFieldSchema,
  UpdateStorySchema,
} from "../schemas/scrum.ts";
import { GraphQLQuerySchema } from "../schemas/inputs.ts";
import { isMutationQuery } from "../services/mutation-validator.ts";
import { enrichError } from "../services/error-enrichment.ts";
import { graphql } from "../services/github.ts";
import { z } from "zod";

// ── Helper types ──────────────────────────────────────────────────────────────

interface PartialFailureResult {
  story: Story | StoryRef;
  partialFailure: true;
  failedFields: Array<{ field: string; reason: string }>;
}

// ── Public API ────────────────────────────────────────────────────────────────

export function registerScrumWriteTools(
  server: McpServer,
  backend: ProjectBackend,
  _scrumConfig: ScrumConfig,
): void {
  // ── C1: scrum_add_vocabulary ──────────────────────────────────────────────────

  server.registerTool(
    "scrum_add_vocabulary",
    {
      title: "Add Vocabulary Entry",
      description:
        "Idempotently add a new option to an existing board field, or a new repo label.\n\n" +
        "IMPORTANT CONSTRAINT: this tool can only add options to fields that already exist " +
        "(status, priority). It cannot create new project fields — that requires a human to " +
        "act in the GitHub Projects UI.\n\n" +
        "Use this when scrum_set_field or scrum_create_story fails because a vocabulary value " +
        "is not found. Call scrum_orient first to see what values already exist before adding duplicates.\n\n" +
        "Args:\n" +
        '  kind   "status_option" | "priority_option" | "label"\n' +
        '  value  display name to add (e.g. "Blocked", "Critical", "tech_debt")\n\n' +
        "Safe to call if the value already exists — operation is idempotent.",
      inputSchema: AddVocabularySchema.shape,
      annotations: { role: "admin" },
    },
    async (params: z.infer<typeof AddVocabularySchema>) => {
      try {
        const result = await backend.addVocabulary(params.kind, params.value);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { ...result, kind: params.kind, value: params.value },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: enrichError(err, { operation: "add_vocabulary" }) }],
          isError: true,
        };
      }
    },
  );

  // ── C2: scrum_set_field ──────────────────────────────────────────────────────

  server.registerTool(
    "scrum_set_field",
    {
      title: "Set Board Field",
      description:
        "Set a single board field on a story. The primary write primitive — use this to move " +
        "stories across the board, assign sprints, set points, and update priority or assignee.\n\n" +
        "Call scrum_get_story first if you need to read the current value before overwriting.\n\n" +
        "Args:\n" +
        "  ref    { number: integer } | { id: string } — story to update\n" +
        '  field  one of: "status" | "sprint" | "story_points" | "priority" | "assignee"\n' +
        "  value  shape depends on field:\n" +
        '           status        → string display name (e.g. "In Progress", "Done")\n' +
        '           sprint        → "current" | "next" | "<sprint-name>" | null  (null clears)\n' +
        "           story_points  → number (e.g. 3, 5, 8)\n" +
        '           priority      → string display name (e.g. "Must", "Should")\n' +
        '           assignee      → GitHub login string (e.g. "hoonsubin")\n' +
        "         Pass null for any field to clear the value entirely.\n\n" +
        "Returns: updated Story object.",
      inputSchema: SetFieldSchema.shape,
      annotations: { role: "admin" },
    },
    async (params: z.infer<typeof SetFieldSchema>) => {
      try {
        await backend.setField(params.ref, params.field, params.value);
        // Fetch and return updated story
        const updated = await backend.getStoryDetail(params.ref);
        return {
          content: [
            { type: "text", text: JSON.stringify(updated.story, null, 2) },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: enrichError(err, { operation: "set_field" }) }],
          isError: true,
        };
      }
    },
  );

  // ── C3: scrum_update_story ──────────────────────────────────────────────────

  server.registerTool(
    "scrum_update_story",
    {
      title: "Update Story",
      description: "Edit the content fields of a story: title, body, labels, assignees, or epic. " +
        "For board fields (status, sprint, story_points, priority, assignee) use scrum_set_field.\n\n" +
        "WARNING — labels and assignees REPLACE the full existing set, they do not append. " +
        "Call scrum_get_story first if you want to add a label without removing existing ones. " +
        "body also replaces the entire body — read first if you intend to append.\n\n" +
        "Args:\n" +
        "  ref        { number: integer } | { id: string } — story to update\n" +
        "  title      string — new title (omit to leave unchanged)\n" +
        "  body       string — replacement markdown body (omit to leave unchanged)\n" +
        "  labels     string[] — REPLACES all existing labels (omit to leave unchanged)\n" +
        "  assignees  string[] — REPLACES all existing assignees, GitHub logins (omit to leave unchanged)\n" +
        "  epic       string | null — Milestone title to assign to; null detaches from epic (omit to leave unchanged)\n\n" +
        "Returns: updated Story object.",
      inputSchema: UpdateStorySchema.shape,
      annotations: { role: "admin" },
    },
    async (params: z.infer<typeof UpdateStorySchema>) => {
      try {
        const updates: Partial<z.infer<typeof UpdateStorySchema>> = {};
        if (params.title !== undefined) updates.title = params.title;
        if (params.body !== undefined) updates.body = params.body;
        if (params.labels !== undefined) updates.labels = params.labels;
        if (params.assignees !== undefined) updates.assignees = params.assignees;
        if (params.epic !== undefined) updates.epic = params.epic;

        await backend.updateStory(params.ref, updates as StoryUpdates);

        // Fetch and return updated story
        const updated = await backend.getStoryDetail(params.ref);
        return {
          content: [
            { type: "text", text: JSON.stringify(updated.story, null, 2) },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: enrichError(err, { operation: "update_story" }) }],
          isError: true,
        };
      }
    },
  );

  // ── C4: scrum_create_story ──────────────────────────────────────────────────

  server.registerTool(
    "scrum_create_story",
    {
      title: "Create Story",
      description:
        "Create a new story (GitHub Issue) and optionally place it on the board in one call.\n\n" +
        "Board fields (sprint, story_points, priority) are applied after creation. If a board " +
        "field fails, the story is still created — check the 'partialFailure' field in the response.\n\n" +
        "Args:\n" +
        "  title        string (required) — concise one-sentence title\n" +
        "  body         string (required) — full markdown body; use user-story format + AC checklist\n" +
        '  type         "feature" | "bug" | "tech_debt" | "spike"\n' +
        '               NOTE: for impediments use scrum_log_impediment, not type:"impediment"\n' +
        '  priority     string — vocabulary display name (e.g. "Must"); call scrum_orient for valid values\n' +
        "  story_points number — Fibonacci estimate (1, 2, 3, 5, 8, 13)\n" +
        "  labels       string[] — additional labels; type labels are added automatically\n" +
        "  epic         string — Milestone title; created if not found\n" +
        "  assignees    string[] — GitHub logins\n" +
        '  sprint       "current" | "next" | "<sprint-name>" — places on board; omit for backlog\n\n' +
        "Returns: created Story object, or partial-failure shape { story, partialFailure: true, failedFields[] }.",
      inputSchema: CreateStorySchema.shape,
      annotations: { role: "admin" },
    },
    async (params: z.infer<typeof CreateStorySchema>) => {
      try {
        // Step 1: Create the story via backend
        const storyRef = await backend.createStory(params as CreateStoryInput);

        // Step 2: Apply optional field sets (collect failures, don't abort)
        const failedFields: PartialFailureResult["failedFields"] = [];

        if (params.sprint !== undefined) {
          try {
            await backend.setField(storyRef, "sprint", params.sprint);
          } catch (err) {
            failedFields.push({
              field: "sprint",
              reason: enrichError(err, { operation: "create_story" }),
            });
          }
        }

        if (params.story_points !== undefined) {
          try {
            await backend.setField(storyRef, "story_points", params.story_points);
          } catch (err) {
            failedFields.push({
              field: "story_points",
              reason: enrichError(err, { operation: "create_story" }),
            });
          }
        }

        if (params.priority !== undefined) {
          try {
            await backend.setField(storyRef, "priority", params.priority);
          } catch (err) {
            failedFields.push({
              field: "priority",
              reason: enrichError(err, { operation: "create_story" }),
            });
          }
        }

        // Step 3: Fetch updated story (wrap so a read failure after successful
        //         creation returns partial-success, not a full failure)
        let storyDetail: Story | Partial<StoryRef>;
        try {
          const fetchedDetail = await backend.getStoryDetail(storyRef);
          storyDetail = fetchedDetail.story;
        } catch (readErr) {
          // Story was created successfully — return partial success with issue ref
          failedFields.push({
            field: "read",
            reason: enrichError(readErr, { operation: "create_story" }),
          });
          storyDetail = { id: storyRef.id }; // minimal shape — full Story unavailable
        }

        // Step 4: Return with partial failure indicator if needed
        if (failedFields.length > 0) {
          const result: PartialFailureResult & { story: Story } = {
            story: storyDetail as Story,
            partialFailure: true,
            failedFields,
          };
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
            isError: false,
          };
        }

        return {
          content: [{ type: "text", text: JSON.stringify(storyDetail, null, 2) }],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: enrichError(err, { operation: "create_story" }) }],
          isError: true,
        };
      }
    },
  );

  // ── C5: scrum_plan_sprint ──────────────────────────────────────────────────

  server.registerTool(
    "scrum_plan_sprint",
    {
      title: "Plan Sprint",
      description:
        "Bulk-assign stories to a sprint. More efficient than calling scrum_set_field per story " +
        "when planning a sprint or moving multiple items at once.\n\n" +
        "Args:\n" +
        '  sprint   "current" | "next" | "<sprint-name>" — target sprint\n' +
        "  stories  StoryRef[] (min 1) — each entry must supply Story.ref.id\n" +
        "  replace  boolean, default false\n" +
        "           false = add the listed stories; existing sprint items are untouched\n" +
        "           true  = CLEAR all current sprint stories first, then assign the list\n" +
        "                   Use with caution — replace:true removes any story not in your list.\n\n" +
        "Returns: { sprint, assigned: StoryRef[], skipped: [{ ref, reason }] }\n" +
        "The operation continues through individual failures — check skipped[] for errors.",
      inputSchema: PlanSprintSchema.shape,
      annotations: { role: "admin" },
    },
    async (params: z.infer<typeof PlanSprintSchema>) => {
      try {
        const assigned: StoryRef[] = [];
        const skipped: Array<{ ref: StoryRef; reason: string }> = [];

        // Step 1: If replace: true, clear existing sprint items
        if (params.replace) {
          const currentStories = await backend.getSprintStories(params.sprint);
          for (const story of currentStories.stories) {
            try {
              await backend.setField(story.ref, "sprint", null);
              assigned.push(story.ref);
            } catch (err) {
              skipped.push({
                ref: story.ref,
                reason: enrichError(err, { operation: "plan_sprint" }),
              });
            }
          }
        }

        // Step 2: Assign each requested story
        for (const ref of params.stories) {
          try {
            await backend.setField(ref, "sprint", params.sprint);
            assigned.push(ref);
          } catch (err) {
            skipped.push({ ref, reason: enrichError(err, { operation: "plan_sprint" }) });
          }
        }

        const result = {
          sprint: params.sprint,
          assigned,
          skipped,
        };

        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: enrichError(err, { operation: "create_story" }) }],
          isError: true,
        };
      }
    },
  );

  // ── C6: scrum_log_impediment ────────────────────────────────────────────────

  server.registerTool(
    "scrum_log_impediment",
    {
      title: "Log Impediment",
      description:
        "Log a blocking impediment: creates a spike story tagged 'impediment', posts a warning " +
        "comment on the affected story, and cross-links the two stories.\n\n" +
        "Use this instead of scrum_create_story when logging something that blocks another story. " +
        "The impediment will appear in scrum_get_backlog results filterable by the 'impediment' label.\n\n" +
        "Args:\n" +
        "  description  string (required) — full description of the blocker; becomes the story body\n" +
        "               and the comment posted to the affected story\n" +
        "  affects      { number } | { id } — the story being blocked (required)\n" +
        "  raised_by    string — GitHub login of the person raising it; defaults to Scrum Master\n" +
        '  priority     string — vocabulary display name (e.g. "Must"); defaults to highest tier\n\n' +
        "Returns: the created impediment Story object.",
      inputSchema: LogImpedimentSchema.shape,
      annotations: { role: "admin" },
    },
    async (params: z.infer<typeof LogImpedimentSchema>) => {
      try {
        // Step 1: Build impediment story input
        const impedimentInput: CreateStoryInput = {
          title: `Impediment: ${params.description.slice(0, 80)}`,
          body: params.description,
          type: "spike",
          priority: params.priority ?? "Must",
          labels: ["impediment"],
        };

        // Step 2: Create the impediment story
        const storyRef = await backend.createStory(impedimentInput);

        // Step 3: Add comment to the AFFECTED story
        const affectedComment = [
          ":warning: **Impediment logged**",
          "",
          params.description,
          "",
          `> Created by ${params.raised_by ?? "agent"}`,
        ].join("\n");

        await backend.addComment(params.affects, affectedComment);

        // Step 4: Add comment to the impediment story itself (bidirectional linking)
        const affectsRef = params.affects.id;
        const impedimentComment = [
          ":link: This impediment affects story",
          `  - Story item ID: ${affectsRef}`,
        ].join("\n");

        await backend.addComment(storyRef, impedimentComment);

        // Step 5: Return the impediment story
        const detail = await backend.getStoryDetail(storyRef);
        return {
          content: [{ type: "text", text: JSON.stringify(detail.story, null, 2) }],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: enrichError(err, { operation: "log_impediment" }) }],
          isError: true,
        };
      }
    },
  );

  // ── C7: github_graphql (deprecated) ───────────────────────────────────────────

  server.registerTool(
    "github_graphql",
    {
      title: "GitHub GraphQL (Deprecated)",
      description:
        "**DEPRECATED.** Preserved for ad-hoc diagnostic GraphQL lookups only. Will be removed in a future version. Prefer the `scrum_*` tools for all agent workflows. Mutations are blocked.",
      inputSchema: GraphQLQuerySchema.shape,
      annotations: { role: "admin" },
    },
    async (params: z.infer<typeof GraphQLQuerySchema>) => {
      try {
        // Validate query does not contain mutations
        if (isMutationQuery(params.query)) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    error: "Mutation blocked",
                    message:
                      "The deprecated github_graphql tool only supports read queries. Use scrum_* tools for mutations.",
                  },
                  null,
                  2,
                ),
              },
            ],
            isError: true,
          };
        }

        // Forward to GitHub GraphQL API
        const result = await graphql(params.query, params.variables ?? {});
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: enrichError(err, { operation: "github_graphql" }) }],
          isError: true,
        };
      }
    },
  );
}
