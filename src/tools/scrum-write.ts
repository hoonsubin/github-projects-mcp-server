// =============================================================================
// src/tools/scrum-write.ts — Register all scrum_* write tools + deprecated github_graphql

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
  UpdateImpedimentSchema,
  UpdateStorySchema,
} from "../schemas/scrum.ts";
import { GraphQLQuerySchema } from "../schemas/inputs.ts";
import { isMutationQuery } from "../services/mutation-validator.ts";
import { enrichError } from "../services/error-enrichment.ts";
import { graphql } from "../adapters/github/internal/http-client.ts";
import { z } from "zod";

// ── Helper types ──────────────────────────────────────────────────────────────

interface PartialFailureResult {
  story: Story | StoryRef;
  partialFailure: true;
  failedFields: Array<{ field: string; reason: string }>;
}

// ── Derived constants ─────────────────────────────────────────────────────────

/** Resolve the p0 (highest-tier) priority display label from config. */
const resolveP0PriorityDisplay = (scrumConfig: ScrumConfig): string => {
  const p0Key = scrumConfig.scrum.priority?.[0]?.key ?? "p0";
  const ghConfig = scrumConfig.backends.github as Record<string, unknown>;
  const priorityDisplay = (ghConfig.priority_display as Record<string, string>) ?? {};
  return priorityDisplay[p0Key] ?? "Must";
};

// ── Public API ────────────────────────────────────────────────────────────────

