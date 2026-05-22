// =============================================================================
// src/scrum/get-sprint.test.ts — Unit tests for getSprintUseCase
//
// Tests for: getSprintUseCase()
// Uses a focused mock implementing SprintPort & ImpedimentPort & HistoryPort.
// =============================================================================

import { assert, assertEquals, assertExists } from "jsr:@std/assert@^1.0.0";
import { getSprintUseCase } from "./get-sprint.ts";
import type {
  BurndownStoryInput,
  HistoryPort,
  ImpedimentListing,
  ImpedimentPort,
  SprintHistoryEntry,
  SprintInfo,
  SprintPort,
  SprintSnapshot,
} from "./ports.ts";
import type { DependencyEntry, DraftStory, IssueStory, SprintRef } from "../domain/types.ts";
import { toSprintName } from "../domain/types.ts";
import { SprintNotScheduledError } from "../domain/errors.ts";

// ── Fixture factories ───────────────────────────────────────────────────────────

const makeSprintInfo = (overrides: Partial<SprintInfo> = {}): SprintInfo => ({
  name: "Sprint 5",
  startDate: "2026-01-05",
  durationDays: 10,
  endDate: "2026-01-15",
  ...overrides,
});

const makeDependencyEntry = (overrides: Partial<DependencyEntry> = {}): DependencyEntry => ({
  key: "17",
  title: "Dependent Story",
  ref: { id: "PVTI_123" },
  ...overrides,
});

const makeIssueStory = (overrides: Partial<IssueStory> = {}): IssueStory => ({
  kind: "issue",
  ref: { id: "PVTI_001" },
  key: "42",
  url: "https://github.com/owner/repo/issues/42",
  title: "Test Story",
  body: "Story body",
  type: "feature",
  status: "In Progress",
  sprint: "Sprint 5",
  story_points: 5,
  priority: "Must",
  assignees: [],
  labels: [],
  created_at: "2026-01-06T00:00:00Z",
  updated_at: "2026-01-06T00:00:00Z",
  blocked_by: [],
  epic: null,
  ...overrides,
});

