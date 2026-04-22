# GitHub Projects v2 MCP Server

A local MCP (Model Context Protocol) server for interacting with **GitHub Projects v2** via the GitHub GraphQL API. Connect it to Claude Desktop, Claude Code, Open WebUI, or any MCP-compatible client.

## Related Documentation

- GitHub Projects API: https://docs.github.com/en/issues/planning-and-tracking-with-projects/

## Tools

| Tool | Description |
|---|---|
| `github_list_projects` | List all projects for a user or org |
| `github_get_project` | Get full project details (fields, IDs) |
| `github_get_project_fields` | List fields with option/iteration IDs |
| `github_update_project` | Update title, description, visibility, status |
| `github_list_project_items` | List items with field values, paginated |
| `github_add_item_to_project` | Add an existing Issue/PR to a project |
| `github_add_draft_issue` | Create a draft issue in a project |
| `github_update_item_field` | Set/clear any custom field value |
| `github_archive_project_item` | Archive or unarchive an item |
| `github_delete_project_item` | Permanently remove an item |
| `github_get_issue_node_id` | Look up a node ID for an Issue/PR |
| `github_get_user_node_id` | Look up a node ID for a user |

## Prerequisites

- Node.js ≥ 20
- Deno.js
- A GitHub Personal Access Token (classic. Fine-grained doesn't support projects v2 yet)

### Token Scopes

| Operation | Required Scope |
|---|---|
| Read projects | `read:project` |
| Write projects (add/update/delete items, update project) | `project` |
| Read issues/PRs (to add them by node ID) | `repo` (or `public_repo` for public repos) |

Generate at: **GitHub → Settings → Developer Settings → Personal access tokens**

## Quickstart

```bash
deno install
deno task start
```

## HTTP Mode (Home Lab / Docker)

```bash
# .env file
GITHUB_TOKEN=ghp_yourtoken
```

```bash
docker compose build
docker compose up
```

The server listens on `http://127.0.0.1:3456/mcp`. Expose through your existing reverse proxy (Nginx, Caddy, Traefik) with authentication.

### Open WebUI MCP Integration

In Open WebUI environment, set:

```
MCP_SERVER_URL=http://github-projects-mcp:3000/mcp
```

Or via the UI: **Admin Panel → Settings → Tools → MCP Servers**.

## Development

```bash
deno task dev          # watch mode TypeScript compilation
deno task inspector    # MCP Inspector UI for interactive testing
```

## Typical Workflows

### 1. Move an issue through the board

```
1. github_get_project        → get project node ID + "Status" field ID + option IDs
2. github_get_issue_node_id  → get issue node ID
3. github_add_item_to_project → get item node ID
4. github_update_item_field  → set Status = "In Progress" (using option_id)
```

### 2. Create and assign a task

```
1. github_get_project        → get project node ID + "Assignee" / "Sprint" field IDs
2. github_get_user_node_id   → get user node ID
3. github_add_draft_issue    → create draft with assignee_ids
4. github_update_item_field  → set Sprint iteration
```

### 3. Bulk-list and triage

```
1. github_list_project_items → paginate through all items
2. github_update_item_field  → set Priority = "High" for each relevant item
```

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `GITHUB_TOKEN` | — | **Required.** GitHub PAT |
| `MCP_TRANSPORT` | `stdio` | `stdio` or `http` |
| `PORT` | `3000` | HTTP listen port (http mode only) |
