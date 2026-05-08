// =============================================================================
// src/services/pagination_test.ts — Tests for readiness helpers
// =============================================================================

import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { computeReadinessSummary, computeStoryReadiness } from "./readiness.ts";

// ---------------------------------------------------------------------------
// computeStoryReadiness tests
// ---------------------------------------------------------------------------

Deno.test("computeStoryReadiness — full DoR met (4 criteria)", () => {
  // Note: The user story regex expects "As a [single word], I want..."
  const body =
    'As a user, I want a login page, so users can access the app.\n\nDepends on #10.\n\n## Acceptance Criteria\n- [ ] Username field validates email format\n- [ ] Password field masks input\n- [ ] "Forgot password" link exists';

  const result = computeStoryReadiness(body, 5);
  // All 4 criteria: user story format, AC checkboxes, story points > 0, dependency reference
  assertEquals(result, {
    has_estimation_and_ac: true,
    partially_ready: false,
    not_ready: false,
  });
});

Deno.test("computeStoryReadiness — partial DoR (has points and AC, no dependencies)", () => {
  const body = `As a developer, I want to add logging, so we can debug issues.

## Acceptance Criteria
- [ ] Log level configurable
- [ ] Logs include timestamp`;

  const result = computeStoryReadiness(body, 8);
  // Only 3 criteria met (user story, AC, points) — needs 4 for "ready"
  assertEquals(result, {
    has_estimation_and_ac: false,
    partially_ready: true,
    not_ready: false,
  });
});

Deno.test("computeStoryReadiness — partially ready (no points, has AC)", () => {
  const body = `As a user, I want to filter results, so I can find what I need.

## Acceptance Criteria
- [ ] Filter by date range
- [ ] Filter by category`;

  const result = computeStoryReadiness(body, null);
  assertEquals(result, {
    has_estimation_and_ac: false,
    partially_ready: true,
    not_ready: false,
  });
});

Deno.test("computeStoryReadiness — not ready (no criteria met)", () => {
  const body = `Some rough idea for a feature.`;

  const result = computeStoryReadiness(body, null);
  assertEquals(result, {
    has_estimation_and_ac: false,
    partially_ready: false,
    not_ready: true,
  });
});

Deno.test("computeStoryReadiness — too large marker", () => {
  const body = `As a user, I want a complete analytics dashboard, so I can track all metrics.

## Acceptance Criteria
- [ ] Page views chart
- [ ] User engagement graph

Larger than a sprint — split into multiple stories.`;

  const result = computeStoryReadiness(body, 13);
  assertEquals(result, {
    has_estimation_and_ac: false,
    partially_ready: true,
    not_ready: false,
  });
});

Deno.test("computeStoryReadiness — with dependencies", () => {
  const body = `As a user, I want to export data, so I can use it elsewhere.

Depends on #42 (API endpoint).

## Acceptance Criteria
- [ ] Export to CSV
- [ ] Export to PDF`;

  const result = computeStoryReadiness(body, 5);
  assertEquals(result, {
    has_estimation_and_ac: true,
    partially_ready: false,
    not_ready: false,
  });
});

// ---------------------------------------------------------------------------
// computeReadinessSummary tests
// ---------------------------------------------------------------------------

Deno.test("computeReadinessSummary — mixed readiness", () => {
  const stories = [
    {
      body: `As a user, I want login.

Depends on #10.

## AC
- [ ] Test`,
      story_points: 5,
    },
    {
      body: `As a user, I want search.

## AC
- [ ] Test`,
      story_points: null,
    },
    {
      body: `Rough idea.`,
      story_points: null,
    },
  ];

  const result = computeReadinessSummary(stories);
  assertEquals(result, {
    ready: 1,
    partially_ready: 1,
    not_ready: 1,
  });
});

Deno.test("computeReadinessSummary — all partially ready (3 criteria, no dependencies)", () => {
  const stories = [
    {
      body: `As a user, I want login.

## AC
- [ ] Test`,
      story_points: 3,
    },
    {
      body: `As a user, I want logout.

## AC
- [ ] Test`,
      story_points: 2,
    },
  ];

  // Only 3 criteria met (user story, AC, points) — needs 4 for "ready"
  const result = computeReadinessSummary(stories);
  assertEquals(result, {
    ready: 0,
    partially_ready: 2,
    not_ready: 0,
  });
});

Deno.test("computeReadinessSummary — empty array", () => {
  const result = computeReadinessSummary([]);
  assertEquals(result, {
    ready: 0,
    partially_ready: 0,
    not_ready: 0,
  });
});
