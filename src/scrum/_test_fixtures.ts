// =============================================================================
// src/scrum/_test_fixtures.ts
//
// Single import point for scrum-layer unit test fixture data. Template content
// strings are extracted from the committed .github/ISSUE_TEMPLATE/ files so
// tests are stable against the real templates without network or filesystem
// dependency at test time. The capture script regenerates these constants.
// =============================================================================

import type { ContentLocation } from "../domain/content-location.ts";

// ── Template content strings (from .github/ISSUE_TEMPLATE/) ────────────────────

export const TEMPLATE_USER_STORY = `name: 📖 User Story
description: A new feature or capability expressed as a Scrum user story.
title: "[Story]: "
labels: ["feature"]
body:
  - type: markdown
    attributes:
      value: |
        Use this template for any new **feature or capability** you want to add to the backlog.
        Fill in the story card fully so it's ready for sprint planning without back-and-forth.

  - type: checkboxes
    id: duplicate-check
    attributes:
      label: Pre-submission check
      options:
        - label: I have searched existing issues and this story is not already tracked.
          required: true

  # ── Story card ────────────────────────────────────────────────────────────────

  - type: input
    id: persona
    attributes:
      label: As a…
      description: Who benefits? (e.g. "Scrum Master using the agent", "developer integrating the MCP server")
      placeholder: Scrum Master using the agent
    validations:
      required: true

  - type: textarea
    id: goal
    attributes:
      label: I want…
      description: What capability or action do they need?
      placeholder: …to be able to log an impediment that is not linked to any specific story
    validations:
      required: true

  - type: textarea
    id: benefit
    attributes:
      label: So that…
      description: What business or workflow value does this deliver?
      placeholder: …the team can track project-level blockers without forcing a fake story link
    validations:
      required: true

  # ── Acceptance criteria ───────────────────────────────────────────────────────

  - type: textarea
    id: acceptance-criteria
    attributes:
      label: Acceptance Criteria
      description: |
        List each criterion as a testable "Given / When / Then" statement or a plain checkbox.
        Every criterion here becomes part of the Definition of Done for this story.
      placeholder: |
        - [ ] Given … when … then …
        - [ ] Given … when … then …
    validations:
      required: true

  # ── Scrum metadata ────────────────────────────────────────────────────────────

  - type: dropdown
    id: story-points
    attributes:
      label: Story Point Estimate
      description: Fibonacci scale. Leave at "?" if the team hasn't estimated yet.
      options:
        - "?"
        - "1"
        - "2"
        - "3"
        - "5"
        - "8"
        - "13"
    validations:
      required: true

  - type: dropdown
    id: component
    attributes:
      label: Affected component
      description: Which architectural layer does this primarily touch?
      options:
        - MCP tool surface (scrum_* tools)
        - Use-case layer (src/scrum/)
        - Domain layer (src/domain/)
        - GitHub adapter (src/adapters/github/)
        - Agent mode (.roo/)
        - Config / bootstrap
        - Documentation
        - Other
    validations:
      required: true

  - type: input
    id: sprint-target
    attributes:
      label: Target sprint (optional)
      description: Sprint name or number if you already know where this belongs.
      placeholder: Sprint 4
    validations:
      required: false

  # ── Extra context ─────────────────────────────────────────────────────────────

  - type: textarea
    id: notes
    attributes:
      label: Additional context / notes
      description: Links, mockups, related issues, or design constraints worth capturing now.
    validations:
      required: false
`;

