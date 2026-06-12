// =============================================================================
// src/tools/response-serialize.test.ts
// =============================================================================

import { assertEquals, assertMatch } from "@std/assert";
import { compactForAgentText, MAX_TOOL_TEXT_BYTES } from "./response-serialize.ts";

Deno.test("compactForAgentText - trims large item arrays", () => {
  const items = Array.from({ length: 200 }, (_, i) => ({
    ref: { id: `id-${i}`, key: `${i}` },
    title: "x".repeat(500),
    status: "In Progress",
    story_points: 3,
    blocked_by: [],
  }));

  const { payload, truncated } = compactForAgentText({
    items,
    total_count: 200,
  });

  assertEquals(truncated, true);
  const parsed = payload as { items: unknown[]; _agent_hint: string };
  assertEquals(parsed.items.length, 10);
  assertMatch(parsed._agent_hint, /truncated/i);
});

Deno.test("compactForAgentText - passes through small payloads", () => {
  const payload = { items: [{ ref: { id: "1", key: "1" } }], total_count: 1 };
  const { truncated } = compactForAgentText(payload);
  assertEquals(truncated, false);
  assertEquals(JSON.stringify(compactForAgentText(payload).payload).length < MAX_TOOL_TEXT_BYTES, true);
});
