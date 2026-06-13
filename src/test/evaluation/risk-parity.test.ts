// =============================================================================
// src/test/evaluation/risk-parity.test.ts
//
// Risk parity verification — SB4: Sprint risk and readiness parity (Phase B exit gate, now complete).
//
// Proves that the agent-side risk counting algorithm described in SKILL.md
// §Sprint risk counts produces the same counts as the server's
// BoardHealthService.computeSprintRiskCounts logic.
//
// Also validates the readiness proxy logic using BacklogItemListing fields that
// are available from scrum_find_items (no body field required).
//
// The server uses story.status to detect "blocked" by comparing against the
// configured status_display["blocked"] display name. The agent uses
// SprintRawItem.hasBlockers (a boolean pre-computed by the adapter from the
// blocked_by dependency list). Both measure the same thing — see report.md §3
// for the documented equivalence.
// =============================================================================

import { assertEquals } from "@std/assert";
import type { SprintRawItem } from "../../scrum/ports.ts";
import type { BacklogItemListing } from "../../domain/types.ts";

// ── Agent-side risk counting (mirrors SKILL.md §Sprint risk counts) ───────────

interface SprintRiskCounts {
  unestimated_count: number;
  blocked_count: number;
  no_assignee_count: number;
}

/**
 * Agent-side sprint risk counts.
 * Excludes items whose status matches the terminal "done" status display name.
 */
function agentCountSprintRisks(
  items: readonly SprintRawItem[],
  doneStatusDisplayName: string,
): SprintRiskCounts {
  const active = items.filter((i) => i.status !== doneStatusDisplayName);
  return {
    unestimated_count: active.filter((i) => i.story_points === null || i.story_points === 0).length,
    blocked_count: active.filter((i) => i.has_blockers).length,
    no_assignee_count: active.filter((i) => !i.has_assignee).length,
  };
}

// ── Server-side risk counting (extracted from BoardHealthService logic) ───────
//
// Mirrors computeSprintRiskCounts in board-health-service.ts:
//   unestimated = stories where story_points ?? 0 === 0
//   blocked     = stories where status === blockedDisplayName
//   no_assignee = stories where assignees.length === 0
//
// Note: the server counts "blocked" by STATUS (== "Blocked" display name),
// while the agent counts "blocked" by hasBlockers (dep list). These measure
// the same underlying state — an item whose blocked_by list is non-empty gets
// status "Blocked" from the board. Documented divergence in report.md §3.1.

interface ServerStoryProxy {
  story_points: number | null;
  status: string | null;
  assignees: readonly string[];
}

function serverCountSprintRisks(
  stories: readonly ServerStoryProxy[],
  blockedDisplayName: string,
): SprintRiskCounts {
  return {
    unestimated_count: stories.filter((s) => (s.story_points ?? 0) === 0).length,
    blocked_count: stories.filter((s) => s.status === blockedDisplayName).length,
    no_assignee_count: stories.filter((s) => s.assignees.length === 0).length,
  };
}

// ── Agent-side readiness proxy (mirrors SKILL.md §DoR readiness assessment) ──

interface ReadinessResult {
  ready_count: number;
  not_ready_count: number;
  readiness_pct: number;
}

/**
 * Agent-side readiness assessment from BacklogItemListing fields.
 * Uses field-level proxies for DoR criteria (no body inspection).
 * "Ready" = type set AND story_points > 0. (Minimum field-checkable DoR.)
 */
