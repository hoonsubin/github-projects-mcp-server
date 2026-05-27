# Merge Type-Surface Diagram into Project Diagram — Implementation Plan

## Core Design Principle

Three parts, each responsible for a single concern:

1. **Type definitions** — all diagram data models live in [`scripts/diagram/types.ts`](scripts/diagram/types.ts)
2. **Styling strategy** — [`DiagramStyler`](scripts/diagram/DiagramStyler.ts) abstract base → concrete subclasses
3. **Generation template** — [`ClassDiagramGenerator`](scripts/diagram/ClassDiagramGenerator.ts) abstract base → concrete subclasses

This makes adding a future third diagram as simple as:

- New extractor function (pure data transformation)
- New concrete subclass of `DiagramStyler` (if colors differ)
- New concrete subclass of `ClassDiagramGenerator` (if relationships differ)
- Wire into [`generate-project-diagram.ts`](scripts/generate-project-diagram.ts) `main()`

## Objective

Refactor the entire diagram generation script so there is only one entry point ([`generate-project-diagram.ts`](scripts/generate-project-diagram.ts)), and calling that script will generate the same diagram outputs `docs/module-imports.mermaid` and `docs/type-surface.mermaid` while the implementation is modular and object-oriented.

**The CLI inputs and outputs must be identical to the current behavior. Only the implementation changes.**

### Known pre-existing bug — do not fix in this refactor

`generate-project-diagram.ts` line 61 contains:

```typescript
case "--include-external":
  includeExternal = false;  // BUG: should be true
```

This inverts the flag. Do **not** correct it here — fixing it would change CLI behavior and break the output-identity guarantee. Track it as a follow-up.

---

## Part 1 — Merged Type Definitions

Move ALL shared types into [`scripts/diagram/types.ts`](scripts/diagram/types.ts). This is the single source of truth for every data shape that crosses a file boundary.

### Existing types to keep (from `scripts/diagram/types.ts`):

| Type           | Purpose                               |
| -------------- | ------------------------------------- |
| `UnusedExport` | Module-imports unused-export tracking |
| `ExportInfo`   | Module export metadata                |
| `ImportInfo`   | Module import metadata                |
| `ExportKind`   | Union of export kinds                 |
| `ImportKind`   | Union of import kinds                 |
| `Layer`        | Architectural layer enum              |
| `LayerMapping` | Directory→layer config                |

### Types to merge in (from `scripts/diagram/tool-surface/types.ts`):

| Type                    | Purpose                                              |
| ----------------------- | ---------------------------------------------------- |
| `ExtractedClass`        | One class node in type-surface diagram               |
| `ExtractedRelationship` | One relationship arrow                               |
| `RelationshipArrow`     | Arrow kind union                                     |
| `NamespaceName`         | `"TypeScriptTypes" \| "ZodSchemas" \| "ToolSurface"` |

### New shared types to add (currently scattered or implicit):

```typescript
/**
 * Shared contract between DiagramStyler and ClassDiagramGenerator.
 * A named group of nodes that maps to one `namespace Name { ... }` block.
 * Defined here (not in DiagramStyler.ts) because it flows between the styler
 * and the generator — both depend on it, neither owns it.
 */
export interface NamespaceDef<T> {
  name: string;
  children: T[];
}

/**
 * Per-node data returned by ClassDiagramGenerator.getClassBody().
 * Carries `name` so the base class emitNode() can write `class Name:::style`
 * without a separate abstract getNodeName() method — keeping the node
 * contract in a single place.
 */
export interface ClassBodyResult {
  name: string; // identifier used in `class Name:::style`
  members: string[];
  stereotype: string | null;
}
```

### Types to consolidate or remove:

- **`ClassDiagramOptions`** — strip to only what `ModuleImportGenerator` still needs (`showUnusedExports`, `showDependencyArrows`). Remove `colorPalette`, `layerMapping`, and `showNameSpaces`: the first two move to `ModuleImportStylerOptions` (local to `ModuleImportStyler.ts`); `showNameSpaces` is an unused stub and should be deleted.
- **`NamespaceConfig`** (in `tool-surface/types.ts`) — only used as an inline config object in `generate-type-surface-diagram.ts`. Remove from types; the `CONFIG` object stays local in the entry-point script.
- **`ExtractorFn`** — stays in `twoPassExtract.ts` where it belongs.

### Result

