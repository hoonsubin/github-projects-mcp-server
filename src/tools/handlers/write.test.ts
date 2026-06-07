// =============================================================================
// src/tools/handlers/write.test.ts
// =============================================================================

import { assertEquals } from "@std/assert";
import {
  handleCreateStory,
  handleSetField,
  handleUpdateStory,
  toCreateStoryInput,
} from "./write.ts";
import { parseToolText } from "../_mcp_result.ts";
import { GitHubApiError } from "../../adapters/github/errors.ts";
import type { ProjectBackend, StoryUpdates } from "../../scrum/ports.ts";
import type { Story, StoryRef } from "../../domain/types.ts";
import type { BackendCallResult } from "../../services/error-enrichment.ts";

// ── Minimal stub factory ──────────────────────────────────────────────────────

/** Create a GitHubApiError with RATE_LIMITED code for test assertions. */
const makeAdapterError = (msg: string): GitHubApiError =>
  new GitHubApiError(msg, { code: "RATE_LIMITED", recovery: "Wait and retry" });

/** A successful BackendCallResult for compose methods. */
const makeStoryResult = (story: Story): BackendCallResult<Story> => ({
  value: story,
  warnings: [],
});

// ── toCreateStoryInput tests ──────────────────────────────────────────────────

Deno.test("toCreateStoryInput - maps story_points to storyPoints", () => {
  const input = toCreateStoryInput({
    title: "T",
    body: "B",
    type: "feature",
    story_points: 5,
  });
  assertEquals(input.storyPoints, 5);
  assertEquals("story_points" in input, false);
});

// ── handleSetField error handling ─────────────────────────────────────────────

Deno.test("handleSetField - returns warnings when composeStoryAfterSetField throws AdapterError", async () => {
  const ref: StoryRef = { id: "PVTI_test_1" };

  const backend = {
    setField: () => {},
    composeStoryAfterSetField: (): Promise<BackendCallResult<Story>> => {
      throw makeAdapterError("Snapshot fetch failed");
    },
  } as unknown as ProjectBackend;

  const result = await handleSetField(backend, {
    ref,
    field: "status",
    value: "Done",
  });

  const payload = parseToolText<Story & { warnings?: string[] }>(result);
  assertEquals(Array.isArray(payload.warnings), true);
  assertEquals(payload.warnings!.length > 0, true);
  assertEquals(payload.warnings![0].includes("RATE_LIMITED"), true);
});

Deno.test("handleSetField - returns warnings when both setField and compose throw", async () => {
  const ref: StoryRef = { id: "PVTI_test_2" };

  const backend = {
    setField: () => {
      throw makeAdapterError("setField failed");
    },
    composeStoryAfterSetField: (): Promise<BackendCallResult<Story>> => {
      throw makeAdapterError("Snapshot fetch failed");
    },
  } as unknown as ProjectBackend;

  const result = await handleSetField(backend, {
    ref,
    field: "status",
    value: "Done",
  });

  const payload = parseToolText<Story & { warnings?: string[] }>(result);
  assertEquals(Array.isArray(payload.warnings), true);
  // Two warnings from catchBackend wrapping both calls
  assertEquals(payload.warnings!.length >= 2, true);
});

// ── handleUpdateStory error handling ──────────────────────────────────────────

Deno.test("handleUpdateStory - returns warnings when updateStory throws AdapterError", async () => {
  const ref: StoryRef = { id: "PVTI_test_1" };
  const story = {
    ref,
    title: "Test",
    body: "",
    type: "feature",
    status: "In Progress",
    sprint: "Sprint 1",
    story_points: 3,
    priority: "Must",
    assignees: [],
    labels: [],
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    blocked_by: [],
    kind: "issue",
    key: "1",
    url: "https://example.com/1",
    epic: null,
  } as Story;

  const backend = {
    updateStory: (_ref: StoryRef, _updates: StoryUpdates) => {
      throw makeAdapterError("Mutation rejected");
    },
    composeStoryAfterStoryUpdate: (): Promise<BackendCallResult<Story>> =>
      Promise.resolve(makeStoryResult(story)),
  } as unknown as ProjectBackend;

  const result = await handleUpdateStory(backend, {
    ref,
    title: "Updated title",
    body: undefined,
    labels: undefined,
    assignees: undefined,
    epic: undefined,
    blocked_by: undefined,
    comment: undefined,
  });

  const payload = parseToolText<Story & { warnings?: string[] }>(result);
  assertEquals(Array.isArray(payload.warnings), true);
  assertEquals(payload.warnings!.length > 0, true);
  assertEquals(payload.warnings![0].includes("RATE_LIMITED"), true);
});

