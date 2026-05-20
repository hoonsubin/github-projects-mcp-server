// =============================================================================
// tests/scrum/get-backlog.test.ts — Unit tests for backlog
//
// Tests for: storyToListing(), isActiveItem(), getBacklogUseCase()
// =============================================================================

import { assert, assertEquals } from "jsr:@std/assert@^1.0.0";
import { getBacklogUseCase } from "./get-backlog.ts";
import type { CompletionMap, ProjectBackend, SprintInfo } from "./ports.ts";
import type { StoryRef } from "../domain/types.ts";
import type { ScrumConfig } from "../domain/config.ts";
import type { Story } from "../domain/types.ts";

// ── Test fixtures ──────────────────────────────────────────────────────────────

import type { IssueStory } from "../domain/types.ts";

const makeStory = (overrides: Partial<IssueStory> = {}): IssueStory => ({
  kind: "issue",
  ref: { id: `PVTI_${Math.random().toString(36).slice(2, 8)}` },
  key: "PRO-1",
  title: "Test Story",
  body: "As a user, I want to test backlog filtering.",
  type: "feature",
  status: "In Progress",
  sprint: null,
  story_points: 3,
  priority: "Must",
  assignees: ["testuser"],
  labels: ["feature"],
  epic: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-02T00:00:00Z",
  url: "https://github.com/test/repo/issues/1",
  blocked_by: [],
  blocks: [],
  ...overrides,
});

/**
 * Creates a mock ProjectBackend implementing all required methods.
 * Uses synchronous returns wrapped in Promise.resolve() where no async I/O is needed.
 */
const createMockBackend = (
  overrides: Partial<Record<keyof ProjectBackend, unknown>> = {},
): ProjectBackend => ({
  getBacklogStories: () =>
    Promise.resolve([
      makeStory({ title: "Active Story", status: "In Progress", sprint: null }),
      makeStory({ title: "Done No Sprint", status: "Done", sprint: null }),
      makeStory({ title: "Done In Sprint", status: "Done", sprint: "Sprint 1" }),
      makeStory({ title: "In Progress No Sprint", status: "In Progress", sprint: null }),
      makeStory({ title: "Todo No Sprint", status: "Todo", sprint: null }),
    ]),
  getOrphanImpediments: () =>
    Promise.resolve([
      {
        ref: { id: "PVTI_orphan1" },
        description: "Orphan impediment 1",
        status: "open",
        raised_by: "orphaner",
        raised_at: "2026-01-01T00:00:00Z",
        resolved_at: null,
      },
      {
        ref: { id: "PVTI_orphan2" },
        description: "Orphan impediment 2",
        status: "in_progress",
        raised_by: "orphaner2",
        raised_at: "2026-01-02T00:00:00Z",
        resolved_at: null,
      },
      {
        ref: { id: "PVTI_orphan3" },
        description: "Resolved orphan (should be excluded)",
        status: "resolved",
        raised_by: "orphaner3",
        raised_at: "2026-01-03T00:00:00Z",
        resolved_at: "2026-01-04T00:00:00Z",
      },
    ]),
  getPlatformState: () =>
    Promise.resolve({
      fields: {
        status: { exists: true, options: [], missingOptions: [] },
        sprint: { exists: true },
        story_points: { exists: true },
        priority: { exists: true, options: [], missingOptions: [] },
      },
      labels: { existing: [], expected: [], missing: [] },
      iterations: { active: null, next: null, completed: [], completedCount: 0 },
    }),
  reload: () => Promise.resolve(),
  getSprintStories: () =>
    Promise.resolve({
      stories: [],
      sprintInfo: { name: "", startDate: "", durationDays: 0, endDate: "" },
    }),
  getStoryDetail: () => Promise.resolve({ story: {} as Story, comments: [], linkedPrs: [] }),
  getCompletedSprintHistory: () => Promise.resolve([]),
  getBurndownInput: () => Promise.resolve({ sprint: {} as SprintInfo, stories: [] }),
  resolveCompletionTimestamps: () =>
    Promise.resolve<CompletionMap>({
      completions: new Map(),
      dataSource: "issue_close_proxy",
    }),
  fetchRepoFile: () => Promise.resolve(""),
  createStory: () => Promise.resolve({ id: "" } as StoryRef),
  updateStory: () => Promise.resolve(),
  setField: () => Promise.resolve(),
  addComment: () => Promise.resolve(),
  addVocabulary: () => Promise.resolve({ created: false }),
  getSprintImpediments: () => Promise.resolve([]),
  getEpics: () => Promise.resolve([]),
  createImpediment: () =>
    Promise.resolve({
      listing: {
        ref: { id: "" },
        description: "",
        status: "open",
        raised_by: null,
        raised_at: "",
        resolved_at: null,
      },
      itemRef: { id: "" },
    }),
  updateImpediment: () =>
    Promise.resolve({
      ref: { id: "" },
      description: "",
      status: "open",
      raised_by: null,
      raised_at: "",
      resolved_at: null,
    }),
  ...Object.fromEntries(
    Object.entries(overrides).map(([k, v]) => [k, typeof v === "function" ? v : v]),
  ),
} as ProjectBackend);

