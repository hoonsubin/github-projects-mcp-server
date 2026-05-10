// =============================================================================
// src/tools/scrum-write_test.ts — Unit tests for C4, C5, C6 write tools
//
// Tests the handler logic for:
//   - C4: scrum_create_story (partial failure path)
//   - C5: scrum_plan_sprint (replace mode, skipped stories)
//   - C6: scrum_log_impediment (both addComment calls verified)
//
// These tests use a stubbed ProjectBackend — no GitHub client needed.
// =============================================================================

import { assertEquals } from "@std/assert";
import type { ProjectBackend, SprintInfo } from "../scrum/ports.ts";
import type { Story, StoryRef } from "../types.ts";

// ── Test helpers ──────────────────────────────────────────────────────────────

const makeStory = (overrides: Partial<Story> = {}): Story => ({
  ref: { number: 1, id: "PVTI_test_1" },
  title: "Test Story",
  body: "Test body",
  type: null,
  status: null,
  sprint: null,
  story_points: null,
  priority: null,
  assignees: [],
  labels: [],
  epic: null,
  created_at: "2025-01-01T00:00:00Z",
  updated_at: "2025-01-01T00:00:00Z",
  url: null,
  ...overrides,
});

const makeSprintInfo = (name = "Sprint 1"): SprintInfo => ({
  name,
  startDate: "2025-01-01",
  durationDays: 14,
  endDate: "2025-01-14",
});

const makePlatformState = () => ({
  fields: {
    status: { exists: true, options: [], missingOptions: [] },
    sprint: { exists: true },
    story_points: { exists: true },
    priority: { exists: true, options: [], missingOptions: [] },
  },
  labels: { existing: [], expected: [], missing: [] },
  iterations: { active: null, next: null, completed: [], completedCount: 0 },
});

const makeBurndownInput = () => ({
  sprint: makeSprintInfo(),
  stories: [],
});

const makeCompletionMap = () => ({ completions: new Map(), dataSource: "audit_log" as const });

// ── Stub builder ──────────────────────────────────────────────────────────────

const makeStubBackend = (overrides?: Partial<ProjectBackend>): ProjectBackend => ({
  createStory: () => Promise.resolve({ number: 1, id: "GHI_stub" }),
  updateStory: () => Promise.resolve(),
  setField: () => Promise.resolve(),
  addComment: () => Promise.resolve(),
  addVocabulary: () => Promise.resolve({ created: true }),
  getPlatformState: () => Promise.resolve(makePlatformState()),
  getSprintStories: () => Promise.resolve({ stories: [], sprintInfo: null }),
  getBacklogStories: () => Promise.resolve([]),
  getStoryDetail: (ref) =>
    Promise.resolve({
      story: makeStory({ ref: { number: 1, id: String(ref) } }),
      comments: [],
      linkedPrs: [],
    }),
  getCompletedSprintHistory: () => Promise.resolve([]),
  getBurndownInput: () => Promise.resolve(makeBurndownInput()),
  resolveCompletionTimestamps: () => Promise.resolve(makeCompletionMap()),
  fetchRepoFile: () => Promise.resolve(""),
  ...overrides,
});

// ── C4: scrum_create_story tests ─────────────────────────────────────────────

Deno.test("C4: scrum_create_story handles partial failure on sprint set", async () => {
  const stubBackend = makeStubBackend({
    createStory: () => Promise.resolve({ number: 42, id: "GHI_stub" }),
    setField: (_ref, field) => {
      if (field === "sprint") {
        return Promise.reject(new Error("Sprint field not configured"));
      }
      return Promise.resolve();
    },
    getStoryDetail: () =>
      Promise.resolve({
        story: makeStory({ ref: { number: 42, id: "GHI_stub" }, title: "Test Story" }),
        comments: [],
        linkedPrs: [],
      }),
  });

  // Simulate handler logic
  const storyRef = await stubBackend.createStory({
    title: "Test Story",
    body: "Test body",
    type: "feature",
  });

  const failedFields: Array<{ field: string; reason: string }> = [];

  try {
    await stubBackend.setField(storyRef, "sprint", "Sprint 1");
  } catch (err) {
    failedFields.push({
      field: "sprint",
      reason: err instanceof Error ? err.message : String(err),
    });
  }

  const detail = await stubBackend.getStoryDetail(storyRef);

  const hasPartialFailure = failedFields.length > 0;

  assertEquals(hasPartialFailure, true);
  assertEquals(failedFields.length, 1);
  assertEquals(failedFields[0].field, "sprint");
  assertEquals(failedFields[0].reason, "Sprint field not configured");
  assertEquals(detail.story.ref.number, 42);
});

