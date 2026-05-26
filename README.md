# The Scrum Master's MCP Toolkit

A local [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server that enables AI agents to manage Scrum teams using scrum language.

This project is designed to serve as the abstraction layer for LLM agents performing autonomous Scrum project management — sprint planning, backlog refinement, history analysis, and ceremony facilitation. Currently optimized for GitHub Projects ecosystem.

The tool surface aims to become **backend-agnostic**: tool names, arguments, and return shapes are defined in Scrum vocabulary. Adding a Trello, Notion, or Linear backend requires replacing only the implementations behind the tools; the agent skill and human workflows remain unchanged.

Supports two transports: **stdio** (Claude Desktop / Claude Code / LM Studio) and **Streamable HTTP** (Open WebUI / Docker / homelab).

## Installation

### Prerequisites

- A GitHub personal access token with **Projects: Read/Write** and **Issues: Read/Write** access
- A GitHub Project (v2) set up and configured with your Scrum fields (Sprint, Status, Priority, etc.)
- A `config.yml` for your project (see `.github/scrum/config.yml` in this repo as a reference)

### Option A — Download a pre-built binary (recommended)

1. Go to the [Releases page](../../releases) and download the binary for your platform:

   | Platform              | File                   |
   | --------------------- | ---------------------- |
   | macOS (Apple Silicon) | `mcp-server-mac-arm64` |
   | macOS (Intel)         | `mcp-server-mac-x64`   |
   | Linux x64             | `mcp-server-linux-x64` |
   | Windows x64           | `mcp-server-win.exe`   |

2. Make it executable (macOS / Linux):
   ```bash
   chmod +x mcp-server-mac-arm64   # or mcp-server-linux-x64
   ```

3. Optionally move it somewhere on your `$PATH`:
   ```bash
   mv mcp-server-mac-arm64 /usr/local/bin/scrum-mcp
   ```

### Option B — Build from source

Requires [Deno](https://deno.com) v2.x.

```bash
git clone https://github.com/YOUR_ORG/github-projects-mcp-server.git
cd github-projects-mcp-server
deno task compile          # builds ./mcp-server for your current platform
deno task compile:all      # builds all four platform binaries into dist/
```

### Configure your MCP client

Add the following to your MCP client configuration (e.g. Claude Desktop's `claude_desktop_config.json`, `.mcp.json`, or `.roo/mcp.json`):

```json
{
  "mcpServers": {
    "scrum-master": {
      "command": "/absolute/path/to/mcp-server",
      "args": [
        "--config",
        "/absolute/path/to/your-project/.github/scrum/config.yml",
        "--root",
        "/absolute/path/to/your-project"
      ],
      "env": {
        "GITHUB_TOKEN": "ghp_your_token_here"
      }
    }
  }
}
```

**`--config`** — path to your project's `config.yml`. Defaults to `.github/scrum/config.yml` relative to the working directory.

**`--root`** — the project root directory, used to resolve repo-relative template paths declared in `config.yml`. Defaults to the current working directory. Required when the binary is invoked from outside the project directory (which is always the case when a MCP client launches it).

**`GITHUB_TOKEN`** — must be set in the `env` block (or in your shell environment). This is the value referenced as `$GITHUB_TOKEN` in the `backends.github.auth.token` field of your `config.yml`.

### Run as HTTP server

Set `MCP_TRANSPORT=http` to switch to Streamable HTTP mode (e.g. for Open WebUI or Docker):

```bash
MCP_TRANSPORT=http PORT=3000 ./mcp-server --config ./my-project/.github/scrum/config.yml --root ./my-project
```

The server exposes `POST /mcp`, `GET /mcp`, and `DELETE /mcp` at the configured port, plus `GET /health`.
