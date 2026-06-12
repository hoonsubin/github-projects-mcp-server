// =============================================================================
// src/tools/handlers/write.test.ts
// =============================================================================

import { assertEquals } from "@std/assert";
import {
  handleAddVocabulary,
  handleCreateStory,
  handleSetField,
  handleUpdateStory,
  toCreateStoryInput,
} from "./write.ts";
import { parseToolText } from "../_mcp_result.ts";
import { GitHubApiError } from "../../adapters/github/errors.ts";
import type { ScrumConfig } from "../../domain/config.ts";
import type { ProjectBackend, PlatformState, StoryUpdates } from "../../scrum/ports.ts";
import type { BackendCallResult } from "../../services/error-enrichment.ts";
import { SessionCache } from "../../services/session-cache.ts";
import type { Story, StoryRef } from "../../domain/types.ts";

// ── Minimal stub factory ──────────────────────────────────────────────────────

const stubScrumConfig = {
  status_display: { backlog: "Backlog" },
  priority_display: { p0: "Must" },
  scrum: {
    status: { backlog: { terminal: false, blocking: false } },
    priority: [{ key: "p0" }],
  },
} as unknown as ScrumConfig;

const emptyPlatformState = (): PlatformState => ({
  fields: {
    status: { exists: true, options: [], missingOptions: [] },
    sprint: { exists: true },
    story_points: { exists: true },
    priority: { exists: true, options: [], missingOptions: [] },
    type: { exists: true, configured: true },
  },
  labels: { existing: [], expected: [], missing: [] },
  iterations: {
    active: null,
    next: null,
    completed: [],
    completedCount: 0,
  },
  vocabulary: {
    statusDisplay: null,
    priorityDisplay: null,
    typeDisplay: null,
    typeTemplatePaths: {},
  },
  epics: { active: [], totalCount: 0 },
  templateUris: null,
});

type WriteAck = { ref: { id: string }; applied: true; warnings?: string[] };

/** Create a GitHubApiError with RATE_LIMITED code for test assertions. */
const makeAdapterError = (msg: string): GitHubApiError =>
  new GitHubApiError(msg, { code: "RATE_LIMITED", recovery: "Wait and retry" });

/** A successful BackendCallResult for compose methods. */
const makeStoryResult = (story: Story): BackendCallResult<Story> => ({
  value: story,
  warnings: [],
});

// ── handleAddVocabulary policy ───────────────────────────────────────────────

Deno.test("handleAddVocabulary - rejects status_option not in missing_options", async () => {
  const backend = {
    getPlatformState: (): Promise<BackendCallResult<PlatformState>> =>
      Promise.resolve({ value: emptyPlatformState(), warnings: [] }),
    addVocabulary: () => Promise.resolve({ created: true }),
  } as unknown as ProjectBackend;

  const result = await handleAddVocabulary(
    backend,
    stubScrumConfig,
    new SessionCache(),
    { kind: "status_option", value: "Backlog" },
  );

  assertEquals(result.isError, true);
  assertEquals(result.content[0]?.text.includes("VOCABULARY_NOT_MISSING"), true);
});

Deno.test("handleAddVocabulary - allows labels without platform state gate", async () => {
  const backend = {
    addVocabulary: () => Promise.resolve({ created: true }),
  } as unknown as ProjectBackend;

  const result = await handleAddVocabulary(
    backend,
    stubScrumConfig,
    new SessionCache(),
    { kind: "label", value: "agent-label" },
  );

  assertEquals(result.isError, undefined);
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

Deno.test("handleSetField (ack) - returns warnings when setField throws", async () => {
  const ref: StoryRef = { id: "PVTI_test_1" };

  const backend = {
    setField: () => {
      throw makeAdapterError("setField failed");
    },
  } as unknown as ProjectBackend;

  const result = await handleSetField(backend, stubScrumConfig, {
    ref,
    field: "status",
    value: "Done",
  });

  const payload = parseToolText<WriteAck>(result);
  assertEquals(payload.applied, true);
  assertEquals(Array.isArray(payload.warnings), true);
  assertEquals(payload.warnings!.length > 0, true);
  assertEquals(payload.warnings![0].includes("RATE_LIMITED"), true);
});

Deno.test("handleSetField (story) - returns warnings when composeStoryAfterSetField throws", async () => {
  const ref: StoryRef = { id: "PVTI_test_1" };

  const backend = {
    setField: () => {},
    composeStoryAfterSetField: (): Promise<BackendCallResult<Story>> => {
      throw makeAdapterError("Snapshot fetch failed");
    },
  } as unknown as ProjectBackend;

  const result = await handleSetField(backend, stubScrumConfig, {
    ref,
    field: "status",
    value: "Done",
    response: "story",
  });

  const payload = parseToolText<Story & { warnings?: string[] }>(result);
  assertEquals(Array.isArray(payload.warnings), true);
  assertEquals(payload.warnings!.length > 0, true);
  assertEquals(payload.warnings![0].includes("RATE_LIMITED"), true);
});

Deno.test("handleSetField (story) - returns warnings when both setField and compose throw", async () => {
  const ref: StoryRef = { id: "PVTI_test_2" };

  const backend = {
    setField: () => {
      throw makeAdapterError("setField failed");
    },
    composeStoryAfterSetField: (): Promise<BackendCallResult<Story>> => {
      throw makeAdapterError("Snapshot fetch failed");
    },
  } as unknown as ProjectBackend;

  const result = await handleSetField(backend, stubScrumConfig, {
    ref,
    field: "status",
    value: "Done",
    response: "story",
  });

  const payload = parseToolText<Story & { warnings?: string[] }>(result);
  assertEquals(Array.isArray(payload.warnings), true);
  assertEquals(payload.warnings!.length >= 2, true);
});

// ── handleUpdateStory error handling ──────────────────────────────────────────

Deno.test("handleUpdateStory (ack) - returns warnings when updateStory throws", async () => {
  const ref: StoryRef = { id: "PVTI_test_1" };

  const backend = {
    updateStory: (_ref: StoryRef, _updates: StoryUpdates) => {
      throw makeAdapterError("Mutation rejected");
    },
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

  const payload = parseToolText<WriteAck>(result);
  assertEquals(payload.applied, true);
  assertEquals(Array.isArray(payload.warnings), true);
  assertEquals(payload.warnings!.length > 0, true);
  assertEquals(payload.warnings![0].includes("RATE_LIMITED"), true);
});

Deno.test("handleUpdateStory (ack) - returns warnings when addComment throws", async () => {
  const ref: StoryRef = { id: "PVTI_test_1" };

  const backend = {
    updateStory: (_ref: StoryRef, _updates: StoryUpdates) => {},
    addComment: (_ref: StoryRef, _body: string) => {
      throw makeAdapterError("Comment failed");
    },
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

  const payload = parseToolText<WriteAck>(result);
  assertEquals(payload.applied, true);
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
