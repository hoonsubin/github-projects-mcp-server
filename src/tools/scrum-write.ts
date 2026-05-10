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
import type { ScrumConfigYml, Story, StoryRef } from "../types.ts";
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
import { formatError, graphql } from "../services/github.ts";
import { z } from "zod";

// ── Helper types ──────────────────────────────────────────────────────────────

interface PartialFailureResult {
  story: StoryRef;
  partialFailure: true;
  failedFields: Array<{ field: string; reason: string }>;
}

// ── Public API ────────────────────────────────────────────────────────────────

export function registerScrumWriteTools(
  server: McpServer,
  backend: ProjectBackend,
  _yml: ScrumConfigYml,
): void {
  // ── C1: scrum_add_vocabulary ──────────────────────────────────────────────────

  server.registerTool(
    "scrum_add_vocabulary",
    {
      title: "Add Vocabulary Entry",
      description:
        "Idempotently add a status option, priority option, or label to the project board schema.",
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
          content: [{ type: "text", text: formatError(err) }],
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
        "Set a single board field (status, sprint, story_points, priority, assignee) on a story.",
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
          content: [{ type: "text", text: formatError(err) }],
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
      description: "Update story content (title, body, labels, assignees, epic).",
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
          content: [{ type: "text", text: formatError(err) }],
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
      description: "Create a story and optionally place it on the board in one call.",
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
            failedFields.push({ field: "sprint", reason: formatError(err) });
          }
        }

        if (params.story_points !== undefined) {
          try {
            await backend.setField(storyRef, "story_points", params.story_points);
          } catch (err) {
            failedFields.push({ field: "story_points", reason: formatError(err) });
          }
        }

        if (params.priority !== undefined) {
          try {
            await backend.setField(storyRef, "priority", params.priority);
          } catch (err) {
            failedFields.push({ field: "priority", reason: formatError(err) });
          }
        }

        // Step 3: Fetch updated story
        const detail = await backend.getStoryDetail(storyRef);

        // Step 4: Return with partial failure indicator if needed
        if (failedFields.length > 0) {
          const result: PartialFailureResult & { story: Story } = {
            story: detail.story,
            partialFailure: true,
            failedFields,
          };
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
            isError: false,
          };
        }

        return {
          content: [{ type: "text", text: JSON.stringify(detail.story, null, 2) }],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: formatError(err) }],
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
        "Bulk-assign stories to a sprint with optional replace mode. Returns partial-success report.",
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
              skipped.push({ ref: story.ref, reason: formatError(err) });
            }
          }
        }

        // Step 2: Assign each requested story
        for (const ref of params.stories) {
          try {
            await backend.setField(ref, "sprint", params.sprint);
            assigned.push(ref);
          } catch (err) {
            skipped.push({ ref, reason: formatError(err) });
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
          content: [{ type: "text", text: formatError(err) }],
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
        "Create an impediment story linked to the affected story and add a comment to both.",
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
        const impedimentComment = [
          ":link: This impediment affects story",
          `  - Number: #${params.affects.number}`,
          `  - Ref: ${params.affects.id ?? "N/A"}`,
        ].join("\n");

        await backend.addComment(storyRef, impedimentComment);

        // Step 5: Return the impediment story
        const detail = await backend.getStoryDetail(storyRef);
        return {
          content: [{ type: "text", text: JSON.stringify(detail.story, null, 2) }],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: formatError(err) }],
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
          content: [{ type: "text", text: formatError(err) }],
          isError: true,
        };
      }
    },
  );
}
