// =============================================================================
// src/scrum/get-burndown.test.ts — Unit tests for getBurndownUseCase
//
// Tests for: getBurndownUseCase()
// Uses a focused BurndownPort mock — only the two methods the use case needs.
// =============================================================================

import { assert, assertEquals, assertExists } from "jsr:@std/assert@^1.0.0";
import { getBurndownUseCase } from "./get-burndown.ts";
import type {
  BurndownInput,
  BurndownPort,
  BurndownStoryInput,
  CompletionMap,
  SprintInfo,
} from "./ports.ts";
import type { ScrumConfig } from "../domain/config.ts";
import type { BurndownResponse } from "../domain/types.ts";
import { toSprintName } from "../domain/types.ts";

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

const makeCompletionMap = (overrides: Partial<CompletionMap> = {}): CompletionMap => ({
  completions: new Map(),
  dataSource: "issue_close_proxy",
  ...overrides,
});

const makeBurndownInput = (overrides: Partial<BurndownInput> = {}): BurndownInput => ({
  sprint: makeSprintInfo(),
  stories: [],
  ...overrides,
});

/**
 * Creates a focused BurndownPort mock — only the two methods the use case depends on.
 * This follows Interface Segregation: the use case imports BurndownPort, not
 * the monolithic ProjectBackend.
 */
const createMockBackend = (overrides: Partial<BurndownPort> = {}): BurndownPort => ({
  getBurndownInput: (_sprint) => Promise.resolve(makeBurndownInput()),
  resolveCompletionTimestamps: (_input) => Promise.resolve(makeCompletionMap()),
  ...overrides,
});

const createMockConfig = (): ScrumConfig => ({
  project: { name: "Test Project" },
  scrum: { priority: [], status: {} },
  backends: { github: {} as Record<string, unknown> },
});

/** Narrow the return type and fail fast if the use case returned an error shape. */
const assertIsBurndownResponse = (
  result: BurndownResponse | { message: string },
): BurndownResponse => {
  assert(
    "sprint" in result,
    `Expected BurndownResponse, got { message: "${(result as { message: string }).message}" }`,
  );
  return result as BurndownResponse;
};

// ═══════════════════════════════════════════════════════════════════════════════
// Group A — Sprint Reference Resolution
// ═══════════════════════════════════════════════════════════════════════════════

Deno.test({
  name: "getBurndownUseCase - defaults sprint to 'current' when not provided",
  async fn() {
    let receivedSprint: string | null = null;
    const backend = createMockBackend({
      getBurndownInput: (sprint) => {
        receivedSprint = sprint as string;
        return Promise.resolve(makeBurndownInput());
      },
    });
    await getBurndownUseCase(backend, createMockConfig(), {});
    assertEquals(receivedSprint, "current");
  },
});