const createMockConfig = (): ScrumConfig => ({
  project: { name: "Test Project" },
  scrum: { priority: [], status: {} },
  backends: { github: {} as Record<string, unknown> },
});

// ── Tests for isActiveItem() ──────────────────────────────────────────────────

Deno.test({
  name: "isActiveItem - Done + no sprint returns false (excluded)",
  async fn() {
    const story = makeStory({ title: "Done No Sprint", status: "Done", sprint: null });
    const backend = createMockBackend({
      getBacklogStories: () => Promise.resolve([story]),
      getOrphanImpediments: () => Promise.resolve([]),
    });
    const result = await getBacklogUseCase(backend, createMockConfig(), {});
    assertEquals(result.stories.length, 0, "Done + no sprint should be excluded");
  },
});

Deno.test({
  name: "isActiveItem - Done + active sprint returns true (included)",
  async fn() {
    const story = makeStory({ title: "Done In Sprint", status: "Done", sprint: "Sprint 1" });
    const backend = createMockBackend({
      getBacklogStories: () => Promise.resolve([story]),
      getOrphanImpediments: () => Promise.resolve([]),
    });
    const result = await getBacklogUseCase(backend, createMockConfig(), {});
    assertEquals(result.stories.length, 1, "Done + active sprint should be included");
    assertEquals(result.stories[0].title, "Done In Sprint");
  },
});

Deno.test({
  name: "isActiveItem - In Progress + no sprint returns true (included)",
  async fn() {
    const story = makeStory({ title: "Active Story", status: "In Progress", sprint: null });
    const backend = createMockBackend({
      getBacklogStories: () => Promise.resolve([story]),
      getOrphanImpediments: () => Promise.resolve([]),
    });
    const result = await getBacklogUseCase(backend, createMockConfig(), {});
    assertEquals(result.stories.length, 1, "In Progress + no sprint should be included");
  },
});

Deno.test({
  name: "isActiveItem - case-insensitive done check",
  async fn() {
    const story = makeStory({ title: "done lowercase", status: "done", sprint: null });
    const backend = createMockBackend({
      getBacklogStories: () => Promise.resolve([story]),
      getOrphanImpediments: () => Promise.resolve([]),
    });
    const result = await getBacklogUseCase(backend, createMockConfig(), {});
    assertEquals(result.stories.length, 0, "Lowercase 'done' + no sprint should be excluded");
  },
});

Deno.test({
  name: "isActiveItem - DONE uppercase check",
  async fn() {
    const story = makeStory({ title: "DONE uppercase", status: "DONE", sprint: null });
    const backend = createMockBackend({
      getBacklogStories: () => Promise.resolve([story]),
      getOrphanImpediments: () => Promise.resolve([]),
    });
    const result = await getBacklogUseCase(backend, createMockConfig(), {});
    assertEquals(result.stories.length, 0, "Uppercase 'DONE' + no sprint should be excluded");
  },
});

// ── Tests for search filtering ────────────────────────────────────────────────

Deno.test({
  name: "getBacklogUseCase - search filter works",
  async fn() {
    const backend = createMockBackend({
      getBacklogStories: () =>
        Promise.resolve([
          makeStory({ title: "Login Feature", status: "In Progress", sprint: null }),
          makeStory({ title: "Logout Feature", status: "In Progress", sprint: null }),
        ]),
      getOrphanImpediments: () => Promise.resolve([]),
    });
    const result = await getBacklogUseCase(backend, createMockConfig(), { search: "login" });
    assertEquals(result.stories.length, 1, "Should filter to only 'Login Feature'");
    assertEquals(result.stories[0].title, "Login Feature");
  },
});

Deno.test({
  name: "getBacklogUseCase - case-insensitive search",
  async fn() {
    const backend = createMockBackend({
      getBacklogStories: () =>
        Promise.resolve([
          makeStory({ title: "Login Feature", status: "In Progress", sprint: null }),
        ]),
      getOrphanImpediments: () => Promise.resolve([]),
    });
    const result = await getBacklogUseCase(backend, createMockConfig(), { search: "LOGIN" });
    assertEquals(result.stories.length, 1, "Uppercase search should match");
  },
});

// ── Tests for labels filtering ────────────────────────────────────────────────

