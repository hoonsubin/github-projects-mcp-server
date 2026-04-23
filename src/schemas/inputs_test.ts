import { assertEquals, assertStringIncludes } from "@std/assert";
import { resolveFieldValue } from "./inputs.ts";

// ── clear ────────────────────────────────────────────────────────────────────

Deno.test("resolveFieldValue - clear: returns isClear true", () => {
  const result = resolveFieldValue({ type: "clear" });
  assertEquals(result, { isClear: true });
});

// ── text ─────────────────────────────────────────────────────────────────────

Deno.test("resolveFieldValue - text with value: returns fieldValue { text }", () => {
  const result = resolveFieldValue({ type: "text", value: "hello" });
  assertEquals(result, { isClear: false, fieldValue: { text: "hello" } });
});

Deno.test("resolveFieldValue - text missing value: returns error string mentioning 'value'", () => {
  const result = resolveFieldValue({ type: "text" });
  assertEquals(typeof result, "string");
  assertStringIncludes(result as string, "value");
});

// ── number ───────────────────────────────────────────────────────────────────

Deno.test("resolveFieldValue - number with number_value: returns fieldValue { number }", () => {
  const result = resolveFieldValue({ type: "number", number_value: 5 });
  assertEquals(result, { isClear: false, fieldValue: { number: 5 } });
});

Deno.test("resolveFieldValue - number zero is a valid value", () => {
  const result = resolveFieldValue({ type: "number", number_value: 0 });
  assertEquals(result, { isClear: false, fieldValue: { number: 0 } });
});

Deno.test("resolveFieldValue - number missing number_value: returns error string", () => {
  const result = resolveFieldValue({ type: "number" });
  assertEquals(typeof result, "string");
  assertStringIncludes(result as string, "number_value");
});

// ── date ─────────────────────────────────────────────────────────────────────

Deno.test("resolveFieldValue - date valid YYYY-MM-DD: returns fieldValue { date }", () => {
  const result = resolveFieldValue({ type: "date", value: "2025-03-15" });
  assertEquals(result, { isClear: false, fieldValue: { date: "2025-03-15" } });
});

Deno.test("resolveFieldValue - date missing value: returns error string", () => {
  const result = resolveFieldValue({ type: "date" });
  assertEquals(typeof result, "string");
  assertStringIncludes(result as string, "value");
});

Deno.test("resolveFieldValue - date MM/DD/YYYY format: returns error mentioning YYYY-MM-DD", () => {
  const result = resolveFieldValue({ type: "date", value: "15/03/2025" });
  assertEquals(typeof result, "string");
  assertStringIncludes(result as string, "YYYY-MM-DD");
  assertStringIncludes(result as string, "15/03/2025");
});

Deno.test("resolveFieldValue - date partial YYYY-MM format: returns error mentioning YYYY-MM-DD", () => {
  const result = resolveFieldValue({ type: "date", value: "2025-03" });
  assertEquals(typeof result, "string");
  assertStringIncludes(result as string, "YYYY-MM-DD");
});

// ── single_select ─────────────────────────────────────────────────────────────

Deno.test("resolveFieldValue - single_select with option_id: returns fieldValue { singleSelectOptionId }", () => {
  const result = resolveFieldValue({ type: "single_select", option_id: "OPT_abc" });
  assertEquals(result, { isClear: false, fieldValue: { singleSelectOptionId: "OPT_abc" } });
});

Deno.test("resolveFieldValue - single_select missing option_id: returns error string mentioning 'option_id'", () => {
  const result = resolveFieldValue({ type: "single_select" });
  assertEquals(typeof result, "string");
  assertStringIncludes(result as string, "option_id");
});

// ── iteration ────────────────────────────────────────────────────────────────

Deno.test("resolveFieldValue - iteration with iteration_id: returns fieldValue { iterationId }", () => {
  const result = resolveFieldValue({ type: "iteration", iteration_id: "ITER_xyz" });
  assertEquals(result, { isClear: false, fieldValue: { iterationId: "ITER_xyz" } });
});

Deno.test("resolveFieldValue - iteration missing iteration_id: returns error string mentioning 'iteration_id'", () => {
  const result = resolveFieldValue({ type: "iteration" });
  assertEquals(typeof result, "string");
  assertStringIncludes(result as string, "iteration_id");
});