```typescript
// scripts/diagram/types.ts — final shape

export interface UnusedExport extends ExportInfo {
  modulePathName: string;
}
export interface ExportInfo {
  name: string;
  kind: ExportKind;
  type?: string;
  returnType?: string;
}
export interface ImportInfo {
  name: string;
  kind: ImportKind;
  path: string;
  alias?: string;
}
export type ExportKind =
  | "class"
  | "function"
  | "interface"
  | "type"
  | "enum"
  | "const"
  | "let"
  | "var"
  | "module";
export type ImportKind = "named" | "default" | "namespace" | "type";
export enum Layer {
  FRAMEWORK = "Framework",
  USE_CASE = "Use-Case",
  ADAPTER = "Adapter",
  OTHER = "Other",
}
export interface LayerMapping {
  [prefix: string]: Layer;
}

// ── Shared diagram contracts ───────────────────────────────────────────────────
export interface NamespaceDef<T> {
  name: string;
  children: T[];
}
export interface ClassBodyResult {
  name: string;
  members: string[];
  stereotype: string | null;
}

// ── Module-import generator options ───────────────────────────────────────────
export interface ClassDiagramOptions {
  showUnusedExports?: boolean;
  showDependencyArrows?: boolean;
}

// ── Type-surface types ─────────────────────────────────────────────────────────
export interface ExtractedClass {
  name: string;
  stereotype: string | null;
  members: string[];
  namespace: NamespaceName;
  sourceFile: string;
}
export interface ExtractedRelationship {
  from: string;
  to: string;
  arrow: RelationshipArrow;
  label?: string;
}
export type RelationshipArrow = "-->" | "--|>" | "--*" | "..>";
export type NamespaceName = "TypeScriptTypes" | "ZodSchemas" | "ToolSurface";
```

---

## Part 2 — Abstract `DiagramStyler` Base

```typescript
// scripts/diagram/DiagramStyler.ts — abstract base only, no concrete logic

import type { NamespaceDef } from "./types.ts";

export abstract class DiagramStyler<T> {
  /** Return all `classDef` lines to append at the end of the diagram. */
  abstract getClassDefs(): string[];

  /**
   * Partition nodes into namespace groups in the order they should appear
   * in the diagram.  Each NamespaceDef maps to a `namespace Name { ... }` block.
   */
  abstract getNamespaceDefs(): NamespaceDef<T>[];

  /**
   * Return the Mermaid style-class name for a given node.
   * Used inline as `class Name:::styleName` in the class declaration.
   * The returned key must match one of the `classDef` keys from getClassDefs().
   */
  abstract getNodeStyle(node: T): string;
}
```

`NamespaceDef<T>` is imported from `types.ts` — not defined here — because it is a shared data contract between the styler and the generator.

### `ModuleImportStyler` (renamed from current `DiagramStyler`)

```typescript
// scripts/diagram/ModuleImportStyler.ts — concrete

// ModuleImportStylerOptions is a plain data shape, not an extensibility contract,
// so it is a `type` rather than an `interface`.
type ModuleImportStylerOptions = {
  colorPalette?: readonly string[];
  layerMapping?: LayerMapping;
};

export class ModuleImportStyler extends DiagramStyler<ParsedModule> {
  constructor(modules: ParsedModule[], options?: ModuleImportStylerOptions) { ... }

  // Returns `classDef ${folderName} fill:${color},...` strings (folder-based coloring)
  getClassDefs(): string[] { ... }

  // Returns namespace defs grouped by Layer enum (Framework/Use-Case/Adapter/Other)
  // Uses the layerMapping option (falls back to DEFAULT_LAYER_MAPPING).
  getNamespaceDefs(): NamespaceDef<ParsedModule>[] { ... }

  // Returns module.getParentFolderName() — must match a classDef key from getClassDefs()
  getNodeStyle(node: ParsedModule): string { return node.getParentFolderName(); }
}
```

`ModuleImportStylerOptions` stays local to this file; it is never used across modules.

### `TypeSurfaceStyler` (new — absorbs color logic from `NamespacedDiagramGenerator`)

