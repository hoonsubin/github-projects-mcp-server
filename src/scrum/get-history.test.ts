// =============================================================================
// src/scrum/get-history.test.ts — Unit tests for getHistoryUseCase
//
// Tests for: getHistoryUseCase()
// Uses a focused HistoryPort & ImpedimentPort mock — only the three methods
// the use case depends on.
// =============================================================================

import { assert, assertEquals, assertExists } from "jsr:@std/assert@^1.0.0";
import { getHistoryUseCase } from "./get-history.ts";
import type {
  BurndownStoryInput,
  HistoryPort,
  ImpedimentListing,
  ImpedimentPort,
  SprintHistoryEntry,
  SprintInfo,
} from "./ports.ts";
import type { ScrumConfig } from "../domain/config.ts";

// ── Fixture factories ───────────────────────────────────────────────────────────

const makeSprintInfo = (overrides: Partial<SprintInfo> = {}): SprintInfo => ({
  name: "Sprint 5",
  startDate: "2026-01-05",
  durationDays: 10,
  endDate: "2026-01-15",
  ...overrides,
});

const makeStoryInput = (overrides: Partial<BurndownStoryInput> = {}): BurndownStoryInput => ({
  number: 42,
  title: "Test Story",
  points: 5,
  status: "In Progress",
  ...overrides,
});

const makeSprintHistoryEntry = (
  overrides: Partial<SprintHistoryEntry> = {},
): SprintHistoryEntry => ({
  info: makeSprintInfo(),
  stories: [],
  ...overrides,
});

const makeImpedimentListing = (
  overrides: Partial<ImpedimentListing> = {},
): ImpedimentListing => ({
  ref: { id: "PVTI_imp_001" },
  description: "Test impediment",
  status: "open" as const,
  raised_by: "testuser",
  raised_at: "2026-01-06T00:00:00Z",
  resolved_at: null,
  ...overrides,
});

/**
 * Creates a focused mock implementing HistoryPort & ImpedimentPort.
 * Only the three methods the use case depends on — updateImpediment is a stub
 * required by ImpedimentPort but never called by getHistoryUseCase.
 */
const createMockBackend = (
  overrides: Partial<HistoryPort & ImpedimentPort> = {},
): HistoryPort & ImpedimentPort => ({
  getCompletedSprintHistory: (_window) => Promise.resolve([]),
  getSprintImpediments: (_sprint) => Promise.resolve([]),
  updateImpediment: (_ref, _status, _resolutionNotes?) => Promise.resolve(makeImpedimentListing()),
  ...overrides,
});

