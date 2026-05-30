# AGENTS.md — Ask Mode

This file provides guidance to agents in Ask mode in this repository.

## Project Knowledge Base

- **[`docs/ARCHITECTURE.MD`](docs/ARCHITECTURE.MD)** — Authoritative on domain model (entity relationships, persistence tiers, field annotations), tool surface call flow, agent interaction patterns, and server layer design.
- **[`tasks/REFACTORING.md`](tasks/REFACTORING.md)** — Current adapter refactoring strategy: phase 0 (org project support) through phase 4 (search API integration) plus multi-backend abstract design principles.
- **[`tasks/TODO.md`](tasks/TODO.md)** — Active development work items.

## Non-Obvious Navigation

- **Source layers map:** `src/tools/` = framework, `src/scrum/` + `src/domain/` = use-case, `src/adapters/` = adapter. `src/services/` = cross-cutting (logger, error enrichment).
- **Port interface at [`src/scrum/ports.ts`](src/scrum/ports.ts)** is the canonical contract between use-case and adapter layers. Input/filter types defined here, not in domain types.
- **Domain types at [`src/domain/types.ts`](src/domain/types.ts)** (691 lines) cover the full entity model with `stored`/`computed`/`config`/`agent` annotations.
- **Config shape at [`src/domain/config.ts`](src/domain/config.ts)** — platform-agnostic; backend-specific config is type-erased as `Record<string, unknown>`.
- **Diagram generation scripts** in [`scripts/diagram/`](scripts/diagram/): class diagrams, layer surfaces, module imports, tool registrations.
- **MCP tools** registered in [`src/tools/scrum-read.ts`](src/tools/scrum-read.ts) (5 read + 1 resource) and [`src/tools/scrum-write.ts`](src/tools/scrum-write.ts) (7 write).

## Available Research Tools

- **mempalace** — `mempalace_search` for semantic codebase search.
- **searxng** — `searxng_web_search` for external API/error lookups.
