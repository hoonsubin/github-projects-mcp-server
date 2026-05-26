# The Scrum Master's MCP Toolkit

A local [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server that enables AI agents to manage Scrum teams using scrum language.

This project is designed to serve as the abstraction layer for LLM agents performing autonomous Scrum project management - sprint planning, backlog refinement, history analysis, and ceremony facilitation. Currently optimized for GitHub Projects ecosystem.

The tool surface aims to become **backend-agnostic**: tool names, arguments, and return shapes are defined in Scrum vocabulary. Adding a Trello, Notion, or Linear backend requires replacing only the implementations behind the tools; the agent skill and human workflows remain unchanged.

Supports two transports: **stdio** (Claude Desktop / Claude Code / LM Studio) and **Streamable HTTP** (Open WebUI / Docker / homelab).

## Installation

### Prerequisites

- A GitHub personal access token with **Projects: Read/Write** and **Issues: Read/Write** access
- A GitHub Project (v2) set up and configured with your Scrum fields (Sprint, Status, Priority, etc.)
- A `config.yml` for your project (see `.github/scrum/config.yml` in this repo as a reference)

### Option A - Download a pre-built binary (recommended)

1. Go to the [Releases page](../../releases) and download the binary for your platform:

   | Platform              | File                     |
   | --------------------- | ------------------------ |
   | macOS (Apple Silicon) | `mcp-server-mac-arm64`   |
   | macOS (Intel)         | `mcp-server-mac-x64`     |
   | Linux x64             | `mcp-server-linux-x64`   |
   | Linux arm64           | `mcp-server-linux-arm64` |
   | Windows x64           | `mcp-server-win.exe`     |

2. Make it executable (macOS / Linux):
   ```bash
   chmod +x mcp-server-mac-arm64   # or mcp-server-linux-x64
   ```

3. Optionally move it somewhere on your `$PATH`:
   ```bash
   mv mcp-server-mac-arm64 /usr/local/bin/scrum-mcp
   ```

### Option B - Build from source

Requires [Deno](https://deno.com) v2.x.

```bash
git clone https://github.com/hoonsubin/github-projects-mcp-server.git
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

**`--config`** - path to your project's `config.yml`. Defaults to `.github/scrum/config.yml` relative to the working directory.

**`--root`** - the project root directory, used to resolve repo-relative template paths declared in `config.yml`. Defaults to the current working directory. Required when the binary is invoked from outside the project directory (which is always the case when a MCP client launches it).

**`GITHUB_TOKEN`** - must be set in the `env` block (or in your shell environment). This is the value referenced as `$GITHUB_TOKEN` in the `backends.github.auth.token` field of your `config.yml`.

### Run as HTTP server

Set `MCP_TRANSPORT=http` to switch to Streamable HTTP mode (e.g. for Open WebUI or Docker):

```bash
MCP_TRANSPORT=http PORT=3000 ./mcp-server --config ./my-project/.github/scrum/config.yml --root ./my-project
```

The server exposes `POST /mcp`, `GET /mcp`, and `DELETE /mcp` at the configured port, plus `GET /health`.

## Development Environment

The project ships a fully configured devcontainer. All tools (Deno, Node, `gh` CLI, `act`, Docker-in-Docker, and the Python toolchain) are installed automatically. You do not need any of them on your host machine except Docker Desktop.

### 1. Prerequisites (host machine)

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) running
- [VS Code](https://code.visualstudio.com/) with the [Dev Containers extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers)

### 2. Environment file

Copy the example env file and fill in your values before opening the container. Docker Compose reads this file at build time; the container will not start without it.

```bash
cp .env.example .env
```

Open `.env` and set at minimum:

```bash
GITHUB_TOKEN=ghp_your_token_here   # needs Projects: Read/Write, Issues: Read/Write
MCP_TRANSPORT=http                  # or stdio
PORT=3000
SEARXNG_SECRET=change-me            # any random string, used by the SearXNG sidecar
```

### 3. Open in devcontainer

Open the project folder in VS Code, then when prompted click **Reopen in Container** - or run it manually:

```
Ctrl+Shift+P → Dev Containers: Reopen in Container
```

VS Code will build the image and start all sidecar services (Qdrant, SearXNG, Valkey). The `postCreateCommand` runs automatically and installs:

- `uv` + Python 3.12 managed by uv
- `mempalace` (AI memory tooling via uv)
- `pi` agent and the `mempalace-pi` plugin via npm
- Deno dependency cache (`deno install`)

First build takes a few minutes. Subsequent opens use the cached image and are near-instant.

### 4. Verify the environment

Run these inside the container terminal to confirm everything is wired up:

````bash
deno --version
gh --version
docker info
uv --version
mempalace --version

### 5. RooCode setup

The repo ships three custom agent modes in `.roomodes`. After the devcontainer starts:

1. Open the RooCode panel in VS Code (the extension is pre-installed).
2. Click the mode selector in the top-left of the panel - you should see the three project modes:
   - **📋 Scrum Master** - board management, sprint ceremonies, backlog health
   - **📝 User Story Creator** - delegate mode for authoring DoR-compliant stories
   - **🔍 Project Research** - read-only codebase analysis
3. Connect the MCP server to RooCode. Add this to `.roo/mcp.json` inside the container (create it if it doesn't exist):

```json
{
  "mcpServers": {
    "scrum-master": {
      "command": "deno",
      "args": [
        "run",
        "--allow-env",
        "--allow-net",
        "--allow-read",
        "src/index.ts",
        "--config",
        "/workspace/.github/scrum/config.yml",
        "--root",
        "/workspace"
      ],
      "env": {
        "GITHUB_TOKEN": "${GITHUB_TOKEN}"
      }
    }
  }
}
````

This runs the server directly from source so edits to `src/` take effect immediately without recompiling.

4. Select **📋 Scrum Master** mode and type a prompt - for example `show me the current sprint health` - to confirm the MCP tools are reachable.

### 6. Testing GitHub Actions locally with `act`

`act` replays workflow YAML locally inside Docker containers. It is pre-installed in the devcontainer.

**One-time setup - create a secrets file** (git-ignored):

```bash
echo "GITHUB_TOKEN=ghp_your_token_here" > .secrets
```

The `.actrc` at repo root already points `act` at the correct runner image and secrets file, so no extra flags are needed.

**Run the pre-release workflow** (triggered by a push to `main`):

```bash
act push
```

Under `act` the workflow automatically skips the four publish and prune steps that call `gh` against the real repo. What actually runs and is worth validating locally:

| Step                      | What it tests                                                                       |
| ------------------------- | ----------------------------------------------------------------------------------- |
| Checkout                  | Git history and fetch depth                                                         |
| Set up Deno               | Deno install and cache                                                              |
| Derive version            | SHA-based version string format                                                     |
| Patch version into source | `sed` regex against `src/index.ts`                                                  |
| Compile all targets       | Cross-compilation for all five platforms                                            |
| Generate checksums        | `sha256sum` over `dist/`                                                            |
| Prune old pre-releases    | Pruning algorithm against 80 synthetic releases (mock + dry-run, no real API calls) |