const createMockConfig = (overrides: Partial<ScrumConfig> = {}): ScrumConfig => ({
  project: { name: "Test Project" },
  scrum: { priority: [], status: {} },
  backends: { github: {} as Record<string, unknown> },
  ...overrides,
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group A — Window Parameter Passthrough
// ═══════════════════════════════════════════════════════════════════════════════

Deno.test({
  name: "getHistoryUseCase - passes window to getCompletedSprintHistory",
  async fn() {
    let receivedWindow: number | null = null;
    const backend = createMockBackend({
      getCompletedSprintHistory: (window) => {
        receivedWindow = window;
        return Promise.resolve([]);
      },
    });
    await getHistoryUseCase(backend, createMockConfig(), 3);
    assertEquals(receivedWindow, 3);
  },
});

Deno.test({
  name: "getHistoryUseCase - window appears in result",
  async fn() {
    const backend = createMockBackend({
      getCompletedSprintHistory: () => Promise.resolve([]),
    });
    const result = await getHistoryUseCase(backend, createMockConfig(), 5);
    assertEquals(result.window, 5);
  },
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group B — Empty History
// ═══════════════════════════════════════════════════════════════════════════════

Deno.test({
  name: "getHistoryUseCase - empty history returns empty sprints and zero average",
  async fn() {
    const backend = createMockBackend({
      getCompletedSprintHistory: () => Promise.resolve([]),
    });
    const result = await getHistoryUseCase(backend, createMockConfig(), 3);
    assertEquals(result.sprints.length, 0);
    assertEquals(result.window, 3);
    assertEquals(result.average_completed_points, 0);
  },
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group C — SprintSnapshot Shape Mapping
// ═══════════════════════════════════════════════════════════════════════════════

Deno.test({
  name: "getHistoryUseCase - sprint geometry fields mapped correctly",
  async fn() {
    const entry = makeSprintHistoryEntry({
      info: makeSprintInfo({
        name: "Sprint 12",
        startDate: "2026-03-02",
        durationDays: 14,
        endDate: "2026-03-16",
      }),
      stories: [
        makeStoryInput({ number: 1, title: "Story A", points: 5, status: "Done" }),
      ],
    });
    const backend = createMockBackend({
      getCompletedSprintHistory: () => Promise.resolve([entry]),
    });
    const result = await getHistoryUseCase(backend, createMockConfig(), 3);
    assertEquals(result.sprints.length, 1);

    const snap = result.sprints[0];
    assertEquals(snap.sprint.name, "Sprint 12");
    assertEquals(snap.sprint.start_date, "2026-03-02");
    assertEquals(snap.sprint.end_date, "2026-03-16");
    assertEquals(snap.sprint.duration_days, 14);
    assertEquals(snap.sprint.days_remaining, 0, "completed sprints always have days_remaining = 0");
    assertEquals(snap.total_count, 1);
  },
});

Deno.test({
  name: "getHistoryUseCase - StoryListing projection has writable=false and priority=null",
  async fn() {
    const entry = makeSprintHistoryEntry({
      info: makeSprintInfo({ name: "Sprint 7" }),
      stories: [
        makeStoryInput({ number: 10, title: "Login Page", points: 8, status: "Done" }),
        makeStoryInput({ number: 11, title: "Signup Page", points: 5, status: "In Progress" }),
      ],
    });
    const backend = createMockBackend({
      getCompletedSprintHistory: () => Promise.resolve([entry]),
    });
    const result = await getHistoryUseCase(backend, createMockConfig(), 3);
    const items = result.sprints[0].items;

    assertEquals(items.length, 2);

    const s1 = items[0];
    assertEquals(s1.title, "Login Page");
    assertEquals(s1.status, "Done");
    assertEquals(s1.story_points, 8);
    assertEquals(s1.priority, null, "BurndownStoryInput does not carry priority");
    assertEquals(s1.writable, false, "history items are read-only");
    assertEquals(s1.sprint, "Sprint 7");
    assertExists(s1.ref.id, "ref.id should be populated");
    assertEquals(s1.ref.key, "10", "ref.key is String(story.number)");

    const s2 = items[1];
    assertEquals(s2.title, "Signup Page");
    assertEquals(s2.status, "In Progress");
    assertEquals(s2.story_points, 5);
    assertEquals(s2.priority, null);
    assertEquals(s2.writable, false);
    assertEquals(s2.sprint, "Sprint 7");
    assertEquals(s2.ref.key, "11");
  },
});

Deno.test({
  name: "getHistoryUseCase - StoryListing ref.id falls back to empty string when ref is absent",
  async fn() {
    const entry = makeSprintHistoryEntry({
      info: makeSprintInfo({ name: "Sprint 8" }),
      stories: [
        // BurndownStoryInput with no ref (history items may lack ref)
        { number: 99, title: "No Ref Story", points: 3, status: "Done" },
      ],
    });
    const backend = createMockBackend({
      getCompletedSprintHistory: () => Promise.resolve([entry]),
    });
    const result = await getHistoryUseCase(backend, createMockConfig(), 3);
    const item = result.sprints[0].items[0];
    assertEquals(item.ref.id, "");
    assertEquals(item.ref.key, "99");
  },
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group D — Totals Computation
// ═══════════════════════════════════════════════════════════════════════════════

Deno.test({
  name: "getHistoryUseCase - committed_points equals sum of all story points",
  async fn() {
    const entry = makeSprintHistoryEntry({
      info: makeSprintInfo({ name: "Sprint 5" }),
      stories: [
        makeStoryInput({ number: 1, points: 3, status: "Done" }),
        makeStoryInput({ number: 2, points: 5, status: "In Progress" }),
        makeStoryInput({ number: 3, points: 8, status: "Todo" }),
      ],
    });
    const backend = createMockBackend({
      getCompletedSprintHistory: () => Promise.resolve([entry]),
    });
    const result = await getHistoryUseCase(backend, createMockConfig(), 3);
    const totals = result.sprints[0].totals;

    if ("committed_points" in totals && "completed_points" in totals) {
      assertEquals(totals.committed_points, 16, "3+5+8 = 16");
      // story_points equals committed_points for history snapshots
      assertEquals(totals.story_points, 16);
      // Only story 1 is "Done" → completed_points = 3
      assertEquals(totals.completed_points, 3);
    } else {
      assert(false, "history totals should have committed_points and completed_points");
    }
  },
});

Deno.test({
  name: "getHistoryUseCase - completed_points only counts terminal-status stories",
  async fn() {
    const entry = makeSprintHistoryEntry({
      info: makeSprintInfo({ name: "Sprint 5" }),
      stories: [
        makeStoryInput({ number: 1, points: 5, status: "Done" }),
        makeStoryInput({ number: 2, points: 3, status: "Done" }),
        makeStoryInput({ number: 3, points: 8, status: "In Progress" }),
        makeStoryInput({ number: 4, points: 2, status: "Todo" }),
      ],
    });
    const backend = createMockBackend({
      getCompletedSprintHistory: () => Promise.resolve([entry]),
    });
    const result = await getHistoryUseCase(backend, createMockConfig(), 3);
    const totals = result.sprints[0].totals;

    if ("committed_points" in totals && "completed_points" in totals) {
      assertEquals(totals.committed_points, 18, "5+3+8+2 = 18");
      assertEquals(totals.completed_points, 8, "only Done stories: 5+3 = 8");
    } else {
      assert(false, "history totals should have committed_points and completed_points");
    }
  },
});

Deno.test({
  name: "getHistoryUseCase - stories with 0 points contribute 0 to both committed and completed",
  async fn() {
    const entry = makeSprintHistoryEntry({
      info: makeSprintInfo({ name: "Sprint 5" }),
      stories: [
        makeStoryInput({ number: 1, points: 0, status: "Done" }),
        makeStoryInput({ number: 2, points: 0, status: "In Progress" }),
        makeStoryInput({ number: 3, points: 5, status: "Done" }),
      ],
    });
    const backend = createMockBackend({
      getCompletedSprintHistory: () => Promise.resolve([entry]),
    });
    const result = await getHistoryUseCase(backend, createMockConfig(), 3);
    const totals = result.sprints[0].totals;

    if ("committed_points" in totals && "completed_points" in totals) {
      assertEquals(totals.committed_points, 5, "0+0+5 = 5");
      assertEquals(totals.completed_points, 5, "only the 5-point Done story");
    } else {
      assert(false, "history totals should have committed_points and completed_points");
    }
  },
});

Deno.test({
  name: "getHistoryUseCase - by_status groups stories correctly",
  async fn() {
    const entry = makeSprintHistoryEntry({
      info: makeSprintInfo({ name: "Sprint 5" }),
      stories: [
        makeStoryInput({ number: 1, points: 3, status: "Done" }),
        makeStoryInput({ number: 2, points: 5, status: "Done" }),
        makeStoryInput({ number: 3, points: 8, status: "In Progress" }),
        makeStoryInput({ number: 4, points: 2, status: "In Progress" }),
        makeStoryInput({ number: 5, points: 1, status: null }),
      ],
    });
    const backend = createMockBackend({
      getCompletedSprintHistory: () => Promise.resolve([entry]),
    });
    const result = await getHistoryUseCase(backend, createMockConfig(), 3);
    const by_status = result.sprints[0].totals.by_status;

    assertEquals(by_status["Done"], 2, "two stories with Done");
    assertEquals(by_status["In Progress"], 2, "two stories with In Progress");
    assertEquals(by_status["(none)"], 1, "null status grouped as (none)");
  },
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group E — Terminal Status Detection
// ═══════════════════════════════════════════════════════════════════════════════

Deno.test({
  name: "getHistoryUseCase - fallback to 'Done' when no terminal key is configured",
  async fn() {
    const entry = makeSprintHistoryEntry({
      info: makeSprintInfo({ name: "Sprint 5" }),
      stories: [
        makeStoryInput({ number: 1, points: 5, status: "Done" }),
        makeStoryInput({ number: 2, points: 3, status: "done" }),
        makeStoryInput({ number: 3, points: 8, status: "DONE" }),
        makeStoryInput({ number: 4, points: 2, status: "In Progress" }),
      ],
    });
    const backend = createMockBackend({
      getCompletedSprintHistory: () => Promise.resolve([entry]),
    });
    // Empty status config — no terminal key → falls back to "Done"
    const config = createMockConfig({ scrum: { priority: [], status: {} } });
    const result = await getHistoryUseCase(backend, config, 3);
    const totals = result.sprints[0].totals;

    if ("completed_points" in totals) {
      assertEquals(totals.completed_points, 16, "5+3+8 = 16 (case-insensitive 'done' check)");
    } else {
      assert(false, "history totals should have completed_points");
    }
  },
});

Deno.test({
  name: "getHistoryUseCase - config-driven terminal status detection",
  async fn() {
    const entry = makeSprintHistoryEntry({
      info: makeSprintInfo({ name: "Sprint 5" }),
      stories: [
        makeStoryInput({ number: 1, points: 5, status: "Closed" }),
        makeStoryInput({ number: 2, points: 3, status: "Done" }),
        makeStoryInput({ number: 3, points: 8, status: "In Progress" }),
      ],
    });
    const backend = createMockBackend({
      getCompletedSprintHistory: () => Promise.resolve([entry]),
    });
    // Config declares "closed" as the terminal status, mapped to "Closed" display
    const config = createMockConfig({
      scrum: {
        priority: [],
        status: {
          closed: { terminal: true, blocking: false },
          in_progress: { terminal: false, blocking: false },
        },
      },
      backends: {
        github: {
          status_display: { closed: "Closed", in_progress: "In Progress" },
        } as Record<string, unknown>,
      },
    });
    const result = await getHistoryUseCase(backend, config, 3);
    const totals = result.sprints[0].totals;

    if ("completed_points" in totals) {
      // Only "Closed" is terminal — story 1 has 5 points
      assertEquals(totals.completed_points, 5, "only 'Closed' counts as completed");
      assertEquals(totals.committed_points, 16, "5+3+8 = 16");
    } else {
      assert(false, "history totals should have completed_points");
    }
  },
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group F — Impediment Fetching
// ═══════════════════════════════════════════════════════════════════════════════

Deno.test({
  name: "getHistoryUseCase - getSprintImpediments is called with correct SprintName",
  async fn() {
    let receivedSprint: string | null = null;
    const imp = makeImpedimentListing({ description: "Blocker on CI" });
    const entry = makeSprintHistoryEntry({
      info: makeSprintInfo({ name: "Sprint 9" }),
      stories: [
        makeStoryInput({ number: 1, points: 3, status: "Done" }),
      ],
    });
    const backend = createMockBackend({
      getCompletedSprintHistory: () => Promise.resolve([entry]),
      getSprintImpediments: (sprint) => {
        receivedSprint = sprint as string;
        return Promise.resolve([imp]);
      },
    });
    await getHistoryUseCase(backend, createMockConfig(), 3);
    assertEquals(receivedSprint, "Sprint 9", "toSprintName should produce the sprint name");
  },
});

Deno.test({
  name: "getHistoryUseCase - impediments appear in snapshot",
  async fn() {
    const imp1 = makeImpedimentListing({
      ref: { id: "PVTI_imp_1" },
      description: "CI pipeline down",
      status: "open",
    });
    const imp2 = makeImpedimentListing({
      ref: { id: "PVTI_imp_2" },
      description: "Missing API key",
      status: "in_progress",
    });
    const entry = makeSprintHistoryEntry({
      info: makeSprintInfo({ name: "Sprint 10" }),
      stories: [
        makeStoryInput({ number: 1, points: 5, status: "Done" }),
      ],
    });
    const backend = createMockBackend({
      getCompletedSprintHistory: () => Promise.resolve([entry]),
      getSprintImpediments: () => Promise.resolve([imp1, imp2]),
    });
    const result = await getHistoryUseCase(backend, createMockConfig(), 3);
    const impediments = result.sprints[0].impediments;

    assertEquals(impediments.length, 2);
    assertEquals(impediments[0].ref.id, "PVTI_imp_1");
    assertEquals(impediments[0].description, "CI pipeline down");
    assertEquals(impediments[0].status, "open");
    assertEquals(impediments[1].ref.id, "PVTI_imp_2");
    assertEquals(impediments[1].description, "Missing API key");
    assertEquals(impediments[1].status, "in_progress");
  },
});

Deno.test({
  name: "getHistoryUseCase - empty impediments list when no blockers",
  async fn() {
    const entry = makeSprintHistoryEntry({
      info: makeSprintInfo({ name: "Sprint 11" }),
      stories: [
        makeStoryInput({ number: 1, points: 5, status: "Done" }),
      ],
    });
    const backend = createMockBackend({
      getCompletedSprintHistory: () => Promise.resolve([entry]),
      getSprintImpediments: () => Promise.resolve([]),
    });
    const result = await getHistoryUseCase(backend, createMockConfig(), 3);
    assertEquals(result.sprints[0].impediments.length, 0);
  },
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group G — Average Completed Points
// ═══════════════════════════════════════════════════════════════════════════════

Deno.test({
  name: "getHistoryUseCase - single sprint average equals its completed_points",
  async fn() {
    const entry = makeSprintHistoryEntry({
      info: makeSprintInfo({ name: "Sprint 5" }),
      stories: [
        makeStoryInput({ number: 1, points: 5, status: "Done" }),
        makeStoryInput({ number: 2, points: 3, status: "Done" }),
        makeStoryInput({ number: 3, points: 8, status: "In Progress" }),
      ],
    });
    const backend = createMockBackend({
      getCompletedSprintHistory: () => Promise.resolve([entry]),
    });
    const result = await getHistoryUseCase(backend, createMockConfig(), 3);
    // completed_points = 5+3 = 8, committed_points = 5+3+8 = 16
    // average = 8 / 1 = 8
    assertEquals(result.average_completed_points, 8);
  },
});

Deno.test({
  name: "getHistoryUseCase - multiple sprints average is mean of completed_points",
  async fn() {
    const entry1 = makeSprintHistoryEntry({
      info: makeSprintInfo({ name: "Sprint 1" }),
      stories: [
        makeStoryInput({ number: 1, points: 5, status: "Done" }),
        makeStoryInput({ number: 2, points: 3, status: "Done" }),
        makeStoryInput({ number: 3, points: 2, status: "In Progress" }),
      ],
    });
    const entry2 = makeSprintHistoryEntry({
      info: makeSprintInfo({ name: "Sprint 2" }),
      stories: [
        makeStoryInput({ number: 4, points: 8, status: "Done" }),
        makeStoryInput({ number: 5, points: 5, status: "Done" }),
        makeStoryInput({ number: 6, points: 7, status: "Todo" }),
      ],
    });
    const entry3 = makeSprintHistoryEntry({
      info: makeSprintInfo({ name: "Sprint 3" }),
      stories: [
        makeStoryInput({ number: 7, points: 3, status: "Done" }),
        makeStoryInput({ number: 8, points: 1, status: "Done" }),
        makeStoryInput({ number: 9, points: 0, status: "Done" }),
      ],
    });
    const backend = createMockBackend({
      getCompletedSprintHistory: () => Promise.resolve([entry1, entry2, entry3]),
    });
    const result = await getHistoryUseCase(backend, createMockConfig(), 5);
    // Sprint 1 completed: 5+3 = 8
    // Sprint 2 completed: 8+5 = 13
    // Sprint 3 completed: 3+1+0 = 4
    // average = (8+13+4)/3 = 25/3 = 8.3333... → Math.round(8.3333 * 100) / 100 = 8.33
    assertEquals(result.average_completed_points, 8.33);
  },
});

Deno.test({
  name: "getHistoryUseCase - zero completed points across all sprints returns 0 average",
  async fn() {
    const entry1 = makeSprintHistoryEntry({
      info: makeSprintInfo({ name: "Sprint 1" }),
      stories: [
        makeStoryInput({ number: 1, points: 5, status: "In Progress" }),
        makeStoryInput({ number: 2, points: 3, status: "Todo" }),
      ],
    });
    const entry2 = makeSprintHistoryEntry({
      info: makeSprintInfo({ name: "Sprint 2" }),
      stories: [
        makeStoryInput({ number: 3, points: 8, status: "In Progress" }),
      ],
    });
    const backend = createMockBackend({
      getCompletedSprintHistory: () => Promise.resolve([entry1, entry2]),
    });
    const result = await getHistoryUseCase(backend, createMockConfig(), 5);
    assertEquals(result.average_completed_points, 0);
  },
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group H — Multiple Sprint Entries
// ═══════════════════════════════════════════════════════════════════════════════

Deno.test({
  name: "getHistoryUseCase - all entries are processed in order",
  async fn() {
    const entry1 = makeSprintHistoryEntry({
      info: makeSprintInfo({ name: "Sprint 1", startDate: "2026-01-05", endDate: "2026-01-15" }),
      stories: [
        makeStoryInput({ number: 1, points: 5, status: "Done" }),
      ],
    });
    const entry2 = makeSprintHistoryEntry({
      info: makeSprintInfo({ name: "Sprint 2", startDate: "2026-01-19", endDate: "2026-01-29" }),
      stories: [
        makeStoryInput({ number: 2, points: 8, status: "Done" }),
      ],
    });
    const entry3 = makeSprintHistoryEntry({
      info: makeSprintInfo({ name: "Sprint 3", startDate: "2026-02-02", endDate: "2026-02-12" }),
      stories: [
        makeStoryInput({ number: 3, points: 3, status: "Done" }),
      ],
    });
    const backend = createMockBackend({
      getCompletedSprintHistory: () => Promise.resolve([entry1, entry2, entry3]),
    });
    const result = await getHistoryUseCase(backend, createMockConfig(), 5);

    assertEquals(result.sprints.length, 3);
    assertEquals(result.sprints[0].sprint.name, "Sprint 1");
    assertEquals(result.sprints[1].sprint.name, "Sprint 2");
    assertEquals(result.sprints[2].sprint.name, "Sprint 3");

    assertEquals(result.sprints[0].total_count, 1);
    assertEquals(result.sprints[1].total_count, 1);
    assertEquals(result.sprints[2].total_count, 1);

    // average = (5+8+3)/3 = 16/3 = 5.33
    assertEquals(result.average_completed_points, 5.33);
  },
});

Deno.test({
  name: "getHistoryUseCase - window in result matches input across multiple sprints",
  async fn() {
    const entry = makeSprintHistoryEntry({
      info: makeSprintInfo({ name: "Sprint 5" }),
      stories: [makeStoryInput({ number: 1, points: 5, status: "Done" })],
    });
    const backend = createMockBackend({
      getCompletedSprintHistory: () => Promise.resolve([entry]),
    });
    const result = await getHistoryUseCase(backend, createMockConfig(), 7);
    assertEquals(result.window, 7);
    assertEquals(result.sprints.length, 1);
  },
});
