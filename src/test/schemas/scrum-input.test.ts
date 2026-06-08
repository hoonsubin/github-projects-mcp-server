// =============================================================================
// Input schema contract checks - pure Zod / MCP SDK validation (no tools layer)
// =============================================================================

import { assertEquals } from "@std/assert";
import { normalizeObjectSchema, safeParse } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import { z } from "zod";
import { UpdateStorySchema } from "../../schemas/scrum.ts";

Deno.test("UpdateStorySchema blocked_by - accepts array, null, and JSON string", () => {
  const shape = normalizeObjectSchema(UpdateStorySchema.shape);
  assertEquals(shape !== undefined, true);

  const arrayInput = {
    ref: { id: "PVTI_a" },
    blocked_by: [{ id: "PVTI_b" }],
  };
  assertEquals(safeParse(shape!, arrayInput).success, true);

  const nullInput = {
    ref: { id: "PVTI_a" },
    blocked_by: null,
  };
  const nullParsed = safeParse(shape!, nullInput);
  assertEquals(nullParsed.success, true);
  if (nullParsed.success) {
    assertEquals(nullParsed.data.blocked_by, []);
  }

  const stringInput = {
    ref: { id: "PVTI_a" },
    blocked_by: JSON.stringify([{ id: "PVTI_b" }]),
  };
  const stringParsed = safeParse(shape!, stringInput);
  assertEquals(stringParsed.success, true);
  if (stringParsed.success) {
    assertEquals(stringParsed.data.blocked_by, [{ id: "PVTI_b" }]);
  }
});

Deno.test("UpdateStorySchema blocked_by - z.toJSONSchema has top-level type array", () => {
  const json = z.toJSONSchema(UpdateStorySchema);
  const blockedBy = json.properties?.blocked_by as { type?: string } | undefined;
  assertEquals(blockedBy?.type, "array");
});
