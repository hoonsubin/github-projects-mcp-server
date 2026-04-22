import { assertEquals, assertThrows } from "@std/assert";
import type { ProjectV2Item, ProjectV2ItemFieldValue } from "../types.ts";
import {
  encodeCursor,
  decodeCursor,
  computeEndDate,
  calcDaysRemaining,
  getFieldValue,
  getNumberFieldValue,
  getStatusValue,
  getIterationValue,
  sumStoryPoints,
  isBacklogItem,
  getItemTitle,
  getItemNumber,
  getItemUrl,
  getItemAssignees,
} from "./scrum.ts";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const makeItem = (overrides: Partial<ProjectV2Item> = {}): ProjectV2Item =>
  ({
    id: "PVTI_1",
    type: "DraftIssue",
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:00:00Z",
    isArchived: false,
    content: {
      __typename: "DraftIssue",
      id: "DI_1",
      title: "My Draft",
      body: "",
      assignees: { nodes: [] },
    },
    fieldValues: { nodes: [] },
    ...overrides,
  }) as ProjectV2Item;

const makeFieldValue = (
  fieldId: string,
  extra: Record<string, unknown> = {},
): ProjectV2ItemFieldValue =>
  ({
    __typename: "ProjectV2ItemFieldTextValue",
    field: { id: fieldId, name: "Field" },
    ...extra,
  }) as ProjectV2ItemFieldValue;

// ---------------------------------------------------------------------------
// Cursor helpers
// ---------------------------------------------------------------------------

Deno.test("encodeCursor - produces a non-empty base64 string", () => {
  const result = encodeCursor(0);
  assertEquals(typeof result, "string");
  assertEquals(result.length > 0, true);
});

Deno.test("encodeCursor/decodeCursor - round-trip for index 0", () => {
  assertEquals(decodeCursor(encodeCursor(0)), 0);
});

Deno.test("encodeCursor/decodeCursor - round-trip for index 42", () => {
  assertEquals(decodeCursor(encodeCursor(42)), 42);
});

Deno.test("encodeCursor/decodeCursor - round-trip for large index", () => {
  assertEquals(decodeCursor(encodeCursor(1000)), 1000);
});

Deno.test("decodeCursor - invalid base64 characters: throws", () => {
  assertThrows(
    () => decodeCursor("!!!notbase64!!!"),
    Error,
    "Invalid pagination cursor",
  );
});

Deno.test("decodeCursor - valid base64 but non-numeric payload: throws", () => {
  assertThrows(
    () => decodeCursor(btoa("hello")),
    Error,
    "Invalid pagination cursor",
  );
});

Deno.test("decodeCursor - negative number payload: throws", () => {
  assertThrows(
    () => decodeCursor(btoa("-1")),
    Error,
    "Invalid pagination cursor",
  );
});

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

Deno.test("computeEndDate - 14-day sprint from 2025-04-27 ends on 2025-05-10", () => {
  // Inclusive: day 1 = Apr 27, day 14 = May 10 (27 + 14 - 1 = 40 → May 10)
  assertEquals(computeEndDate("2025-04-27", 14), "2025-05-10");
});

Deno.test("computeEndDate - 1-day sprint ends on the same day as start", () => {
  assertEquals(computeEndDate("2025-01-15", 1), "2025-01-15");
});

Deno.test("computeEndDate - crosses month boundary correctly", () => {
  // Jan 28 + 13 days = Feb 10 (28 + 14 - 1 = 41, Jan has 31 days → Feb 10)
  assertEquals(computeEndDate("2025-01-28", 14), "2025-02-10");
});

Deno.test("calcDaysRemaining - past end date returns 0", () => {
  assertEquals(calcDaysRemaining("2000-01-01"), 0);
});

Deno.test("calcDaysRemaining - far future end date returns positive number", () => {
  const days = calcDaysRemaining("2099-12-31");
  assertEquals(days > 0, true);
});

// ---------------------------------------------------------------------------
// Field value extractors
// ---------------------------------------------------------------------------

Deno.test("getFieldValue - matching field ID: returns the field value node", () => {
  const fv = makeFieldValue("F_1", { text: "hello" });
  const item = makeItem({ fieldValues: { nodes: [fv] } });
  const result = getFieldValue(item, "F_1");
  assertEquals(result, fv);
});