export const TEMPLATE_BUG = `name: 🐛 Bug Report
description: Something isn't working correctly in the MCP server or agent behaviour.
title: "[Bug]: "
labels: ["bug"]
body:
  - type: markdown
    attributes:
      value: |
        Use this template for **defects** - unexpected behaviour, incorrect tool responses, or
        contract violations in the \`scrum_*\` tool surface.

  - type: checkboxes
    id: duplicate-check
    attributes:
      label: Pre-submission check
      options:
        - label: I have searched existing issues and this bug is not already reported.
          required: true

  # ── What happened ─────────────────────────────────────────────────────────────

  - type: textarea
    id: expected
    attributes:
      label: Expected behaviour
      description: What should have happened?
      placeholder: "\`scrum_get_story\` should return the impediments array for the given story."
    validations:
      required: true

  - type: textarea
    id: actual
    attributes:
      label: Actual behaviour
      description: What actually happened? Paste error messages or incorrect output here.
      placeholder: The tool returns an empty \`impediments\` array even when impediments exist.
    validations:
      required: true

  - type: textarea
    id: steps
    attributes:
      label: Steps to reproduce
      description: Minimal steps or MCP call sequence needed to trigger the bug.
      placeholder: |
        1. Call \`scrum_log_impediment\` with \`affects.story = "STORY-12"\`
        2. Call \`scrum_get_story\` with the same story ID
        3. Observe \`impediments\` is \`[]\`
    validations:
      required: true

  # ── Affected surface ──────────────────────────────────────────────────────────

  - type: dropdown
    id: affected-tool
    attributes:
      label: Affected MCP tool
      description: Which \`scrum_*\` tool exhibits the wrong behaviour? Select all that apply.
      multiple: true
      options:
        - scrum_orient
        - scrum_find_items
        - scrum_get_item_detail
        - scrum_get_board_health
        - scrum_get_analytics
        - scrum_get_sprint
        - scrum_get_story
        - scrum_get_history
        - scrum_get_burndown
        - scrum_get_template
        - scrum_create_story
        - scrum_update_story
        - scrum_set_field
        - scrum_plan_sprint
        - scrum_log_impediment
        - scrum_update_impediment
        - scrum_add_vocabulary
        - Agent behaviour (not a specific tool)
        - Other / unknown
    validations:
      required: true

  - type: dropdown
    id: severity
    attributes:
      label: Severity
      options:
        - "Blocker – prevents core Scrum workflow"
        - "Major – incorrect output, workaround exists"
        - "Minor – cosmetic or edge-case issue"
    validations:
      required: true

  # ── Environment ───────────────────────────────────────────────────────────────

  - type: input
    id: server-version
    attributes:
      label: Server version / commit SHA
      placeholder: "e.g. main@a1b2c3d or v0.4.0"
    validations:
      required: false

  - type: input
    id: deno-version
    attributes:
      label: Deno version
      placeholder: "e.g. 2.3.1 - run \`deno --version\`"
    validations:
      required: false

  - type: textarea
    id: logs
    attributes:
      label: Relevant log output
      description: Paste stderr / MCP debug logs. Automatically rendered as code.
      render: shell
    validations:
      required: false

  - type: textarea
    id: notes
    attributes:
      label: Additional context
    validations:
      required: false
`;

