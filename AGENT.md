# AGENT.md

Project guidance for all coding agents. Concise by design - linked docs provide depth.

## Reference Documents

- `README.md` - Project installation.
- `tasks/TODO.md` - Active work items.
- `tasks/REFACTORING.md` - Ongoing refactor plan.
- `docs/proj-diagram.md` - Current module dependency diagram.
- `docs/ARCHITECTURE.MD` - Project architecture

## High-Level Architecture

Three layers. Inner layers never import outer.

```mermaid
flowchart TD

  subgraph Framework["FRAMEWORK LAYER src/tools/ + src/schemas/"]
    direction TB
    FW["MCP tool registration thin handlers Zod param parsing"]
  end

  subgraph UseCase["USE-CASE LAYER src/scrum/ + src/domain/ + src/services/"]
    direction TB
    UC["Scrum orchestration domain rules pure computation"]
    PB["interface ProjectBackend (src/scrum/ports.ts)"]
  end

  subgraph Adapter["ADAPTER LAYER src/adapters/"]
    direction TB
    AD["GitHubProjectBackend implements ProjectBackend"]
    SVC["internal/ services (LabelResolver, FieldValueMutator, etc.)"]
    AD -->|delegates to| SVC
  end

  FW -->|calls use-case functions| UC
  UC -->|depends on focused port| PB
  AD -.->|implements Dependency Inversion| PB
```

- **Entry:** `src/index.ts` - bootstraps McpServer, registers tools, selects transport.

## Code Style

- **Imports:** Full relative paths with `.ts` extension; no bare specifiers for local modules.
- **Naming:** `PascalCase` types · `camelCase` functions/vars · `UPPER_SNAKE_CASE` constants.
- **Functions:** Arrow only - `const fn = (arg: Type): Return => {}`.
- **Errors:** Throw `GitHubApiError`; handlers return structured text via format helper.
- **Zod:** Always `.strict()` on object schemas.
- **Types:** No inline concrete types; define named types. Compose or extend existing ones.
- **Lint:** `deno lint` must pass before marking any task complete.
- **Readability:** Code must be clean, maintainable, and beautiful for the humans to read. No type or logic repetition. Keep things modular and extendable.

## Commands

```bash
mempalance search "your search string"  # semantic codebase search
deno lint                                # lint
deno task test                                # unit tests
deno fmt --check                         # format check
deno task diagram-gen                    # regenerate module dependency report
```
