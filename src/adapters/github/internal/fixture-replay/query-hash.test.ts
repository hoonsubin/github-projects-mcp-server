import { assertEquals } from "@std/assert";
import {
  computeQueryHash,
  extractOperationName,
  hashToFilename,
  stableVariablesJson,
} from "./query-hash.ts";

Deno.test("extractOperationName — named query", () => {
  const query = "query GetProjectItems($id: ID!) { node(id: $id) { ... } }";
  assertEquals(extractOperationName(query), "GetProjectItems");
});

Deno.test("stableVariablesJson — sorts object keys", () => {
  assertEquals(
    stableVariablesJson({ z: 1, a: 2 }),
    '{"a":2,"z":1}',
  );
});

Deno.test("computeQueryHash — stable across key order", () => {
  const query = "query Foo { x }";
  const h1 = computeQueryHash(query, { b: 1, a: 2 });
  const h2 = computeQueryHash(query, { a: 2, b: 1 });
  assertEquals(h1, h2);
  assertEquals(h1.startsWith("Foo:"), true);
});

Deno.test("hashToFilename — strips unsafe characters", () => {
  const slug = hashToFilename('GetFoo:{"a":1}');
  assertEquals(slug.includes(":"), false);
});
