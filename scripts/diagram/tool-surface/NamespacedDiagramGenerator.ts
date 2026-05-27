// =============================================================================
// scripts/diagram/tool-surface/NamespacedDiagramGenerator.ts
//
// Assembles ExtractedClass[] + ExtractedRelationship[] into a Mermaid
// classDiagram string with namespace blocks.
//
// Colour coding
// ─────────────
// Each (namespace, stereotype) pair maps to a named classDef style.
// Classes whose names appear in `warningNodes` get a "_warn" variant:
// same fill colour but red text and a red 2px border.
//
// Usage:
//   const gen = new NamespacedDiagramGenerator(classes, relationships, warningNodes);
//   const mermaid = gen.generate();
// =============================================================================

import type { ExtractedClass, ExtractedRelationship, NamespaceName } from "./types.ts";

// ── Namespace display order ───────────────────────────────────────────────────

const NAMESPACE_ORDER: NamespaceName[] = [
  "TypeScriptTypes",
  "ZodSchemas",
  "ToolSurface",
];

// ── Colour definitions ────────────────────────────────────────────────────────
//
// Keys follow the pattern  <ns-prefix>_<stereotype-slug>
// Warning variants are derived at runtime by overriding stroke and color.
//
// TypeScriptTypes → blue/indigo family
// ZodSchemas      → green/teal family
// ToolSurface     → amber/orange family

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
function warnStyle(base: string): string {
  return base
    .replace(/\bstroke:#[0-9a-fA-F]+/, "stroke:#ef4444")
    .replace(/\bcolor:#[0-9a-fA-F]+/, "color:#dc2626") +
    ",stroke-width:2px";
}

// ── Style key derivation ──────────────────────────────────────────────────────

const NS_PREFIX: Record<NamespaceName, string> = {
  TypeScriptTypes: "ts",
  ZodSchemas: "zod",
  ToolSurface: "tool",
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

function getStyleKey(cls: ExtractedClass): string {
  const ns = NS_PREFIX[cls.namespace] ?? "ts";
  const ste = STEREO_SLUG[cls.stereotype ?? ""] ?? "type";
  const key = `${ns}_${ste}`;
  // Fall back to namespace-default if exact key has no definition
  return key in STYLE_DEFS ? key : `${ns}_type`;
}

// ── Generator ─────────────────────────────────────────────────────────────────

export class NamespacedDiagramGenerator {
  constructor(
    private readonly classes: ExtractedClass[],
    private readonly relationships: ExtractedRelationship[],
    private readonly warningNodes: Set<string> = new Set(),
  ) {}

  generate(): string {
    const lines: string[] = [];
    lines.push("classDiagram");
    lines.push("");

    // ── Namespace blocks ──────────────────────────────────────────────────
    for (const ns of NAMESPACE_ORDER) {
      const nsClasses = this.classes.filter((c) => c.namespace === ns);
      if (nsClasses.length === 0) continue;

      lines.push(`    namespace ${ns} {`);
      lines.push("");

      for (const cls of nsClasses) {
        lines.push(...this.emitClass(cls));
        lines.push("");
      }

      lines.push("    }");
      lines.push("");
    }

    // ── Relationships ─────────────────────────────────────────────────────
    const relLines = this.emitRelationships();
    if (relLines.length > 0) {
      lines.push(...relLines);
    }

    // ── classDef declarations ─────────────────────────────────────────────
    lines.push("");
    lines.push(...this.emitClassDefs());

    return lines.join("\n");
  }

  // ── classDef emission ───────────────────────────────────────────────────────
  //
  // Collects the distinct style keys actually used in this diagram and emits
  // one `classDef` per key plus a `_warn` variant.

  private emitClassDefs(): string[] {
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

  // ── Class emission ──────────────────────────────────────────────────────────
  //
  // The `:::styleName` is placed inline in the class declaration so that
  // Mermaid applies the colour even when the class is inside a namespace block.
  // Separate `class Name:::style` statements outside namespace blocks are
  // ignored by Mermaid for classes already declared inside a namespace.

  private emitClass(cls: ExtractedClass): string[] {
    const lines: string[] = [];
    const indent = "        ";

    const key = getStyleKey(cls);
    const variant = this.warningNodes.has(cls.name) ? `${key}_warn` : key;

    lines.push(`${indent}class ${cls.name}:::${variant} {`);

    if (cls.stereotype) {
      lines.push(`${indent}    <<${cls.stereotype}>>`);
    }

    for (const member of cls.members) {
      lines.push(`${indent}    ${member}`);
    }

    lines.push(`${indent}}`);
    return lines;
  }

  // ── Relationship emission ───────────────────────────────────────────────────
  //
  // Deduplicates: if the same (from, to, arrow) triple was collected more than
  // once (e.g. a field named "ref" and "blocked_by" both point to StoryRef),
  // only the first occurrence is emitted.

  private emitRelationships(): string[] {
    const lines: string[] = [];
    const seen = new Set<string>();

    const knownClassNames = new Set(this.classes.map((c) => c.name));

    for (const rel of this.relationships) {
      // Skip arrows to/from classes not in the diagram
      if (!knownClassNames.has(rel.from) || !knownClassNames.has(rel.to)) continue;

      const key = `${rel.from}${rel.arrow}${rel.to}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const label = rel.label ? ` : ${rel.label}` : "";
      lines.push(`    ${rel.from} ${rel.arrow} ${rel.to}${label}`);
    }

    return lines;
  }
}

// ── Two-pass collection helper ─────────────────────────────────────────────────
//
// The relationship extractors need a `knownNames` set to decide which arrows
// to emit.  This helper runs all extractors twice:
//   Pass 1: collect class names only (no relationships)
//   Pass 2: collect everything with the full known-names set populated
//
// Usage:
//   const { classes, relationships, warnings, warningNodes } = twoPassExtract(extractors);

export type ExtractorFn = (
  knownNames: Set<string>,
) => {
  classes: ExtractedClass[];
  relationships: ExtractedRelationship[];
  warnings?: string[];
  warningNodes?: Set<string>;
};

export function twoPassExtract(extractors: ExtractorFn[]): {
  classes: ExtractedClass[];
  relationships: ExtractedRelationship[];
  warnings: string[];
  warningNodes: Set<string>;
} {
  // Pass 1: names only (warnings and warningNodes discarded — re-emitted on pass 2)
  const knownNames = new Set<string>();
  for (const fn of extractors) {
    const { classes } = fn(new Set());
    for (const cls of classes) knownNames.add(cls.name);
  }

  // Pass 2: full extraction with relationship pruning
  const allClasses: ExtractedClass[] = [];
  const allRelationships: ExtractedRelationship[] = [];
  const allWarnings: string[] = [];
  const allWarningNodes = new Set<string>();

  for (const fn of extractors) {
    const { classes, relationships, warnings = [], warningNodes } = fn(knownNames);
    allClasses.push(...classes);
    allRelationships.push(...relationships);
    allWarnings.push(...warnings);
    if (warningNodes) {
      for (const n of warningNodes) allWarningNodes.add(n);
    }
  }

  return {
    classes: allClasses,
    relationships: allRelationships,
    warnings: allWarnings,
    warningNodes: allWarningNodes,
  };
}
