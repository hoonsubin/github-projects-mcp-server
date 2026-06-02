// =============================================================================
// src/tools/_mcp_result.ts - MCP tool response helpers for contract tests
// =============================================================================

/** Shape returned by scrum tool handlers before MCP SDK wrapping. */
export interface McpTextResult {
  readonly content: ReadonlyArray<{ readonly type: "text"; readonly text: string }>;
  readonly structuredContent?: Record<string, unknown>;
}

export const toMcpTextResult = (payload: unknown): McpTextResult => ({
  content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
  structuredContent: payload as Record<string, unknown>,
});

/** Parse the JSON payload from a tool handler's text content block. */
export const parseToolText = <T>(result: McpTextResult): T => {
  const block = result.content[0];
  if (!block || block.type !== "text") {
    throw new Error("Expected tool result with a text content block");
  }
  return JSON.parse(block.text) as T;
};

/** Format Zod safeParse failures for test output. */
export const formatZodError = (error: {
  issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>;
}): string =>
  error.issues
    .map((issue) => `${issue.path.map(String).join(".") || "(root)"}: ${issue.message}`)
    .join("\n");
