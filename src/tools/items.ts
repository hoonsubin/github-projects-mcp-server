import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp";
import { formatError, graphql } from "../services/github.ts";
import {
  formatItem,
  ITEM_CONTENT_FRAGMENT,
  ITEM_FIELD_VALUES_FRAGMENT,
} from "../services/formatters.ts";
import {
  AddDraftIssueSchema,
  AddItemSchema,
  ArchiveItemSchema,
  DeleteItemSchema,
  GetIssueNodeIdSchema,
  GetUserNodeIdSchema,
  ListItemsSchema,
  resolveFieldValue,
  UpdateFieldValueSchema,
} from "../schemas/inputs.ts";
import type {
  AddDraftIssueData,
  AddProjectItemData,
  ArchiveProjectItemData,
  DeleteProjectItemData,
  ProjectItemsData,
  ProjectV2Item,
  UpdateProjectItemFieldData,
} from "../types.ts";

export const registerItemTools = (server: McpServer): void => {
  // ── List Items ─────────────────────────────────────────────────────────────

  server.registerTool(
    "github_list_project_items",
    {
      title: "List Project Items",
      description: `List items (issues, PRs, draft issues) in a GitHub Project v2.

Returns each item's node ID (needed for field updates), content details,
and all custom field values. Filtering is client-side (GitHub has no server filterBy).

Args:
  - owner (string): GitHub username or org login
  - owner_type ('user'|'org'): defaults to 'user'
  - project_number (number): project number
  - first (number): items per page, 1-100, default 20
  - after (string): pagination cursor
  - filter_type ('Issue'|'PullRequest'|'DraftIssue'): optional content type filter
  - iteration_id (string, optional): filter to items assigned to a specific sprint iteration node ID
  - status_option_id (string, optional): filter to items with a specific Status option ID
    (get option IDs from github_get_project_fields)

Returns: Markdown list of items with IDs, titles, states, and field values.
         Includes pagination cursor if more items exist.`,
      inputSchema: ListItemsSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        const itemsFragment = `
          items(first: $first, after: $after) {
            totalCount
            pageInfo { hasNextPage endCursor }
            nodes {
              id type createdAt updatedAt isArchived
              ${ITEM_CONTENT_FRAGMENT}
              ${ITEM_FIELD_VALUES_FRAGMENT}
            }
          }`;

        const query = params.owner_type === "org"
          ? `query($login: String!, $number: Int!, $first: Int!, $after: String) {
                organization(login: $login) {
                  projectV2(number: $number) { ${itemsFragment} }
                }
              }`
          : `query($login: String!, $number: Int!, $first: Int!, $after: String) {
                user(login: $login) {
                  projectV2(number: $number) { ${itemsFragment} }
                }
              }`;

        const data = await graphql<ProjectItemsData>(query, {
          login: params.owner,
          number: params.project_number,
          first: params.first,
          after: params.after ?? null,
        });

        const projectData = params.owner_type === "org"
          ? data.organization?.projectV2
          : data.user?.projectV2;

        if (!projectData) {
          return {
            content: [{
              type: "text",
              text: `Project #${params.project_number} not found for ${params.owner}.`,
            }],
          };
        }

        let items: ProjectV2Item[] = projectData.items.nodes;

        if (params.filter_type) {
          items = items.filter((item) => item.type === params.filter_type);
        }

        // Client-side iteration filter — matches any field value node with the given iterationId.
        // The agent is responsible for knowing which field is the sprint field (via config.yml).
        if (params.iteration_id) {
          const targetId = params.iteration_id;
          items = items.filter((item) =>
            item.fieldValues.nodes.some((fv) => fv.iterationId === targetId)
          );
        }

        // Client-side status option filter
        if (params.status_option_id) {
          const targetOptionId = params.status_option_id;
          items = items.filter((item) =>
            item.fieldValues.nodes.some((fv) => fv.optionId === targetOptionId)
          );
        }

        const { totalCount, pageInfo } = projectData.items;
        const lines = [
          `## Project Items (${totalCount} total, showing ${items.length})`,
          pageInfo.hasNextPage ? `_Next page cursor: \`${pageInfo.endCursor}\`_` : "",
          "",
          items.length === 0 ? "_No items found._" : items.map(formatItem).join("\n\n---\n\n"),
        ];

        return { content: [{ type: "text", text: lines.filter((l) => l !== "").join("\n") }] };
      } catch (err) {
        return { content: [{ type: "text", text: formatError(err) }] };
      }
    },
  );

  // ── Add Issue/PR to Project ────────────────────────────────────────────────

  server.registerTool(
    "github_add_item_to_project",
    {
      title: "Add Issue/PR to Project",
      description: `Add an existing Issue or Pull Request to a GitHub Project v2.

You need:
  1. The project node ID — get it from github_get_project
  2. The issue/PR node ID — get it from github_get_issue_node_id

Args:
  - project_id (string): Project node ID (e.g., PVT_kwDO...)
  - content_id (string): Issue or PR node ID (e.g., I_kwDO... or PR_kwDO...)

Returns: Node ID of the new project item (use this for github_update_item_field).`,
      inputSchema: AddItemSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        const mutation = `
          mutation($projectId: ID!, $contentId: ID!) {
            addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) {
              item { id }
            }
          }`;

        const data = await graphql<AddProjectItemData>(mutation, {
          projectId: params.project_id,
          contentId: params.content_id,
        });

        const itemId = data.addProjectV2ItemById.item.id;
        return {
          content: [{
            type: "text",
            text:
              `✅ Item added to project.\n**Item node ID**: \`${itemId}\`\n\nUse this ID with github_update_item_field to set field values.`,
          }],
        };
      } catch (err) {
        return { content: [{ type: "text", text: formatError(err) }] };
      }
    },
  );

  // ── Add Draft Issue ────────────────────────────────────────────────────────

  server.registerTool(
    "github_add_draft_issue",
    {
      title: "Add Draft Issue to Project",
      description: `Create a new draft issue directly in a GitHub Project v2.

Draft issues live only in the project board (not in a repository) until converted.
Useful for capturing quick tasks or ideas without creating a repo issue.

**Prerequisites**: you need the project node ID before calling this tool.
Call github_get_project(owner, owner_type, project_number) and use the returned id.

Args:
  - project_id (string): Project node ID (PVT_kwDO…). Do NOT pass owner or project_number here.
  - title (string): Draft issue title (required)
  - body (string, optional): Markdown body content
  - assignee_ids (string[], optional): Array of user node IDs (get from github_get_user_node_id)

Returns: Node ID of the new project item. Use github_update_item_field to set field values such as sprint assignment.`,
      inputSchema: AddDraftIssueSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        const mutation = `
          mutation($input: AddProjectV2DraftIssueInput!) {
            addProjectV2DraftIssue(input: $input) {
              projectItem { id }
            }
          }`;

        const input: Record<string, unknown> = {
          projectId: params.project_id,
          title: params.title,
        };
        if (params.body !== undefined) input.body = params.body;
        if (params.assignee_ids && params.assignee_ids.length > 0) {
          input.assigneeIds = params.assignee_ids;
        }

        const data = await graphql<AddDraftIssueData>(mutation, { input });
        const itemId = data.addProjectV2DraftIssue.projectItem.id;

        return {
          content: [{
            type: "text",
            text: [
              `✅ Draft issue created.`,
              `**Title**: ${params.title}`,
              `**Item node ID**: \`${itemId}\``,
            ].join("\n"),
          }],
        };
      } catch (err) {
        return { content: [{ type: "text", text: formatError(err) }] };
      }
    },
  );

  // ── Update Field Value ─────────────────────────────────────────────────────

  server.registerTool(
    "github_update_item_field",
    {
      title: "Update Project Item Field Value",
      description: `Set or clear a custom field value on a project item.

Workflow:
  1. Get project node ID: call github_get_project or use github_graphql
  2. Get field IDs: call github_get_project_fields or use github_graphql
  3. Get item IDs: github_list_project_items
  4. Call this tool with the resolved IDs

Supported field types — always set \`type\`, then set the matching companion key:
  - text:          { type: 'text', value: 'string' }
  - number:        { type: 'number', number_value: 123 }
  - date:          { type: 'date', value: 'YYYY-MM-DD' }
  - single_select: { type: 'single_select', option_id: 'abc123' }
  - iteration:     { type: 'iteration', iteration_id: 'abc123' }
  - clear:         { type: 'clear' }  — removes any current value, no other key needed

Args:
  - project_id (string): Project node ID (PVT_kwDO…) — from github_get_project or github_graphql.
    Do NOT pass owner or project_number here.
  - item_id (string): Project item node ID (e.g., PVTI_lADO...)
  - field_id (string): Field node ID (from github_get_project_fields or github_graphql)
  - value (object): New value with type discriminator (see above)

Returns: Confirmation with item ID.`,
      inputSchema: UpdateFieldValueSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        const resolved = resolveFieldValue(params.value);
        if (typeof resolved === "string") {
          return { content: [{ type: "text", text: resolved }] };
        }

        if (resolved.isClear) {
          const mutation = `
            mutation($input: ClearProjectV2ItemFieldValueInput!) {
              clearProjectV2ItemFieldValue(input: $input) {
                projectV2Item { id }
              }
            }`;
          await graphql<{ clearProjectV2ItemFieldValue: { projectV2Item: { id: string } } }>(
            mutation,
            {
              input: {
                projectId: params.project_id,
                itemId: params.item_id,
                fieldId: params.field_id,
              },
            },
          );
          return {
            content: [{ type: "text", text: `✅ Field cleared on item \`${params.item_id}\`.` }],
          };
        }

        const mutation = `
          mutation($input: UpdateProjectV2ItemFieldValueInput!) {
            updateProjectV2ItemFieldValue(input: $input) {
              projectV2Item { id }
            }
          }`;

        const data = await graphql<UpdateProjectItemFieldData>(mutation, {
          input: {
            projectId: params.project_id,
            itemId: params.item_id,
            fieldId: params.field_id,
            value: resolved.fieldValue,
          },
        });

        return {
          content: [{
            type: "text",
            text:
              `✅ Field updated on item \`${data.updateProjectV2ItemFieldValue.projectV2Item.id}\`.`,
          }],
        };
      } catch (err) {
        return { content: [{ type: "text", text: formatError(err) }] };
      }
    },
  );

  // ── Archive Item ───────────────────────────────────────────────────────────

  server.registerTool(
    "github_archive_project_item",
    {
      title: "Archive/Unarchive Project Item",
      description: `Archive or unarchive an item in a GitHub Project v2.

Archived items are hidden from the default board view but not deleted.
Use github_delete_project_item to permanently remove an item.

**Prerequisites**: you need the project node ID — call github_get_project or use github_graphql.

Args:
  - project_id (string): Project node ID (PVT_kwDO…). Do NOT pass owner or project_number.
  - item_id (string): Project item node ID (PVTI_lADO…)
  - archived (boolean): true to archive, false to unarchive (default: true)

Returns: Confirmation with item ID and new archived status.`,
      inputSchema: ArchiveItemSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        const mutation = `
          mutation($input: ArchiveProjectV2ItemInput!) {
            archiveProjectV2Item(input: $input) {
              item { id isArchived }
            }
          }`;

        const data = await graphql<ArchiveProjectItemData>(mutation, {
          input: {
            projectId: params.project_id,
            itemId: params.item_id,
            archived: params.archived,
          },
        });

        const { id, isArchived } = data.archiveProjectV2Item.item;
        return {
          content: [{
            type: "text",
            text: `✅ Item \`${id}\` is now **${isArchived ? "archived" : "unarchived"}**.`,
          }],
        };
      } catch (err) {
        return { content: [{ type: "text", text: formatError(err) }] };
      }
    },
  );

  // ── Delete Item ────────────────────────────────────────────────────────────

  server.registerTool(
    "github_delete_project_item",
    {
      title: "Delete Project Item",
      description: `Permanently remove an item from a GitHub Project v2.

⚠️ This is irreversible. The underlying issue or PR is NOT deleted — only its
project card is removed. Use github_archive_project_item for reversible hiding.

**Prerequisites**: you need the project node ID — call github_get_project or use github_graphql.

Args:
  - project_id (string): Project node ID (PVT_kwDO…). Do NOT pass owner or project_number.
  - item_id (string): Project item node ID to delete (PVTI_lADO…)

Returns: Confirmation with the deleted item's ID.`,
      inputSchema: DeleteItemSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        const mutation = `
          mutation($input: DeleteProjectV2ItemInput!) {
            deleteProjectV2Item(input: $input) {
              deletedItemId
            }
          }`;

        const data = await graphql<DeleteProjectItemData>(mutation, {
          input: {
            projectId: params.project_id,
            itemId: params.item_id,
          },
        });

        return {
          content: [{
            type: "text",
            text:
              `✅ Item \`${data.deleteProjectV2Item.deletedItemId}\` has been permanently removed from the project.`,
          }],
        };
      } catch (err) {
        return { content: [{ type: "text", text: formatError(err) }] };
      }
    },
  );

  // ── Helper: Get Issue Node ID ──────────────────────────────────────────────

  server.registerTool(
    "github_get_issue_node_id",
    {
      title: "Get Issue/PR Node ID",
      description: `Look up the GraphQL node ID for a GitHub Issue or Pull Request.

Node IDs are required by github_add_item_to_project. Issue numbers alone are not sufficient.

Args:
  - owner (string): Repository owner
  - repo (string): Repository name
  - issue_number (number): Issue or PR number
  - type ('issue'|'pull_request'): default 'issue'

Returns: The node ID (e.g., I_kwDO...) needed for other tools.`,
      inputSchema: GetIssueNodeIdSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        const query = params.type === "pull_request"
          ? `query($owner: String!, $repo: String!, $number: Int!) {
                repository(owner: $owner, name: $repo) {
                  pullRequest(number: $number) { id number title url state }
                }
              }`
          : `query($owner: String!, $repo: String!, $number: Int!) {
                repository(owner: $owner, name: $repo) {
                  issue(number: $number) { id number title url state }
                }
              }`;

        const data = await graphql<{
          repository: {
            issue?: { id: string; number: number; title: string; url: string; state: string };
            pullRequest?: { id: string; number: number; title: string; url: string; state: string };
          } | null;
        }>(query, { owner: params.owner, repo: params.repo, number: params.issue_number });

        const item = params.type === "pull_request"
          ? data.repository?.pullRequest
          : data.repository?.issue;

        if (!item) {
          return {
            content: [{
              type: "text",
              text: `${
                params.type === "pull_request" ? "PR" : "Issue"
              } #${params.issue_number} not found in ${params.owner}/${params.repo}.`,
            }],
          };
        }

        return {
          content: [{
            type: "text",
            text: [
              `**Node ID**: \`${item.id}\``,
              `**Title**: ${item.title} (#${item.number})`,
              `**State**: ${item.state}`,
              `**URL**: ${item.url}`,
            ].join("\n"),
          }],
        };
      } catch (err) {
        return { content: [{ type: "text", text: formatError(err) }] };
      }
    },
  );

  // ── Helper: Get User Node ID ───────────────────────────────────────────────

  server.registerTool(
    "github_get_user_node_id",
    {
      title: "Get User Node ID",
      description: `Look up the GraphQL node ID for a GitHub user.

User node IDs are needed for the assignee_ids field in github_add_draft_issue.

Args:
  - login (string): GitHub username

Returns: The user's node ID (e.g., U_kgDO...).`,
      inputSchema: GetUserNodeIdSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        const query = `
          query($login: String!) {
            user(login: $login) { id login name avatarUrl }
          }`;

        const data = await graphql<{
          user: { id: string; login: string; name: string | null; avatarUrl: string } | null;
        }>(query, { login: params.login });

        if (!data.user) {
          return { content: [{ type: "text", text: `User '${params.login}' not found.` }] };
        }

        return {
          content: [{
            type: "text",
            text: [
              `**Node ID**: \`${data.user.id}\``,
              `**Login**: ${data.user.login}`,
              data.user.name ? `**Name**: ${data.user.name}` : "",
            ].filter(Boolean).join("\n"),
          }],
        };
      } catch (err) {
        return { content: [{ type: "text", text: formatError(err) }] };
      }
    },
  );
};
