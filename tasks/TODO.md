# Backlog — Design Discussion Items

> Generated from design session on 2026-05-18. Items are organized by epic and sequenced by dependency. Transfer individual items to your PM board as they enter refinement.

---

## Epic 1: Portable Server Bootstrap

**Goal:** The MCP server should be launchable from any directory via `npx` or `deno run`, accepting its config via a CLI argument rather than assuming a hardcoded path inside the project repo.

---

### [tech_debt] Remove `fetchRepoFile` from the backend port

**Estimate:** 2 pts **Dependencies:** none — foundational; other epics build on this

`TemplatePort.fetchRepoFile` sits on `ProjectBackend` and is already marked "GitHub-specific — non-GitHub backends may omit this." File reading is not a PM platform concern. This must be extracted before the portability and template stories can be cleanly implemented.

**Acceptance Criteria**

- [ ] `TemplatePort` interface and its `fetchRepoFile` method are removed from `src/scrum/ports.ts`
- [ ] `ProjectBackend` no longer extends `TemplatePort`
- [ ] The GitHub adapter's `fetchRepoFile` implementation is deleted or relocated to an internal helper used only by the template system
- [ ] All callers of `fetchRepoFile` (currently `getTemplateUseCase`) are updated to use the new `FileReader` service (see next item)
- [ ] TypeScript compiles cleanly; no references to `TemplatePort` remain

---

### [tech_debt] Introduce `FileReader` service

**Estimate:** 1 pt **Dependencies:** `fetchRepoFile` removed from port

A lightweight module at `src/services/file-reader.ts`. Wraps `Deno.readTextFile`. Constructed with a `baseDir` (the directory of the resolved config file at startup); all relative paths are resolved against it.

**Acceptance Criteria**

- [ ] `FileReader` is constructed with an absolute `baseDir` string
- [ ] `read(path: string): Promise<string>` resolves relative paths against `baseDir`; absolute paths pass through unchanged
- [ ] Throws a descriptive error on missing file that includes the fully-resolved path
- [ ] No imports from `src/adapters/` or `src/domain/` — pure I/O service with no domain knowledge
- [ ] Unit-testable with a temp directory

---

### [user_story] Accept `--config` as a CLI argument

**As a** developer integrating the MCP server via `npx` or `deno run`, **I want** to pass `--config <path>` when starting the server, **so that** I can run the server from any directory without modifying source or placing config files at hardcoded paths.

**Estimate:** 2 pts **Dependencies:** `FileReader` service

**Acceptance Criteria**

- [ ] `src/index.ts` parses `--config <path>` from `Deno.args`
- [ ] The path is resolved against `Deno.cwd()` at startup
- [ ] `FileReader` is constructed with the _directory_ of the resolved config file and injected into all use cases at the composition root
- [ ] If the file does not exist, the server starts but every tool call returns: `"Config not found at <resolved_path>. Pass --config <path> when starting the server."`
- [ ] Existing behavior is unchanged when `--config` is provided and the file exists
- [ ] `npx @yourorg/scrum-master-mcp --config ./scrum.config.yml` works end-to-end

---

### [user_story] Default config search when `--config` is absent

**As a** developer running the server inside an existing project repo, **I want** the server to find my config automatically without passing `--config`, **so that** existing setups continue to work with no changes.

**Estimate:** 1 pt **Dependencies:** `--config` CLI argument story

**Acceptance Criteria**

- [ ] When `--config` is absent, `src/index.ts` searches `Deno.cwd()` in order: `.github/scrum/config.yml`, then `scrum.config.yml`
- [ ] First match is used as if `--config <path>` had been passed
- [ ] If neither is found, the same "config not found" error behavior applies
- [ ] The search order is documented in the README

---

### [user_story] Config-relative path resolution for all file references

**As a** developer whose project root differs from where the MCP process is launched, **I want** all file paths declared inside `config.yml` to resolve relative to the config file's own directory, **so that** my config is portable regardless of the server's working directory.

**Estimate:** 1 pt **Dependencies:** `FileReader` service, `--config` CLI argument story

**Acceptance Criteria**

- [ ] `FileReader.baseDir` is the directory of the resolved config file, not `Deno.cwd()`
- [ ] A path like `.github/ISSUE_TEMPLATE/user_story.yml` in the config resolves to `<config_dir>/.github/ISSUE_TEMPLATE/user_story.yml`
- [ ] Absolute paths in the config are passed through unchanged
- [ ] Config comments include an inline example explaining the resolution rule

---

## Epic 2: Flexible Item Template System