Deno.test({
  name: "getBurndownUseCase - passes explicit sprint name through",
  async fn() {
    const sprintName = toSprintName("Sprint 9");
    let receivedSprint: string | null = null;
    const backend = createMockBackend({
      getBurndownInput: (sprint) => {
        receivedSprint = sprint as string;
        return Promise.resolve(makeBurndownInput());
      },
    });
    await getBurndownUseCase(backend, createMockConfig(), { sprint: sprintName });
    assertEquals(receivedSprint, "Sprint 9");
  },
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group B — Response Shape & warning / data_source
// ═══════════════════════════════════════════════════════════════════════════════

Deno.test({
  name: "getBurndownUseCase - response has all required fields, no warning",
  async fn() {
    const backend = createMockBackend();
    const result = assertIsBurndownResponse(
      await getBurndownUseCase(backend, createMockConfig(), {}),
    );
    assertExists(result.sprint, "sprint must exist");
    assertEquals(result.data_source, "issue_close_proxy");
    assert(
      !("warning" in result),
      "warning should be absent when completionResult has no warning",
    );
    assert(Array.isArray(result.series), "series must be an array");
    assert(Array.isArray(result.ideal), "ideal must be an array");
    assert(Array.isArray(result.stories), "stories must be an array");
  },
});

Deno.test({
  name: "getBurndownUseCase - includes warning when completionResult has warning",
  async fn() {
    const backend = createMockBackend({
      resolveCompletionTimestamps: () =>
        Promise.resolve({
          completions: new Map(),
          dataSource: "issue_close_proxy" as const,
          warning: "User account detected; completion timestamps inferred from issue close events.",
        }),
    });
    const result = assertIsBurndownResponse(
      await getBurndownUseCase(backend, createMockConfig(), {}),
    );
    assertEquals(
      result.warning,
      "User account detected; completion timestamps inferred from issue close events.",
    );
  },
});

Deno.test({
  name: "getBurndownUseCase - data_source is audit_log when returned by backend",
  async fn() {
    const backend = createMockBackend({
      resolveCompletionTimestamps: () =>
        Promise.resolve({
          completions: new Map(),
          dataSource: "audit_log" as const,
        }),
    });
    const result = assertIsBurndownResponse(
      await getBurndownUseCase(backend, createMockConfig(), {}),
    );
    assertEquals(result.data_source, "audit_log");
  },
});

Deno.test({
  name: "getBurndownUseCase - data_source is issue_close_proxy when returned by backend",
  async fn() {
    const backend = createMockBackend({
      resolveCompletionTimestamps: () =>
        Promise.resolve({
          completions: new Map(),
          dataSource: "issue_close_proxy" as const,
        }),
    });
    const result = assertIsBurndownResponse(
      await getBurndownUseCase(backend, createMockConfig(), {}),
    );
    assertEquals(result.data_source, "issue_close_proxy");
  },
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group C — Committed Points
// ═══════════════════════════════════════════════════════════════════════════════

Deno.test({
  name: "getBurndownUseCase - committed points sum is correct",
  async fn() {
    const backend = createMockBackend({
      getBurndownInput: () =>
        Promise.resolve(
          makeBurndownInput({
            stories: [
              makeStoryInput({ number: 1, points: 3 }),
              makeStoryInput({ number: 2, points: 5 }),
              makeStoryInput({ number: 3, points: 8 }),
            ],
          }),
        ),
    });
    const result = assertIsBurndownResponse(
      await getBurndownUseCase(backend, createMockConfig(), {}),
    );
    // Committed points should equal the first ideal entry: 3+5+8 = 16
    assertEquals(result.ideal[0].remaining_points, 16);
  },
});

Deno.test({
  name: "getBurndownUseCase - committed points = 0 when stories array is empty",
  async fn() {
    const backend = createMockBackend({
      getBurndownInput: () => Promise.resolve(makeBurndownInput({ stories: [] })),
    });
    const result = assertIsBurndownResponse(
      await getBurndownUseCase(backend, createMockConfig(), {}),
    );
    assertEquals(result.ideal[0].remaining_points, 0);
  },
});

Deno.test({
  name: "getBurndownUseCase - stories with 0 points contribute nothing to sum",
  async fn() {
    const backend = createMockBackend({
      getBurndownInput: () =>
        Promise.resolve(
          makeBurndownInput({
            stories: [
              makeStoryInput({ number: 1, points: 0 }),
              makeStoryInput({ number: 2, points: 0 }),
              makeStoryInput({ number: 3, points: 5 }),
            ],
          }),
        ),
    });
    const result = assertIsBurndownResponse(
      await getBurndownUseCase(backend, createMockConfig(), {}),
    );
    assertEquals(result.ideal[0].remaining_points, 5);
  },
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group D — Sprint Metadata Mapping
// ═══════════════════════════════════════════════════════════════════════════════

Deno.test({
  name: "getBurndownUseCase - sprint meta maps SprintInfo fields correctly",
  async fn() {
    const backend = createMockBackend({
      getBurndownInput: () =>
        Promise.resolve(
          makeBurndownInput({
            sprint: makeSprintInfo({
              name: "Sprint 12",
              startDate: "2026-03-02",
              durationDays: 14,
              endDate: "2026-03-16",
            }),
          }),
        ),
    });
    const result = assertIsBurndownResponse(
      await getBurndownUseCase(backend, createMockConfig(), {}),
    );
    assertEquals(result.sprint.name, "Sprint 12");
    assertEquals(result.sprint.start_date, "2026-03-02");
    assertEquals(result.sprint.end_date, "2026-03-16");
    assertEquals(result.sprint.duration_days, 14);
    assert(typeof result.sprint.days_remaining === "number", "days_remaining must be a number");
  },
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group E — Story Mapping & completed_at Logic
// ═══════════════════════════════════════════════════════════════════════════════

Deno.test({
  name: "getBurndownUseCase - stories are mapped with correct fields",
  async fn() {
    const backend = createMockBackend({
      getBurndownInput: () =>
        Promise.resolve(
          makeBurndownInput({
            stories: [
              makeStoryInput({ number: 1, title: "Login Page", points: 5, status: "Done" }),
              makeStoryInput({ number: 2, title: "Signup Page", points: 8, status: "In Progress" }),
            ],
          }),
        ),
    });
    const result = assertIsBurndownResponse(
      await getBurndownUseCase(backend, createMockConfig(), {}),
    );
    assertEquals(result.stories.length, 2);

    const s1 = result.stories[0];
    assertEquals(s1.number, 1);
    assertEquals(s1.title, "Login Page");
    assertEquals(s1.points, 5);
    assertEquals(s1.status, "Done");
    assertEquals(s1.completed_at, null, "not in completion map → null");

    const s2 = result.stories[1];
    assertEquals(s2.number, 2);
    assertEquals(s2.title, "Signup Page");
    assertEquals(s2.points, 8);
    assertEquals(s2.status, "In Progress");
    assertEquals(s2.completed_at, null, "not in completion map → null");
  },
});

Deno.test({
  name: "getBurndownUseCase - completed_at is populated when story is in completion map",
  async fn() {
    const completions = new Map<number, string>();
    completions.set(1, "2026-01-08T14:30:00Z");
    completions.set(2, "2026-01-10T09:15:00Z");
    const backend = createMockBackend({
      getBurndownInput: () =>
        Promise.resolve(
          makeBurndownInput({
            stories: [
              makeStoryInput({ number: 1, title: "Done Story", points: 5, status: "Done" }),
              makeStoryInput({ number: 2, title: "Also Done", points: 3, status: "Done" }),
            ],
          }),
        ),
      resolveCompletionTimestamps: () =>
        Promise.resolve({
          completions,
          dataSource: "audit_log" as const,
        }),
    });
    const result = assertIsBurndownResponse(
      await getBurndownUseCase(backend, createMockConfig(), {}),
    );
    assertEquals(result.stories[0].completed_at, "2026-01-08T14:30:00Z");
    assertEquals(result.stories[1].completed_at, "2026-01-10T09:15:00Z");
  },
});

Deno.test({
  name: "getBurndownUseCase - completed_at is null when story is NOT in completion map",
  async fn() {
    const completions = new Map<number, string>();
    completions.set(1, "2026-01-08T14:30:00Z");
    // Story 2 is NOT in the map
    const backend = createMockBackend({
      getBurndownInput: () =>
        Promise.resolve(
          makeBurndownInput({
            stories: [
              makeStoryInput({ number: 1, title: "Done Story", points: 5, status: "Done" }),
              makeStoryInput({ number: 2, title: "Not Done", points: 3, status: "In Progress" }),
            ],
          }),
        ),
      resolveCompletionTimestamps: () =>
        Promise.resolve({
          completions,
          dataSource: "audit_log" as const,
        }),
    });
    const result = assertIsBurndownResponse(
      await getBurndownUseCase(backend, createMockConfig(), {}),
    );
    assertEquals(result.stories[0].completed_at, "2026-01-08T14:30:00Z");
    assertEquals(result.stories[1].completed_at, null);
  },
});

Deno.test({
  name: "getBurndownUseCase - null status is preserved as null",
  async fn() {
    const backend = createMockBackend({
      getBurndownInput: () =>
        Promise.resolve(
          makeBurndownInput({
            stories: [
              makeStoryInput({ number: 1, title: "Unset Status", points: 3, status: null }),
            ],
          }),
        ),
    });
    const result = assertIsBurndownResponse(
      await getBurndownUseCase(backend, createMockConfig(), {}),
    );
    assertEquals(result.stories[0].status, null);
  },
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group F — Integration with sprint-math helpers (series / ideal pass-through)
// ═══════════════════════════════════════════════════════════════════════════════

Deno.test({
  name: "getBurndownUseCase - ideal line has duration_days + 1 entries",
  async fn() {
    const backend = createMockBackend({
      getBurndownInput: () =>
        Promise.resolve(
          makeBurndownInput({
            sprint: makeSprintInfo({ durationDays: 10 }),
            stories: [
              makeStoryInput({ number: 1, points: 5 }),
            ],
          }),
        ),
    });
    const result = assertIsBurndownResponse(
      await getBurndownUseCase(backend, createMockConfig(), {}),
    );
    assertEquals(result.ideal.length, 11, "ideal line: duration_days + 1 = 11");
  },
});

Deno.test({
  name: "getBurndownUseCase - series is present and non-empty in response",
  async fn() {
    const backend = createMockBackend({
      getBurndownInput: () =>
        Promise.resolve(
          makeBurndownInput({
            sprint: makeSprintInfo({ durationDays: 5 }),
            stories: [
              makeStoryInput({ number: 1, points: 5 }),
            ],
          }),
        ),
    });
    const result = assertIsBurndownResponse(
      await getBurndownUseCase(backend, createMockConfig(), {}),
    );
    assert(Array.isArray(result.series), "series must be an array");
    assert(result.series.length > 0, "series must be non-empty for a sprint with days remaining");
    assertEquals(typeof result.series[0].date, "string");
    assertEquals(typeof result.series[0].remaining_points, "number");
    assertEquals(typeof result.series[0].completed_points, "number");
  },
});

Deno.test({
  name: "getBurndownUseCase - ideal line is present and correctly shaped",
  async fn() {
    const backend = createMockBackend({
      getBurndownInput: () =>
        Promise.resolve(
          makeBurndownInput({
            sprint: makeSprintInfo({ durationDays: 5 }),
            stories: [
              makeStoryInput({ number: 1, points: 10 }),
            ],
          }),
        ),
    });
    const result = assertIsBurndownResponse(
      await getBurndownUseCase(backend, createMockConfig(), {}),
    );
    assert(Array.isArray(result.ideal), "ideal must be an array");
    assert(result.ideal.length > 0, "ideal must be non-empty");
    assertEquals(typeof result.ideal[0].date, "string");
    assertEquals(typeof result.ideal[0].remaining_points, "number");
  },
});