```typescript
// scripts/diagram/TypeSurfaceStyler.ts — concrete

// ── Style constants (private to this file) ─────────────────────────────────────
// STYLE_DEFS, NS_PREFIX, STEREO_SLUG, warnStyle() are all defined here as
// module-level constants/functions.  They are NOT exported — they are an
// implementation detail of how this styler assigns colors.

const STYLE_DEFS: Record<string, string> = { ... };  // full map from NamespacedDiagramGenerator
const NS_PREFIX: Record<NamespaceName, string> = { TypeScriptTypes: "ts", ZodSchemas: "zod", ToolSurface: "tool" };
const STEREO_SLUG: Record<string, string> = { ... };
function warnStyle(base: string): string { ... }
function getStyleKey(cls: ExtractedClass): string { ... }

// ── Canonical namespace order ──────────────────────────────────────────────────
// getNamespaceDefs() MUST return groups in this fixed order so that the
// rendered diagram always shows TypeScriptTypes first, then ZodSchemas, then
// ToolSurface — regardless of which order nodes were collected.
const NAMESPACE_ORDER: NamespaceName[] = ["TypeScriptTypes", "ZodSchemas", "ToolSurface"];

export class TypeSurfaceStyler extends DiagramStyler<ExtractedClass> {
  constructor(
    private readonly classes: ExtractedClass[],
    private readonly warningNodes: Set<string>,
  ) { super(); }

  // Emits only classDef keys actually used in this diagram, plus their _warn variants.
  // Keys are emitted in alphabetical order (matching current NamespacedDiagramGenerator
  // behavior: [...usedKeys].sort()) to preserve byte-identical output.
  getClassDefs(): string[] { ... }

  // Groups classes by namespace; returns groups in NAMESPACE_ORDER; skips empty groups.
  getNamespaceDefs(): NamespaceDef<ExtractedClass>[] { ... }

  // Returns `${styleKey}` or `${styleKey}_warn` for warning nodes.
  // The key must match a classDef entry emitted by getClassDefs().
  getNodeStyle(node: ExtractedClass): string {
    const key = getStyleKey(node);
    return this.warningNodes.has(node.name) ? `${key}_warn` : key;
  }
}
```

**Note on `getClassDefs()` ordering:** The current `NamespacedDiagramGenerator.emitClassDefs()` sorts keys alphabetically (`[...usedKeys].sort()`). `TypeSurfaceStyler` must preserve this same sort to ensure the output `type-surface.mermaid` is byte-identical to the pre-refactor file.

---

## Part 3 — Abstract `ClassDiagramGenerator` Base