**Goal:** The agent should be able to retrieve a team-declared template for any backlog item type — from a local markdown file or a GitHub Issue Form YML — and use it to compose consistent issue bodies without being told explicitly which template to apply.

---

### [tech_debt] Add `StoryType`, `TemplateField`, and `ItemTemplate` domain types

**Estimate:** 1 pt **Dependencies:** none — pure type additions

**Acceptance Criteria**

- [ ] `StoryType = "user_story" | "bug" | "tech_debt" | "spike" | "impediment"` added to `src/domain/types.ts`
- [ ] `TemplateField` interface: `{ id: string; label: string; type: "text" | "textarea" | "dropdown" | "checkboxes"; description?: string; placeholder?: string; options?: string[]; required: boolean }`
- [ ] `ItemTemplate` discriminated union: `{ source: "default"; fields: null } | { source: "markdown"; rawContent: string; fields: null } | { source: "github_issue_form"; rawContent: string; fields: TemplateField[] }`
- [ ] `ArtifactType` (ceremony types) is unchanged
- [ ] No imports from `src/adapters/` in `src/domain/types.ts`

---

### [tech_debt] Add `templates.items` to `ScrumConfig` and `config.yml`

**Estimate:** 1 pt **Dependencies:** `StoryType` domain type

**Acceptance Criteria**

- [ ] `ScrumConfig.templates` in `src/domain/config.ts` gains `items?: Partial<Record<StoryType, string | null>>`
- [ ] `config.yml` `templates:` block is updated with an `items:` subkey; all type keys default to `null`
- [ ] Config comments explain the two supported formats (`.md` and `.yml`) and the fallback behavior
- [ ] Existing ceremony template keys (`sprint_review`, `retrospective`, etc.) are untouched

---

### [tech_debt] Introduce `TemplateParser` in the use-case layer

**Estimate:** 2 pts **Dependencies:** `TemplateField` and `ItemTemplate` domain types; `FileReader` service

A pure module at `src/scrum/template-parser.ts`. No imports from `src/adapters/`. Accepts raw file content and a format hint; returns an `ItemTemplate`. The GitHub Issue Form YML format is just a file format — parsing it is not a GitHub API concern.

**Acceptance Criteria**

- [ ] `parseTemplate(content: string, format: "yml" | "md"): ItemTemplate` exported
- [ ] `"md"` format: returns `{ source: "markdown", rawContent: content, fields: null }`
- [ ] `"yml"` format: parses GitHub Issue Form schema (`body[]`), maps `textarea` / `input` / `dropdown` / `checkboxes` items to `TemplateField[]`; skips `markdown` banner items and `checkboxes` without an `id` (pre-submission checks)
- [ ] `rawContent` for parsed YML is a reconstructed markdown: each field becomes `## <label>\n<placeholder or blank line>`
- [ ] Unknown or empty content returns `{ source: "default", fields: null }`
- [ ] Pure function — no I/O, no side effects; unit-testable without filesystem access

---

### [user_story] Declare item body templates per story type in config

**As a** team lead, **I want** to declare a template file path for each backlog item type in `config.yml`, **so that** the agent uses my team's issue structure when creating stories, without me specifying it each time.

**Estimate:** 3 pts **Dependencies:** `TemplateParser`, `FileReader`, `templates.items` config type, `StoryType`

**Acceptance Criteria**

- [ ] `scrum_get_template` Zod schema gains a `category` discriminator: `"ceremony"` (existing) or `"item"` (new)
- [ ] When `category: "item"`, the tool reads `scrumConfig.templates.items[type]`
- [ ] Path ending `.yml` → reads via `FileReader`, parsed as GitHub Issue Form → returns `ItemTemplate` with `source: "github_issue_form"` and populated `fields`
- [ ] Path ending `.md` → reads via `FileReader` → returns `ItemTemplate` with `source: "markdown"` and `rawContent`
- [ ] `null` or absent path → returns `{ source: "default", fields: null }`
- [ ] `scrum_orient` response includes `template_sources: Record<StoryType, "github_issue_form" | "markdown" | "default">` so the agent sees the full picture at session start without probing each type individually
- [ ] Existing `category: "ceremony"` behavior is fully backward-compatible

---

### [tech_debt] Update agent rules to fetch item template before `scrum_create_story`

**Estimate:** 1 pt **Dependencies:** `scrum_get_template` item category support

**Acceptance Criteria**

