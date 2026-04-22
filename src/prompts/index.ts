// =============================================================================
// src/prompts/index.ts
// MCP Prompts — workflow entry points and mutation safety gates.
//
// Prompts registered here define the agent's permitted scope per workflow and
// provide behavioral contracts that enforce the autonomy gradient. They degrade
// gracefully when the MCP client doesn't surface them: tool descriptions carry
// the same "when NOT to call me" language as a fallback safety layer.
//
// Prompts:
//   classify-intent     — disambiguation gate for unstructured NL input
//   confirm-mutation    — required confirmation gate before writes from NL context
//   standup             — read-only status + blockers summary workflow
//   backlog-refinement  — estimate, prioritise, create draft issues
//   sprint-planning     — iteration assignment workflow
//   sprint-close        — archive Done items, carry over incomplete items
//   sprint-management   — full read + write access (autonomy-gated)
// =============================================================================

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp";
import { z } from "zod";

export const registerSprintPrompts = (server: McpServer): void => {
  // ── classify-intent ─────────────────────────────────────────────────────────
  //
  // Disambiguation gate. Call this before taking any action on unstructured
  // natural language (Slack messages, issue comments, standup notes).
  // Returns a structured classification: direct_command | contextual_reference |
  // incidental_mention, with confidence and any implied ticket numbers.
  //
  // Decision rules:
  //   incidental_mention           → take NO action
  //   contextual_reference + low   → ask user to confirm before acting
  //   direct_command + high        → proceed (still subject to autonomy level)

  server.registerPrompt(
    "classify-intent",
    {
      title: "Classify Intent",
      description:
        "Disambiguation gate for unstructured natural language. " +
        "Call before acting on Slack messages, issue comments, or informal notes. " +
        "Returns intent classification and confidence — do not act on incidental mentions.",
      argsSchema: {
        message: z.string().describe("The unstructured message to classify"),
        source: z
          .enum(["slack", "comment", "direct", "other"])
          .describe("Where the message originated"),
      },
    },
    (args) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Classify the intent of the following message from source "${args.source}".

MESSAGE:
${args.message}

Respond with a JSON object in this exact shape:
{
  "intent": "direct_command" | "contextual_reference" | "incidental_mention",
  "confidence": "high" | "low",
  "implied_action": "<string describing the action, or null>",
  "implied_items": ["<ticket number or item title>", ...]
}

Classification rules:
- "direct_command": The message explicitly asks the agent to perform a specific action
  (e.g., "move US-03 to In Progress", "assign US-05 to sprint 2").
- "contextual_reference": The message mentions a work item in context but does not
  explicitly direct the agent to act (e.g., "we're still working on the auth stuff").
- "incidental_mention": The message mentions a ticket number or task casually with no
  implied need for board action (e.g., "remember when we fixed that login bug?").

For "incidental_mention", the correct response is NO board action.
For "contextual_reference" with low confidence, ask the user for explicit confirmation
before executing any write operation.
For "direct_command" with high confidence, you may proceed — but still respect the
autonomy level configured in scrum://config.`,
          },
        },
      ],
    }),
  );

  // ── confirm-mutation ─────────────────────────────────────────────────────────
  //
  // Required confirmation gate before any write that originates from unstructured
  // NL input, or before bulk writes above the require_confirmation_above_n_items
  // threshold in scrum://config.
  //
  // The agent MUST show the preview and wait for the literal string "confirm"
  // before calling any write tool. "yes", "ok", "looks good" are NOT accepted.

  server.registerPrompt(
    "confirm-mutation",
    {
      title: "Confirm Mutation",
      description:
        "Mutation safety gate. Show a structured preview of a pending write operation " +
        "and require the literal string 'confirm' before executing. " +
        "Use before any write from unstructured NL input or bulk writes above the threshold.",
      argsSchema: {
        action: z
          .string()
          .describe(
            "Human-readable description of the action (e.g., 'Assign 5 items to Sprint 2')",
          ),
        items_json: z
          .string()
          .describe(
            "JSON array of { id, title } objects for the items that will be mutated",
          ),
        field: z.string().describe("Field being changed (e.g., 'Sprint', 'Status')"),
        new_value: z
          .string()
          .describe("New field value that will be set (e.g., 'Sprint 2', 'Done')"),
      },
    },
    (args) => {
      let items: Array<{ id: string; title: string }> = [];
      try {
        items = JSON.parse(args.items_json) as Array<{ id: string; title: string }>;
      } catch {
        items = [{ id: "?", title: args.items_json }];
      }
      const itemList = items
        .map((item) => `  - \`${item.id}\`  ${item.title}`)
        .join("\n");

      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `## Pending Operation: ${args.action}

**Field**: ${args.field}
**New value**: ${args.new_value}
**Items affected** (${items.length}):
${itemList}

---

⚠️  This operation will modify ${items.length} item${items.length === 1 ? "" : "s"} on the GitHub project board.

Type **confirm** (exactly) to execute, or anything else to cancel.
"yes", "ok", "looks good" will NOT execute the operation.`,
            },
          },
        ],
      };
    },
  );

  // ── standup ──────────────────────────────────────────────────────────────────
  //
  // Read-only workflow. Loads scrum://config and scrum://sprint/current, then
  // calls github_get_sprint_status to produce the daily standup brief.
  // No writes are permitted in this workflow.

  server.registerPrompt(
    "standup",
    {
      title: "Daily Standup",
      description:
        "Prepare the daily standup brief: sprint progress, blockers, and carry-over risk. " +
        "Read-only — no board mutations are permitted in this workflow.",
    },
    () => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `You are acting as Scrum Master assistant preparing the daily standup brief.

PERMITTED OPERATIONS:
- Read scrum://config (project coordinates, field names, status taxonomy)
- Read scrum://sprint/current (sprint goal and capacity plan)
- Call github_get_sprint_status (live board state)

NOT PERMITTED in this workflow:
- Any write tool (github_update_item_field, github_bulk_update_item_field, etc.)
- Archiving or deleting items
- Moving items between sprints

WORKFLOW:
1. Read scrum://config to get project coordinates and field mappings
2. Read scrum://sprint/current to understand the sprint goal and team commitments
3. Call github_get_sprint_status to get live progress data
4. Produce a standup brief with:
   - Sprint progress (points completed / committed, % complete, days remaining)
   - Blocked items (if any) with assignees
   - Items at carry-over risk (not done with < carry_over_threshold_days remaining)
   - A concise "Yesterday / Today / Blockers" structure

Keep the output concise — standup is 15 minutes. Flag blockers first.`,
          },
        },
      ],
    }),
  );

  // ── backlog-refinement ───────────────────────────────────────────────────────
  //
  // Write scope: story points (number field), status (single-select),
  // and creating new draft issues. Does NOT assign items to sprints.

  server.registerPrompt(
    "backlog-refinement",
    {
      title: "Backlog Refinement",
      description:
        "Estimate, prioritise, and create draft issues in the Product Backlog. " +
        "Permitted writes: story points, status, new draft issues. " +
        "Sprint assignment is NOT permitted — use sprint-planning for that.",
    },
    () => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `You are acting as Scrum Master assistant during backlog refinement.

PERMITTED OPERATIONS:
- Read scrum://config
- Call github_get_backlog_items (backlog view)
- Call github_get_project_fields (field IDs and option IDs)
- Call github_update_item_field for: Story Points (number), Status (single-select)
- Call github_add_draft_issue (create new backlog items)
- Call github_bulk_update_item_field for Story Points or Status fields only

NOT PERMITTED in this workflow:
- Setting the Sprint / Iteration field on any item
- Archiving or deleting items
- Moving items between sprints

WORKFLOW:
1. Read scrum://config to confirm field names and story point scale
2. Call github_get_backlog_items to see unestimated and unassigned items
3. For each item under discussion:
   a. Confirm the story point estimate against the configured scale
   b. Check Definition of Ready criteria from scrum://config
   c. Update story points or status as agreed
4. If creating a new item, call github_add_draft_issue
5. After any write from a verbal instruction (not a direct command), invoke
   the confirm-mutation prompt before executing

AUTONOMY NOTE: Respect the autonomy.level in scrum://config:
- conservative / standard: invoke confirm-mutation before every write
- full: proceed on high-confidence direct_command intent (still invoke
  classify-intent first if input is from Slack or a comment)`,
          },
        },
      ],
    }),
  );

  // ── sprint-planning ──────────────────────────────────────────────────────────
  //
  // Write scope: iteration (sprint) field assignment only.
  // All other field changes require backlog-refinement workflow.

  server.registerPrompt(
    "sprint-planning",
    {
      title: "Sprint Planning",
      description:
        "Assign backlog items to a sprint iteration. " +
        "The only permitted write is setting the Sprint / Iteration field. " +
        "Estimation and status changes must use the backlog-refinement workflow.",
    },
    () => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `You are acting as Scrum Master assistant during sprint planning.

PERMITTED OPERATIONS:
- Read scrum://config (project coordinates, sprint field ID, velocity window)
- Read scrum://sprint/current (sprint goal, team capacity)
- Call github_get_backlog_items (sprint-ready candidates)
- Call github_get_velocity (historical velocity for capacity guidance)
- Call github_get_sprint_status (check existing sprint commitments)
- Call github_bulk_update_item_field to set the Sprint field (iteration_id) only
- Call github_update_item_field to set the Sprint field on a single item only

NOT PERMITTED in this workflow:
- Changing Story Points, Status, Priority, or any field other than Sprint
- Creating or deleting items
- Archiving items

WORKFLOW:
1. Read scrum://config for project coordinates and the sprint field name
2. Read scrum://sprint/current for sprint goal and team capacity
3. Call github_get_velocity to see average completed points over the last N sprints
4. Call github_get_backlog_items(include_estimated_only: true) for sprint-ready items
5. Help the team select items whose total story points fit within capacity
   (use average velocity × 0.8 as a safe target for the first sprint; historical avg after)
6. Once the selection is confirmed, call github_bulk_update_item_field with:
   - field_id: the sprint field ID from scrum://config
   - value: { type: 'iteration', iteration_id: '<target sprint iteration ID>' }
   - item_ids: the selected project item IDs

AUTONOMY NOTE: Always invoke confirm-mutation before any bulk sprint assignment,
regardless of autonomy level. Sprint commitment changes are high-stakes.`,
          },
        },
      ],
    }),
  );

  // ── sprint-close ─────────────────────────────────────────────────────────────
  //
  // Write scope: clear/reassign sprint field (carry-over), archive Done items.
  // The close tool defaults to dry_run: true — agent must explicitly confirm.

  server.registerPrompt(
    "sprint-close",
    {
      title: "Sprint Close",
      description:
        "Close a sprint: carry incomplete items to the next sprint or backlog, " +
        "optionally archive Done items. Always starts with a dry-run preview. " +
        "Require explicit 'confirm' before executing.",
    },
    () => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `You are acting as Scrum Master assistant for the sprint close ceremony.

PERMITTED OPERATIONS:
- Read scrum://config
- Call github_get_sprint_status (final state of the closing sprint)
- Call github_generate_sprint_report (produces the sprint review document)
- Call github_close_sprint with dry_run: true (preview — ALWAYS run this first)
- Call github_close_sprint with dry_run: false ONLY after confirm-mutation has been
  invoked and the user has typed the literal string "confirm"
- Call github_archive_project_item (individual archiving if needed)

NOT PERMITTED in this workflow:
- Creating new items
- Modifying story points or status
- Changing any field other than Sprint (iteration) and archived status

WORKFLOW:
1. Read scrum://config to get project coordinates, Done status option name
2. Call github_get_sprint_status to see the final sprint state
3. Call github_generate_sprint_report to produce the sprint review document
4. Call github_close_sprint(dry_run: true) to preview carry-over and archive actions
5. Present the preview to the user and invoke confirm-mutation
6. Only after receiving "confirm": call github_close_sprint(dry_run: false)
7. After execution, archive sprint-current.md as sprint-archive-{N}.md

CRITICAL: Never call github_close_sprint with dry_run: false without first
presenting the dry-run preview and receiving the literal string "confirm".
This rule applies regardless of autonomy level.`,
          },
        },
      ],
    }),
  );

  // ── sprint-management ────────────────────────────────────────────────────────
  //
  // Full read + write access. All mutations are subject to the autonomy gradient
  // from scrum://config. classify-intent is always called before acting on NL input.

  server.registerPrompt(
    "sprint-management",
    {
      title: "Sprint Management",
      description:
        "Full sprint management: read board state, update field values, bulk-assign items, " +
        "and run sprint ceremonies. All writes are subject to the autonomy level in scrum://config. " +
        "classify-intent is always called before acting on informal messages.",
    },
    () => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `You are acting as Scrum Master assistant with full sprint management access.

PERMITTED OPERATIONS:
- Read any scrum:// resource
- Call any github_* read tool
- Call github_update_item_field and github_bulk_update_item_field
- Call github_add_draft_issue
- Call github_close_sprint (dry_run: true freely; dry_run: false only after confirm)
- Call github_archive_project_item

AUTONOMY GRADIENT (from autonomy.level in scrum://config):
  conservative: invoke confirm-mutation before EVERY write, including single-item updates
  standard:     invoke confirm-mutation before writes from NL input and bulk writes
  full:         proceed on high-confidence direct_command intent; confirm-mutation
                required for bulk > require_confirmation_above_n_items threshold,
                and always for destructive operations (archive, sprint close)

ALWAYS:
1. Call classify-intent before acting on any Slack message, issue comment, or
   informal note. Never act on "incidental_mention" classification.
2. For sprint close, always run dry_run: true first and present the preview.
3. Respect Definition of Ready / Definition of Done from scrum://config when
   moving items between status values.
4. Flag impediments using the impediment field — do not silently move blocked
   items without noting the block.

WORKFLOW for general requests:
1. Read scrum://config (project coordinates + field IDs)
2. Identify the requested operation
3. If from informal NL: call classify-intent → abort if incidental_mention
4. Check autonomy level → invoke confirm-mutation if required
5. Execute the operation
6. Report the outcome with item IDs and new field values`,
          },
        },
      ],
    }),
  );
};