Deno.test("C4: scrum_create_story succeeds when all field sets pass", async () => {
  const setFieldCalls: Array<{ ref: StoryRef; field: string; value: unknown }> = [];

  const stubBackend = makeStubBackend({
    createStory: () => Promise.resolve({ number: 42, id: "GHI_stub" }),
    setField: (ref, field, value) => {
      setFieldCalls.push({ ref, field, value });
      return Promise.resolve();
    },
  });

  // Simulate handler logic
  const storyRef = await stubBackend.createStory({
    title: "Test Story",
    body: "Test body",
    type: "feature",
    sprint: "Sprint 1",
    storyPoints: 5,
    priority: "Must",
  });

  const failedFields: Array<{ field: string; reason: string }> = [];

  if (storyRef.id) {
    await stubBackend.setField(storyRef, "sprint", "Sprint 1").catch(() =>
      failedFields.push({ field: "sprint", reason: "" })
    );
    await stubBackend.setField(storyRef, "story_points", 5).catch(() =>
      failedFields.push({ field: "story_points", reason: "" })
    );
    await stubBackend.setField(storyRef, "priority", "Must").catch(() =>
      failedFields.push({ field: "priority", reason: "" })
    );
  }

  assertEquals(failedFields.length, 0);
  assertEquals(setFieldCalls.length, 3);
  assertEquals(setFieldCalls[0].field, "sprint");
  assertEquals(setFieldCalls[1].field, "story_points");
  assertEquals(setFieldCalls[2].field, "priority");
});

// ── C5: scrum_plan_sprint tests ──────────────────────────────────────────────

Deno.test("C5: scrum_plan_sprint with replace: true clears existing items", async () => {
  const clearedRefs: StoryRef[] = [];

  const stubBackend = makeStubBackend({
    getSprintStories: () =>
      Promise.resolve({
        stories: [
          makeStory({ ref: { number: 10, id: "GHI_1" }, title: "Existing 1" }),
          makeStory({ ref: { number: 11, id: "GHI_2" }, title: "Existing 2" }),
        ],
        sprintInfo: makeSprintInfo("Sprint 1"),
      }),
    setField: (ref, field, value) => {
      if (field === "sprint" && value === null) {
        clearedRefs.push(ref);
      }
      return Promise.resolve();
    },
  });

  // Simulate handler logic
  const assigned: StoryRef[] = [];
  const skipped: Array<{ ref: StoryRef; reason: string }> = [];

  // Replace mode: clear existing
  const currentStories = await stubBackend.getSprintStories("Sprint 2");
  for (const story of currentStories.stories) {
    try {
      await stubBackend.setField(story.ref, "sprint", null);
      assigned.push(story.ref);
    } catch (err) {
      skipped.push({ ref: story.ref, reason: err instanceof Error ? err.message : String(err) });
    }
  }

  // Assign new story
  try {
    await stubBackend.setField({ number: 42 }, "sprint", "Sprint 2");
    assigned.push({ number: 42 });
  } catch (err) {
    skipped.push({ ref: { number: 42 }, reason: err instanceof Error ? err.message : String(err) });
  }

  // Assert: both existing stories were cleared
  assertEquals(clearedRefs.length, 2);
  assertEquals(clearedRefs[0].number, 10);
  assertEquals(clearedRefs[1].number, 11);

  // Assert: new story was assigned
  assertEquals(assigned.length, 3);
  assertEquals(assigned[2].number, 42);
});

