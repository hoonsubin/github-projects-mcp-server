// =============================================================================
// scripts/diagram/LayerSurfaceStyler.ts — Layer-specific coloring for use-case
// and adapter layer class diagrams.
//
// Every stereotype maps to a style key prefixed by layer: "uc_" for
// UseCaseLayer and "ad_" for AdapterLayer. Warning variants use the same
// fill with red border and red text.
// =============================================================================

import type { ExtractedClass, NamespaceDef, NamespaceName } from "./types.ts";
import { DiagramStyler } from "./DiagramStyler.ts";

// ── Namespace display order ───────────────────────────────────────────────────

const LAYER_NAMESPACE_ORDER: NamespaceName[] = [
  "UseCaseLayer",
  "AdapterLayer",
];

// ── Layer prefix mapping ──────────────────────────────────────────────────────

const LAYER_NS_PREFIX: Record<string, string> = {
  UseCaseLayer: "uc",
  AdapterLayer: "ad",
};

// ── Stereotype slugs ──────────────────────────────────────────────────────────

const STEREO_SLUG: Record<string, string> = {
  class: "class",
  abstract: "abstract",
  interface: "interface",
  union: "union",
  branded: "branded",
  enumeration: "enum",
  "const-tuple": "tuple",
};

// ── Colour definitions ────────────────────────────────────────────────────────

const STYLE_DEFS: Record<string, string> = {
  // ── UseCaseLayer (blue/purple palette) ────────────────────────────────────
  uc_class: "fill:#dbeafe,stroke:#3b82f6,color:#1e3a8a",
  uc_abstract: "fill:#e0e7ff,stroke:#6366f1,color:#312e81",
  uc_interface: "fill:#ede9fe,stroke:#8b5cf6,color:#4c1d95",
  uc_type: "fill:#bfdbfe,stroke:#3b82f6,color:#1e3a8a",
  uc_union: "fill:#e0e7ff,stroke:#6366f1,color:#312e81",
  uc_branded: "fill:#ede9fe,stroke:#8b5cf6,color:#4c1d95",
  uc_enum: "fill:#fce7f3,stroke:#ec4899,color:#831843",
  uc_tuple: "fill:#fef3c7,stroke:#f59e0b,color:#78350f",

  // ── AdapterLayer (green/amber palette) ────────────────────────────────────
  ad_class: "fill:#dcfce7,stroke:#22c55e,color:#14532d",
  ad_abstract: "fill:#d1fae5,stroke:#14b8a6,color:#134e4a",
  ad_interface: "fill:#ccfbf1,stroke:#14b8a6,color:#134e4a",
  ad_type: "fill:#fef3c7,stroke:#f59e0b,color:#78350f",
  ad_union: "fill:#fef3c7,stroke:#f59e0b,color:#78350f",
  ad_branded: "fill:#ede9fe,stroke:#8b5cf6,color:#4c1d95",
  ad_enum: "fill:#fce7f3,stroke:#ec4899,color:#831843",
  ad_tuple: "fill:#fef3c7,stroke:#f59e0b,color:#78350f",
};

/** Derive a warning-variant style: same fill, red border + red text. */
const warnStyle = (base: string): string => {
  return base
    .replace(/\bstroke:#[0-9a-fA-F]+/, "stroke:#ef4444")
    .replace(/\bcolor:#[0-9a-fA-F]+/, "color:#dc2626") +
    ",stroke-width:2px";
};

// ── Style key derivation ──────────────────────────────────────────────────────

const getStyleKey = (cls: ExtractedClass): string => {
  const ns = LAYER_NS_PREFIX[cls.namespace] ?? "uc";
  const ste = STEREO_SLUG[cls.stereotype ?? ""] ?? "type";
  const key = `${ns}_${ste}`;
  return key in STYLE_DEFS ? key : `${ns}_type`;
};

// ── LayerSurfaceStyler ─────────────────────────────────────────────────────────

export class LayerSurfaceStyler extends DiagramStyler<ExtractedClass> {
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
    for (const ns of LAYER_NAMESPACE_ORDER) {
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