const makeDraftStory = (overrides: Partial<DraftStory> = {}): DraftStory => ({
  kind: "draft",
  ref: { id: "PVTI_draft" },
  key: null,
  url: null,
  title: "Draft Story",
  body: "Draft body",
  type: null,
  status: null,
  sprint: "Sprint 5",
  story_points: null,
  priority: null,
  assignees: [],
  labels: [],
  created_at: "2026-01-06T00:00:00Z",
  updated_at: "2026-01-06T00:00:00Z",
  blocked_by: [],
  epic: null,
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

const makeImpedimentListing = (overrides: Partial<ImpedimentListing> = {}): ImpedimentListing => ({
  ref: { id: "IMP_001" },
  description: "Blocked by external API outage",
  status: "open",
  raised_by: "test-user",
  raised_at: "2026-01-07T00:00:00Z",
  resolved_at: null,
  ...overrides,
});

// ── Type-narrowing helpers ──────────────────────────────────────────────────────

/** Narrow the return type for single-sprint assertions (throws if "all" result). */
const assertIsSingleResult = (
  result: { sprint: SprintSnapshot } | { sprints: SprintSnapshot[]; total_count: number },
): SprintSnapshot => {
  assert("sprint" in result, "Expected single sprint result, got 'all' result");
  return (result as { sprint: SprintSnapshot }).sprint;
};

/** Narrow the return type for "all" assertions (throws if single result). */
const assertIsAllResult = (
  result: { sprint: SprintSnapshot } | { sprints: SprintSnapshot[]; total_count: number },
): SprintSnapshot[] => {
  assert("sprints" in result, "Expected 'all' result, got single sprint result");
  return (result as { sprints: SprintSnapshot[]; total_count: number }).sprints;
};

// ── Mock backend ────────────────────────────────────────────────────────────────

type BackendOverrides = Partial<SprintPort & ImpedimentPort & HistoryPort>;

/**
 * Creates a focused mock implementing SprintPort, ImpedimentPort, and HistoryPort.
 * Follows the focused-port pattern from get-burndown.test.ts and get-history.test.ts.
 */
const createMockBackend = (
  overrides: BackendOverrides = {},
): SprintPort & ImpedimentPort & HistoryPort => ({
  getSprintStories: (_sprint: SprintRef) =>
    Promise.resolve({
      stories: [makeIssueStory()],
      sprintInfo: makeSprintInfo(),
    }),
  getSprintImpediments: (_sprint: SprintRef) => Promise.resolve([]),
  getCompletedSprintHistory: (_window: number) => Promise.resolve([makeSprintHistoryEntry()]),
  updateImpediment: () => Promise.resolve(makeImpedimentListing({ status: "resolved" })),
  ...overrides,
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group A — Single Sprint Ref Passthrough
// ═══════════════════════════════════════════════════════════════════════════════

Deno.test({
  name: '[A1] passes "current" to getSprintStories',
  async fn() {
    let receivedSprint: SprintRef | null = null;
    const backend = createMockBackend({
      getSprintStories: (sprint) => {
        receivedSprint = sprint;
        return Promise.resolve({
          stories: [makeIssueStory()],
          sprintInfo: makeSprintInfo(),
        });
      },
    });
    await getSprintUseCase(backend, "current");
    assertEquals(receivedSprint, "current");
  },
});

Deno.test({
  name: '[A2] passes "next" to getSprintStories',
  async fn() {
    let receivedSprint: SprintRef | null = null;
    const backend = createMockBackend({
      getSprintStories: (sprint) => {
        receivedSprint = sprint;
        return Promise.resolve({
          stories: [makeIssueStory()],
          sprintInfo: makeSprintInfo(),
        });
      },
    });
    await getSprintUseCase(backend, "next");
    assertEquals(receivedSprint, "next");
  },
});

Deno.test({
  name: "[A3] passes explicit SprintName to getSprintStories",
  async fn() {
    const sprintName = toSprintName("Sprint 5");
    let receivedSprint: SprintRef | null = null;
    const backend = createMockBackend({
      getSprintStories: (sprint) => {
        receivedSprint = sprint;
        return Promise.resolve({
          stories: [makeIssueStory()],
          sprintInfo: makeSprintInfo(),
        });
      },
    });
    await getSprintUseCase(backend, sprintName);
    assertEquals(receivedSprint, "Sprint 5");
  },
});

Deno.test({
  name: '[A4] null sprintRef returns "(no sprint)" and never calls getSprintStories',
  async fn() {
    let called = false;
    const backend = createMockBackend({
      getSprintStories: () => {
        called = true;
        return Promise.resolve({
          stories: [],
          sprintInfo: makeSprintInfo(),
        });
      },
    });
    const result = await getSprintUseCase(backend, null);
    const snapshot = assertIsSingleResult(result);
    assertEquals(snapshot.sprint.name, "(no sprint)");
    assertEquals(snapshot.items, []);
    assertEquals(snapshot.total_count, 0);
    assertEquals(snapshot.totals.story_points, 0);
    assert(!called, "getSprintStories must not be called for null sprintRef");
  },
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group B — Single Sprint Result Shape
// ═══════════════════════════════════════════════════════════════════════════════

Deno.test({
  name: "[B1] return type is { sprint: SprintSnapshot }",
  async fn() {
    const backend = createMockBackend();
    const result = await getSprintUseCase(backend, "current");
    assertIsSingleResult(result);
    assert("sprint" in result, "result must have .sprint key");
    assert(!("sprints" in result), "result must NOT have .sprints key for single ref");
  },
});

Deno.test({
  name: "[B2] sprint metadata fields mapped from SprintInfo",
  async fn() {
    const backend = createMockBackend({
      getSprintStories: () =>
        Promise.resolve({
          stories: [],
          sprintInfo: makeSprintInfo({
            name: "Sprint 12",
            startDate: "2026-03-02",
            durationDays: 14,
            endDate: "2026-03-16",
          }),
        }),
    });
    const result = await getSprintUseCase(backend, "current");
    const snapshot = assertIsSingleResult(result);
    assertEquals(snapshot.sprint.name, "Sprint 12");
    assertEquals(snapshot.sprint.start_date, "2026-03-02");
    assertEquals(snapshot.sprint.end_date, "2026-03-16");
    assertEquals(snapshot.sprint.duration_days, 14);
  },
});

Deno.test({
  name: "[B3] days_remaining computed via buildSprintMeta",
  async fn() {
    const backend = createMockBackend();
    const result = await getSprintUseCase(backend, "current");
    const snapshot = assertIsSingleResult(result);
    assert(
      typeof snapshot.sprint.days_remaining === "number" && snapshot.sprint.days_remaining >= 0,
      `days_remaining must be a non-negative number, got ${snapshot.sprint.days_remaining}`,
    );
  },
});

Deno.test({
  name: "[B4] items are StoryListing[] projections",
  async fn() {
    const backend = createMockBackend({
      getSprintStories: () =>
        Promise.resolve({
          stories: [
            makeIssueStory({
              ref: { id: "PVTI_001" },
              key: "42",
              title: "Login",
              status: "In Progress",
              story_points: 5,
              priority: "Must",
            }),
          ],
          sprintInfo: makeSprintInfo(),
        }),
    });
    const result = await getSprintUseCase(backend, "current");
    const snapshot = assertIsSingleResult(result);
    assertEquals(snapshot.items.length, 1);
    const item = snapshot.items[0];
    assertEquals(item.ref.id, "PVTI_001");
    assertEquals(item.ref.key, "42");
    assertEquals(item.title, "Login");
    assertEquals(item.status, "In Progress");
    assertEquals(item.story_points, 5);
    assertEquals(item.priority, "Must");
    assertEquals(item.writable, true);
  },
});

Deno.test({
  name: "[B5] total_count equals items.length",
  async fn() {
    const backend = createMockBackend({
      getSprintStories: () =>
        Promise.resolve({
          stories: [
            makeIssueStory(),
            makeIssueStory({ ref: { id: "PVTI_002" }, key: "43" }),
            makeIssueStory({ ref: { id: "PVTI_003" }, key: "44" }),
          ],
          sprintInfo: makeSprintInfo(),
        }),
    });
    const result = await getSprintUseCase(backend, "current");
    const snapshot = assertIsSingleResult(result);
    assertEquals(snapshot.total_count, 3);
    assertEquals(snapshot.total_count, snapshot.items.length);
  },
});

Deno.test({
  name: "[B6] totals.story_points sums across all items",
  async fn() {
    const backend = createMockBackend({
      getSprintStories: () =>
        Promise.resolve({
          stories: [
            makeIssueStory({ ref: { id: "PVTI_001" }, key: "1", story_points: 3 }),
            makeIssueStory({ ref: { id: "PVTI_002" }, key: "2", story_points: 5 }),
            makeIssueStory({ ref: { id: "PVTI_003" }, key: "3", story_points: 8 }),
          ],
          sprintInfo: makeSprintInfo(),
        }),
    });
    const result = await getSprintUseCase(backend, "current");
    const snapshot = assertIsSingleResult(result);
    assertEquals(snapshot.totals.story_points, 16);
  },
});

Deno.test({
  name: "[B7] totals.by_status groups correctly",
  async fn() {
    const backend = createMockBackend({
      getSprintStories: () =>
        Promise.resolve({
          stories: [
            makeIssueStory({ ref: { id: "PVTI_001" }, key: "1", status: "In Progress" }),
            makeIssueStory({ ref: { id: "PVTI_002" }, key: "2", status: "In Progress" }),
            makeIssueStory({ ref: { id: "PVTI_003" }, key: "3", status: "Done" }),
          ],
          sprintInfo: makeSprintInfo(),
        }),
    });
    const result = await getSprintUseCase(backend, "current");
    const snapshot = assertIsSingleResult(result);
    assertEquals(snapshot.totals.by_status["In Progress"], 2);
    assertEquals(snapshot.totals.by_status["Done"], 1);
  },
});

Deno.test({
  name: "[B8] impediments populated from getSprintImpediments",
  async fn() {
    const impediments = [
      makeImpedimentListing({ ref: { id: "IMP_001" }, description: "Blocker A" }),
      makeImpedimentListing({ ref: { id: "IMP_002" }, description: "Blocker B" }),
    ];
    const backend = createMockBackend({
      getSprintImpediments: () => Promise.resolve(impediments),
    });
    const result = await getSprintUseCase(backend, "current");
    const snapshot = assertIsSingleResult(result);
    assertEquals(snapshot.impediments.length, 2);
    assertEquals(snapshot.impediments[0].description, "Blocker A");
    assertEquals(snapshot.impediments[1].description, "Blocker B");
  },
});

Deno.test({
  name: "[B9] empty impediments when none exist",
  async fn() {
    const backend = createMockBackend({
      getSprintImpediments: () => Promise.resolve([]),
    });
    const result = await getSprintUseCase(backend, "current");
    const snapshot = assertIsSingleResult(result);
    assertEquals(snapshot.impediments, []);
  },
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group C — StoryListing Projection (storyToListing)
// ═══════════════════════════════════════════════════════════════════════════════

Deno.test({
  name: "[C1] writable is true for active sprint items",
  async fn() {
    const backend = createMockBackend({
      getSprintStories: () =>
        Promise.resolve({
          stories: [makeIssueStory()],
          sprintInfo: makeSprintInfo(),
        }),
    });
    const result = await getSprintUseCase(backend, "current");
    const snapshot = assertIsSingleResult(result);
    assertEquals(snapshot.items[0].writable, true);
  },
});

Deno.test({
  name: "[C2] has_dependencies is true when blocked_by is non-empty",
  async fn() {
    const backend = createMockBackend({
      getSprintStories: () =>
        Promise.resolve({
          stories: [makeIssueStory({ blocked_by: [makeDependencyEntry()] })],
          sprintInfo: makeSprintInfo(),
        }),
    });
    const result = await getSprintUseCase(backend, "current");
    const snapshot = assertIsSingleResult(result);
    assertEquals(snapshot.items[0].has_dependencies.length > 0, true);
  },
});

Deno.test({
  name: "[C3] has_dependencies is false when blocked_by is empty",
  async fn() {
    const backend = createMockBackend({
      getSprintStories: () =>
        Promise.resolve({
          stories: [makeIssueStory({ blocked_by: [] })],
          sprintInfo: makeSprintInfo(),
        }),
    });
    const result = await getSprintUseCase(backend, "current");
    const snapshot = assertIsSingleResult(result);
    assertEquals(snapshot.items[0].has_dependencies.length > 0, false);
  },
});

Deno.test({
  name: "[C5] DraftStory projects correctly (no .key or .url)",
  async fn() {
    const backend = createMockBackend({
      getSprintStories: () =>
        Promise.resolve({
          stories: [makeDraftStory()],
          sprintInfo: makeSprintInfo(),
        }),
    });
    const result = await getSprintUseCase(backend, "current");
    const snapshot = assertIsSingleResult(result);
    assertEquals(snapshot.items[0].ref.key, null);
  },
});

Deno.test({
  name: "[C6] IssueStory projects correctly (has .key)",
  async fn() {
    const backend = createMockBackend({
      getSprintStories: () =>
        Promise.resolve({
          stories: [makeIssueStory({ ref: { id: "PVTI_001" }, key: "42" })],
          sprintInfo: makeSprintInfo(),
        }),
    });
    const result = await getSprintUseCase(backend, "current");
    const snapshot = assertIsSingleResult(result);
    assertEquals(snapshot.items[0].ref.key, "42");
  },
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group D — "all" Branch Result Shape
// ═══════════════════════════════════════════════════════════════════════════════

Deno.test({
  name: "[D1] result type is { sprints: SprintSnapshot[], total_count: number }",
  async fn() {
    const backend = createMockBackend({
      getCompletedSprintHistory: () => Promise.resolve([]),
    });
    const result = await getSprintUseCase(backend, "all");
    assert("sprints" in result, "result must have .sprints array");
    assert(
      Array.isArray((result as { sprints: unknown[] }).sprints),
      ".sprints must be an array",
    );
    assertEquals(typeof (result as { total_count: number }).total_count, "number");
    assert(!("sprint" in result), "result must NOT have .sprint key for 'all'");
  },
});

Deno.test({
  name: "[D2] current + next + history all present",
  async fn() {
    const backend = createMockBackend({
      getCompletedSprintHistory: () =>
        Promise.resolve([
          makeSprintHistoryEntry({ info: makeSprintInfo({ name: "Sprint 4" }) }),
        ]),
    });
    const result = await getSprintUseCase(backend, "all");
    const sprints = assertIsAllResult(result);
    assertEquals(sprints.length, 3, "current + next + 1 completed");
  },
});

Deno.test({
  name: "[D3] current appears before history entries",
  async fn() {
    const backend = createMockBackend({
      getSprintStories: (sprint) =>
        Promise.resolve({
          stories: [],
          sprintInfo: sprint === "current"
            ? makeSprintInfo({ name: "Active Sprint" })
            : makeSprintInfo({ name: "Next Sprint" }),
        }),
      getCompletedSprintHistory: () =>
        Promise.resolve([
          makeSprintHistoryEntry({ info: makeSprintInfo({ name: "Completed Sprint" }) }),
        ]),
    });
    const result = await getSprintUseCase(backend, "all");
    const sprints = assertIsAllResult(result);
    assertEquals(sprints[0].sprint.name, "Active Sprint");
  },
});

Deno.test({
  name: "[D4] total_count equals sprints.length",
  async fn() {
    const backend = createMockBackend({
      getCompletedSprintHistory: () =>
        Promise.resolve([
          makeSprintHistoryEntry({ info: makeSprintInfo({ name: "Sprint 4" }) }),
        ]),
    });
    const result = await getSprintUseCase(backend, "all");
    assertEquals(
      (result as { total_count: number }).total_count,
      3,
    );
  },
});

Deno.test({
  name: "[D5] limit passed to getCompletedSprintHistory",
  async fn() {
    let receivedWindow: number | null = null;
    const backend = createMockBackend({
      getCompletedSprintHistory: (window) => {
        receivedWindow = window;
        return Promise.resolve([]);
      },
    });
    await getSprintUseCase(backend, "all", 7);
    assertEquals(receivedWindow, 7);
  },
});

Deno.test({
  name: "[D6] completed sprint has days_remaining: 0",
  async fn() {
    const backend = createMockBackend({
      getCompletedSprintHistory: () =>
        Promise.resolve([
          makeSprintHistoryEntry({ info: makeSprintInfo({ name: "Sprint 4" }) }),
        ]),
    });
    const result = await getSprintUseCase(backend, "all");
    const sprints = assertIsAllResult(result);
    const completedSprint = sprints.find((s) => s.sprint.name === "Sprint 4");
    assertExists(completedSprint, "Completed sprint must exist");
    assertEquals(completedSprint.sprint.days_remaining, 0);
  },
});

Deno.test({
  name: "[D7] completed sprint StoryListing has writable: false",
  async fn() {
    const backend = createMockBackend({
      getCompletedSprintHistory: () =>
        Promise.resolve([
          makeSprintHistoryEntry({
            info: makeSprintInfo({ name: "Sprint 4" }),
            stories: [makeStoryInput({ number: 1, points: 5, status: "Done" })],
          }),
        ]),
    });
    const result = await getSprintUseCase(backend, "all");
    const sprints = assertIsAllResult(result);
    const completedSprint = sprints.find((s) => s.sprint.name === "Sprint 4");
    assertExists(completedSprint);
    assertEquals(completedSprint.items[0].writable, false);
  },
});

Deno.test({
  name: "[D8] completed sprint StoryListing has sprint set to entry name",
  async fn() {
    const backend = createMockBackend({
      getCompletedSprintHistory: () =>
        Promise.resolve([
          makeSprintHistoryEntry({
            info: makeSprintInfo({ name: "Sprint 4" }),
            stories: [makeStoryInput({ number: 1, points: 5, status: "Done" })],
          }),
        ]),
    });
    const result = await getSprintUseCase(backend, "all");
    const sprints = assertIsAllResult(result);
    const completedSprint = sprints.find((s) => s.sprint.name === "Sprint 4");
    assertExists(completedSprint);
    assertEquals(completedSprint.items[0].sprint, "Sprint 4");
  },
});

Deno.test({
  name: "[D9] impediments fetched for completed sprint",
  async fn() {
    let receivedSprint: string | null = null;
    const backend = createMockBackend({
      getCompletedSprintHistory: () =>
        Promise.resolve([
          makeSprintHistoryEntry({ info: makeSprintInfo({ name: "Sprint X" }) }),
        ]),
      getSprintImpediments: (sprint) => {
        receivedSprint = sprint as string;
        return Promise.resolve([]);
      },
    });
    await getSprintUseCase(backend, "all");
    assertEquals(receivedSprint, "Sprint X");
  },
});

Deno.test({
  name: '[D10] ref.id === "<history>" on history StoryListing items',
  async fn() {
    const backend = createMockBackend({
      getCompletedSprintHistory: () =>
        Promise.resolve([
          makeSprintHistoryEntry({
            info: makeSprintInfo({ name: "Sprint 4" }),
            stories: [makeStoryInput({ number: 5, points: 3, status: "Done" })],
          }),
        ]),
    });
    const result = await getSprintUseCase(backend, "all");
    const sprints = assertIsAllResult(result);
    const completedSprint = sprints.find((s) => s.sprint.name === "Sprint 4");
    assertExists(completedSprint);
    assertEquals(completedSprint.items[0].ref.id, "<history>");
  },
});

Deno.test({
  name: "[D11] ref.key === String(story.number) on history items",
  async fn() {
    const backend = createMockBackend({
      getCompletedSprintHistory: () =>
        Promise.resolve([
          makeSprintHistoryEntry({
            info: makeSprintInfo({ name: "Sprint 4" }),
            stories: [makeStoryInput({ number: 42, points: 5, status: "Done" })],
          }),
        ]),
    });
    const result = await getSprintUseCase(backend, "all");
    const sprints = assertIsAllResult(result);
    const completedSprint = sprints.find((s) => s.sprint.name === "Sprint 4");
    assertExists(completedSprint);
    assertEquals(completedSprint.items[0].ref.key, "42");
  },
});

Deno.test({
  name: "[D12] priority is null on history items",
  async fn() {
    const backend = createMockBackend({
      getCompletedSprintHistory: () =>
        Promise.resolve([
          makeSprintHistoryEntry({
            info: makeSprintInfo({ name: "Sprint 4" }),
            stories: [makeStoryInput({ number: 1, points: 5, status: "Done" })],
          }),
        ]),
    });
    const result = await getSprintUseCase(backend, "all");
    const sprints = assertIsAllResult(result);
    const completedSprint = sprints.find((s) => s.sprint.name === "Sprint 4");
    assertExists(completedSprint);
    assertEquals(completedSprint.items[0].priority, null);
  },
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group E — "all" Branch: Current/Next Absent (SprintNotScheduledError)
// ═══════════════════════════════════════════════════════════════════════════════

Deno.test({
  name: "[E1] current throws SprintNotScheduledError → excluded, next + history only",
  async fn() {
    const backend = createMockBackend({
      getSprintStories: (sprint) => {
        if (sprint === "current") {
          throw new SprintNotScheduledError("current", "No current sprint");
        }
        return Promise.resolve({
          stories: [],
          sprintInfo: makeSprintInfo({ name: "Next Sprint" }),
        });
      },
      getCompletedSprintHistory: () =>
        Promise.resolve([
          makeSprintHistoryEntry({ info: makeSprintInfo({ name: "Sprint 4" }) }),
        ]),
    });
    const result = await getSprintUseCase(backend, "all");
    const sprints = assertIsAllResult(result);
    assertEquals(sprints.length, 2);
  },
});

Deno.test({
  name: "[E2] next throws SprintNotScheduledError → excluded, current + history only",
  async fn() {
    const backend = createMockBackend({
      getSprintStories: (sprint) => {
        if (sprint === "next") {
          throw new SprintNotScheduledError("next", "No next sprint");
        }
        return Promise.resolve({
          stories: [],
          sprintInfo: makeSprintInfo({ name: "Active Sprint" }),
        });
      },
      getCompletedSprintHistory: () =>
        Promise.resolve([
          makeSprintHistoryEntry({ info: makeSprintInfo({ name: "Sprint 4" }) }),
        ]),
    });
    const result = await getSprintUseCase(backend, "all");
    const sprints = assertIsAllResult(result);
    assertEquals(sprints.length, 2);
  },
});

Deno.test({
  name: "[E3] both current and next throw → history only",
  async fn() {
    const backend = createMockBackend({
      getSprintStories: (sprint: SprintRef) => {
        throw new SprintNotScheduledError(
          sprint === "current" ? "current" : "next",
          `No ${sprint} sprint`,
        );
      },
      getCompletedSprintHistory: () =>
        Promise.resolve([
          makeSprintHistoryEntry({ info: makeSprintInfo({ name: "Sprint 4" }) }),
        ]),
    });
    const result = await getSprintUseCase(backend, "all");
    const sprints = assertIsAllResult(result);
    assertEquals(sprints.length, 1);
    assertEquals(sprints[0].sprint.name, "Sprint 4");
  },
});

Deno.test({
  name: '[E4] SprintNotScheduledError from getSprintStories("current") caught, not propagated',
  async fn() {
    const backend = createMockBackend({
      getSprintStories: (sprint) => {
        if (sprint === "current") {
          throw new SprintNotScheduledError("current", "No current sprint");
        }
        return Promise.resolve({
          stories: [],
          sprintInfo: makeSprintInfo({ name: "Next Sprint" }),
        });
      },
      getCompletedSprintHistory: () => Promise.resolve([]),
    });
    // Should not throw
    const result = await getSprintUseCase(backend, "all");
    const sprints = assertIsAllResult(result);
    assertEquals(sprints.length, 1);
  },
});

Deno.test({
  name: "[E5] non-SprintNotScheduledError re-thrown",
  async fn() {
    const authError = new Error("Authentication failed");
    const backend = createMockBackend({
      getSprintStories: () => {
        throw authError;
      },
    });
    try {
      await getSprintUseCase(backend, "all");
      assert(false, "Should have thrown");
    } catch (err) {
      assertEquals(err, authError);
    }
  },
});

Deno.test({
  name: "[E6] total_count reflects actual snapshot count after absent sprints",
  async fn() {
    const backend = createMockBackend({
      getSprintStories: (sprint) => {
        if (sprint === "next") {
          throw new SprintNotScheduledError("next", "No next sprint");
        }
        return Promise.resolve({
          stories: [],
          sprintInfo: makeSprintInfo({ name: "Active Sprint" }),
        });
      },
      getCompletedSprintHistory: () => Promise.resolve([]),
    });
    const result = await getSprintUseCase(backend, "all");
    assertEquals((result as { total_count: number }).total_count, 1);
  },
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group F — "all" Branch: Limit / Slot Math
// ═══════════════════════════════════════════════════════════════════════════════

Deno.test({
  name: "[F1] limit = 0 → only current/next, zero history",
  async fn() {
    const backend = createMockBackend({
      getCompletedSprintHistory: () =>
        Promise.resolve([
          makeSprintHistoryEntry({ info: makeSprintInfo({ name: "Sprint 4" }) }),
          makeSprintHistoryEntry({ info: makeSprintInfo({ name: "Sprint 3" }) }),
        ]),
    });
    const result = await getSprintUseCase(backend, "all", 0);
    const sprints = assertIsAllResult(result);
    // current + next = 2 active; remainingSlots = max(0, 0 - 2) = 0
    assertEquals(sprints.length, 2);
    const historySprints = sprints.filter(
      (s) => s.sprint.name === "Sprint 4" || s.sprint.name === "Sprint 3",
    );
    assertEquals(historySprints.length, 0);
  },
});

Deno.test({
  name: "[F2] limit caps total sprints",
  async fn() {
    const backend = createMockBackend({
      getCompletedSprintHistory: () =>
        Promise.resolve([
          makeSprintHistoryEntry({ info: makeSprintInfo({ name: "Sprint 4" }) }),
          makeSprintHistoryEntry({ info: makeSprintInfo({ name: "Sprint 3" }) }),
          makeSprintHistoryEntry({ info: makeSprintInfo({ name: "Sprint 2" }) }),
        ]),
    });
    // limit=2, current+next=2 active → remainingSlots = 0 → 0 history
    const result = await getSprintUseCase(backend, "all", 2);
    const sprints = assertIsAllResult(result);
    assertEquals(sprints.length, 2);
  },
});

Deno.test({
  name: "[F3] history entries beyond remainingSlots are sliced off",
  async fn() {
    const backend = createMockBackend({
      getCompletedSprintHistory: () =>
        Promise.resolve([
          makeSprintHistoryEntry({ info: makeSprintInfo({ name: "Sprint 4" }) }),
          makeSprintHistoryEntry({ info: makeSprintInfo({ name: "Sprint 3" }) }),
          makeSprintHistoryEntry({ info: makeSprintInfo({ name: "Sprint 2" }) }),
          makeSprintHistoryEntry({ info: makeSprintInfo({ name: "Sprint 1" }) }),
          makeSprintHistoryEntry({ info: makeSprintInfo({ name: "Sprint 0" }) }),
        ]),
    });
    // limit=3, current+next=2 → remainingSlots = 1 → only 1 history
    const result = await getSprintUseCase(backend, "all", 3);
    const sprints = assertIsAllResult(result);
    assertEquals(sprints.length, 3);
    // Only the first history entry (Sprint 4) should appear
    assertEquals(sprints[2].sprint.name, "Sprint 4");
  },
});

Deno.test({
  name: "[F4] large limit returns all entries",
  async fn() {
    const historyEntries = Array.from(
      { length: 10 },
      (_, i) => makeSprintHistoryEntry({ info: makeSprintInfo({ name: `Sprint ${10 - i}` }) }),
    );
    const backend = createMockBackend({
      getCompletedSprintHistory: () => Promise.resolve(historyEntries),
    });
    const result = await getSprintUseCase(backend, "all", 50);
    const sprints = assertIsAllResult(result);
    // 2 active + 10 history = 12 total
    assertEquals(sprints.length, 12);
  },
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group G — Edge Cases & Null Handling
// ═══════════════════════════════════════════════════════════════════════════════

Deno.test({
  name: "[G1] empty stories → empty items, total_count: 0, story_points: 0",
  async fn() {
    const backend = createMockBackend({
      getSprintStories: () =>
        Promise.resolve({
          stories: [],
          sprintInfo: makeSprintInfo(),
        }),
    });
    const result = await getSprintUseCase(backend, "current");
    const snapshot = assertIsSingleResult(result);
    assertEquals(snapshot.items, []);
    assertEquals(snapshot.total_count, 0);
    assertEquals(snapshot.totals.story_points, 0);
  },
});

Deno.test({
  name: '[G2] null status → grouped as "(none)" in by_status',
  async fn() {
    const backend = createMockBackend({
      getSprintStories: () =>
        Promise.resolve({
          stories: [
            makeIssueStory({ ref: { id: "PVTI_001" }, key: "1", status: null }),
          ],
          sprintInfo: makeSprintInfo(),
        }),
    });
    const result = await getSprintUseCase(backend, "current");
    const snapshot = assertIsSingleResult(result);
    assertEquals(snapshot.totals.by_status["(none)"], 1);
  },
});

Deno.test({
  name: "[G3] null story_points → contributes 0 to sum",
  async fn() {
    const backend = createMockBackend({
      getSprintStories: () =>
        Promise.resolve({
          stories: [
            makeIssueStory({ ref: { id: "PVTI_001" }, key: "1", story_points: null }),
          ],
          sprintInfo: makeSprintInfo(),
        }),
    });
    const result = await getSprintUseCase(backend, "current");
    const snapshot = assertIsSingleResult(result);
    assertEquals(snapshot.totals.story_points, 0);
  },
});

Deno.test({
  name: "[G4] zero story_points → contributes 0",
  async fn() {
    const backend = createMockBackend({
      getSprintStories: () =>
        Promise.resolve({
          stories: [
            makeIssueStory({ ref: { id: "PVTI_001" }, key: "1", story_points: 0 }),
          ],
          sprintInfo: makeSprintInfo(),
        }),
    });
    const result = await getSprintUseCase(backend, "current");
    const snapshot = assertIsSingleResult(result);
    assertEquals(snapshot.totals.story_points, 0);
  },
});

Deno.test({
  name: "[G5] mixed null and non-null story_points sum correctly",
  async fn() {
    const backend = createMockBackend({
      getSprintStories: () =>
        Promise.resolve({
          stories: [
            makeIssueStory({ ref: { id: "PVTI_001" }, key: "1", story_points: 3 }),
            makeIssueStory({ ref: { id: "PVTI_002" }, key: "2", story_points: null }),
            makeIssueStory({ ref: { id: "PVTI_003" }, key: "3", story_points: 5 }),
          ],
          sprintInfo: makeSprintInfo(),
        }),
    });
    const result = await getSprintUseCase(backend, "current");
    const snapshot = assertIsSingleResult(result);
    assertEquals(snapshot.totals.story_points, 8);
  },
});

Deno.test({
  name: "[G6] all stories with same status → single by_status entry",
  async fn() {
    const backend = createMockBackend({
      getSprintStories: () =>
        Promise.resolve({
          stories: [
            makeIssueStory({ ref: { id: "PVTI_001" }, key: "1", status: "In Progress" }),
            makeIssueStory({ ref: { id: "PVTI_002" }, key: "2", status: "In Progress" }),
            makeIssueStory({ ref: { id: "PVTI_003" }, key: "3", status: "In Progress" }),
          ],
          sprintInfo: makeSprintInfo(),
        }),
    });
    const result = await getSprintUseCase(backend, "current");
    const snapshot = assertIsSingleResult(result);
    assertEquals(snapshot.totals.by_status["In Progress"], 3);
    assertEquals(Object.keys(snapshot.totals.by_status).length, 1);
  },
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group H — Impediment Fetching (Single Sprint)
// ═══════════════════════════════════════════════════════════════════════════════

Deno.test({
  name: "[H1] getSprintImpediments called with correct SprintRef",
  async fn() {
    const sprintName = toSprintName("Sprint 5");
    let receivedSprint: SprintRef | null = null;
    const backend = createMockBackend({
      getSprintImpediments: (sprint) => {
        receivedSprint = sprint;
        return Promise.resolve([]);
      },
    });
    await getSprintUseCase(backend, sprintName);
    assertEquals(receivedSprint, "Sprint 5");
  },
});

Deno.test({
  name: "[H2] multiple impediments all mapped",
  async fn() {
    const impediments = [
      makeImpedimentListing({ ref: { id: "IMP_001" }, description: "Blocker 1", status: "open" }),
      makeImpedimentListing({
        ref: { id: "IMP_002" },
        description: "Blocker 2",
        status: "in_progress",
      }),
      makeImpedimentListing({
        ref: { id: "IMP_003" },
        description: "Blocker 3",
        status: "resolved",
      }),
    ];
    const backend = createMockBackend({
      getSprintImpediments: () => Promise.resolve(impediments),
    });
    const result = await getSprintUseCase(backend, "current");
    const snapshot = assertIsSingleResult(result);
    assertEquals(snapshot.impediments.length, 3);
  },
});

Deno.test({
  name: "[H3] impediment fields preserved",
  async fn() {
    const impediments = [
      makeImpedimentListing({
        ref: { id: "IMP_001" },
        description: "Blocked by external API outage",
        status: "open",
        raised_by: "test-user",
      }),
    ];
    const backend = createMockBackend({
      getSprintImpediments: () => Promise.resolve(impediments),
    });
    const result = await getSprintUseCase(backend, "current");
    const snapshot = assertIsSingleResult(result);
    const imp = snapshot.impediments[0];
    assertEquals(imp.ref.id, "IMP_001");
    assertEquals(imp.description, "Blocked by external API outage");
    assertEquals(imp.status, "open");
    assertEquals(imp.raised_by, "test-user");
  },
});

Deno.test({
  name: "[H4] resolved impediments included (no active-only filter)",
  async fn() {
    const impediments = [
      makeImpedimentListing({ ref: { id: "IMP_resolved" }, status: "resolved" }),
    ];
    const backend = createMockBackend({
      getSprintImpediments: () => Promise.resolve(impediments),
    });
    const result = await getSprintUseCase(backend, "current");
    const snapshot = assertIsSingleResult(result);
    assertEquals(snapshot.impediments.length, 1);
    assertEquals(snapshot.impediments[0].status, "resolved");
  },
});