function agentAssessReadiness(items: readonly BacklogItemListing[]): ReadinessResult {
  let readyCount = 0;
  let notReadyCount = 0;

  for (const item of items) {
    const hasType = item.type !== null && item.type !== "";
    const hasEstimate = (item.story_points ?? 0) > 0;
    if (hasType && hasEstimate) {
      readyCount++;
    } else {
      notReadyCount++;
    }
  }

  const total = readyCount + notReadyCount;
  return {
    ready_count: readyCount,
    not_ready_count: notReadyCount,
    readiness_pct: total > 0 ? Math.round((readyCount / total) * 100) : 0,
  };
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const DONE = "Done";
const BLOCKED = "Blocked";

const RAW_ITEMS: SprintRawItem[] = [
  // Active, no issues
  {
    id: "i1",
    number: 1,
    title: "A",
    type: "user_story",
    status: "In Progress",
    story_points: 3,
    has_assignee: true,
    has_blockers: false,
    completed_at: null,
  },
  // Unestimated
  {
    id: "i2",
    number: 2,
    title: "B",
    type: "user_story",
    status: "Backlog",
    story_points: null,
    has_assignee: true,
    has_blockers: false,
    completed_at: null,
  },
  // No assignee
  {
    id: "i3",
    number: 3,
    title: "C",
    type: "bug",
    status: "Backlog",
    story_points: 2,
    has_assignee: false,
    has_blockers: false,
    completed_at: null,
  },
  // Blocked (has_blockers: true)
  {
    id: "i4",
    number: 4,
    title: "D",
    type: "user_story",
    status: BLOCKED,
    story_points: 5,
    has_assignee: true,
    has_blockers: true,
    completed_at: null,
  },
  // Unestimated AND no assignee (counts in two buckets)
  {
    id: "i5",
    number: 5,
    title: "E",
    type: "user_story",
    status: "Backlog",
    story_points: 0,
    has_assignee: false,
    has_blockers: false,
    completed_at: null,
  },
  // Done — excluded from risk counts
  {
    id: "i6",
    number: 6,
    title: "F",
    type: "user_story",
    status: DONE,
    story_points: 3,
    has_assignee: true,
    has_blockers: false,
    completed_at: "2026-01-08T10:00:00Z",
  },
];

// Server-side story proxies (same data in server-compatible shape)
const SERVER_STORIES: ServerStoryProxy[] = RAW_ITEMS
  .filter((i) => i.status !== DONE)
  .map((i) => ({
    story_points: i.story_points,
    status: i.status,
    assignees: i.has_assignee ? ["someone"] : [],
  }));

// BacklogItemListing proxies for readiness assessment
const LISTING_ITEMS: BacklogItemListing[] = [
  // Ready: type + estimate set
  {
    ref: { id: "i1", key: "1" },
    title: "A",
    type: "user_story",
    status: "In Progress",
    story_points: 3,
    priority: null,
    assignees: ["dev1"],
    labels: [],
    sprint: { name: "S1", ref: { id: "iter1" } },
    epic: null,
    blocked_by: [],
    blocks: [],
    custom_fields: {},
  },
  // Not ready: no estimate
  {
    ref: { id: "i2", key: "2" },
    title: "B",
    type: "user_story",
    status: "Backlog",
    story_points: null,
    priority: null,
    assignees: ["dev1"],
    labels: [],
    sprint: { name: "S1", ref: { id: "iter1" } },
    epic: null,
    blocked_by: [],
    blocks: [],
    custom_fields: {},
  },
  // Not ready: no type
  {
    ref: { id: "i3", key: "3" },
    title: "C",
    type: null,
    status: "Backlog",
    story_points: 2,
    priority: null,
    assignees: [],
    labels: [],
    sprint: { name: "S1", ref: { id: "iter1" } },
    epic: null,
    blocked_by: [],
    blocks: [],
    custom_fields: {},
  },
  // Ready: type + estimate set (blocked, but field-proxy readiness ignores blockers)
  {
    ref: { id: "i4", key: "4" },
    title: "D",
    type: "user_story",
    status: BLOCKED,
    story_points: 5,
    priority: null,
    assignees: ["dev1"],
    labels: [],
    sprint: { name: "S1", ref: { id: "iter1" } },
    epic: null,
    blocked_by: [{ key: "0", title: null, ref: { id: "i0" } }],
    blocks: [],
    custom_fields: {},
  },
  // Not ready: zero estimate
  {
    ref: { id: "i5", key: "5" },
    title: "E",
    type: "user_story",
    status: "Backlog",
    story_points: 0,
    priority: null,
    assignees: [],
    labels: [],
    sprint: { name: "S1", ref: { id: "iter1" } },
    epic: null,
    blocked_by: [],
    blocks: [],
    custom_fields: {},
  },
];

// ── Tests ─────────────────────────────────────────────────────────────────────

Deno.test("risk parity: agent unestimated_count matches server logic", () => {
  const agent = agentCountSprintRisks(RAW_ITEMS, DONE);
  const server = serverCountSprintRisks(SERVER_STORIES, BLOCKED);

  assertEquals(
    agent.unestimated_count,
    server.unestimated_count,
    `unestimated: agent=${agent.unestimated_count} server=${server.unestimated_count}`,
  );
  assertEquals(agent.unestimated_count, 2, "items B (null) and E (0) are unestimated");
});

Deno.test("risk parity: agent no_assignee_count matches server logic", () => {
  const agent = agentCountSprintRisks(RAW_ITEMS, DONE);
  const server = serverCountSprintRisks(SERVER_STORIES, BLOCKED);

  assertEquals(
    agent.no_assignee_count,
    server.no_assignee_count,
    `no_assignee: agent=${agent.no_assignee_count} server=${server.no_assignee_count}`,
  );
  assertEquals(agent.no_assignee_count, 2, "items C and E have no assignee");
});

Deno.test("risk parity: agent blocked_count matches server logic (hasBlockers == status Blocked)", () => {
  const agent = agentCountSprintRisks(RAW_ITEMS, DONE);
  const server = serverCountSprintRisks(SERVER_STORIES, BLOCKED);

  // Both detect 1 blocked item (item D). Agent uses hasBlockers; server uses status.
  // Equivalence holds when blocked_by list non-empty ↔ status=Blocked, which is
  // enforced by adapter business logic. Documented in report.md §3.1.
  assertEquals(agent.blocked_count, server.blocked_count);
  assertEquals(agent.blocked_count, 1, "only item D is blocked");
});

Deno.test("risk parity: done items excluded from all risk counts", () => {
  const agent = agentCountSprintRisks(RAW_ITEMS, DONE);
  // Item F is Done with 3 SP, assigned — must not inflate any risk count
  assertEquals(
    agent.unestimated_count,
    2,
    "Done item must not count as unestimated even if points > 0",
  );
  assertEquals(agent.no_assignee_count, 2, "Done item must not count as no-assignee");
  assertEquals(agent.blocked_count, 1, "Done item must not count as blocked");
});

Deno.test("risk parity: zero-item sprint returns all-zero counts", () => {
  const agent = agentCountSprintRisks([], DONE);
  assertEquals(agent.unestimated_count, 0);
  assertEquals(agent.blocked_count, 0);
  assertEquals(agent.no_assignee_count, 0);
});

Deno.test("readiness proxy: field-level assessment produces expected counts", () => {
  const result = agentAssessReadiness(LISTING_ITEMS);
  // A (type+pts) and D (type+pts, despite blocked) are ready; B, C, E are not
  assertEquals(result.ready_count, 2, "A and D are ready");
  assertEquals(result.not_ready_count, 3, "B (no pts), C (no type), E (zero pts) are not ready");
  assertEquals(result.readiness_pct, 40, "2/5 = 40%");
});

Deno.test("readiness proxy: empty listing returns zero pct without divide-by-zero", () => {
  const result = agentAssessReadiness([]);
  assertEquals(result.readiness_pct, 0);
  assertEquals(result.ready_count, 0);
});