```typescript
// scripts/diagram/ClassDiagramGenerator.ts — abstract base only

import type { ClassBodyResult, NamespaceDef } from "./types.ts";
import type { DiagramStyler } from "./DiagramStyler.ts";

export abstract class ClassDiagramGenerator<T> {
  constructor(protected readonly styler: DiagramStyler<T>) {}

  /**
   * Template method — assembles the complete Mermaid diagram string.
   * Subclasses provide the three abstract pieces below.
   */
  generate(): string {
    const lines: string[] = [];
    lines.push(...this.getHeaderLines(), "");

    for (const ns of this.styler.getNamespaceDefs()) {
      lines.push(`    namespace ${ns.name} {`, "");
      for (const child of ns.children) {
        lines.push(...this.emitNode(child));
      }
      lines.push("    }", "");
    }

    lines.push(...this.getRelationshipLines(), "");
    lines.push(...this.styler.getClassDefs());

    return lines.join("\n");
  }

  /** First lines of the output, e.g. `["classDiagram", "    direction LR"]`. */
  protected abstract getHeaderLines(): string[];

  /**
   * All data needed to emit one node.
   * `name` is the identifier written into `class Name:::style`.
   * Returning `name` here (rather than via a separate abstract method) keeps
   * the node contract in a single place and avoids a redundant traversal.
   */
  protected abstract getClassBody(node: T): ClassBodyResult;

  /** All relationship lines, e.g. `"    A --> B : \"imports\""`. */
  protected abstract getRelationshipLines(): string[];

  private emitNode(node: T): string[] {
    const { name, members, stereotype } = this.getClassBody(node);
    const style = this.styler.getNodeStyle(node);
    const lines: string[] = [];
    lines.push(`        class ${name}:::${style} {`);
    if (stereotype) lines.push(`            <<${stereotype}>>`);
    for (const m of members) lines.push(`            ${m}`);
    lines.push(`        }`, "");
    return lines;
  }
}
```

Key design decisions:

- `ClassBodyResult` (from `types.ts`) carries `name` so there is no phantom `getNodeName(node: T)` free function. The base class needs no extra abstract method to get a node's display name.
- `NamespaceDef<T>` is imported from `types.ts`, keeping the type in one place.

### `ModuleImportGenerator` (refactored from current `ClassDiagramGenerator`)

```typescript
// scripts/diagram/ModuleImportGenerator.ts — concrete

// Move these from the current ClassDiagramGenerator.ts into this file as
// private module-level constants (they are only used here):
//   - exportFormatters (the Record<ExportKind, formatter> map)
//   - formatExportAsMember() (the dispatch function)
//   - type MermaidClassNode = Map<string, ParsedModule>

export class ModuleImportGenerator extends ClassDiagramGenerator<ParsedModule> {
  // Initialized lazily on first call to getRelationshipLines() to avoid
  // doing work in the constructor (P2 pattern).
  private nodeMap: Map<string, ParsedModule> | null = null;

  constructor(
    private readonly modules: ParsedModule[],
    private readonly unusedExports: UnusedExport[],
    styler: ModuleImportStyler,
    private readonly options?: ClassDiagramOptions,
  ) {
    super(styler);
  }

  protected getHeaderLines(): string[] {
    return ["classDiagram", "    direction LR"];
  }

  protected getClassBody(mod: ParsedModule): ClassBodyResult {
    const members: string[] = mod.getExports().map(formatExportAsMember);
    if (this.options?.showUnusedExports) {
      const unused = this.unusedExports.filter(e => e.modulePathName === mod.filePathName);
      if (unused.length > 0) {
        members.push(`%% Unused: ${unused.map(u => u.name).join(", ")}`);
      }
    }
    return { name: mod.getMermaidClassName(), members, stereotype: null };
  }

  protected getRelationshipLines(): string[] {
    // Returns deduplicated import-based arrows: `modName --> targetModName : "imports"`
    // Skips when showDependencyArrows is false (default true).
    // Calls ensureNodeMap() on first invocation.
    ...
  }

  private ensureNodeMap(): Map<string, ParsedModule> {
    if (this.nodeMap) return this.nodeMap;
    const map = new Map<string, ParsedModule>();
    for (const ns of this.styler.getNamespaceDefs()) {
      for (const mod of ns.children) {
        map.set(mod.getMermaidClassName(), mod);
      }
    }
    this.nodeMap = map;
    return map;
  }
}
```

**Notes:**

- `exportFormatters`, `formatExportAsMember`, and `type MermaidClassNode` move from the current `ClassDiagramGenerator.ts` into `ModuleImportGenerator.ts` as private module-level items.
- The `findUnusedExports()` instance method on the current `ClassDiagramGenerator` is dead code — `helpers.findUnusedExports(modules)` already handles this in the entry-point script and is the canonical location. Delete it; do not carry it forward.
- `nodeMap` is built lazily in `ensureNodeMap()` rather than in the constructor, keeping the constructor free of side effects.

### `TypeSurfaceGenerator` (new — absorbs `NamespacedDiagramGenerator`)

```typescript
// scripts/diagram/TypeSurfaceGenerator.ts — concrete

export class TypeSurfaceGenerator extends ClassDiagramGenerator<ExtractedClass> {
  constructor(
    private readonly classes: ExtractedClass[],
    private readonly relationships: ExtractedRelationship[],
    styler: TypeSurfaceStyler,
  ) {
    super(styler);
  }

  protected getHeaderLines(): string[] {
    return ["classDiagram"];  // no "direction LR" — layout is auto
  }

  protected getClassBody(cls: ExtractedClass): ClassBodyResult {
    return { name: cls.name, members: cls.members, stereotype: cls.stereotype };
  }

  protected getRelationshipLines(): string[] {
    // Deduplicated (from, to, arrow) arrow emission from ExtractedRelationship[].
    // Skips arrows where either endpoint is not in the known classes set.
    ...
  }
}
```

---

## Part 4 — Standalone Utility: `twoPassExtract.ts`

Extract from `NamespacedDiagramGenerator.ts` into its own file:

```typescript
// scripts/diagram/twoPassExtract.ts

import type { ExtractedClass, ExtractedRelationship } from "./types.ts";

export type ExtractorFn = (knownNames: Set<string>) => {
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
  // Pass 1: collect class names only
  const knownNames = new Set<string>();
  for (const fn of extractors) {
    const { classes } = fn(new Set());
    for (const cls of classes) knownNames.add(cls.name);
  }

  // Pass 2: full extraction with relationship pruning against known names
  const allClasses: ExtractedClass[] = [];
  const allRelationships: ExtractedRelationship[] = [];
  const allWarnings: string[] = [];
  const allWarningNodes = new Set<string>();

  for (const fn of extractors) {
    const { classes, relationships, warnings = [], warningNodes } = fn(knownNames);
    allClasses.push(...classes);
    allRelationships.push(...relationships);
    allWarnings.push(...warnings);
    if (warningNodes) { for (const n of warningNodes) allWarningNodes.add(n); }
  }

  return {
    classes: allClasses,
    relationships: allRelationships,
    warnings: allWarnings,
    warningNodes: allWarningNodes,
  };
}
```

---

## Part 5 — Extractors (moved and adapted to accept `ParsedModule`)

The three extractors move from `scripts/diagram/tool-surface/` to `scripts/diagram/`. The only change per extractor is the signature: accept `ParsedModule` instead of `(filePath, source)`, then call `module.getModuleSource()` instead of `ts.createSourceFile()` (which `ParsedModule` already called in its constructor). This eliminates the duplicate parse.

All imports update from `./types.ts` to `./types.ts` — same file name, now at the new path.

**DomainTypeExtractor:**

```typescript
// Before:
export function extractDomainTypes(
  filePath: string, source: string, namespace: NamespaceName, knownNames: Set<string>
): DomainExtractorResult {
  const sourceFile = ts.createSourceFile(filePath, source, ...);
  ...
}

// After:
export function extractDomainTypes(
  module: ParsedModule, namespace: NamespaceName, knownNames: Set<string>
): DomainExtractorResult {
  const sourceFile = module.getModuleSource();   // already parsed — no extra cost
  // Use module.filePathName wherever filePath was used
  ...
}
```

**ZodSchemaExtractor:**

```typescript
// After:
export function extractZodSchemas(
  module: ParsedModule,
  namespace: NamespaceName,
  knownNames: Set<string>,
  schemaNameToClassName: Record<string, string> = {},
): ZodExtractorResult { ... }
```

**ToolRegistrationExtractor:**

```typescript
// After:
export function extractToolRegistrations(
  module: ParsedModule,
  namespace: NamespaceName,
  knownNames: Set<string>,
  schemaNameToClassName: Record<string, string> = {},
  responseMap: Record<string, string[]> = {},
): ToolExtractorResult { ... }
```

---

## Part 6 — Entry Point Changes

### `generate-project-diagram.ts` — unified `main()`

```
main()
├── parseArgs()
├── scanModules(src) → modules[]                (unchanged; parses ALL .ts files under src/)
├── findUnusedExports(modules) → unusedExports  (from helpers.ts, unchanged)
│
├── generate module-imports diagram
│   ├── new ModuleImportStyler(modules)
│   ├── new ModuleImportGenerator(modules, unusedExports, styler, options)
│   └── generator.generate() → moduleImportDiagram string
│
├── generate type-surface diagram
│   ├── filter modules[] by CONFIG file paths → typeSurfaceModules[]
│   │   (reuse already-parsed ParsedModule instances — do NOT re-read files)
│   ├── build ExtractorFn[] (one per file per namespace)
│   ├── twoPassExtract(extractors) → { classes, relationships, warnings, warningNodes }
│   ├── new TypeSurfaceStyler(classes, warningNodes)
│   ├── new TypeSurfaceGenerator(classes, relationships, styler)
│   └── generator.generate() → typeSurfaceDiagram string
│
├── generateMarkdownReport(unusedExports, moduleImportDiagram, outputDir)
│   └── embeds module-imports diagram in mermaid block + unused-exports table
│       (fixes existing bug: report currently emits an empty mermaid block)
│
└── save artifacts
    ├── report.md              (markdown report with embedded module-imports diagram)
    ├── module-imports.mermaid
    └── type-surface.mermaid   (written to same --output dir as other artifacts)
```

**Filtering already-scanned modules for type-surface extraction:**

`scanModules()` already parses every `.ts` file in `src/` into `ParsedModule` instances. The CONFIG files (`src/domain/types.ts`, `src/schemas/scrum.ts`, etc.) are a subset of those. Reuse them directly instead of creating new `ParsedModule` instances, which would re-invoke `ts.createSourceFile()` redundantly:

```typescript
// Resolve CONFIG paths to absolute paths the same way scanModules does
const domainModules = modules.filter((m) =>
  CONFIG.domainTypeFiles.some((p) => m.filePathName.endsWith(p))
);
const zodModules = modules.filter((m) =>
  CONFIG.zodSchemaFiles.some((p) => m.filePathName.endsWith(p))
);
const toolModules = modules.filter((m) => CONFIG.toolFiles.some((p) => m.filePathName.endsWith(p)));

// Then build extractors from those ParsedModule instances, not from raw file reads
const extractors: ExtractorFn[] = [
  ...domainModules.map((mod) => (known: Set<string>) =>
    extractDomainTypes(mod, "TypeScriptTypes", known)
  ),
  ...zodModules.map((mod) => (known: Set<string>) =>
    extractZodSchemas(mod, "ZodSchemas", known, CONFIG.schemaNameOverrides)
  ),
  ...toolModules.map((mod) => (known: Set<string>) =>
    extractToolRegistrations(
      mod,
      "ToolSurface",
      known,
      CONFIG.schemaNameOverrides,
      CONFIG.toolResponseMap,
    )
  ),
];
```

The type-surface `CONFIG` object (file lists, schema name overrides, tool response map) stays as a local `const` in this script — it has no reuse outside the entry point.

### `generate-type-surface-diagram.ts` — DELETE

All its logic is absorbed into `generate-project-diagram.ts main()`.

---

## Part 7 — Final Directory Structure

```
scripts/diagram/
├── types.ts                     ← merged: ALL data models + NamespaceDef<T> + ClassBodyResult
├── twoPassExtract.ts            ← standalone utility (extracted from NamespacedDiagramGenerator)
├── DiagramStyler.ts             ← abstract base class only
├── ModuleImportStyler.ts        ← concrete (folder-based coloring, replaces old DiagramStyler)
├── TypeSurfaceStyler.ts         ← concrete (stereotype-based coloring + STYLE_DEFS constants)
├── ClassDiagramGenerator.ts     ← abstract base class only
├── ModuleImportGenerator.ts     ← concrete (module-per-class diagram, replaces old ClassDiagramGenerator)
├── TypeSurfaceGenerator.ts      ← concrete (type-surface diagram, replaces NamespacedDiagramGenerator)
├── DomainTypeExtractor.ts       ← moved from tool-surface/, adapted to ParsedModule
├── ZodSchemaExtractor.ts        ← moved from tool-surface/, adapted to ParsedModule
├── ToolRegistrationExtractor.ts ← moved from tool-surface/, adapted to ParsedModule
├── ParsedModule.ts              ← unchanged
└── helpers.ts                   ← unchanged (resolveImport, findUnusedExports)
```

`scripts/diagram/tool-surface/` is deleted entirely after extractors are moved.

---

## Execution Steps

| #      | Action                                                                                                                                                                                                                                                                                                                                                                                    | Files Affected                                                                                                                           |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 1      | Merge all types: add `ExtractedClass`, `ExtractedRelationship`, `RelationshipArrow`, `NamespaceName`, `NamespaceDef<T>`, `ClassBodyResult` into `types.ts`; strip `ClassDiagramOptions` to two fields; delete `NamespaceConfig` from `tool-surface/types.ts`                                                                                                                              | [`scripts/diagram/types.ts`](scripts/diagram/types.ts), [`scripts/diagram/tool-surface/types.ts`](scripts/diagram/tool-surface/types.ts) |
| 2      | Refactor `DiagramStyler.ts` to abstract base; import `NamespaceDef<T>` from `types.ts`; remove all concrete logic                                                                                                                                                                                                                                                                         | [`scripts/diagram/DiagramStyler.ts`](scripts/diagram/DiagramStyler.ts)                                                                   |
| 3      | Create `ModuleImportStyler.ts` with concrete folder-based coloring logic (moved from old `DiagramStyler`); define local `type ModuleImportStylerOptions` (not `interface`)                                                                                                                                                                                                                | New file                                                                                                                                 |
| 4      | Refactor `ClassDiagramGenerator.ts` to abstract base; import `ClassBodyResult` + `NamespaceDef<T>` from `types.ts`; use `result.name` in `emitNode` (no phantom `getNodeName`); remove `ClassDiagramOptions` re-export                                                                                                                                                                    | [`scripts/diagram/ClassDiagramGenerator.ts`](scripts/diagram/ClassDiagramGenerator.ts)                                                   |
| 5      | Create `ModuleImportGenerator.ts`; move `exportFormatters`, `formatExportAsMember`, and `type MermaidClassNode` from old `ClassDiagramGenerator.ts` into this file as private module-level items; implement lazy `ensureNodeMap()` (not constructor-time build); delete the dead `findUnusedExports()` instance method; wire `getClassBody` to return `name: mod.getMermaidClassName()`   | New file                                                                                                                                 |
| **5a** | **Compile check:** run `deno check scripts/diagram/ModuleImportGenerator.ts` and `deno task diagram-gen` — verify `docs/module-imports.mermaid` output is identical to the pre-refactor file                                                                                                                                                                                              | —                                                                                                                                        |
| 6      | Create `TypeSurfaceStyler.ts`: move `STYLE_DEFS`, `NS_PREFIX`, `STEREO_SLUG`, `warnStyle()`, `getStyleKey()` from `NamespacedDiagramGenerator.ts` as private module-level constants; implement `getNamespaceDefs()` iterating `NAMESPACE_ORDER`; implement `getClassDefs()` with `[...usedKeys].sort()` to preserve alphabetical order matching current output                            | New file                                                                                                                                 |
| 7      | Create `TypeSurfaceGenerator.ts`: implement `getHeaderLines()` (`["classDiagram"]`), `getClassBody()` returning `{ name: cls.name, ... }`, `getRelationshipLines()` with deduplication                                                                                                                                                                                                    | New file                                                                                                                                 |
| 8      | Extract `twoPassExtract.ts` and `ExtractorFn` type from `NamespacedDiagramGenerator.ts`                                                                                                                                                                                                                                                                                                   | New file; [`scripts/diagram/tool-surface/NamespacedDiagramGenerator.ts`](scripts/diagram/tool-surface/NamespacedDiagramGenerator.ts)     |
| 9      | Move & adapt extractors: copy `DomainTypeExtractor.ts`, `ZodSchemaExtractor.ts`, `ToolRegistrationExtractor.ts` to `scripts/diagram/`; change signatures to accept `ParsedModule`; replace `ts.createSourceFile(...)` with `module.getModuleSource()`; update type imports to `../types.ts`; originals in `tool-surface/` kept until Step 12                                              | New files at `scripts/diagram/`                                                                                                          |
| **9a** | **Compile check:** run `deno check scripts/diagram/DomainTypeExtractor.ts scripts/diagram/ZodSchemaExtractor.ts scripts/diagram/ToolRegistrationExtractor.ts`                                                                                                                                                                                                                             | —                                                                                                                                        |
| 10     | Update `generate-project-diagram.ts`: import both generators; add type-surface `CONFIG`; filter `modules[]` by CONFIG paths for type-surface extractors (do not re-read files); add type-surface pipeline in `main()`; fix `generateMarkdownReport` to embed the module-imports diagram string (fixes existing empty mermaid block bug); save `type-surface.mermaid` to `args.output` dir | [`scripts/generate-project-diagram.ts`](scripts/generate-project-diagram.ts)                                                             |
| 11     | Delete `generate-type-surface-diagram.ts`                                                                                                                                                                                                                                                                                                                                                 | [`scripts/generate-type-surface-diagram.ts`](scripts/generate-type-surface-diagram.ts)                                                   |
| 12     | Delete `scripts/diagram/tool-surface/` directory entirely                                                                                                                                                                                                                                                                                                                                 | Whole dir                                                                                                                                |
| 13     | Update `deno.json`: remove the `type-surface` task (its output is now produced by `diagram-gen`)                                                                                                                                                                                                                                                                                          | [`deno.json`](deno.json)                                                                                                                 |
| 14     | Verify byte-identical output: back up existing `.mermaid` files, run `deno task diagram-gen`, diff new vs backed-up files, then clean up backups if passing. Also run `deno lint`. See verification script below.                                                                                                                                                                         | —                                                                                                                                        |

### Step 14 — Verification script

```bash
# Back up current outputs as ground truth
cp docs/module-imports.mermaid docs/module-imports.mermaid.bak
cp docs/type-surface.mermaid   docs/type-surface.mermaid.bak

# Generate fresh outputs via the unified entry point
deno task diagram-gen

# Diff — both must be empty (no differences)
diff docs/module-imports.mermaid docs/module-imports.mermaid.bak
diff docs/type-surface.mermaid   docs/type-surface.mermaid.bak

# Lint
deno lint

# Clean up on success
rm docs/module-imports.mermaid.bak docs/type-surface.mermaid.bak
```
