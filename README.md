# GitHub Projects v2 MCP Server

A local [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server for operating on **GitHub Projects v2** via the GitHub GraphQL API. Designed to serve as the action layer for LLM agents performing autonomous SCRUM project management — sprint planning, backlog refinement, velocity tracking, and ceremony facilitation — without leaving the GitHub Projects ecosystem.

Supports two transports: **stdio** (Claude Desktop / Claude Code / LM Studio) and **Streamable HTTP** (Open WebUI / Docker / homelab).

## Related Documentation

- [GitHub Projects v2 — About Projects](https://docs.github.com/en/issues/planning-and-tracking-with-projects/learning-about-projects/about-projects)
- [GitHub Projects v2 — GraphQL API](https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/using-the-api-to-manage-projects)
- [Model Context Protocol Specification](https://modelcontextprotocol.io/docs)
- [The SCRUM Method](https://www.scrum.org/learning-series/what-is-scrum/)

## What is SCRUM?

> If you are just getting started, think of Scrum as a way to get work done as a team in small pieces at a time, with continuous experimentation and feedback loops along the way to learn and improve as you go. Scrum helps people and teams deliver value incrementally in a collaborative way. As an agile framework, Scrum provides just enough structure for people and teams to integrate into how they work, while adding the right practices to optimize for their specific needs.
>
> [From SCRUM.org](https://www.scrum.org/learning-series/what-is-scrum/)

A fully mapped SCRUM project composition will look something like the following:

```mermaid
erDiagram
%% ── CORE PROJECT STRUCTURE ──────────────────────────────────────────────

PROJECT {
 string id PK
 string name
 string vision
 enum status "Active|Paused|Completed|Archived"
 date start_date
 date end_date
}

TEAM {
 string id PK
 string project_id FK
 string name
}

MEMBER {
 string id PK
 string team_id FK
 string name
 string email
}

MEMBER_CAPACITY {
 string id PK
 string member_id FK
 string sprint_id FK
 float available_days
 int capacity_points
 string notes
}

ROLE_ASSIGNMENT {
 string id PK
 string member_id FK
 string sprint_id FK
 enum role "PO|SM|Developer"
}

%% ── BACKLOG HIERARCHY ───────────────────────────────────────────────────

PRODUCT_BACKLOG {
 string id PK
 string project_id FK
 string product_goal
 date last_refined
}

EPIC {
 string id PK
 string backlog_id FK
 string title
 string description
 enum priority "Must|Should|Could|Wont"
 enum status "Open|InProgress|Done"
}

USER_STORY {
 string id PK
 string epic_id FK
 string title
 string as_a
 string i_want
 string so_that
 int story_points
 enum status "Backlog|Ready|InSprint|Done|Blocked"
 enum priority "Must|Should|Could|Wont"
}

SPRINT_BACKLOG_ITEM {
 string id PK
 string sprint_id FK
 string story_id FK
 date added_date
 bool carried_over
 int committed_points
}

ACCEPTANCE_CRITERIA {
 string id PK
 string story_id FK
 string criterion
 bool passed
}

TASK {
 string id PK
 string story_id FK
 string assignee_id FK
 string title
 enum type "Feature|Bug|TechDebt|Spike|Research"
 enum status "Todo|InProgress|Blocked|Done"
 float hours_estimate
 float hours_actual
}

IMPEDIMENT {
 string id PK
 string sprint_id FK
 string task_id FK
 string story_id FK
 string raised_by FK
 string owner_id FK
 string description
 date raised_date
 date resolved_date
 enum status "Open|InProgress|Resolved"
}

%% ── SPRINT ──────────────────────────────────────────────────────────────

SPRINT {
 string id PK
 string project_id FK
 int number
 string goal
 date start_date
 date end_date
 int capacity_points
 int committed_points
 int completed_points
 enum status "Planned|Active|Closed"
}

%% ── CEREMONIES ──────────────────────────────────────────────────────────

CEREMONY {
 string id PK
 string sprint_id FK
 string facilitator_id FK
 enum type "Planning|Standup|Review|Retro|Refinement"
 datetime scheduled_at
 int duration_min
 string notes
}

CEREMONY_ATTENDANCE {
 string id PK
 string ceremony_id FK
 string member_id FK
 bool attended
}

STANDUP_ENTRY {
 string id PK
 string ceremony_id FK
 string member_id FK
 date date
 string done_yesterday
 string plan_today
 string blockers
}

RETRO_ENTRY {
 string id PK
 string ceremony_id FK
 string member_id FK
 enum category "WentWell|Improve|Start|Stop"
 string observation
}

RETRO_ACTION {
 string id PK
 string retro_entry_id FK
 string sprint_id FK
 string owner_id FK
 string description
 enum status "Open|Done|Deferred"
 string sprint_target_id FK
}

REVIEW_FEEDBACK {
 string id PK
 string sprint_id FK
 string ceremony_id FK
 string given_by
 string feedback
 string triggered_story_id FK
}

%% ── TRACKING ────────────────────────────────────────────────────────────

BURNDOWN_DATAPOINT {
 string id PK
 string sprint_id FK
 enum series "Ideal|Actual"
 date date
 int remaining_points
 int completed_points
}

VELOCITY_RECORD {
 string id PK
 string project_id FK
 string sprint_id FK
 int committed_points
 int completed_points
}

%% ── QUALITY ─────────────────────────────────────────────────────────────

DEFINITION_OF_DONE {
 string id PK
 string project_id FK
 string criterion
 string area
 int version
 date last_updated
}

DEFINITION_OF_READY {
 string id PK
 string project_id FK
 string criterion
 int version
 date last_updated
}

SPRINT_REPORT {
 string id PK
 string sprint_id FK
 string author_id FK
 date submitted_at
 string summary
 string commitment_next_sprint
}

%% ── RELATIONSHIPS ───────────────────────────────────────────────────────

PROJECT ||--o{ TEAM : "has"
PROJECT ||--|| PRODUCT_BACKLOG : "owns"
PROJECT ||--o{ SPRINT : "runs"
PROJECT ||--o{ DEFINITION_OF_DONE : "defines"
PROJECT ||--o{ DEFINITION_OF_READY : "defines"
PROJECT ||--o{ VELOCITY_RECORD : "tracks"

TEAM ||--o{ MEMBER : "includes"
MEMBER ||--o{ ROLE_ASSIGNMENT : "holds"
MEMBER ||--o{ MEMBER_CAPACITY : "has per sprint"
SPRINT ||--o{ ROLE_ASSIGNMENT : "scopes"
SPRINT ||--o{ MEMBER_CAPACITY : "allocates"

PRODUCT_BACKLOG ||--o{ EPIC : "contains"
EPIC ||--o{ USER_STORY : "breaks into"

USER_STORY ||--o{ ACCEPTANCE_CRITERIA : "verified by"
USER_STORY ||--o{ TASK : "decomposed into"
USER_STORY ||--o{ SPRINT_BACKLOG_ITEM : "pulled into"

SPRINT ||--o{ SPRINT_BACKLOG_ITEM : "contains"
SPRINT ||--o{ CEREMONY : "schedules"
SPRINT ||--|| SPRINT_REPORT : "documented in"
SPRINT ||--o{ VELOCITY_RECORD : "recorded in"
SPRINT ||--o{ BURNDOWN_DATAPOINT : "tracked by"
SPRINT ||--o{ IMPEDIMENT : "surfaces"

TASK }o--o{ IMPEDIMENT : "may cause"
USER_STORY }o--o{ IMPEDIMENT : "may cause"
MEMBER ||--o{ IMPEDIMENT : "owns"
MEMBER ||--o{ TASK : "assigned to"

CEREMONY ||--o{ CEREMONY_ATTENDANCE : "records"
CEREMONY ||--o{ STANDUP_ENTRY : "captures"
CEREMONY ||--o{ RETRO_ENTRY : "captures"
CEREMONY ||--o{ REVIEW_FEEDBACK : "captures"
MEMBER ||--o{ CEREMONY_ATTENDANCE : "attends"

RETRO_ENTRY ||--o{ RETRO_ACTION : "generates"
MEMBER ||--o{ RETRO_ACTION : "owns"
SPRINT ||--o{ RETRO_ACTION : "targets"

USER_STORY }o--o{ REVIEW_FEEDBACK : "triggered by"

SPRINT_REPORT }o--|| MEMBER : "authored by"
```

This project provides the necessary tools for a LLM to act as the SCRUM master assistant within the GitHub ecosystem. Removing the need for complex PM tools.

It is designed to be used with the `skill/scrum-master-assistant/` agentic skill as the orchestration layer.

This project requires significant refactoring, as it needs to be more flexible and functional in different project contexts.

## Tool Surface

This section defines the public MCP interface — the tools an LLM agent can call. It is the stable contract of the project: backend implementations, data types, and storage details may change underneath, but every tool listed below should retain the same name, semantic arguments, and return meaning.

### Design principles

The surface is governed by five rules. Any change that violates one is a breaking change.

1. **Scrum vocabulary only.** No tool name, argument, or return field references the underlying platform (no `github_*`, no `issue_id`, no `node_id`). The agent speaks Scrum; the backend translates.
2. **Backend-agnostic shapes.** Inputs and outputs are described in domain terms (`Story`, `Sprint`, `Board`, `ScrumField`). Adding a Notion or Trello backend must require zero changes to this section.
3. **Stateless server, per-call resolution.** No tool depends on context cached between calls. Each tool resolves any names → backend IDs at the moment of invocation. The agent may call any tool in any order without a setup step.
4. **Atomic at the tool boundary, not below.** A single tool call performs one logically complete Scrum operation. The agent may need multiple calls for a workflow (e.g., create a story, then assign it to a sprint), but each call either succeeds end-to-end or fails cleanly.
5. **The MCP is amoral.** It does not enforce Definition of Ready, Definition of Done, sprint-injection policy, or any other Scrum judgement. Those live in the agent skill. If the agent asks the MCP to assign an unrefined item to a sprint, the MCP complies. The skill is responsible for not asking.

### Common types

These appear in arguments and return values across multiple tools. They are described semantically; the on-the-wire representation is a backend concern.

| Type | Meaning |
|---|---|
| `StoryRef` | A reference to a single Story. Accepted forms: `{ "number": 42 }` (the user-facing reference, e.g., issue number, card ID) or `{ "id": "<opaque>" }` (the backend-native handle returned by previous calls). Tools accept either form. |
| `SprintRef` | A reference to a sprint. Accepted forms: `"current"`, `"next"`, `null` (= no sprint, i.e., the backlog), or an explicit sprint name (e.g., `"Sprint 12"`). |
| `ScrumField` | One of `status`, `sprint`, `story_points`, `priority`, `assignee`. The set is fixed; new field types are out of scope for v1. |
| `StoryType` | One of `feature`, `bug`, `tech_debt`, `spike`. Drives the type label or category the backend applies. |
| `Story` | The canonical entity. See full shape under [Story shape](#story-shape) below. |

#### Story shape

Every read tool that returns Stories returns objects of this shape (with optional fields populated when present):

| Field | Meaning |
|---|---|
| `ref` | A `StoryRef` containing both `number` and `id` so the agent can use either. |
| `title` | The story title. |
| `body` | The story body, rendered as markdown. Includes user-story format, AC checklist, dependencies, technical notes — whatever the team wrote. |
| `type` | `StoryType` resolved from the type label or category. |
| `status` | The current status, in the team's vocabulary (e.g., `"In Progress"`). |
| `sprint` | The current sprint name, or `null` if the story is in the backlog. |
| `story_points` | Numeric estimate, or `null` if unestimated. |
| `priority` | The team's priority value (e.g., `"Must"`), or `null`. |
| `assignees` | Array of team member identifiers (login or display name as configured). |
| `labels` | Array of label strings (excluding the `type:*` label, which is reflected in `type`). |
| `epic` | Parent epic name or `null`. (V1 reads epic membership; does not write.) |
| `created_at`, `updated_at` | ISO-8601 timestamps. |
| `url` | Canonical URL to view the story in the backend's UI, when available. |

### Read tools

Read tools are the agent's eyes. They are cheap, idempotent, and safe to call as often as needed.

#### `scrum_get_config`

Returns the team's static Scrum configuration: Definition of Ready, Definition of Done, status vocabulary, priority vocabulary, team roster, sprint length, and story-point scale. Read once per session by the agent at orient time.

**Arguments:** none.

**Returns:** an object with fields `definition_of_ready` (array of strings), `definition_of_done` (array of strings), `status_vocabulary` (array of strings, in workflow order), `priority_vocabulary` (array of strings, ordered by importance), `story_point_values` (array of allowed numeric estimates), `sprint` (object with `length_weeks`, `start_day`), `team` (array of `{ login, name, role }`), `ceremony_records_backend` (string indicating where notes land).

**Notes:** This is the one place the agent learns the team's Scrum dialect — what "Done" is called, what priority tiers exist, who is on the team. All write tools that take vocabulary values (e.g., `scrum_set_field` with field `status`) accept values from this vocabulary.

**Does not:** return live sprint state (use `scrum_get_board`), historical data (use `scrum_get_velocity`), or platform identifiers.

#### `scrum_get_board`

Returns the current Sprint Backlog as a snapshot: the sprint metadata, its goal, its capacity, and every Story currently assigned to it grouped by status, with story points summed per group.

**Arguments:**
- `sprint` (optional, `SprintRef`): defaults to `"current"`. Pass `"next"` to inspect the upcoming sprint, or an explicit sprint name to inspect a past sprint.

**Returns:** an object with `sprint` (`{ name, goal, start_date, end_date, days_remaining, capacity_points }`), `groups` (array of `{ status, stories: Story[], points_sum }` in the order defined by `status_vocabulary`), `totals` (`{ committed_points, completed_points, in_flight_points, blocked_points }`).

**Notes:** This is the agent's primary orient call for any in-sprint ceremony. The grouped structure means the agent doesn't have to bucket Stories itself — a 9B model especially benefits from receiving pre-grouped data.

**Does not:** include backlog (unsprinted) items; surface burndown timeseries; resolve dependencies between stories.

#### `scrum_get_backlog`

Returns the Product Backlog: all Stories not assigned to any sprint and not yet `Done`, ordered by priority. Supports filtering so the agent can answer "is this a duplicate of something already tracked?"

**Arguments:**
- `search` (optional, string): free-text match against title and body.
- `labels` (optional, array of strings): include only Stories carrying all of these labels.
- `priority` (optional, string): include only Stories at this priority value or higher.
- `epic` (optional, string): include only Stories under this epic.
- `limit` (optional, integer, default 50): cap on items returned.

**Returns:** an object with `stories` (array of `Story`), `total_count` (number of items matching the filter regardless of `limit`), and `readiness` (object summarising how many items are sprint-ready, in refinement, future candidates — based on whether they have `story_points`, AC in body, and a priority).

**Notes:** The readiness summary is a pure aggregation, not a Scrum judgement. It reports observable state; it does not enforce DoR.

**Does not:** modify ordering; create or estimate items; mark items as ready.

#### `scrum_get_story`

Returns the full detail of one Story, including comments, sub-tasks if the backend supports them, linked PRs, and the full body content.

**Arguments:**
- `ref` (required, `StoryRef`).

**Returns:** a `Story` object plus `comments` (array of `{ author, body, created_at, url }`), `linked_prs` (array of PR references with state), `sub_tasks` (array of `{ title, status }` if the backend exposes sub-tasks), `acceptance_criteria` (array of `{ text, checked }` parsed from the body).

**Notes:** Use when the agent needs deep context on a single item — assessing DoR, drafting a status update, debugging a blocked item.

**Does not:** return diff content of linked PRs, render images attached to the story, or follow links to other stories transitively.

#### `scrum_get_velocity`

Returns historical sprint completion data so the agent can compute capacity, trend, and confidence intervals.

**Arguments:**
- `window` (optional, integer, default 5): number of most recent closed sprints to include.

**Returns:** an array of `{ sprint, committed_points, completed_points, completion_rate, started_count, completed_count }`, ordered most-recent-first. Plus an aggregate field `average_completed` over the window.

**Notes:** Velocity is a pure read-aggregation. The MCP does not write velocity records — they are derived from sprint state.

**Does not:** project future velocity, surface variance analysis, or compute team-member-level throughput.

### Write tools

Write tools mutate state. The agent should call them only after confirming intent with the human (per the skill's autonomy rules).

#### `scrum_create_story`

Creates a new Story and optionally places it on the board.

**Arguments:**
- `title` (required, string): the story title.
- `body` (required, string, markdown): the full story body. The agent assembles the user-story format, AC checklist, dependencies, and technical notes into one markdown document before calling.
- `type` (required, `StoryType`): drives the type label.
- `priority` (optional, string): a value from `priority_vocabulary`.
- `story_points` (optional, number): a value from `story_point_values`.
- `labels` (optional, array of strings): additional non-type labels (e.g., `area:ux`).
- `epic` (optional, string): parent epic name.
- `assignees` (optional, array of strings): team member logins.
- `sprint` (optional, `SprintRef`): if provided, the story is created and immediately assigned to this sprint. If omitted, the story enters the backlog.

**Returns:** the newly created `Story`.

**Notes:** The single-call atomicity is the point of this tool. The agent does not need to follow a `create` with `set_field` for points and priority; it bundles them in the create call.

**Does not:** validate DoR, check sprint capacity, notify anyone, or create sub-tasks.

#### `scrum_update_story`

Edits the content of an existing Story — title, body, labels, assignees, epic. Does not touch board fields (status, sprint, story points, priority); use `scrum_set_field` for those.

**Arguments:**
- `ref` (required, `StoryRef`).
- `title` (optional, string).
- `body` (optional, string, markdown): replaces the full body. The agent reads the current body via `scrum_get_story` first if it intends to append.
- `labels` (optional, array of strings): replaces the label set, excluding `type:*` and `priority:*` labels which are managed by their own writes.
- `assignees` (optional, array of strings): replaces the assignee set.
- `epic` (optional, string or `null`): set to `null` to detach from epic.

**Returns:** the updated `Story`.

**Notes:** The body field is replace-not-append. This is intentional — the agent must read before it writes if it wants to preserve content. `scrum_post_note` exists for append-only commentary and should be preferred for ceremony notes.

**Does not:** modify board state, change story type, archive or close the story.

#### `scrum_set_field`

The single tool for board-field writes. Replaces 80% of what raw GitHub Projects field updates would otherwise require, with no IDs in the agent's context.

**Arguments:**
- `ref` (required, `StoryRef`).
- `field` (required, `ScrumField`): one of `status`, `sprint`, `story_points`, `priority`, `assignee`.
- `value` (required): semantic value matching the field:
  - `status`: a string from `status_vocabulary` (e.g., `"In Progress"`).
  - `sprint`: a `SprintRef` (`"current"`, `"next"`, `null`, or explicit sprint name).
  - `story_points`: a number from `story_point_values`, or `null` to unestimate.
  - `priority`: a string from `priority_vocabulary`, or `null` to clear.
  - `assignee`: a team member login, or `null` to unassign. To assign multiple, use `scrum_update_story` with `assignees`.

**Returns:** the updated `Story`.

**Notes:** Setting `sprint` to `null` is how the agent removes a story from the current sprint (e.g., during a mid-sprint swap). This is the "remove from sprint" operation; there is no separate tool.

**Does not:** validate that the value transition makes Scrum sense (e.g., setting `Done` on an item that hasn't been reviewed). The skill enforces such rules.

#### `scrum_plan_sprint`

Bulk-assigns multiple Stories to a sprint in one atomic call. Used during sprint planning to commit the agreed scope after the team has discussed each item.

**Arguments:**
- `sprint` (required, `SprintRef`): typically `"next"` or an explicit name; `"current"` is allowed but represents a mid-sprint scope change.
- `stories` (required, array of `StoryRef`): the items to commit.
- `replace` (optional, boolean, default `false`): if `true`, clears any existing sprint assignment first; if `false`, adds to whatever's already there.

**Returns:** an object with `assigned` (array of refs successfully placed), `skipped` (array of `{ ref, reason }` for failures — e.g., story already Done, story not found).

**Notes:** This is a convenience over `scrum_set_field` in a loop, but the atomicity matters: if the backend supports a single transaction, the assignment either succeeds for all listed items or fails as a group with a clear partial-success report.

**Does not:** check capacity, enforce DoR on the listed items, or set a Sprint Goal (the goal is a property of the sprint metadata, set via the team's chosen ceremony backend — a Discussion post, a sprint-current.md file, etc.).

#### `scrum_log_impediment`

Creates a new Story typed `impediment` (or the team's equivalent label), links it to the affected story, and sets its status to `Blocked`.

**Arguments:**
- `description` (required, string, markdown): the impediment body.
- `affects` (required, `StoryRef`): the Story this is blocking.
- `raised_by` (optional, string): team member login of the person who surfaced it; defaults to the configured Scrum Master.
- `priority` (optional, string): a value from `priority_vocabulary`; defaults to the highest tier.

**Returns:** the impediment as a `Story`, plus `linked_to` containing the affected story's ref.

**Notes:** Impediments are first-class Stories so they show up on the board and in velocity reporting if the team chooses. The link to the affected story is bidirectional where the backend supports it (e.g., a comment on each).

**Does not:** notify the impediment owner, escalate after N days (the agent's daily standup ceremony does this), or close the affected story.

#### `scrum_post_note`

Appends a comment or note to an existing Story. Used for ceremony artefacts (standup logs, retro entries, review feedback) and for the audit trail of decisions like sprint injection.

**Arguments:**
- `ref` (required, `StoryRef`).
- `body` (required, string, markdown).
- `kind` (optional, string, default `"comment"`): one of `"comment"`, `"standup"`, `"retro"`, `"review"`. Determines any tagging the backend applies for later filtering. Treat as a hint; the body is always preserved verbatim.

**Returns:** an object with `url` (the canonical URL of the new comment).

**Notes:** This is append-only. It does not modify the Story body. It is the right tool whenever the agent wants to leave an auditable note without changing the underlying content.

**Does not:** edit existing comments, delete comments, or notify the assignee.

### What this surface deliberately does NOT include

The full Scrum domain (see the ER diagram above) is much richer than these eleven tools. The omissions are intentional. Anything in this list is either out of scope for the MCP, handled by the agent skill, or deferred to v2.

- **Sprint creation, closure, and field-setup writes.** Creating new iterations, changing field option sets, renaming statuses, and provisioning labels are administrative one-shots performed by the human against the platform UI or via a separate CLI/script. The MCP does not expose these as agent-callable tools.
- **Burndown writes.** Burndown is computed by the agent from `scrum_get_board` snapshots over time. The MCP does not store time-series.
- **Velocity record writes.** Velocity is read-only-aggregated. The MCP does not maintain a velocity table; it derives velocity from completed sprint state on demand.
- **Ceremony entities (CEREMONY, CEREMONY_ATTENDANCE, STANDUP_ENTRY, RETRO_ENTRY, REVIEW_FEEDBACK as records).** Ceremonies are activities the agent facilitates with the human; their artefacts land as `scrum_post_note` calls or as files in the team's chosen ceremony-records backend. There is no Ceremony entity write.
- **Acceptance criteria as a separate entity.** AC lives inside the Story body as a markdown checklist. `scrum_get_story` parses it for convenience; writes go through `scrum_update_story` against the body.
- **Tasks as separate entities.** V1 flattens Stories — each PBI is one Story. Sub-task hierarchy (parent/child) is deferred to v2.
- **Definition of Done / Definition of Ready writes.** DoD and DoR are read via `scrum_get_config`. Edits happen against the team's config file by hand.
- **Member capacity writes.** Per-sprint capacity lives in the team's sprint-current document and is read into context via the agent's skill, not via a dedicated MCP tool.
- **Notifications, mentions, or messaging.** The MCP does not send Slack messages, emails, or mobile pushes. If the team wants those, they configure separate automation against the same backend.
- **Authentication or token management.** The server is bootstrapped with credentials at startup; agent-callable tools do not surface auth operations.

If a future workflow requires something on this list, the right move is usually to add it as agent skill behaviour or as a separate CLI task — not to grow the MCP tool surface.

---

## How this MCP is used with the agent skill

This MCP is the action layer for an LLM agent acting as a Scrum Master. The agent's reasoning, coaching, and ceremony facilitation come from the [`scrum-agile-assistant`](https://github.com/anthropics/skills/tree/main/scrum-agile-assistant) skill (or any equivalent system prompt). The MCP's job is to make that reasoning effective on a real platform.

The two layers have strictly separate responsibilities. Confusion between them is the failure mode this project is designed to prevent.

### Division of responsibilities

| Layer | Owns |
|---|---|
| **Human** | Intent, content, scope decisions, approval of state-changing actions, anything the system cannot fetch from itself. |
| **Agent skill** | Scrum knowledge, ceremony facilitation, DoR/DoD enforcement, mid-sprint scope-injection coaching, retro format selection, document drafting, asking the human the right questions, deciding when to call the MCP. |
| **MCP server** | Atomic platform operations, name → backend ID resolution, board snapshots, velocity aggregation, write idempotence. |

Three rules follow from this split:

1. **The agent never asks the MCP a Scrum question.** "Is this story ready?" is an agent question — it reads `scrum_get_story` and applies its own DoR check. "Does this team have a Definition of Ready?" is also an agent question — it reads `scrum_get_config`, but the interpretation belongs to the skill.
2. **The MCP never asks the human a question.** Tools either succeed or fail with a clear error. Clarification happens in the agent layer.
3. **The human never directly issues backend operations.** The whole point of the abstraction is that the human says "test solution b this sprint" and the agent translates that into the right sequence of MCP calls.

### The four-phase interaction pattern

Every non-trivial workflow follows the same shape. The pattern is what makes the system predictable across ceremonies and across backends.

**Phase 1 — Orient.** The agent reads world state with `scrum_get_config`, `scrum_get_board`, and (when context demands) `scrum_get_backlog` or `scrum_get_velocity`. These calls happen silently; the human does not see them as a sequence of operations. The skill uses the results to ground the rest of the conversation in real numbers.

**Phase 2 — Coach.** The agent applies the skill. It identifies any DoR gaps, sprint-injection risks, capacity violations, or unclarified intent. It surfaces these to the human in plain language and asks for the missing information. No MCP calls happen in this phase.

**Phase 3 — Confirm.** Once the human has given the agent enough information, the agent restates the planned changes — "I'm going to create a Spike titled X with N points in Sprint M, and bump story #37 back to the backlog" — and waits for approval. Confirmation is required for every state change above the autonomy threshold defined in `config.yml`.

**Phase 4 — Execute.** The agent calls the MCP write tools in sequence. Each call is atomic; the agent threads returned references between calls (`scrum_create_story` returns a `StoryRef` that the next `scrum_set_field` consumes).

**Phase 5 — Report.** The agent summarises what changed in plain language with links to the affected Stories. The human can verify directly in the platform UI if they want.

### What the agent must always ask the human

Some information cannot be fetched by any tool because it lives only in the human's head. The skill recognises these as forced clarifications:

- **The actual content of the work.** "Solution b" or "the new login flow" or "fix the bug Cara reported" is an opaque label. The agent must obtain the concrete description before drafting a Story.
- **The user role for a story.** "Players" vs. "new players on mobile" is a judgement the human must make.
- **Acceptance criteria.** What does success look like? In measurable terms? The MCP does not know.
- **Estimates and time-boxes.** Team members provide these during planning; the agent records them after.
- **Mid-sprint scope decisions.** Whether to inject into the current sprint or queue for the next, and if injecting, what to drop.
- **The Sprint Goal.** A sentence the team commits to. The agent can suggest, but cannot decide.
- **Retro commitments.** Exactly one improvement per sprint, owned by the team — not the agent.
- **Approval to write.** For any change above the configured autonomy level.

### What the MCP cannot answer

The corresponding non-list — questions the MCP is structurally incapable of answering, by design:

- "Is this Story ready?"
- "Should we inject this into the current sprint?"
- "What's a good Sprint Goal for this work?"
- "Who should this be assigned to?" (it knows the team but not who has bandwidth)
- "Is this estimate realistic?"
- "Was the last retro commitment honoured?"
- "Why has this Story been blocked for three days?"

These belong to the agent skill, the human, or both. Anyone tempted to "just add a tool" for one of these should treat that as a signal that the boundary has slipped.

### Canonical example: mid-sprint UX research request

The human says: *"Several players report the game interface is too complicated. My ideas to fix are a, b, c. I think b is most feasible to test before the end of this sprint."*

What happens, by phase:

1. **Orient.** Agent calls `scrum_get_config()`, `scrum_get_board()`, and `scrum_get_backlog({ search: "ui" })`. Now it knows the current Sprint Goal, capacity, days remaining, and whether this concern is already tracked.
2. **Coach.** Agent recognises three issues: solutions a/b/c are opaque labels, no AC has been defined, and this is mid-sprint scope injection. It asks the human: what is solution b in concrete terms, who is the affected user, is this research (Spike) or a deliverable (Story), what does success look like, and is the human prepared to drop something to make room?
3. **Confirm.** Human answers. Agent drafts: "Spike titled 'A/B test reduced main-menu', 3 SP, in current sprint, dropping #37 (Daily login bonus) to make room. AC: ≥10% reduction in new-player tutorial drop-off." Asks for approval.
4. **Execute.** Agent calls in sequence: `scrum_create_story` (returns the new ref), `scrum_set_field(new, "sprint", "current")`, `scrum_set_field(new, "story_points", 3)`, `scrum_set_field(#37, "sprint", null)`, `scrum_post_note(#37, "Removed mid-sprint to make room for X — will reschedule next sprint.")`.
5. **Report.** Agent: "Done. Spike #42 created in Sprint 5 with 3 points; #37 bumped back to backlog. Test runs through Friday."

Every other workflow this server supports — sprint planning, daily standup, sprint review, retrospective, backlog refinement, impediment escalation — follows the same five-phase shape with different tool sequences in Phase 4.

### Where the boundary helps when things change

The reason this division matters: the system survives change in three independent dimensions.

- **Backend changes.** Swapping GitHub for Notion replaces only the implementations behind the eleven tools. The agent skill, the Scrum vocabulary, and the human's interactions are unchanged.
- **Skill changes.** Improving the agent's coaching, adding new ceremony formats, or supporting new retro frameworks is a skill-file edit. The MCP does not need a release.
- **Domain changes.** If a future Scrum dialect needs new fields (say, a "confidence" rating on estimates), the team adds it as a custom field in their backend, declares it in `config.yml`, and the agent reads it from the Story body or from `scrum_get_config`. The tool surface does not grow.

The eleven tools are the contract. Everything else is a moving part.
