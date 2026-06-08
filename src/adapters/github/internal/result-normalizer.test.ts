// =============================================================================
// src/adapters/github/internal/result-normalizer.test.ts
//
// Unit tests for buildNonCanonicalFieldPredicate and serializeFieldValuePayload.
// Uses FIXTURE_ITEM_WITH_CUSTOM_FIELDS from _test_fixtures.ts - the same data
// the production pipeline processes - so no hand-crafted mocks are needed.
// =============================================================================

import { assert, assertEquals, assertFalse } from "@std/assert";
import {
  buildNonCanonicalFieldPredicate,
  serializeFieldValuePayload,
} from "./result-normalizer.ts";
import { makeConfig } from "./_test_utils.ts";
import { FIXTURE_ITEM_WITH_CUSTOM_FIELDS } from "./_test_fixtures.ts";

const config = makeConfig();

// ── buildNonCanonicalFieldPredicate ───────────────────────────────────────────

Deno.test("buildNonCanonicalFieldPredicate - non-canonical date field passes", () => {
  const isNonCanonical = buildNonCanonicalFieldPredicate(config);
  const deadlineFv = FIXTURE_ITEM_WITH_CUSTOM_FIELDS.fieldValues.nodes
    .find((fv) => fv.field?.name === "Deadline");
  assert(deadlineFv);
  assert(isNonCanonical(deadlineFv));
});

Deno.test("buildNonCanonicalFieldPredicate - non-canonical text field passes", () => {
  const isNonCanonical = buildNonCanonicalFieldPredicate(config);
  const tqFv = FIXTURE_ITEM_WITH_CUSTOM_FIELDS.fieldValues.nodes
    .find((fv) => fv.field?.name === "Target Quarter");
  assert(tqFv);
  assert(isNonCanonical(tqFv));
});

Deno.test("buildNonCanonicalFieldPredicate - canonical Status field fails", () => {
  const isNonCanonical = buildNonCanonicalFieldPredicate(config);
  const statusFv = FIXTURE_ITEM_WITH_CUSTOM_FIELDS.fieldValues.nodes
    .find((fv) => fv.field?.name === "Status");
  assert(statusFv);
  assertFalse(isNonCanonical(statusFv));
});

Deno.test("buildNonCanonicalFieldPredicate - canonical Story Points field fails", () => {
  const isNonCanonical = buildNonCanonicalFieldPredicate(config);
  const spFv = FIXTURE_ITEM_WITH_CUSTOM_FIELDS.fieldValues.nodes
    .find((fv) => fv.field?.name === "Story Points");
  assert(spFv);
  assertFalse(isNonCanonical(spFv));
});

Deno.test("buildNonCanonicalFieldPredicate - canonical Type field fails", () => {
  const isNonCanonical = buildNonCanonicalFieldPredicate(config);
  const typeFv = FIXTURE_ITEM_WITH_CUSTOM_FIELDS.fieldValues.nodes
    .find((fv) => fv.field?.name === "Type");
  assert(typeFv);
  assertFalse(isNonCanonical(typeFv));
});

Deno.test("buildNonCanonicalFieldPredicate - canonical Priority field fails", () => {
  const isNonCanonical = buildNonCanonicalFieldPredicate(config);
  const prioFv = FIXTURE_ITEM_WITH_CUSTOM_FIELDS.fieldValues.nodes
    .find((fv) => fv.field?.name === "Priority");
  assert(prioFv);
  assertFalse(isNonCanonical(prioFv));
});

Deno.test("buildNonCanonicalFieldPredicate - canonical Sprint field fails", () => {
  const isNonCanonical = buildNonCanonicalFieldPredicate(config);
  const sprintFv = FIXTURE_ITEM_WITH_CUSTOM_FIELDS.fieldValues.nodes
    .find((fv) => fv.field?.name === "Sprint");
  assert(sprintFv);
  assertFalse(isNonCanonical(sprintFv));
});

Deno.test("buildNonCanonicalFieldPredicate - missing field name returns false", () => {
  const isNonCanonical = buildNonCanonicalFieldPredicate(config);
  assertFalse(isNonCanonical({ __typename: "Unknown", field: undefined as unknown as never }));
});

// ── serializeFieldValuePayload ────────────────────────────────────────────────

Deno.test("serializeFieldValuePayload - date field produces { date }", () => {
  const fv = FIXTURE_ITEM_WITH_CUSTOM_FIELDS.fieldValues.nodes
    .find((fv) => fv.field?.name === "Deadline")!;
  assertEquals(serializeFieldValuePayload(fv), { date: "2026-08-15" });
});

Deno.test("serializeFieldValuePayload - text field produces { text }", () => {
  const fv = FIXTURE_ITEM_WITH_CUSTOM_FIELDS.fieldValues.nodes
    .find((fv) => fv.field?.name === "Target Quarter")!;
  assertEquals(serializeFieldValuePayload(fv), { text: "Q3" });
});

Deno.test("serializeFieldValuePayload - single-select produces { name }", () => {
  const fv = FIXTURE_ITEM_WITH_CUSTOM_FIELDS.fieldValues.nodes
    .find((fv) => fv.field?.name === "Type")!;
  assertEquals(serializeFieldValuePayload(fv), { name: "User Story" });
});

Deno.test("serializeFieldValuePayload - iteration produces { title, startDate, duration, iterationId }", () => {
  const fv = FIXTURE_ITEM_WITH_CUSTOM_FIELDS.fieldValues.nodes
    .find((fv) => fv.field?.name === "Sprint")!;
  const payload = serializeFieldValuePayload(fv);
  assertEquals(payload.title, "Sprint 4");
  assertEquals(payload.iterationId, "07155ad6");
});

Deno.test("serializeFieldValuePayload - number field produces { number }", () => {
  const fv = FIXTURE_ITEM_WITH_CUSTOM_FIELDS.fieldValues.nodes
    .find((fv) => fv.field?.name === "Story Points")!;
  assertEquals(serializeFieldValuePayload(fv), { number: 3 });
});

Deno.test("serializeFieldValuePayload - labels field produces { labels }", () => {
  const fv = FIXTURE_ITEM_WITH_CUSTOM_FIELDS.fieldValues.nodes
    .find((fv) => fv.field?.name === "Labels")!;
  const payload = serializeFieldValuePayload(fv);
  assert(Array.isArray(payload.labels));
  assertEquals(payload.labels.length, 2);
});
