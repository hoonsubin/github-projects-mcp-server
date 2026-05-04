import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp";
import { enrichError, graphql } from "../services/github.ts";
import {
  CreateCommentSchema,
  CreateIssueSchema,
  GetRepoFileSchema,
  GraphQLQuerySchema,
  UpdateIssueSchema,
  WriteRepoFileSchema,
} from "../schemas/inputs.ts";

// ── Inline response types ─────────────────────────────────────────────────────
// Defined here rather than types.ts to keep repository-specific shapes local.

interface RepoFileData {
  repository: {
    object: { text: string; oid: string } | null;
  } | null;
}

interface RepoIdData {
  repository: { id: string } | null;
}

interface HeadOidData {
  repository: {
    ref: {
      target: { oid: string };
    } | null;
  } | null;
}

interface CreateIssueData {
  createIssue: {
    issue: { id: string; number: number; title: string; url: string };
  };
}

interface UpdateIssueData {
  updateIssue: {
    issue: { id: string; number: number; title: string; state: string; url: string };
  };
}

interface AddCommentData {
  addComment: {
    commentEdge: { node: { id: string; url: string } };
  };
}

interface AddDiscussionCommentData {
  addDiscussionComment: {
    comment: { id: string; url: string };
  };
}

interface CreateCommitData {
  createCommitOnBranch: {
    commit: { oid: string; url: string };
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * UTF-8-safe base64 encoder. Uses a byte-loop rather than spread-into-btoa to
 * avoid call-stack overflows on files larger than a few MB.
 */
const toBase64 = (text: string): string => {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
};

// ── Tool registration ─────────────────────────────────────────────────────────

export const registerRepositoryTools = (server: McpServer): void => {
  // ── Arbitrary GraphQL query ───────────────────────────────────────────────

  server.registerTool(
    "github_graphql",
    {
      title: "GitHub GraphQL Query",
      description: `Execute a read-only GraphQL query against the GitHub API.

Use this tool for ad-hoc lookups not covered by other tools:
  - Fetching repository or user node IDs
  - Listing labels, milestones, or branches
  - Resolving discussion IDs
  - Exploring any GitHub data accessible via GraphQL

Mutations are blocked — this tool is strictly read-only.
For write operations use: github_create_issue, github_update_issue,
github_create_comment, github_write_repo_file, github_update_item_field, etc.

Args:
  - query (string): A valid GraphQL query string (no 'mutation' keyword)
  - variables (object, optional): Variables referenced in the query

Returns: Raw JSON response data as formatted text.`,
      inputSchema: GraphQLQuerySchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        if (/\bmutation\b/i.test(params.query)) {
          return {
            content: [{
              type: "text",
              text: "Error: github_graphql is read-only. Use a dedicated write tool for mutations.",
            }],
          };
        }

        const data = await graphql<unknown>(params.query, params.variables ?? {});

        // Detect silent all-null responses — common when the token lacks read
        // access to a resource (GitHub returns null rather than an error).
        if (
          data !== null &&
          typeof data === "object" &&
          Object.values(data as Record<string, unknown>).length > 0 &&
          Object.values(data as Record<string, unknown>).every((v) => v === null)
        ) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify(data, null, 2) +
                "\n\n⚠️ All top-level fields returned null. This usually means your token " +
                "does not have read access to the queried resource. " +
                "Verify the owner/repo/login values are correct and that your " +
                "fine-grained token grants access to the relevant repository.",
            }],
          };
        }