export function registerScrumWriteTools(
  server: McpServer,
  backend: ProjectBackend,
  scrumConfig: ScrumConfig,
): void {
  const p0PriorityDisplay = resolveP0PriorityDisplay(scrumConfig);
  // ── C1: scrum_add_vocabulary ──────────────────────────────────────────────────

  server.registerTool(
    "scrum_add_vocabulary",
    {
      title: "Add Vocabulary Entry",
      description: `Idempotently add a new option to an existing board field, or a new repo label.

        IMPORTANT CONSTRAINT: this tool can only add options to fields that already exist
        (status, priority). It cannot create new project fields — that requires a human to
        act in the GitHub Projects UI.

        Use this when scrum_set_field or scrum_create_story fails because a vocabulary value
        is not found. Call scrum_orient first to see what values already exist before adding duplicates.

        Args:
          kind   "status_option" | "priority_option" | "label"
          value  display name to add (e.g. "Blocked", "Critical", "tech_debt")

        Safe to call if the value already exists — operation is idempotent.`,
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
          content: [{ type: "text", text: enrichError(err) }],
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
        `Set a single board field on a story. The primary write primitive — use this to move
        stories across the board, assign sprints, set points, update priority, assignee, or type.

        Call scrum_get_story first if you need to read the current value before overwriting.

        Args:
          ref    { id: string } — story to update (Story.ref.id from any read tool)
          field  one of: "status" | "sprint" | "story_points" | "priority" | "assignee" | "type"
          value  shape depends on field:
                   status        → string display name (e.g. "In Progress", "Done")
                   sprint        → "current" | "next" | "<sprint-name>" | null  (null clears)
                   story_points  → number (e.g. 3, 5, 8)
                   priority      → string display name (e.g. "Must", "Should")
                   assignee      → GitHub login string (e.g. "hoonsubin")
                   type          → canonical key (e.g. "feature", "bug" — see vocabulary.type in scrum_orient)
                 Pass null for any field to clear the value entirely.

        Returns: updated Story object.`,
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
          content: [{ type: "text", text: enrichError(err) }],
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
      description: `Edit the content fields of a story: title, body, labels, assignees, or epic.
        For board fields (status, sprint, story_points, priority, assignee) use scrum_set_field.

        WARNING — labels and assignees REPLACE the full existing set, they do not append.
        Call scrum_get_story first if you want to add a label without removing existing ones.
        body also replaces the entire body — read first if you intend to append.

        Args:
          ref        { number: integer } | { id: string } — story to update
          title      string — new title (omit to leave unchanged)
          body       string — replacement markdown body (omit to leave unchanged)
          labels     string[] — REPLACES all existing labels (omit to leave unchanged)
          assignees  string[] — REPLACES all existing assignees, GitHub logins (omit to leave unchanged)
          epic       string | null — Milestone title to assign to; null detaches from epic (omit to leave unchanged)
          comment    string — Post a comment on the story after updating (omit to skip)

        Returns: updated Story object.`,
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

        // Post comment if provided
        if (params.comment !== undefined) {
          await backend.addComment(params.ref, params.comment);
        }

        // Fetch and return updated story
        const updated = await backend.getStoryDetail(params.ref);
        return {
          content: [
            { type: "text", text: JSON.stringify(updated.story, null, 2) },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: enrichError(err) }],
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
        `Create a new story on the project board and optionally assign it to a sprint in one call.

        Stories are created as Draft Issues first. If labels or an epic are supplied the draft is
        automatically promoted to a full Issue so those fields can be applied — this is transparent
        to the caller. Board fields (type, priority, sprint, story_points) are applied after creation;
        if a board field fails the story is still created — check 'partialFailure' in the response.

        Args:
          title        string (required) — concise one-sentence title
          body         string (required) — full markdown body; use user-story format + AC checklist
          type         canonical key (e.g. "feature", "bug") — set via the Type board field
                       Call scrum_orient for vocabulary.type to see valid keys for this project
          priority     string — vocabulary display name (e.g. "Must"); call scrum_orient for valid values
          story_points number — Fibonacci estimate (1, 2, 3, 5, 8, 13)
          labels       string[] — must already exist; check platform_state.labels.existing from scrum_orient
          epic         string — Milestone title; created if not found
          assignees    string[] — GitHub logins
          sprint       "current" | "next" | "<sprint-name>" — places on board; omit for backlog

        Returns: created Story object, or partial-failure shape { story, partialFailure: true, failedFields[] }.`,
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
              reason: enrichError(err),
            });
          }
        }

        if (params.story_points !== undefined) {
          try {
            await backend.setField(storyRef, "story_points", params.story_points);
          } catch (err) {
            failedFields.push({
              field: "story_points",
              reason: enrichError(err),
            });
          }
        }

        if (params.priority !== undefined) {
          try {
            await backend.setField(storyRef, "priority", params.priority);
          } catch (err) {
            failedFields.push({
              field: "priority",
              reason: enrichError(err),
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
            reason: enrichError(readErr),
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
          content: [{ type: "text", text: enrichError(err) }],
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
        `Bulk-assign stories to a sprint. More efficient than calling scrum_set_field per story
        when planning a sprint or moving multiple items at once.

        Args:
          sprint   "current" | "next" | "<sprint-name>" — target sprint
          stories  StoryRef[] (min 1) — each entry must supply Story.ref.id
          replace  boolean, default false
                   false = add the listed stories; existing sprint items are untouched
                   true  = CLEAR all current sprint stories first, then assign the list
                           Use with caution — replace:true removes any story not in your list.

        Returns: { sprint, assigned: StoryRef[], skipped: [{ ref, reason }] }
        The operation continues through individual failures — check skipped[] for errors.`,
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
                reason: enrichError(err),
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
            skipped.push({ ref, reason: enrichError(err) });
          }
        }

        const result: Record<string, unknown> = {
          sprint: params.sprint,
          assigned,
          skipped,
        };
        // Include goal in response if provided (echo only, not persisted)
        if (params.goal !== undefined) {
          result.goal = params.goal;
        }

        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: enrichError(err) }],
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
        `Log a blocking impediment: creates a spike story tagged 'impediment', posts a warning
        comment on the affected story, and cross-links the two stories.

        Use this instead of scrum_create_story when logging something that blocks another story.
        The impediment will appear in scrum_get_backlog results filterable by the 'impediment' label.

        Args:
          description  string (required) — full description of the blocker; becomes the story body
                       and the comment posted to the affected story
          affects      { story: { id } } | { sprint: string } — optional; omit to log a project-level orphan
          raised_by    string — GitHub login of the person raising it; defaults to Scrum Master
          priority     string — vocabulary display name (e.g. "Must"); defaults to highest tier

        Returns: the created impediment Story object.`,
      inputSchema: LogImpedimentSchema.shape,
      annotations: { role: "admin" },
    },
    async (params: z.infer<typeof LogImpedimentSchema>) => {
      try {
        // Step 1: Build impediment story input
        const impedimentInput: CreateStoryInput = {
          title: `Impediment: ${params.description.slice(0, 80)}`,
          body: params.description,
          type: "impediment",
          priority: params.priority ?? p0PriorityDisplay,
          labels: ["impediment"],
        };

        // Step 2: Create the impediment story; listing.ref.id is the GitHub Issue node ID (I_...)
        const { listing: impediment, itemRef } = await backend.createImpediment(impedimentInput);

        // Step 3: Conditional branching based on affects presence
        if (params.affects) {
          if ("story" in params.affects) {
            // Story case: post warning on affected story + back-link on impediment
            const affectedComment = [
              ":warning: **Impediment logged**",
              "",
              params.description,
              "",
              `> Created by ${params.raised_by ?? "agent"}`,
            ].join("\n");

            await backend.addComment(params.affects.story, affectedComment);

            const affectsRef = params.affects.story.id;
            const impedimentComment = [
              ":link: This impediment affects story",
              `  - Story item ID: ${affectsRef}`,
            ].join("\n");

            await backend.addComment(itemRef, impedimentComment);
          } else if ("sprint" in params.affects) {
            // Sprint case: post single cross-reference comment on impediment
            const sprintName = params.affects.sprint;
            const impedimentComment = [
              ":link: This impediment affects sprint",
              `  - Sprint: ${sprintName}`,
            ].join("\n");

            await backend.addComment(itemRef, impedimentComment);
          }
        }
        return {
          content: [{
            type: "text",
            text: JSON.stringify(
              { impediment, affects: params.affects ?? null },
              null,
              2,
            ),
          }],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: enrichError(err) }],
          isError: true,
        };
      }
    },
  );

  // ── C7: scrum_update_impediment ──────────────────────────────────────────────

  server.registerTool(
    "scrum_update_impediment",
    {
      title: "Update Impediment",
      description: `Update an impediment's status and optionally add resolution notes.

        Args:
          ref              { id } — impediment project item ID from scrum_get_backlog or scrum_get_sprint
          status           "open" | "in_progress" | "resolved" — new impediment status
          resolution_notes  string (optional) — notes explaining why this impediment was resolved

        Returns: the updated ImpedimentListing.`,
      inputSchema: UpdateImpedimentSchema.shape,
      annotations: { role: "admin" },
    },
    async (params: z.infer<typeof UpdateImpedimentSchema>) => {
      try {
        const result = await backend.updateImpediment(
          params.ref,
          params.status,
          params.resolution_notes,
        );
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: enrichError(err) }],
          isError: true,
        };
      }
    },
  );

  // ── C8: github_graphql (deprecated) ───────────────────────────────────────────

  server.registerTool(
    "github_graphql",
    {
      title: "GitHub GraphQL (Deprecated)",
      description:
        `**DEPRECATED.** Preserved for ad-hoc diagnostic GraphQL lookups only. Will be removed in a future version. Prefer the \`scrum_*\` tools for all agent workflows. Mutations are blocked.`,
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
          content: [{ type: "text", text: enrichError(err) }],
          isError: true,
        };
      }
    },
  );
}
