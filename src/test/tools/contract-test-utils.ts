// =============================================================================
// Shared helpers for scrum_* tool-surface contract tests.
// =============================================================================

import { type z, z as zod } from "zod";
import {
  getParseErrorMessage,
  normalizeObjectSchema,
  safeParse,
} from "@modelcontextprotocol/sdk/server/zod-compat.js";
import { formatZodError, type McpTextResult, parseToolText } from "../../tools/_mcp_result.ts";

export const parseHandlerPayload = <T>(result: McpTextResult): T => parseToolText<T>(result);

/** Raw shape registered as outputSchema on a tool (e.g. OrientResultSchema.shape). */
export type McpOutputShape = Record<string, z.ZodType>;

/**
 * Mirrors MCP SDK validateToolOutput: requires structuredContent and parses it
 * with normalizeObjectSchema(outputShape) — same path as runtime CallTool.
 */
export const assertMcpToolOutput = (
  result: McpTextResult,
  outputShape: McpOutputShape,
  label = "MCP tool output",
): Record<string, unknown> => {
  if (!result.structuredContent) {
    throw new Error(
      `${label}: missing structuredContent (MCP SDK rejects with -32602)`,
    );
  }
  const outputObj = normalizeObjectSchema(outputShape);
  if (!outputObj) {
    throw new Error(`${label}: could not normalize output shape for MCP validation`);
  }
  const parsed = safeParse(outputObj, result.structuredContent);
  if (!parsed.success) {
    const error = "error" in parsed ? parsed.error : "Unknown error";
    throw new Error(
      `${label}: MCP output validation failed: ${getParseErrorMessage(error)}`,
    );
  }
  return result.structuredContent;
};

const objectShapeFromSchema = (schema: z.ZodType): McpOutputShape | undefined => {
  if (schema instanceof zod.ZodObject) {
    return schema.shape as McpOutputShape;
  }
  return undefined;
};

/**
 * Validates handler results the way agents and MCP both consume them:
 * - structuredContent against the strict output schema (and MCP .shape parser)
 * - text content block after JSON round-trip (agent-visible path)
 */
export const assertHandlerSchema = <T>(
  result: McpTextResult,
  schema: z.ZodType<T>,
  label = "handler output",
  mcpOutputShape: McpOutputShape | undefined = objectShapeFromSchema(schema),
): T => {
  if (!result.structuredContent) {
    throw new Error(`${label}: missing structuredContent`);
  }

  const structuredParsed = schema.safeParse(result.structuredContent);
  if (!structuredParsed.success) {
    throw new Error(
      `${label} structuredContent failed schema validation:\n${
        formatZodError(structuredParsed.error)
      }`,
    );
  }

  const textParsed = schema.safeParse(parseToolText(result));
  if (!textParsed.success) {
    throw new Error(
      `${label} text content failed schema validation:\n${formatZodError(textParsed.error)}`,
    );
  }

  if (mcpOutputShape) {
    assertMcpToolOutput(result, mcpOutputShape, label);
  }

  return structuredParsed.data;
};
