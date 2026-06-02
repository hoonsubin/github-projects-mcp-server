// =============================================================================
// Shared helpers for scrum_* tool-surface contract tests.
// =============================================================================

import type { z } from "zod";
import { formatZodError, type McpTextResult, parseToolText } from "../../tools/_mcp_result.ts";

export const parseHandlerPayload = <T>(result: McpTextResult): T => parseToolText<T>(result);

export const assertHandlerSchema = <T>(
  result: McpTextResult,
  schema: z.ZodType<T>,
  label = "handler output",
): T => {
  const payload = parseToolText(result);
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new Error(`${label} failed schema validation:\n${formatZodError(parsed.error)}`);
  }
  return parsed.data;
};
