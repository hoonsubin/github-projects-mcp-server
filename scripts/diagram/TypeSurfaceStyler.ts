// =============================================================================
// scripts/diagram/TypeSurfaceStyler.ts — Stereotype-based coloring for type-surface diagrams
// =============================================================================

import type { ExtractedClass, NamespaceDef, NamespaceName } from "./types.ts";
import { DiagramStyler } from "./DiagramStyler.ts";

// ── Namespace display order ───────────────────────────────────────────────────

const NAMESPACE_ORDER: NamespaceName[] = [
  "TypeScriptTypes",
  "ZodSchemas",
  "ToolSurface",
  "UseCaseLayer",
  "AdapterLayer",
];

// ── Colour definitions ────────────────────────────────────────────────────────

const STYLE_DEFS: Record<string, string> = {
  // ── TypeScriptTypes ────────────────────────────────────────────────────────
  ts_interface: "fill:#dbeafe,stroke:#3b82f6,color:#1e3a8a",
  ts_union: "fill:#e0e7ff,stroke:#6366f1,color:#312e81",
  ts_branded: "fill:#ede9fe,stroke:#8b5cf6,color:#4c1d95",
  ts_enum: "fill:#fce7f3,stroke:#ec4899,color:#831843",
  ts_tuple: "fill:#fef3c7,stroke:#f59e0b,color:#78350f",
  ts_type: "fill:#bfdbfe,stroke:#3b82f6,color:#1e3a8a", // plain type alias

  // ── ZodSchemas ─────────────────────────────────────────────────────────────
  zod_args: "fill:#dcfce7,stroke:#22c55e,color:#14532d",
  zod_enum: "fill:#ccfbf1,stroke:#14b8a6,color:#134e4a",
  zod_type: "fill:#d1fae5,stroke:#22c55e,color:#14532d", // fallback

  // ── ToolSurface ────────────────────────────────────────────────────────────
  tool_read: "fill:#fef9c3,stroke:#eab308,color:#713f12",
  tool_write: "fill:#ffedd5,stroke:#f97316,color:#7c2d12",
  tool_legacy: "fill:#f3f4f6,stroke:#9ca3af,color:#374151",
  tool_type: "fill:#f3f4f6,stroke:#9ca3af,color:#374151", // fallback
};

/** Derive a warning-variant style: same fill, red text + red border. */
const warnStyle = (base: string): string => {
  return base
    .replace(/\bstroke:#[0-9a-fA-F]+/, "stroke:#ef4444")
    .replace(/\bcolor:#[0-9a-fA-F]+/, "color:#dc2626") +
    ",stroke-width:2px";
};

// ── Style key derivation ──────────────────────────────────────────────────────

const NS_PREFIX: Record<NamespaceName, string> = {
  TypeScriptTypes: "ts",
  ZodSchemas: "zod",
  ToolSurface: "tool",
  UseCaseLayer: "uc",
  AdapterLayer: "ad",
};

const STEREO_SLUG: Record<string, string> = {
  interface: "interface",
  union: "union",
  branded: "branded",
  enumeration: "enum",
  "const-tuple": "tuple",
  Arguments: "args",
  ReadTool: "read",
  WriteTool: "write",
  LegacyTool: "legacy",
};

const getStyleKey = (cls: ExtractedClass): string => {
  const ns = NS_PREFIX[cls.namespace] ?? "ts";
  const ste = STEREO_SLUG[cls.stereotype ?? ""] ?? "type";
  const key = `${ns}_${ste}`;
  // Fall back to namespace-default if exact key has no definition
  return key in STYLE_DEFS ? key : `${ns}_type`;
};

// ── TypeSurfaceStyler ──────────────────────────────────────────────────────────

export class TypeSurfaceStyler extends DiagramStyler<ExtractedClass> {
  constructor(
    private readonly classes: ExtractedClass[],
    private readonly warningNodes: Set<string>,
  ) {
    super();
  }

  getClassDefs(): string[] {
    const usedKeys = new Set<string>();
    for (const cls of this.classes) {
      usedKeys.add(getStyleKey(cls));
    }

    const lines: string[] = [];
    for (const key of [...usedKeys].sort()) {
      const base = STYLE_DEFS[key];
      if (!base) continue;
      lines.push(`    classDef ${key} ${base}`);
      lines.push(`    classDef ${key}_warn ${warnStyle(base)}`);
    }
    return lines;
  }

  getNamespaceDefs(): NamespaceDef<ExtractedClass>[] {
    const result: NamespaceDef<ExtractedClass>[] = [];
    for (const ns of NAMESPACE_ORDER) {
      const nsClasses = this.classes.filter((c) => c.namespace === ns);
      if (nsClasses.length === 0) continue;
      result.push({ name: ns, children: nsClasses });
    }
    return result;
  }

  getNodeStyle(node: ExtractedClass): string {
    const key = getStyleKey(node);
    return this.warningNodes.has(node.name) ? `${key}_warn` : key;
  }
}