- [ ] `.roo/rules-scrum-master/1_workflow.xml` specifies: before calling `scrum_create_story`, the agent calls `scrum_get_template({ category: "item", type: <type> })` unless the template source is already known from `scrum_orient`
- [ ] `source: "github_issue_form"` → agent composes body using `fields[]` as sections: `## <label>\n<content>` in field order
- [ ] `source: "markdown"` → agent uses `rawContent` as the body template, filling placeholders where identifiable
- [ ] `source: "default"` → agent uses its built-in Scrum story structure (existing behavior)
- [ ] Rule is documented with a worked example for each source type

---

## Epic 3: SSE Transport Mode with Per-Connection Config Override

**Goal:** The MCP server should support SSE mode for multi-client deployments. Each connecting client can optionally supply its own config path, which fully overrides the server's default config for that session.

---

### [spike] Investigate MCP SDK SSE transport and per-connection initialization

**Estimate:** 3 pts **Dependencies:** none

**Questions to answer:**

- How does MCP SDK 1.29.0 expose SSE transport — separate server class or transport option on the existing server?
- What per-connection metadata can a client pass in the `initialize` handshake? Is `meta.configPath` readable server-side?
- What session lifecycle hooks are available for per-connection setup and teardown?
- What are the security implications of accepting a client-supplied filesystem path? Should the server validate it against an allowlist?
- Are there SDK constraints that prevent per-connection state isolation?

**Output:** A decision doc at `tasks/sse-spike.md` covering the above, with a recommended implementation approach and any SDK constraints discovered.

---

### [user_story] Run the server in SSE mode

**As a** server operator, **I want** to start the MCP server with `--transport sse --port <N>`, **so that** multiple IDE agents or team members can connect to a single shared server instance without each needing to spawn their own process.

**Estimate:** 3 pts **Dependencies:** SSE spike; Epic 1 complete

**Acceptance Criteria**

- [ ] `src/index.ts` accepts `--transport stdio|sse` (default: `stdio`) and `--port <N>` (default: `3000`, SSE only)
- [ ] In SSE mode, the server loads the default config from `--config` (or fallback search) once at startup, before any client connects
- [ ] Multiple clients can connect concurrently without session state leaking between connections
- [ ] `stdio` mode behavior is unchanged
- [ ] Server logs the transport mode and listening port at startup

---

### [user_story] Per-connection config override in SSE mode

**As a** client connecting to a shared SSE server, **I want** to pass my own config file path in the MCP `initialize` handshake, **so that** I can use my project-specific Scrum config while sharing server infrastructure with other teams.

**Estimate:** 3 pts **Dependencies:** "Run the server in SSE mode"

**Acceptance Criteria**

- [ ] A client may pass `{ "meta": { "configPath": "<path>" } }` in the `initialize` request
- [ ] The server resolves `configPath` against its own filesystem (not the client's); the path must be accessible to the server process
- [ ] The per-connection config **fully replaces** the server's default config for that session — no merging
- [ ] If `configPath` is provided but the file is missing or fails to parse, the connection is rejected with a descriptive error; other sessions are unaffected
- [ ] If `configPath` is absent, the session uses the server's startup default config
- [ ] `FileReader` for the session is scoped to the directory of the session's resolved config file
- [ ] Backend credentials come from server environment variables only; the per-connection config file must not embed tokens
- [ ] "Full override" semantics and the credential restriction are documented

---

## Dependency Map

```
[tech_debt] Remove fetchRepoFile from port
  └─▶ [tech_debt] Introduce FileReader service
        ├─▶ [user_story] Accept --config CLI argument
        │     └─▶ [user_story] Default config search (no --config)
        │     └─▶ [user_story] Config-relative path resolution
        │
        └─▶ [tech_debt] Introduce TemplateParser
              └─▶ (+ templates.items config type + StoryType)
                    └─▶ [user_story] Declare item templates per story type
                          └─▶ [tech_debt] Update agent rules for pre-create template fetch

[spike] Investigate MCP SDK SSE transport
  └─▶ [user_story] Run server in SSE mode  ◀── (also needs Epic 1 complete)
        └─▶ [user_story] Per-connection config override in SSE mode

[tech_debt] Add StoryType / TemplateField / ItemTemplate domain types  ─┐
[tech_debt] Add templates.items to ScrumConfig and config.yml          ─┴─▶ (feeds TemplateParser + declare-templates stories)
```

---

## Rough sizing summary

| Epic                          | Items  | Total pts |
| ----------------------------- | ------ | --------- |
| Epic 1 — Portable Bootstrap   | 5      | 7         |
| Epic 2 — Item Template System | 6      | 9         |
| Epic 3 — SSE Mode             | 3      | 9         |
| **Total**                     | **14** | **25**    |