Deno.test("getFieldValue - non-matching field ID: returns undefined", () => {
  const fv = makeFieldValue("F_1");
  const item = makeItem({ fieldValues: { nodes: [fv] } });
  assertEquals(getFieldValue(item, "F_MISSING"), undefined);
});

Deno.test("getFieldValue - empty fieldValues: returns undefined", () => {
  const item = makeItem();
  assertEquals(getFieldValue(item, "F_1"), undefined);
});

Deno.test("getNumberFieldValue - field with number: returns the number", () => {
  const fv = makeFieldValue("F_SP", { number: 8 });
  const item = makeItem({ fieldValues: { nodes: [fv] } });
  assertEquals(getNumberFieldValue(item, "F_SP"), 8);
});

Deno.test("getNumberFieldValue - field not present: returns null", () => {
  const item = makeItem();
  assertEquals(getNumberFieldValue(item, "F_SP"), null);
});

Deno.test("getStatusValue - field with name and optionId: returns { name, optionId }", () => {
  const fv = makeFieldValue("F_STATUS", {
    __typename: "ProjectV2ItemFieldSingleSelectValue",
    name: "In Progress",
    optionId: "OPT_1",
  });
  const item = makeItem({ fieldValues: { nodes: [fv] } });
  assertEquals(getStatusValue(item, "F_STATUS"), {
    name: "In Progress",
    optionId: "OPT_1",
  });
});

Deno.test("getStatusValue - field not present: returns null", () => {
  const item = makeItem();
  assertEquals(getStatusValue(item, "F_STATUS"), null);
});

Deno.test("getStatusValue - field present but name undefined: returns null", () => {
  const fv = makeFieldValue("F_STATUS", { optionId: "OPT_1" });
  const item = makeItem({ fieldValues: { nodes: [fv] } });
  assertEquals(getStatusValue(item, "F_STATUS"), null);
});

Deno.test("getIterationValue - field with iterationId and title: returns { iterationId, title }", () => {
  const fv = makeFieldValue("F_SPRINT", {
    __typename: "ProjectV2ItemFieldIterationValue",
    iterationId: "ITER_1",
    title: "Sprint 1",
  });
  const item = makeItem({ fieldValues: { nodes: [fv] } });
  assertEquals(getIterationValue(item, "F_SPRINT"), {
    iterationId: "ITER_1",
    title: "Sprint 1",
  });
});

Deno.test("getIterationValue - field not present: returns null", () => {
  const item = makeItem();
  assertEquals(getIterationValue(item, "F_SPRINT"), null);
});

// ---------------------------------------------------------------------------
// Item classification
// ---------------------------------------------------------------------------

Deno.test("isBacklogItem - not archived, no sprint assigned: returns true", () => {
  const item = makeItem();
  assertEquals(isBacklogItem(item, "F_SPRINT"), true);
});

Deno.test("isBacklogItem - not archived, sprint assigned: returns false", () => {
  const fv = makeFieldValue("F_SPRINT", {
    __typename: "ProjectV2ItemFieldIterationValue",
    iterationId: "ITER_1",
    title: "Sprint 1",
  });
  const item = makeItem({ fieldValues: { nodes: [fv] } });
  assertEquals(isBacklogItem(item, "F_SPRINT"), false);
});

Deno.test("isBacklogItem - archived item with no sprint: returns false", () => {
  const item = makeItem({ isArchived: true });
  assertEquals(isBacklogItem(item, "F_SPRINT"), false);
});

// ---------------------------------------------------------------------------
// Item content accessors
// ---------------------------------------------------------------------------

Deno.test("getItemTitle - DraftIssue: returns content.title", () => {
  const item = makeItem();
  assertEquals(getItemTitle(item), "My Draft");
});

Deno.test("getItemTitle - Issue: returns content.title", () => {
  const item = makeItem({
    type: "Issue",
    content: {
      __typename: "Issue",
      id: "I_1",
      number: 42,
      title: "Bug fix",
      url: "https://github.com/owner/repo/issues/42",
      state: "OPEN",
      body: "",
      assignees: { nodes: [] },
      labels: { nodes: [] },
      milestone: null,
      repository: { name: "repo", nameWithOwner: "owner/repo" },
    },
  });
  assertEquals(getItemTitle(item), "Bug fix");
});

