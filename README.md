# The Scrum Master's MCP Toolkit

A local [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server that enables AI agents to manage Scrum teams using scrum language.

This project is designed to serve as the abstraction layer for LLM agents performing autonomous Scrum project management - sprint planning, backlog refinement, history analysis, and ceremony facilitation. Currently optimized for GitHub Projects ecosystem.

The tool surface aims to become **backend-agnostic**: tool names, arguments, and return shapes are defined in Scrum vocabulary. Adding a Trello, Notion, or Linear backend requires replacing only the implementations behind the tools; the agent skill and human workflows remain unchanged.

Supports two transports: **stdio** (Claude Desktop / Claude Code / LM Studio) and **Streamable HTTP** (Open WebUI / Docker / homelab).

## Installation

### Prerequisites

- A GitHub personal access token with **Projects: Read/Write** and **Issues: Read/Write** access
- A GitHub Project (v2) set up and configured with your Scrum fields (Sprint, Status, Priority, etc.)
- A `config.yml` for your project (see [`.github/scrum/config.yml`](.github/scrum/config.yml) in this repo as a reference)

### Option A - Pre-built binary (no runtime required)

The compiled binary embeds a full JavaScript runtime. Download, make executable, and run - nothing else to install. Best for desktop MCP clients and standalone deployments.

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
   chmod +x mcp-server-mac-arm64   # adjust filename for your platform
   ```

3. Optionally move it somewhere on your `$PATH`:
   ```bash
   mv mcp-server-mac-arm64 /usr/local/bin/scrum-mcp
   ```

### Option B - Node.js bundle (requires Node.js 18+)

`server.mjs` is a single self-contained JavaScript file (~a few MB) with all dependencies inlined - no Deno, no `node_modules`. Best for Docker images, CI pipelines, and environments where Node.js is already present.

1. Go to the [Releases page](../../releases) and download `server.mjs`.

2. Run it directly:
   ```bash
   node /path/to/server.mjs --config /path/to/.github/scrum/config.yml --root /path/to/project
   ```

### Option C - MCP Bundle (requires an MCPB-compatible client)

`scrum-master-toolkit.mcpb` is a packaged MCP bundle that can be used with MCPB-compatible clients (e.g. Claude Code with the MCPB plugin).

1. Go to the [Releases page](../../releases) and download `scrum-master-toolkit.mcpb`.

2. Follow your client's instructions for loading `.mcpb` bundles.

### Option D - Build from source

Requires [Deno](https://deno.com) v2.x.

```bash
git clone https://github.com/hoonsubin/scrum-master-toolkit-server.git
cd scrum-master-toolkit-server
deno task compile          # builds ./mcp-server binary for your current platform
deno task build:all        # builds all five platform binaries + Node.js bundle + MCPB bundle into dist/
```

## Usage

### Stdio mode (Claude Desktop, Claude Code, RooCode, LM Studio)

Stdio is the default transport. Your MCP client launches the server as a child process and communicates over stdin/stdout.

Add one of the following blocks to your MCP client configuration (e.g. Claude Desktop's `claude_desktop_config.json`, `.mcp.json`, or `.roo/mcp.json`):

**Pre-built binary (Option A):**

```json
{
  "mcpServers": {
    "scrum-master": {
      "command": "/absolute/path/to/mcp-server-mac-arm64",
      "args": [
        "--config",
        "/absolute/path/to/your-project/.github/scrum/config.yml"
      ],
      "env": {
        "GITHUB_TOKEN": "ghp_your_token_here"
      }
    }
  }
}
```

**Node.js bundle (Option B):**

```json
{
  "mcpServers": {
    "scrum-master": {
      "command": "node",
      "args": [
        "/absolute/path/to/server.mjs",
        "--config",
        "/absolute/path/to/your-project/.github/scrum/config.yml"
      ],
      "env": {
        "GITHUB_TOKEN": "ghp_your_token_here"
      }
    }
  }
}
```

**Development from source (Option D):**

```json
{
  "mcpServers": {
    "scrum-master": {
      "command": "deno",
      "args": [
        "task",
        "start"
      ],
      "env": {
        "GITHUB_TOKEN": "ghp_your_token_here",
        "MCP_TRANSPORT": "stdio"
      }
    }
  }
}
```

**`--config`** - path to your project's `config.yml`. Can also be set via the `SCRUM_CONFIG_PATH` environment variable.

**`--root`** - (optional) path to the project root directory. Defaults to the current working directory.

**`GITHUB_TOKEN`** - set in the `env` block or your shell environment. Referenced as `$GITHUB_TOKEN` in `backends.github.auth.token` in your `config.yml`.

**`SCRUM_PLATFORM`** - (optional) backend platform key. Defaults to `"github"`. Set this to switch backend implementations when multi-backend support is added.

### Streamable HTTP mode (Open WebUI, Docker, homelab)

Set `MCP_TRANSPORT=http` to expose `POST /mcp`, `GET /mcp`, `DELETE /mcp`, and `GET /health` on the configured port.

**Pre-built binary (Option A):**

```bash
GITHUB_TOKEN=ghp_your_token_here \
MCP_TRANSPORT=http \
PORT=3000 \
./mcp-server-mac-arm64 --config /path/to/.github/scrum/config.yml --root /path/to/project
```

**Node.js bundle (Option B):**

```bash
GITHUB_TOKEN=ghp_your_token_here \
MCP_TRANSPORT=http \
PORT=3000 \
node /path/to/server.mjs --config /path/to/.github/scrum/config.yml --root /path/to/project
```

### Docker

The project includes a [`docker-compose.yml`](docker-compose.yml) for containerised deployment. The container exposes port **3000** by default (`3000:3000` in compose).

```bash
cp .env.example .env
# edit .env with your GITHUB_TOKEN and other values
docker compose up -d
```

The server health check is available at `http://localhost:3000/health`. Connect an MCP client via Streamable HTTP at `http://scrum-master-toolkit:3000/mcp` (or `http://localhost:3000/mcp` from the host). Clients must send `Accept: application/json, text/event-stream` on every `POST /mcp` request.

## Deno Tasks

All development workflows are defined as Deno tasks in [`deno.json`](deno.json). Run with `deno task <name>`.

### Development

| Task               | Description                                                 |
| ------------------ | ----------------------------------------------------------- |
| `dev`              | Start server in watch mode with hot-reload (`--watch`)      |
| `start`            | Start server in production mode (stdio transport)           |
| `test`             | Run all tests with `deno test`                              |
| `audit`            | Generate architecture audit report                          |
| `depcruise`        | Run dependency-cruiser (terminal output)                    |
| `depcruise:json`   | Run dependency-cruiser and output JSON                      |
| `depcruise:html`   | Run dependency-cruiser and output HTML report               |
| `capture-fixtures` | Capture test fixtures from live GitHub API (requires token) |

### Build

| Task                  | Description                                                    |
| --------------------- | -------------------------------------------------------------- |
| `compile`             | Build single binary for current platform                       |
| `compile:mac:arm64`   | Build macOS Apple Silicon binary → `dist/mcp-server-mac-arm64` |
| `compile:mac:x64`     | Build macOS Intel binary → `dist/mcp-server-mac-x64`           |
| `compile:linux:x64`   | Build Linux x64 binary → `dist/mcp-server-linux-x64`           |
| `compile:linux:arm64` | Build Linux arm64 binary → `dist/mcp-server-linux-arm64`       |
| `compile:win`         | Build Windows x64 binary → `dist/mcp-server-win.exe`           |
| `bundle:node`         | Build Node.js bundle → `dist/server.mjs`                       |
| `bundle:mcpb`         | Build MCPB bundle → `dist/scrum-master-toolkit.mcpb`           |
| `build:all`           | Run all compile & bundle tasks (5 platforms + node + mcpb)     |

## Development Environment

The project ships a fully configured devcontainer. All tools (Deno, Node, `gh` CLI, `act`, Docker-in-Docker, and the Python toolchain) are installed automatically. You do not need any of them on your host machine except Docker.

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
SCRUM_PLATFORM=github               # backend platform key
SCRUM_CONFIG_PATH=.github/scrum/config.yml
PORT=3000
DEBUG=0
SEARXNG_SECRET=change-me            # any random string, used by the SearXNG sidecar
MEMPALACE_USER_NAME=your-name       # for mempalace AI memory tooling
MEMPALACE_USER_EMAIL=user@email.com
```

### 3. Open in devcontainer

Open the project folder in VS Code, then when prompted click **Reopen in Container** - or run it manually:

```
Ctrl+Shift+P → Dev Containers: Reopen in Container
```

VS Code will build the image and start all sidecar services (Qdrant, SearXNG, Valkey). The [`postCreateCommand`](.devcontainer/post-create.sh) runs automatically and installs:

- `uv` + Python 3.12 managed by uv
- `mempalace` (AI memory tooling via uv)
- `pi` agent and the `mempalace-pi` plugin via npm
- Deno dependency cache (`deno install`)

First build takes a few minutes. Subsequent opens use the cached image and are near-instant.

### 4. Verify the environment

Run these inside the container terminal to confirm everything is wired up:

```bash
deno --version
gh --version
docker info
uv --version
mempalace --version
```

### 5. RooCode setup

The repo ships custom agent modes in [`.roomodes`](.roomodes). After the devcontainer starts:

1. Open the RooCode panel in VS Code (the extension is pre-installed).
2. Click the mode selector in the top-left of the panel - you should see the project modes:
   - **📋 Scrum Master** - board management, sprint ceremonies, backlog health
   - **🔍 Project Research** - read-only codebase analysis
3. The MCP servers are pre-configured in [`.roo/mcp.json`](.roo/mcp.json) and ready to use:

| Server               | Purpose                                               |
| -------------------- | ----------------------------------------------------- |
| `scrum-master`       | `scrum_*` tools (board management, sprint operations) |
| `mempalace`          | AI memory / knowledge graph (`mempalace_*` tools)     |
| `sequentialthinking` | Structured reasoning before complex decisions         |
| `searxng`            | Web search for unfamiliar APIs or errors              |

The `scrum-master` server runs directly from source via `deno task start`, so edits to `src/` take effect immediately without recompiling.

4. Select **📋 Scrum Master** mode and type a prompt - for example `show me the current sprint health` - to confirm the MCP tools are reachable.

### 6. Testing GitHub Actions locally with `act`

`act` replays workflow YAML locally inside Docker containers. It is pre-installed in the devcontainer.

**One-time setup - create a secrets file** (git-ignored):

```bash
echo "GITHUB_TOKEN=ghp_your_token_here" > .secrets
```

The [`.actrc`](.actrc) at repo root already points `act` at the correct runner image and secrets file, so no extra flags are needed.

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
| Patch version into source | `sed` regex against `src/server.ts`                                                 |
| Compile all targets       | Cross-compilation for all five platforms + Node.js bundle + MCPB bundle             |
| Generate checksums        | `sha256sum` over `dist/` (binaries + bundles)                                       |
| Prune old pre-releases    | Pruning algorithm against 80 synthetic releases (mock + dry-run, no real API calls) |

### 7. Running tests

```bash
deno task test        # full suite (~250+ tests, no network required for CI)
deno task depcruise   # layer boundary checks
deno lint src/        # ESLint-style rules via deno lint
```

Tests follow a two-bucket rule:

- **Unit / single-layer** — co-located `*.test.ts` next to the module under test
- **Cross-layer** — [`src/test/tools/`](src/test/tools/) (tool-surface contract, golden, captured) and [`src/test/support/`](src/test/support/) (fake/captured backends, handler assertions)

Adapter unit tests use fixtures from [`src/test/fixtures/`](src/test/fixtures/) (import via `@test/fixtures/`). Capture live port responses with `deno task capture-fixtures`.

## Project Structure

```
src/
├── server.ts                 # Composition root — transport wiring & bootstrap
├── tools/                    # MCP tool registration (thin handlers → use-cases)
│   └── handlers/             # Extracted read/write handler functions
├── scrum/                    # Use-case layer (depends on ports.ts + domain/)
│   ├── ports.ts              # ProjectBackend port interface
│   ├── orient.ts             # One file per MCP read/write use-case
│   ├── find-items.ts
│   ├── get-item-detail.ts
│   ├── get-sprint-data.ts
│   ├── update-impediment.ts
│   ├── config-boot.ts        # Config loading at server startup
│   ├── template-resource.ts  # scrum://template/{type} MCP resources
│   └── utils/                # Shared helpers (not use-cases)
│       ├── listing-mappers.ts
│       ├── sprint-math.ts
│       ├── sprint-context.ts
│       ├── fetch-location.ts
│       └── …
├── domain/                   # Types, vocabulary constants, config schema (no runtime logic)
├── adapters/                 # Backend implementations
│   └── github/
│       ├── backend.ts        # Concrete ProjectBackend facade
│       ├── mappers.ts        # Wire types → domain types (sole platform boundary)
│       ├── bootstrap.ts      # Field IDs, iteration cache
│       ├── operations.graphql
│       ├── query-pipeline/   # Board-scan loop, caching, pagination
│       ├── query-strategies/ # findItems routing + normalization
│       ├── read-services/    # Data aggregation via board-scan coordinator
│       ├── write-services/   # Mutations only
│       ├── infra/            # HTTP client, ref resolution, completion timestamps
│       └── assemblers/       # Strategy implementations (pipeline ↔ strategy bridge)
├── services/                 # Cross-cutting: logger, error enrichment
├── schemas/                  # Zod input/output schemas (handler boundary)
└── test/                     # Cross-layer tests, fixtures, evaluation suite
    ├── fixtures/             # GitHub nodes, port captures, scrum templates
    ├── support/              # FakeBackend, CapturedBackend, test utilities
    ├── tools/                # scrum_* contract, golden, and integration tests
    └── evaluation/           # Agent-side parity tests (Phase B gate)

scripts/                      # Build, audit, diagram generation, fixture capture
.roo/                         # RooCode MCP config + agent skills + mode rules
.github/                      # CI/CD workflows (deployment.yml, pr-check.yml)
docs/                         # Architecture docs (ARCHITECTURE.MD is authoritative)
tasks/                        # Refactoring plan and active work items
```

**Layer contract:** Handler → Use-case → Port → Adapter. The server returns raw facts; Scrum judgments (readiness, burndown, velocity, risk) are computed by the agent skill from `scrum_get_sprint_data` and `scrum_find_items`.

See [`docs/ARCHITECTURE.MD`](docs/ARCHITECTURE.MD) for the full domain model, tool surface, and layer contract. See [`tasks/REFACTORING.md`](tasks/REFACTORING.md) for the completed refactoring phases and remaining agent-side work.

## License

MIT
