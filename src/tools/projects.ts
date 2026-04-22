import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp";
import { graphql, formatError } from "../services/github.ts";
import {
  PROJECT_CORE_FRAGMENT,
  formatProject,
  formatField,
} from "../services/formatters.ts";
import {
  ListProjectsSchema,
  GetProjectSchema,
  UpdateProjectSchema,
  GetProjectFieldsSchema,
} from "../schemas/inputs.ts";
import type {
  UserProjectsData,
  OrgProjectsData,
  SingleProjectData,
  UpdateProjectData,
  ProjectV2Field,
} from "../types.ts";

export const registerProjectTools = (server: McpServer): void => {
  // ── List Projects ──────────────────────────────────────────────────────────

  server.registerTool(
    "github_list_projects",
    {
      title: "List GitHub Projects v2",
      description: `List all GitHub Projects v2 for a user or organization.

Returns project titles, numbers, URLs, status, item counts, and field definitions.
Project numbers are used by other tools. Node IDs (e.g., PVT_kwDO...) are needed
for mutation tools (add item, update field, etc.).

Args:
  - owner (string): GitHub username or org login
  - owner_type ('user'|'org'): defaults to 'user'
  - first (number): results per page, 1-100, default 20
  - after (string): pagination cursor from previous endCursor
  - include_closed (boolean): include closed projects, default false

Returns: Markdown list of projects with IDs, numbers, URLs, and field summaries.`,
      inputSchema: ListProjectsSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        if (params.owner_type === "org") {
          const query = `
            query($login: String!, $first: Int!, $after: String) {
              organization(login: $login) {
                projectsV2(first: $first, after: $after, orderBy: {field: UPDATED_AT, direction: DESC}) {
                  totalCount
                  pageInfo { hasNextPage endCursor }
                  nodes { ${PROJECT_CORE_FRAGMENT} }
                }
              }
            }`;
          const data = await graphql<OrgProjectsData>(query, {
            login: params.owner,
            first: params.first,
            after: params.after ?? null,
          });
          const projectsV2 = data.organization?.projectsV2;
          if (!projectsV2)
            return {
              content: [
                {
                  type: "text",
                  text: `Organization '${params.owner}' not found.`,
                },
              ],
            };

          const { nodes, totalCount, pageInfo } = projectsV2;
          const filtered = params.include_closed
            ? nodes
            : nodes.filter((p) => !p.closed);
          const text = [
            `## Projects for org: ${params.owner} (${totalCount} total)`,
            pageInfo.hasNextPage
              ? `_Next page cursor: \`${pageInfo.endCursor}\`_`
              : "",
            "",
            ...filtered.map(formatProject),
          ].join("\n");
          return { content: [{ type: "text", text }] };
        } else {
          const query = `
            query($login: String!, $first: Int!, $after: String) {
              user(login: $login) {
                projectsV2(first: $first, after: $after, orderBy: {field: UPDATED_AT, direction: DESC}) {
                  totalCount
                  pageInfo { hasNextPage endCursor }
                  nodes { ${PROJECT_CORE_FRAGMENT} }
                }
              }
            }`;
          const data = await graphql<UserProjectsData>(query, {
            login: params.owner,
            first: params.first,
            after: params.after ?? null,
          });
          const projectsV2 = data.user?.projectsV2;
          if (!projectsV2)
            return {
              content: [
                { type: "text", text: `User '${params.owner}' not found.` },
              ],
            };

          const { nodes, totalCount, pageInfo } = projectsV2;
          const filtered = params.include_closed
            ? nodes
            : nodes.filter((p) => !p.closed);
          const text = [
            `## Projects for user: ${params.owner} (${totalCount} total)`,
            pageInfo.hasNextPage
              ? `_Next page cursor: \`${pageInfo.endCursor}\`_`
              : "",
            "",
            ...filtered.map(formatProject),
          ].join("\n");
          return { content: [{ type: "text", text }] };
        }
      } catch (err) {
        return { content: [{ type: "text", text: formatError(err) }] };
      }
    },
  );

  // ── Get Project ────────────────────────────────────────────────────────────

  server.registerTool(
    "github_get_project",
    {
      title: "Get GitHub Project v2",
      description: `Get full details of a single GitHub Project v2 by project number.

Use this to get the project's node ID (needed for mutations), field IDs and option IDs
(needed for updating field values), and README content.

Args:
  - owner (string): GitHub username or org login
  - owner_type ('user'|'org'): defaults to 'user'
  - project_number (number): project number from the URL (e.g., 1 for /projects/1)

Returns: Full project details including fields, options, and node IDs.`,
      inputSchema: GetProjectSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        const query =
          params.owner_type === "org"
            ? `query($login: String!, $number: Int!) {
                organization(login: $login) {
                  projectV2(number: $number) { ${PROJECT_CORE_FRAGMENT} readme }
                }
              }`
            : `query($login: String!, $number: Int!) {
                user(login: $login) {
                  projectV2(number: $number) { ${PROJECT_CORE_FRAGMENT} readme }
                }
              }`;

        const data = await graphql<SingleProjectData>(query, {
          login: params.owner,
          number: params.project_number,
        });

        const project =
          params.owner_type === "org"
            ? data.organization?.projectV2
            : data.user?.projectV2;

        if (!project) {
          return {
            content: [
              {
                type: "text",
                text: `Project #${params.project_number} not found for ${params.owner}.`,
              },
            ],
          };
        }

        const sections = [formatProject(project)];
        if (project.readme) {
          sections.push("", "### README", project.readme);
        }

        return { content: [{ type: "text", text: sections.join("\n") }] };
      } catch (err) {
        return { content: [{ type: "text", text: formatError(err) }] };
      }
    },
  );

  // ── Get Project Fields ─────────────────────────────────────────────────────

  server.registerTool(
    "github_get_project_fields",
    {
      title: "Get Project Fields",
      description: `List all custom fields for a GitHub Project v2, with their IDs and options.

Use this before calling github_update_item_field to get the field node IDs,
single-select option IDs, and iteration IDs you need for updates.

Args:
  - owner (string): GitHub username or org login
  - owner_type ('user'|'org'): defaults to 'user'
  - project_number (number): project number
  - field_type (string, optional): filter by data type — one of TEXT, NUMBER, DATE,
    SINGLE_SELECT, ITERATION, ASSIGNEES, LABELS, MILESTONE, REPOSITORY, REVIEWERS,
    TITLE, TRACKED_BY, TRACKS. Omit to return all fields.

Returns: Each field's name, dataType, node ID, and (for single-select) all option IDs.`,
      inputSchema: GetProjectFieldsSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        const query =
          params.owner_type === "org"
            ? `query($login: String!, $number: Int!) {
                organization(login: $login) {
                  projectV2(number: $number) {
                    title number
                    fields(first: 50) {
                      nodes {
                        ... on ProjectV2Field { id name dataType }
                        ... on ProjectV2SingleSelectField {
                          id name dataType
                          options { id name color description }
                        }
                        ... on ProjectV2IterationField {
                          id name dataType
                          configuration {
                            iterations { id title startDate duration }
                            completedIterations { id title startDate duration }
                          }
                        }
                      }
                    }
                  }
                }
              }`
            : `query($login: String!, $number: Int!) {
                user(login: $login) {
                  projectV2(number: $number) {
                    title number
                    fields(first: 50) {
                      nodes {
                        ... on ProjectV2Field { id name dataType }
                        ... on ProjectV2SingleSelectField {
                          id name dataType
                          options { id name color description }
                        }
                        ... on ProjectV2IterationField {
                          id name dataType
                          configuration {
                            iterations { id title startDate duration }
                            completedIterations { id title startDate duration }
                          }
                        }
                      }
                    }
                  }
                }
              }`;

        const data = await graphql<{
          user?: {
            projectV2: {
              title: string;
              number: number;
              fields: { nodes: ProjectV2Field[] };
            } | null;
          };
          organization?: {
            projectV2: {
              title: string;
              number: number;
              fields: { nodes: ProjectV2Field[] };
            } | null;
          };
        }>(query, { login: params.owner, number: params.project_number });

        const project =
          params.owner_type === "org"
            ? data.organization?.projectV2
            : data.user?.projectV2;

        if (!project) {
          return {
            content: [
              {
                type: "text",
                text: `Project #${params.project_number} not found for ${params.owner}.`,
              },
            ],
          };
        }

        const fields = params.field_type
          ? project.fields.nodes.filter((f) => f.dataType === params.field_type)
          : project.fields.nodes;

        const fieldLines = fields.map(formatField);
        const filterNote = params.field_type
          ? ` (filtered: ${params.field_type})`
          : "";
        const text = [
          `## Fields for: ${project.title} (#${project.number})${filterNote}`,
          "",
          fieldLines.length === 0
            ? `_No fields of type ${params.field_type} found._`
            : fieldLines.join("\n"),
        ].join("\n");

        return { content: [{ type: "text", text }] };
      } catch (err) {
        return { content: [{ type: "text", text: formatError(err) }] };
      }
    },
  );

  // ── Update Project ─────────────────────────────────────────────────────────

  server.registerTool(
    "github_update_project",
    {
      title: "Update GitHub Project v2",
      description: `Update the metadata of a GitHub Project v2.

Can update title, short description, readme, visibility, and open/closed status.
Requires the project node ID (get it from github_get_project).

Args:
  - project_id (string): Node ID of the project (e.g., PVT_kwDO...)
  - title (string, optional): New title
  - short_description (string, optional): New short description (max 255 chars)
  - readme (string, optional): New readme markdown content
  - public (boolean, optional): Set visibility
  - closed (boolean, optional): true to close, false to reopen

Returns: Updated project metadata.`,
      inputSchema: UpdateProjectSchema,
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
          mutation($input: UpdateProjectV2Input!) {
            updateProjectV2(input: $input) {
              projectV2 { id title shortDescription public closed }
            }
          }`;

        const input: Record<string, unknown> = { projectId: params.project_id };
        if (params.title !== undefined) input.title = params.title;
        if (params.short_description !== undefined)
          input.shortDescription = params.short_description;
        if (params.readme !== undefined) input.readme = params.readme;
        if (params.public !== undefined) input.public = params.public;
        if (params.closed !== undefined) input.closed = params.closed;

        const data = await graphql<UpdateProjectData>(mutation, { input });
        const p = data.updateProjectV2.projectV2;

        return {
          content: [
            {
              type: "text",
              text: [
                "✅ Project updated successfully.",
                `**Title**: ${p.title}`,
                `**Status**: ${p.closed ? "Closed" : "Open"} | ${p.public ? "Public" : "Private"}`,
                p.shortDescription
                  ? `**Description**: ${p.shortDescription}`
                  : "",
              ]
                .filter(Boolean)
                .join("\n"),
            },
          ],
        };
      } catch (err) {
        return { content: [{ type: "text", text: formatError(err) }] };
      }
    },
  );
};