Deno.test("getItemTitle - null content: returns '(no title)'", () => {
  const item = makeItem({ content: null });
  assertEquals(getItemTitle(item), "(no title)");
});

Deno.test("getItemNumber - DraftIssue (no number): returns null", () => {
  const item = makeItem();
  assertEquals(getItemNumber(item), null);
});

Deno.test("getItemNumber - Issue: returns the number", () => {
  const item = makeItem({
    type: "Issue",
    content: {
      __typename: "Issue",
      id: "I_1",
      number: 42,
      title: "Bug",
      url: "https://github.com/owner/repo/issues/42",
      state: "OPEN",
      body: "",
      assignees: { nodes: [] },
      labels: { nodes: [] },
      milestone: null,
      repository: { name: "repo", nameWithOwner: "owner/repo" },
    },
  });
  assertEquals(getItemNumber(item), 42);
});

Deno.test("getItemUrl - DraftIssue (no url): returns null", () => {
  const item = makeItem();
  assertEquals(getItemUrl(item), null);
});

Deno.test("getItemUrl - Issue: returns the url", () => {
  const url = "https://github.com/owner/repo/issues/42";
  const item = makeItem({
    type: "Issue",
    content: {
      __typename: "Issue",
      id: "I_1",
      number: 42,
      title: "Bug",
      url,
      state: "OPEN",
      body: "",
      assignees: { nodes: [] },
      labels: { nodes: [] },
      milestone: null,
      repository: { name: "repo", nameWithOwner: "owner/repo" },
    },
  });
  assertEquals(getItemUrl(item), url);
});

Deno.test("getItemAssignees - Issue with two assignees: returns login array", () => {
  const item = makeItem({
    type: "Issue",
    content: {
      __typename: "Issue",
      id: "I_1",
      number: 1,
      title: "Task",
      url: "https://github.com/owner/repo/issues/1",
      state: "OPEN",
      body: "",
      assignees: { nodes: [{ login: "alice" }, { login: "bob" }] },
      labels: { nodes: [] },
      milestone: null,
      repository: { name: "repo", nameWithOwner: "owner/repo" },
    },
  });
  assertEquals(getItemAssignees(item), ["alice", "bob"]);
});

Deno.test("getItemAssignees - null content: returns empty array", () => {
  const item = makeItem({ content: null });
  assertEquals(getItemAssignees(item), []);
});

Deno.test("getItemAssignees - DraftIssue no assignees: returns empty array", () => {
  const item = makeItem();
  assertEquals(getItemAssignees(item), []);
});

// ---------------------------------------------------------------------------
// Aggregation helpers
// ---------------------------------------------------------------------------

Deno.test("sumStoryPoints - two items with points 3 and 5: returns 8", () => {
  const item1 = makeItem({
    id: "PVTI_1",
    fieldValues: { nodes: [makeFieldValue("F_SP", { number: 3 })] },
  });
  const item2 = makeItem({
    id: "PVTI_2",
    fieldValues: { nodes: [makeFieldValue("F_SP", { number: 5 })] },
  });
  assertEquals(sumStoryPoints([item1, item2], "F_SP"), 8);
});

Deno.test("sumStoryPoints - item with no points field contributes 0", () => {
  const item1 = makeItem({
    id: "PVTI_1",
    fieldValues: { nodes: [makeFieldValue("F_SP", { number: 3 })] },
  });
  const item2 = makeItem({ id: "PVTI_2" }); // no story points field
  assertEquals(sumStoryPoints([item1, item2], "F_SP"), 3);
});

Deno.test("sumStoryPoints - null fieldId: returns 0 immediately", () => {
  const item = makeItem({
    fieldValues: { nodes: [makeFieldValue("F_SP", { number: 5 })] },
  });
  assertEquals(sumStoryPoints([item], null), 0);
});

Deno.test("sumStoryPoints - empty items array: returns 0", () => {
  assertEquals(sumStoryPoints([], "F_SP"), 0);
});