Deno.test({
  name: "getBacklogUseCase - labels filter works",
  async fn() {
    const backend = createMockBackend({
      getBacklogStories: () =>
        Promise.resolve([
          makeStory({
            title: "Story A",
            status: "In Progress",
            sprint: null,
            labels: ["feature", "urgent"],
          }),
          makeStory({ title: "Story B", status: "In Progress", sprint: null, labels: ["bug"] }),
        ]),
      getOrphanImpediments: () => Promise.resolve([]),
    });
    const result = await getBacklogUseCase(backend, createMockConfig(), { labels: ["feature"] });
    assertEquals(result.stories.length, 1, "Should filter to only stories with 'feature' label");
    assertEquals(result.stories[0].title, "Story A");
  },
});

// ── Tests for priority filtering ──────────────────────────────────────────────

Deno.test({
  name: "getBacklogUseCase - priority filter works",
  async fn() {
    const backend = createMockBackend({
      getBacklogStories: () =>
        Promise.resolve([
          makeStory({
            title: "Must Priority",
            status: "In Progress",
            sprint: null,
            priority: "Must",
          }),
          makeStory({
            title: "Should Priority",
            status: "In Progress",
            sprint: null,
            priority: "Should",
          }),
        ]),
      getOrphanImpediments: () => Promise.resolve([]),
    });
    const result = await getBacklogUseCase(backend, createMockConfig(), { priority: "Must" });
    assertEquals(result.stories.length, 1, "Should filter to only 'Must' priority");
    assertEquals(result.stories[0].title, "Must Priority");
  },
});

// ── Tests for epic filtering ──────────────────────────────────────────────────

Deno.test({
  name: "getBacklogUseCase - epic filter works",
  async fn() {
    const backend = createMockBackend({
      getBacklogStories: () =>
        Promise.resolve([
          makeStory({
            title: "Epic A Story",
            status: "In Progress",
            sprint: null,
            epic: { ref: { id: "MI_epic_a" }, name: "Epic A" },
          }),
          makeStory({
            title: "Epic B Story",
            status: "In Progress",
            sprint: null,
            epic: { ref: { id: "MI_epic_b" }, name: "Epic B" },
          }),
        ]),
      getOrphanImpediments: () => Promise.resolve([]),
    });
    const result = await getBacklogUseCase(backend, createMockConfig(), { epic: "Epic A" });
    assertEquals(result.stories.length, 1, "Should filter to only 'Epic A' stories");
    assertEquals(result.stories[0].title, "Epic A Story");
  },
});

// ── Tests for limit ───────────────────────────────────────────────────────────

Deno.test({
  name: "getBacklogUseCase - limit is applied",
  async fn() {
    const backend = createMockBackend({
      getBacklogStories: () =>
        Promise.resolve([
          makeStory({ title: "Story 1", status: "In Progress", sprint: null }),
          makeStory({ title: "Story 2", status: "In Progress", sprint: null }),
          makeStory({ title: "Story 3", status: "In Progress", sprint: null }),
        ]),
      getOrphanImpediments: () => Promise.resolve([]),
    });
    const result = await getBacklogUseCase(backend, createMockConfig(), { limit: 2 });
    assertEquals(result.stories.length, 2, "Should return only 2 stories");
    assertEquals(result.total_count, 3, "total_count should reflect pre-limit count");
  },
});

// ── Tests for orphan_impediments ──────────────────────────────────────────────

Deno.test({
  name: "getBacklogUseCase - orphan_impediments field is populated",
  async fn() {
    const backend = createMockBackend({
      getBacklogStories: () =>
        Promise.resolve([
          makeStory({ title: "Active Story", status: "In Progress", sprint: null }),
        ]),
      getOrphanImpediments: () =>
        Promise.resolve([
          {
            ref: { id: "PVTI_orphan1" },
            description: "Orphan impediment 1",
            status: "open",
            raised_by: "orphaner",
            raised_at: "2026-01-01T00:00:00Z",
            resolved_at: null,
          },
        ]),
    });
    const result = await getBacklogUseCase(backend, createMockConfig(), {});
    assert(Array.isArray(result.orphan_impediments), "orphan_impediments should be an array");
    assertEquals(result.orphan_impediments.length, 1, "Should return unresolved orphans only");
    assertEquals(result.orphan_impediments[0].description, "Orphan impediment 1");
  },
});

// ── Tests for result shape ────────────────────────────────────────────────────

Deno.test({
  name: "getBacklogUseCase - returns correct result shape",
  async fn() {
    const backend = createMockBackend({
      getBacklogStories: () =>
        Promise.resolve([
          makeStory({ title: "Test Story", status: "In Progress", sprint: null }),
        ]),
      getOrphanImpediments: () => Promise.resolve([]),
    });
    const result = await getBacklogUseCase(backend, createMockConfig(), {});
    assert("stories" in result, "result should have stories field");
    assert("total_count" in result, "result should have total_count field");
    assert("readiness" in result, "result should have readiness field");
    assert("orphan_impediments" in result, "result should have orphan_impediments field");
    assert("epics" in result, "result should have epics field");
    assert(Array.isArray(result.epics), "epics should be an array");
    assert(typeof result.total_count === "number", "total_count should be a number");
    assert(typeof result.readiness === "object", "readiness should be an object");
    assert("ready" in result.readiness, "readiness should have ready field");
    assert("partially_ready" in result.readiness, "readiness should have partially_ready field");
    assert("not_ready" in result.readiness, "readiness should have not_ready field");
  },
});