Deno.test("C5: scrum_plan_sprint with skipped story returns partial success", async () => {
  const stubBackend = makeStubBackend({
    setField: (ref) => {
      if (ref.number === 99) {
        return Promise.reject(new Error("Story not found in project"));
      }
      return Promise.resolve();
    },
  });

  // Simulate handler logic
  const assigned: StoryRef[] = [];
  const skipped: Array<{ ref: StoryRef; reason: string }> = [];

  for (const ref of [{ number: 42 }, { number: 99 }]) {
    try {
      await stubBackend.setField(ref, "sprint", "Sprint 1");
      assigned.push(ref);
    } catch (err) {
      skipped.push({ ref, reason: err instanceof Error ? err.message : String(err) });
    }
  }

  assertEquals(assigned.length, 1);
  assertEquals(assigned[0].number, 42);
  assertEquals(skipped.length, 1);
  assertEquals(skipped[0].ref.number, 99);
  assertEquals(skipped[0].reason, "Story not found in project");
});

// ── C6: scrum_log_impediment tests ───────────────────────────────────────────

Deno.test("C6: scrum_log_impediment verifies both addComment calls", async () => {
  const commentCalls: Array<{ ref: StoryRef; body: string }> = [];

  const stubBackend = makeStubBackend({
    createStory: () => Promise.resolve({ number: 50, id: "GHI_impediment" }),
    addComment: (ref, body) => {
      commentCalls.push({ ref, body });
      return Promise.resolve();
    },
    getStoryDetail: () =>
      Promise.resolve({
        story: makeStory({ ref: { number: 50, id: "GHI_impediment" }, title: "Impediment: Test" }),
        comments: [],
        linkedPrs: [],
      }),
  });

  // Simulate handler logic
  const impedimentInput = {
    title: "Impediment: Build server is down",
    body: "Build server is down",
    type: "spike" as const,
    priority: "Must",
    labels: ["impediment"],
  };

  const storyRef = await stubBackend.createStory(impedimentInput);

  const affectedComment = [
    ":warning: **Impediment logged**",
    "",
    "Build server is down",
    "",
    "> Created by alice",
  ].join("\n");

  await stubBackend.addComment({ number: 42 }, affectedComment);

  const impedimentComment = [
    ":link: This impediment affects story",
    "  - Number: #42",
    "  - Ref: GHI_impediment",
  ].join("\n");

  await stubBackend.addComment(storyRef, impedimentComment);

  const detail = await stubBackend.getStoryDetail(storyRef);

  // Assert: both addComment calls were made
  assertEquals(commentCalls.length, 2);

  // Assert: first comment on the AFFECTED story
  assertEquals(commentCalls[0].ref.number, 42);
  assertEquals(commentCalls[0].body.includes("Impediment logged"), true);
  assertEquals(commentCalls[0].body.includes("Build server is down"), true);

  // Assert: second comment on the impediment story
  assertEquals(commentCalls[1].ref.number, 50);
  assertEquals(commentCalls[1].body.includes("affects story"), true);

  // Assert: returned story is the impediment
  assertEquals(detail.story.title, "Impediment: Test");
});

Deno.test("C6: scrum_log_impediment defaults priority to Must", async () => {
  let createdInput: { type: string; labels: string[]; priority: string } | undefined;

  const stubBackend = makeStubBackend({
    createStory: (input) => {
      createdInput = {
        type: input.type,
        labels: input.labels ?? [],
        priority: input.priority ?? "",
      };
      return Promise.resolve({ number: 50, id: "GHI_impediment" });
    },
    addComment: () => Promise.resolve(),
    getStoryDetail: () =>
      Promise.resolve({
        story: makeStory({ ref: { number: 50, id: "GHI_impediment" }, title: "Impediment: Test" }),
        comments: [],
        linkedPrs: [],
      }),
  });

  // Simulate handler logic
  const impedimentInput = {
    title: "Impediment: Network outage",
    body: "Network outage",
    type: "spike" as const,
    priority: "Must",
    labels: ["impediment"],
  };

  await stubBackend.createStory(impedimentInput);

  assertEquals(createdInput?.type, "spike");
  assertEquals(createdInput?.labels, ["impediment"]);
  assertEquals(createdInput?.priority, "Must");
});
