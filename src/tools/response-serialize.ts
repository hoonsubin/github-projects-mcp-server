// =============================================================================
// src/tools/response-serialize.ts - Compact MCP payloads (omit noise, no pretty-print)
// =============================================================================

const STRIP_EMPTY_ARRAY_KEYS = new Set([
  "blocks",
  "dependency_map",
]);

const STRIP_EMPTY_OBJECT_KEYS = new Set(["custom_fields"]);

/** Max bytes for agent-visible tool text; structuredContent keeps the full payload. */
export const MAX_TOOL_TEXT_BYTES = 100_000;

const isEmptyValue = (key: string, value: unknown): boolean => {
  if (value === undefined) return true;
  if (value === "") return true;
  if (value === null) return false;

  if (Array.isArray(value) && value.length === 0) {
    return STRIP_EMPTY_ARRAY_KEYS.has(key);
  }

  if (
    key === "dependency_map" && (value === null || (Array.isArray(value) && value.length === 0))
  ) {
    return true;
  }

  if (key === "scope_summary" && typeof value === "object" && value !== null) {
    const s = value as { sprint_count?: unknown; backlog_count?: unknown };
    return s.sprint_count === null && s.backlog_count === null;
  }

  if (STRIP_EMPTY_OBJECT_KEYS.has(key) && typeof value === "object" && value !== null) {
    return Object.keys(value).length === 0;
  }

  if (key === "sprint" && typeof value === "object" && value !== null) {
    const sprint = value as { name?: unknown; ref?: { id?: string } };
    if (sprint.ref?.id === "") {
      const { ref: _ref, ...rest } = sprint as Record<string, unknown>;
      return Object.values(rest).every((v) => v === null || v === "");
    }
  }

  return false;
};

/** Recursively drop undefined, empty strings, and known noise keys. Keeps explicit nulls. */
export const stripEmpty = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(stripEmpty).filter((v) => v !== undefined);
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (child === undefined) continue;
      if (isEmptyValue(key, child)) continue;
      if (key === "sprint" && typeof child === "object" && child !== null) {
        const sprint = child as { name?: unknown; ref?: { id?: string } };
        if (sprint.ref?.id === "") {
          const slim = { ...sprint };
          delete (slim as { ref?: unknown }).ref;
          if (Object.keys(slim).length > 0) out[key] = stripEmpty(slim);
          continue;
        }
      }
      const stripped = stripEmpty(child);
      if (stripped === undefined) continue;
      if (isEmptyValue(key, stripped)) continue;
      out[key] = stripped;
    }
    return out;
  }
  return value;
};

const textByteLength = (text: string): number => new TextEncoder().encode(text).length;

const AGENT_HINT =
  "Response truncated for size. Narrow with sprint, intent, fields: compact, has_blockers, or a lower limit.";

/** Shrink oversized payloads for the agent text channel while preserving structuredContent. */
export const compactForAgentText = (
  payload: unknown,
): { readonly payload: unknown; readonly truncated: boolean } => {
  const current = stripEmpty(payload);
  let text = JSON.stringify(current);
  if (textByteLength(text) <= MAX_TOOL_TEXT_BYTES) {
    return { payload: current, truncated: false };
  }

  if (typeof current === "object" && current !== null && "items" in current) {
    const obj = current as Record<string, unknown>;
    const items = obj.items;
    if (Array.isArray(items) && items.length > 10) {
      const trimmed = stripEmpty({
        ...obj,
        items: items.slice(0, 10),
        _agent_hint: AGENT_HINT,
        _truncated: { items_shown: 10, items_total: items.length },
      });
      text = JSON.stringify(trimmed);
      if (textByteLength(text) <= MAX_TOOL_TEXT_BYTES) {
        return { payload: trimmed, truncated: true };
      }
    }
  }

  const preview = typeof current === "object" && current !== null
    ? {
      total_count: "total_count" in current
        ? (current as { total_count: unknown }).total_count
        : undefined,
      warnings: "warnings" in current ? (current as { warnings: unknown }).warnings : undefined,
    }
    : undefined;

  return {
    payload: stripEmpty({
      _truncated: true,
      _agent_hint: AGENT_HINT,
      preview,
    }),
    truncated: true,
  };
};

/** JSON.stringify without pretty-print for MCP text + structuredContent. */
export const serializeToolPayload = (payload: unknown): string => {
  const { payload: compact } = compactForAgentText(payload);
  return JSON.stringify(compact);
};