export const TEMPLATE_IMPEDIMENT = `name: 🚧 Impediment
description: Something blocking the team's progress. Maps directly to scrum_log_impediment.
title: "[Impediment]: "
labels: ["impediment"]
body:
  - type: markdown
    attributes:
      value: |
        Use this template to **raise an impediment** - any blocker that the team cannot resolve
        within a single Daily Scrum and that requires Scrum Master action or escalation.

        Impediments are first-class artifacts in this project. They have their own lifecycle
        (\`open → in_progress → resolved\`) and can be linked to a story, a sprint, or left as a
        project-level orphan via \`scrum_log_impediment\`.

  # ── Description ──────────────────────────────────────────────────────────────

  - type: textarea
    id: description
    attributes:
      label: Impediment description
      description: What is blocking progress? Be specific and factual - no diagnosis needed yet.
      placeholder: The GitHub Projects v2 GraphQL API returns a 403 for all \`updateProjectV2ItemFieldValue\` mutations on the staging token, even though the token has \`project\` scope.
    validations:
      required: true

  # ── Impact ────────────────────────────────────────────────────────────────────

  - type: dropdown
    id: severity
    attributes:
      label: Severity
      options:
        - "Blocker – sprint goal is at risk, no workaround"
        - "Significant – multiple stories affected, workaround is costly"
        - "Minor – single story affected, workaround exists"
    validations:
      required: true

  - type: textarea
    id: what-is-blocked
    attributes:
      label: What is blocked?
      description: |
        List the story IDs, sprint name, or workflow area that cannot proceed.
        Use \`#issue-number\` to link stories.
      placeholder: |
        - #88 (scrum_set_field write path)
        - #91 (scrum_plan_sprint)
        - Current sprint goal: "Complete write tool surface"
    validations:
      required: true

  # ── Context ───────────────────────────────────────────────────────────────────

  - type: textarea
    id: discovered-when
    attributes:
      label: When / how was this discovered?
      description: Sprint event, commit, test run, or manual test that surfaced the blocker.
      placeholder: Discovered during Sprint 3 Day 2 standup while running integration tests against the staging GitHub org.
    validations:
      required: false

  - type: textarea
    id: attempted
    attributes:
      label: What has already been tried?
      description: Avoid duplicating effort - list what was attempted and why it didn't work.
      placeholder: |
        - Regenerated the token with \`project\`, \`repo\`, and \`admin:org\` scopes - same 403.
        - Checked GitHub status page - no ongoing incident.
    validations:
      required: false

  # ── Resolution ────────────────────────────────────────────────────────────────

  - type: textarea
    id: resolution-path
    attributes:
      label: Proposed resolution path
      description: Who needs to act, and what is the first concrete step?
      placeholder: |
        1. SM to escalate to GitHub Support with the exact mutation and token hash.
        2. In parallel: team unblocks #88 by stubbing the mutation in tests so development can continue.
        3. Close impediment once token grants the mutation successfully in CI.
    validations:
      required: false

  - type: input
    id: raised-by
    attributes:
      label: Raised by
      description: GitHub username of the person raising this impediment.
      placeholder: "@hoonkim"
    validations:
      required: false

  - type: textarea
    id: notes
    attributes:
      label: Additional context / links
    validations:
      required: false
`;

// ── ContentLocation constants (for template-resource.test.ts) ──────────────────

export const INLINE_LOCATION = {
  kind: "inline",
  content: "# Custom Template\n\nSome content.",
} as const satisfies ContentLocation;

export const INLINE_YAML_LOCATION = {
  kind: "inline",
  content: "name: Test Template\ndescription: A YAML inline template.\n",
} as const satisfies ContentLocation;

export const INLINE_JSON_LOCATION = {
  kind: "inline",
  content: '{"name":"Test Template","description":"A JSON inline template."}',
} as const satisfies ContentLocation;

export const FILE_YML_LOCATION = {
  kind: "file",
  path: "/some/path/template.yml",
} as const satisfies ContentLocation;

export const FILE_JSON_LOCATION = {
  kind: "file",
  path: "/some/path/template.json",
} as const satisfies ContentLocation;

export const FILE_MD_LOCATION = {
  kind: "file",
  path: "/some/path/template.md",
} as const satisfies ContentLocation;

export const URL_YML_LOCATION = {
  kind: "url",
  url: new URL("https://raw.example.com/template.yml"),
} as const satisfies ContentLocation;

export const URL_JSON_LOCATION = {
  kind: "url",
  url: new URL("https://raw.example.com/template.json"),
} as const satisfies ContentLocation;

export const URL_MD_LOCATION = {
  kind: "url",
  url: new URL("https://raw.example.com/template.md"),
} as const satisfies ContentLocation;

// ── Pre-resolved type → template content map (for template-pipeline.test.ts) ───

export const TYPE_TEMPLATE_CONTENT: Record<string, string> = {
  user_story: TEMPLATE_USER_STORY,
  bug: TEMPLATE_BUG,
  impediment: TEMPLATE_IMPEDIMENT,
};
