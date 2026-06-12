// =============================================================================
// src/tools/handler-errors.ts - Recoverable tool errors for agent self-correction
// =============================================================================

import { enrichError } from "../services/error-enrichment.ts";
import type { McpTextResult } from "./_mcp_result.ts";

/** Return isError result so the model sees recovery guidance (MCP SDK pattern). */
export const toToolErrorResult = (err: unknown): McpTextResult => ({
  content: [{ type: "text", text: enrichError(err) }],
  isError: true,
});
