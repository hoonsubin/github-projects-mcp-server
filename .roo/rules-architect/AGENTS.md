# AGENTS.md — Architect Mode

This file provides guidance to agents in Architect mode in this repository.

## Non-Obvious Architectural Constraints

- **Layer dependency rule:** Framework → Use-Case → Port ← Adapter. The port interface at [`src/scrum/ports.ts`](src/scrum/ports.ts) inverts dependency — adapters implement it, use-cases consume it. Adding a new backend means one new adapter directory; nothing above the port changes.
- **Persistence tiers are hard boundaries:** `stored` (platform), `computed` (server-derived, never persisted), `config` (human-edited YAML), `agent` (LLM-produced ceremony artifacts). Computed entities cannot be persisted; stored entities cannot be computed. See [`docs/ARCHITECTURE.MD`](docs/ARCHITECTURE.MD) §Domain Model Reference for full tier annotations.
- **Capability system (current):** [`src/adapters/capabilities.ts`](src/adapters/capabilities.ts) uses boolean flags. [`src/adapters/abstract-backend.ts`](src/adapters/abstract-backend.ts) provides default implementations of optional methods that throw `UnsupportedCapabilityError` (extends `AdapterError`). The [`tasks/REFACTORING.md`](tasks/REFACTORING.md) multi-backend target migrates these booleans to a tri-state `NATIVE | EMULATED | UNAVAILABLE` enum.
- **Adapter refactoring target** (from [`tasks/REFACTORING.md`](tasks/REFACTORING.md)): the adapter is an assembly layer — fragment library → query assembler → execution engine. Decouple "what to fetch" from "how to fetch" from "how to normalize." No new coupling between query construction and pagination infrastructure.
- **`AbstractProjectBackend`** ([`src/adapters/abstract-backend.ts`](src/adapters/abstract-backend.ts)) provides the base class adapters extend. It offers a `resolveRef()` helper (protected, not on port interface) that converts `{ number }` story refs to `{ id }` refs. Adapters with `stableItemKeys:true` override this.
- **`ProjectBackend` is a composed interface** of focused ports: `StoryPort`, `FindItemsPort`, `AnalyticsPort`, `BoardHealthPort`, `ImpedimentPort`, `FileReaderPort`, `ProjectWriter`. New use-cases should import specific ports, not the monolith.
- **Tool name constants** are the single source of truth in `SCRUM_READ_TOOL_NAMES` / `SCRUM_WRITE_TOOL_NAMES`. Never hardcode tool names in server bootstrap or elsewhere.
- **Error hierarchy:** `AdapterError` (abstract) → subclasses carry `backendName`, `code`, `recovery`. All backend errors extend this. Use-case layer catches with `catchBackend()` for partial results; handler wraps with `enrichError()` for structured text. See [`src/domain/errors.ts`](src/domain/errors.ts) and [`src/services/error-enrichment.ts`](src/services/error-enrichment.ts).
- **`console.log` is FORBIDDEN** — MCP stdio transport. All output to stderr via [`src/services/logger.ts`](src/services/logger.ts).