// ── Tests for StoryListing projection ─────────────────────────────────────────

Deno.test({
  name: "StoryListing projection - lightweight entry has correct fields",
  async fn() {
    const backend = createMockBackend({
      getBacklogStories: () =>
        Promise.resolve([
          makeStory({
            title: "Projected Story",
            status: "In Progress",
            sprint: null,
            story_points: 5,
            priority: "Should",
          }),
        ]),
      getOrphanImpediments: () => Promise.resolve([]),
    });
    const result = await getBacklogUseCase(backend, createMockConfig(), {});
    const listing = result.stories[0];
    assert("ref" in listing, "listing should have ref");
    assert("id" in listing.ref, "ref should have id");
    assert("key" in listing.ref, "ref should have key");
    assert("title" in listing, "listing should have title");
    assert("status" in listing, "listing should have status");
    assert("story_points" in listing, "listing should have story_points");
    assert("priority" in listing, "listing should have priority");
    assert("sprint" in listing, "listing should have sprint");
    assert("writable" in listing, "listing should have writable");
    assertEquals(listing.writable, true, "writable should be true for active backlog items");
    assert(!("body" in listing), "listing should NOT have body field");
    assert(!("labels" in listing), "listing should NOT have labels field");
    assert(!("assignees" in listing), "listing should NOT have assignees field");
  },
});

// ── Tests for readiness computation ───────────────────────────────────────────

Deno.test({
  name: "getBacklogUseCase - readiness is computed correctly",
  async fn() {
    const backend = createMockBackend({
      getBacklogStories: () =>
        Promise.resolve([
          makeStory({
            title: "Ready Story",
            status: "In Progress",
            sprint: null,
            body: "As a user, I want login.\n\n## Acceptance Criteria\n- [ ] AC1\n- [ ] AC2",
            story_points: 3,
          }),
          makeStory({
            title: "Not Ready Story",
            status: "In Progress",
            sprint: null,
            body: "Just a description without AC.",
            story_points: 5,
          }),
        ]),
      getOrphanImpediments: () => Promise.resolve([]),
    });
    const result = await getBacklogUseCase(backend, createMockConfig(), {});
    assert(result.readiness.ready >= 0, "ready count should be >= 0");
    assert(result.readiness.partially_ready >= 0, "partially_ready count should be >= 0");
    assert(result.readiness.not_ready >= 0, "not_ready count should be >= 0");
    const total = result.readiness.ready + result.readiness.partially_ready +
      result.readiness.not_ready;
    assertEquals(total, result.stories.length, "readiness totals should equal story count");
  },
});

// ── Tests for empty backlog ───────────────────────────────────────────────────

Deno.test({
  name: "getBacklogUseCase - empty backlog returns empty arrays",
  async fn() {
    const backend = createMockBackend({
      getBacklogStories: () => Promise.resolve([]),
      getOrphanImpediments: () => Promise.resolve([]),
    });
    const result = await getBacklogUseCase(backend, createMockConfig(), {});
    assertEquals(result.stories.length, 0, "stories should be empty");
    assertEquals(result.total_count, 0, "total_count should be 0");
    assertEquals(result.orphan_impediments.length, 0, "orphan_impediments should be empty");
  },
});

// ── Tests for Done status variations ──────────────────────────────────────────

Deno.test({
  name: "isActiveItem - 'Done' with sprint null is excluded",
  async fn() {
    const story = makeStory({ title: "Done Null Sprint", status: "Done", sprint: null });
    const backend = createMockBackend({
      getBacklogStories: () => Promise.resolve([story]),
      getOrphanImpediments: () => Promise.resolve([]),
    });
    const result = await getBacklogUseCase(backend, createMockConfig(), {});
    assertEquals(result.stories.length, 0, "Done + null sprint should be excluded");
  },
});

Deno.test({
  name: "isActiveItem - 'Done' with sprint 'current' is included",
  async fn() {
    const story = makeStory({ title: "Done Current Sprint", status: "Done", sprint: "current" });
    const backend = createMockBackend({
      getBacklogStories: () => Promise.resolve([story]),
      getOrphanImpediments: () => Promise.resolve([]),
    });
    const result = await getBacklogUseCase(backend, createMockConfig(), {});
    assertEquals(result.stories.length, 1, "Done + current sprint should be included");
  },
});