        return {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        };
      } catch (err) {
        return { content: [{ type: "text", text: enrichError(err, { operation: "graphql" }) }] };
      }
    },
  );

  // ── Read a file from a repository ────────────────────────────────────────

  server.registerTool(
    "github_get_repo_file",
    {
      title: "Get Repository File",
      description: `Read a file's text content from a GitHub repository via GraphQL.

Useful for reading configuration files, READMEs, or any tracked text file
without needing the GitHub REST API.

Args:
  - owner (string): Repository owner (user or org login)
  - repo (string): Repository name
  - path (string): File path relative to the repo root (e.g. '.github/scrum/config.yml')
  - ref (string, optional): Branch, tag, or commit SHA. Defaults to HEAD.

Returns: File content as plain text, plus the blob OID (useful as a version reference).
         Returns an error message if the path does not exist or is not a text blob.`,
      inputSchema: GetRepoFileSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        const ref = params.ref ?? "HEAD";
        const expression = `${ref}:${params.path}`;

        const data = await graphql<RepoFileData>(
          `query GetRepoFile($owner: String!, $repo: String!, $expression: String!) {
            repository(owner: $owner, name: $repo) {
              object(expression: $expression) {
                ... on Blob {
                  text
                  oid
                }
              }
            }
          }`,
          { owner: params.owner, repo: params.repo, expression },
        );

        if (!data.repository) {
          return {
            content: [{
              type: "text",
              text: `Error: Repository '${params.owner}/${params.repo}' not found or not accessible.\n\n` +
                `→ Fix: Check the owner and repo name, and ensure your fine-grained token ` +
                `grants 'Contents: Read' access to '${params.owner}/${params.repo}'.`,
            }],
          };
        }

        const blob = data.repository.object;
        if (!blob) {
          return {
            content: [{
              type: "text",
              text: `Error: Path '${params.path}' not found at ref '${ref}' in ${params.owner}/${params.repo}.\n\n` +
                `→ Fix: Verify the file path and ref are correct (ref defaults to HEAD if omitted).`,
            }],
          };
        }

        return {
          content: [{
            type: "text",
            text: [
              `**${params.owner}/${params.repo}** \`${params.path}\` @ \`${ref}\``,
              `OID: \`${blob.oid}\``,
              ``,
              blob.text,
            ].join("\n"),
          }],
        };
      } catch (err) {
        return { content: [{ type: "text", text: enrichError(err, { operation: "get_repo_file" }) }] };
      }
    },
  );

  // ── Create an issue ───────────────────────────────────────────────────────

  server.registerTool(
    "github_create_issue",
    {
      title: "Create Issue",
      description: `Create a new issue in a GitHub repository.

Internally performs two GraphQL calls:
  1. Look up the repository node ID.
  2. Call the createIssue mutation with that ID.

To add the issue to a project after creation, use github_add_item_to_project
with the returned issue node ID.

Args:
  - owner (string): Repository owner (user or org login)
  - repo (string): Repository name
  - title (string): Issue title (max 255 characters)
  - body (string, optional): Issue body in Markdown
  - assignee_ids (string[], optional): User node IDs to assign
    (get IDs via github_get_user_node_id or github_graphql)
  - label_ids (string[], optional): Label node IDs to apply
    (get IDs via github_graphql listing repository labels)

Returns: Issue number, node ID, title, and URL of the created issue.`,
      inputSchema: CreateIssueSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        // Step 1: resolve repository node ID
        const repoData = await graphql<RepoIdData>(
          `query GetRepoId($owner: String!, $repo: String!) {
            repository(owner: $owner, name: $repo) {
              id
            }
          }`,
          { owner: params.owner, repo: params.repo },
        );

        if (!repoData.repository) {
          return {
            content: [{
              type: "text",
              text: `Error: Repository '${params.owner}/${params.repo}' not found or not accessible.\n\n` +
                `→ Fix: Check the owner and repo name, and ensure your fine-grained token ` +
                `grants 'Issues: Read and write' access to '${params.owner}/${params.repo}'.`,
            }],
          };
        }

        const repositoryId = repoData.repository.id;

        // Step 2: create the issue
        const input: Record<string, unknown> = {
          repositoryId,
          title: params.title,
        };
        if (params.body !== undefined) input.body = params.body;
        if (params.assignee_ids !== undefined) input.assigneeIds = params.assignee_ids;
        if (params.label_ids !== undefined) input.labelIds = params.label_ids;

        const data = await graphql<CreateIssueData>(
          `mutation CreateIssue($input: CreateIssueInput!) {
            createIssue(input: $input) {
              issue {
                id
                number
                title
                url
              }
            }
          }`,
          { input },
        );

        const issue = data.createIssue.issue;
        return {
          content: [{
            type: "text",
            text: [
              `✅ Issue created.`,
              `**Title**: ${issue.title}`,
              `**Number**: #${issue.number}`,
              `**Node ID**: \`${issue.id}\``,
              `**URL**: ${issue.url}`,
            ].join("\n"),
          }],
        };
      } catch (err) {
        return { content: [{ type: "text", text: enrichError(err, { operation: "create_issue" }) }] };
      }
    },
  );

  // ── Update an issue ───────────────────────────────────────────────────────

  server.registerTool(
    "github_update_issue",
    {
      title: "Update Issue",
      description: `Update an existing GitHub issue — state, title, body, assignees, or labels.

All fields except issue_node_id are optional. Only provided fields are changed;
omitted fields remain unchanged. To clear all assignees or labels, pass an empty
array [].

Args:
  - issue_node_id (string): Node ID of the issue (e.g. I_kwDO...)
    Get it via github_get_issue_node_id or github_graphql.
  - state ('OPEN'|'CLOSED', optional): New issue state
  - title (string, optional): New title (max 255 characters)
  - body (string, optional): New body in Markdown
  - assignee_ids (string[], optional): Replacement set of user node IDs
  - label_ids (string[], optional): Replacement set of label node IDs

Returns: Updated issue number, state, title, and URL.`,
      inputSchema: UpdateIssueSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        const input: Record<string, unknown> = { id: params.issue_node_id };
        if (params.state !== undefined) input.state = params.state;
        if (params.title !== undefined) input.title = params.title;
        if (params.body !== undefined) input.body = params.body;
        if (params.assignee_ids !== undefined) input.assigneeIds = params.assignee_ids;
        if (params.label_ids !== undefined) input.labelIds = params.label_ids;

        const data = await graphql<UpdateIssueData>(
          `mutation UpdateIssue($input: UpdateIssueInput!) {
            updateIssue(input: $input) {
              issue {
                id
                number
                title
                state
                url
              }
            }
          }`,
          { input },
        );

        const issue = data.updateIssue.issue;
        return {
          content: [{
            type: "text",
            text: [
              `✅ Issue updated.`,
              `**Title**: ${issue.title}`,
              `**Number**: #${issue.number}`,
              `**State**: ${issue.state}`,
              `**Node ID**: \`${issue.id}\``,
              `**URL**: ${issue.url}`,
            ].join("\n"),
          }],
        };
      } catch (err) {
        return { content: [{ type: "text", text: enrichError(err, { operation: "update_issue" }) }] };
      }
    },
  );

  // ── Create a comment ──────────────────────────────────────────────────────

  server.registerTool(
    "github_create_comment",
    {
      title: "Create Comment",
      description: `Add a comment to a GitHub issue, pull request, or discussion.

Issues and PRs share the addComment mutation (subject_id is the node ID of
the issue or PR). Discussions use addDiscussionComment.

Args:
  - subject_id (string): Node ID of the target:
      Issue      → I_kwDO...  (from github_get_issue_node_id)
      PR         → PR_kwDO... (from github_get_issue_node_id with type='pull_request')
      Discussion → D_kwDO...  (from github_graphql)
  - body (string): Comment body in Markdown
  - type ('issue'|'pr'|'discussion'): Target content type

Returns: Node ID and URL of the new comment.`,
      inputSchema: CreateCommentSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        if (params.type === "discussion") {
          const data = await graphql<AddDiscussionCommentData>(
            `mutation AddDiscussionComment($discussionId: ID!, $body: String!) {
              addDiscussionComment(input: { discussionId: $discussionId, body: $body }) {
                comment {
                  id
                  url
                }
              }
            }`,
            { discussionId: params.subject_id, body: params.body },
          );

          const comment = data.addDiscussionComment.comment;
          return {
            content: [{
              type: "text",
              text: [
                `✅ Discussion comment created.`,
                `**Node ID**: \`${comment.id}\``,
                `**URL**: ${comment.url}`,
              ].join("\n"),
            }],
          };
        }

        // issue or pr — both use addComment
        const data = await graphql<AddCommentData>(
          `mutation AddComment($subjectId: ID!, $body: String!) {
            addComment(input: { subjectId: $subjectId, body: $body }) {
              commentEdge {
                node {
                  id
                  url
                }
              }
            }
          }`,
          { subjectId: params.subject_id, body: params.body },
        );

        const comment = data.addComment.commentEdge.node;
        return {
          content: [{
            type: "text",
            text: [
              `✅ Comment created.`,
              `**Node ID**: \`${comment.id}\``,
              `**URL**: ${comment.url}`,
            ].join("\n"),
          }],
        };
      } catch (err) {
        return { content: [{ type: "text", text: enrichError(err, { operation: "create_comment" }) }] };
      }
    },
  );

  // ── Write a file to a repository ─────────────────────────────────────────

  server.registerTool(
    "github_write_repo_file",
    {
      title: "Write Repository File",
      description: `Create or overwrite a single file in a GitHub repository via a commit.

Internally performs two GraphQL calls:
  1. Fetch the current HEAD commit OID on the target branch (optimistic lock).
  2. Call createCommitOnBranch with the file content and that OID.

The branch must already exist. Content is accepted as plain text; base64
encoding is handled internally.

Args:
  - owner (string): Repository owner (user or org login)
  - repo (string): Repository name
  - branch (string): Target branch (e.g. 'main'). Must already exist.
  - path (string): File path relative to the repo root (e.g. '.github/scrum/config.yml')
  - content (string): Plain text file content
  - commit_message (string): Commit headline (keep under 72 characters)

Returns: Commit OID and URL of the resulting commit.`,
      inputSchema: WriteRepoFileSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        // Step 1: fetch HEAD commit OID for the optimistic lock
        const headData = await graphql<HeadOidData>(
          `query GetHeadOid($owner: String!, $repo: String!, $branch: String!) {
            repository(owner: $owner, name: $repo) {
              ref(qualifiedName: $branch) {
                target {
                  oid
                }
              }
            }
          }`,
          { owner: params.owner, repo: params.repo, branch: params.branch },
        );

        if (!headData.repository) {
          return {
            content: [{
              type: "text",
              text: `Error: Repository '${params.owner}/${params.repo}' not found or not accessible.\n\n` +
                `→ Fix: Check the owner and repo name, and ensure your fine-grained token ` +
                `grants 'Contents: Read and write' access to '${params.owner}/${params.repo}'.`,
            }],
          };
        }

        if (!headData.repository.ref) {
          return {
            content: [{
              type: "text",
              text: `Error: Branch '${params.branch}' not found in ${params.owner}/${params.repo}.\n\n` +
                `→ Fix: Check the branch name — it must already exist. ` +
                `This tool cannot create new branches.`,
            }],
          };
        }

        const expectedHeadOid = headData.repository.ref.target.oid;

        // Step 2: commit the file
        const data = await graphql<CreateCommitData>(
          `mutation WriteRepoFile($input: CreateCommitOnBranchInput!) {
            createCommitOnBranch(input: $input) {
              commit {
                oid
                url
              }
            }
          }`,
          {
            input: {
              branch: {
                repositoryNameWithOwner: `${params.owner}/${params.repo}`,
                branchName: params.branch,
              },
              message: { headline: params.commit_message },
              fileChanges: {
                additions: [
                  { path: params.path, contents: toBase64(params.content) },
                ],
              },
              expectedHeadOid,
            },
          },
        );

        const commit = data.createCommitOnBranch.commit;
        return {
          content: [{
            type: "text",
            text: [
              `✅ File committed.`,
              `**Path**: ${params.path}`,
              `**Branch**: ${params.branch}`,
              `**Commit OID**: \`${commit.oid}\``,
              `**Commit URL**: ${commit.url}`,
            ].join("\n"),
          }],
        };
      } catch (err) {
        return { content: [{ type: "text", text: enrichError(err, { operation: "write_repo_file" }) }] };
      }
    },
  );
};
