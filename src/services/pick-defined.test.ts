import { assertEquals } from "@std/assert";
import { pickDefined } from "./pick-defined.ts";

Deno.test("pickDefined - includes property with non-undefined value", () => {
  const result = pickDefined({ a: 1, b: "hello" }, ["a"]);
  assertEquals(result, { a: 1 });
});

Deno.test("pickDefined - preserves null values (clear/set-to-null intent)", () => {
  const result = pickDefined({ a: null, b: undefined }, ["a", "b"]);
  assertEquals(result, { a: null });
});

Deno.test("pickDefined - skips properties with undefined values", () => {
  const result = pickDefined({ a: undefined, b: 42 }, ["a", "b"]);
  assertEquals(result, { b: 42 });
});

Deno.test("pickDefined - returns empty object when all values are undefined", () => {
  const result = pickDefined({ a: undefined }, ["a"]);
  assertEquals(result, {});
});

Deno.test("pickDefined - returns empty object for empty keys array", () => {
  const result = pickDefined({ a: 1 }, []);
  assertEquals(result, {});
});

Deno.test("pickDefined - handles exact UpdateStorySchema shape", () => {
  const params = {
    title: "New title",
    body: undefined,
    epic: null, // detach epic intent
    blocked_by: undefined,
    comment: "hello", // not in keys - should not appear
  };
  const result = pickDefined(params, ["title", "body", "epic", "blocked_by"]);
  assertEquals(result, { title: "New title", epic: null });
});

Deno.test("pickDefined - includes false (falsy but defined)", () => {
  assertEquals(pickDefined({ a: false }, ["a"]), { a: false });
});

Deno.test("pickDefined - includes 0 (falsy but defined)", () => {
  assertEquals(pickDefined({ a: 0 }, ["a"]), { a: 0 });
});

Deno.test("pickDefined - skips key absent from object entirely", () => {
  const obj = { b: 1 } as Record<string, unknown>;
  assertEquals(pickDefined(obj, ["a", "b"]), { b: 1 });
});