Deno.test("handleUpdateStory - returns warnings when addComment throws AdapterError", async () => {
  const ref: StoryRef = { id: "PVTI_test_1" };
  const story = {
    ref,
    title: "Test",
    body: "",
    type: "feature",
    status: "In Progress",
    sprint: "Sprint 1",
    story_points: 3,
    priority: "Must",
    assignees: [],
    labels: [],
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    blocked_by: [],
    kind: "issue",
    key: "1",
    url: "https://example.com/1",
    epic: null,
  } as Story;

  const backend = {
    updateStory: (_ref: StoryRef, _updates: StoryUpdates) => {},
    addComment: (_ref: StoryRef, _body: string) => {
      throw makeAdapterError("Comment failed");
    },
    composeStoryAfterStoryUpdate: (): Promise<BackendCallResult<Story>> =>
      Promise.resolve(makeStoryResult(story)),
  } as unknown as ProjectBackend;

  const result = await handleUpdateStory(backend, {
    ref,
    title: "Updated",
    body: undefined,
    labels: undefined,
    assignees: undefined,
    epic: undefined,
    blocked_by: undefined,
    comment: "A comment",
  });

  const payload = parseToolText<Story & { warnings?: string[] }>(result);
  assertEquals(Array.isArray(payload.warnings), true);
  assertEquals(payload.warnings!.length > 0, true);
  assertEquals(payload.warnings![0].includes("RATE_LIMITED"), true);
});

// ── handleCreateStory error handling ──────────────────────────────────────────

Deno.test("handleCreateStory - returns partialFailure when createStory throws AdapterError", async () => {
  const backend = {
    createStory: () => {
      throw makeAdapterError("Cannot create draft");
    },
  } as unknown as ProjectBackend;

  const result = await handleCreateStory(backend, {
    title: "New story",
    body: "body",
    type: "feature",
    sprint: undefined,
    priority: undefined,
    story_points: undefined,
    labels: undefined,
    epic: undefined,
    assignees: undefined,
  });

  const payload = parseToolText<
    { partialFailure?: boolean; failedFields?: Array<{ field: string; reason: string }> }
  >(result);
  assertEquals(payload.partialFailure, true);
  assertEquals(Array.isArray(payload.failedFields), true);
  assertEquals(payload.failedFields!.length, 1);
  assertEquals(payload.failedFields![0].field, "create");
});

Deno.test("handleCreateStory - returns partialFailure when composeStorySnapshot throws after successful create", async () => {
  const ref: StoryRef = { id: "PVTI_test_new" };

  const backend = {
    createStory: () => ref,
    composeStorySnapshot: (): Promise<BackendCallResult<Story>> => {
      throw makeAdapterError("Snapshot read failed");
    },
  } as unknown as ProjectBackend;

  const result = await handleCreateStory(backend, {
    title: "New story",
    body: "body",
    type: "feature",
    sprint: undefined,
    priority: undefined,
    story_points: undefined,
    labels: undefined,
    epic: undefined,
    assignees: undefined,
  });

  const payload = parseToolText<
    { partialFailure?: boolean; failedFields?: Array<{ field: string; reason: string }> }
  >(result);
  assertEquals(payload.partialFailure, true);
  assertEquals(Array.isArray(payload.failedFields), true);
  assertEquals(payload.failedFields!.some((f) => f.field === "read"), true);
});
