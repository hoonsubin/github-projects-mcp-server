# Layer-Surface Class Diagram — Implementation Plan

## Objective

Extend [`scripts/generate-project-diagram.ts`](scripts/generate-project-diagram.ts) to produce a third Mermaid class diagram (`layer-surface.mermaid`) showing all **classes, interfaces, types, and enums** in the **Use-Case/domain layer** (`src/scrum/`, `src/domain/`) and **Adapter layer** (`src/adapters/`) with full relationship pointers:

- `extends` (class → class)
- `implements` (class → interface)
- field/method type references (association arrows)
- import/dependency usage (dashed arrows)

The output should follow the same rendering conventions as [`docs/type-surface.mermaid`](docs/type-surface.mermaid): `classDiagram` format, namespace blocks per layer, styled class declarations with stereotypes.

---

## Design Decisions

### D1 — Extend `NamespaceName` vs create separate type

Extend the existing [`NamespaceName`](scripts/diagram/types.ts:127) type union with two new values:

```typescript
export type NamespaceName =
  | "TypeScriptTypes"
  | "ZodSchemas"
  | "ToolSurface"
  | "UseCaseLayer"
  | "AdapterLayer";
```

**Rationale:** The new extractor produces the same [`ExtractedClass`](scripts/diagram/types.ts:88-111) shape. The only difference is the `namespace` value. Extending the union avoids creating parallel type hierarchies.

**Impact:** Add `UseCaseLayer: "uc"` and `AdapterLayer: "ad"` entries to [`NS_PREFIX`](scripts/diagram/TypeSurfaceStyler.ts:49-53) in `TypeSurfaceStyler.ts`. These are no-ops at runtime because no type-surface extractor produces those namespaces.

### D2 — Share type-node formatting helpers

Extract the following **module-private** helpers from [`DomainTypeExtractor.ts`](scripts/diagram/DomainTypeExtractor.ts) into a shared [`TypeNodeHelpers.ts`](scripts/diagram/TypeNodeHelpers.ts) module:

| Helper                                                                   | Purpose                                                |
| ------------------------------------------------------------------------ | ------------------------------------------------------ |
| [`formatTypeNode()`](scripts/diagram/DomainTypeExtractor.ts:266-363)     | Render a TS type node to Mermaid display string        |
| [`collectTypeRefs()`](scripts/diagram/DomainTypeExtractor.ts:367-389)    | Walk a type node and collect all referenced type names |
| [`getNodeText()`](scripts/diagram/DomainTypeExtractor.ts:397-402)        | Extract display text from an AST node                  |
| [`sanitizeForMermaid()`](scripts/diagram/DomainTypeExtractor.ts:393-395) | Replace `{`/`}` with `[`/`]`                           |

Both [`DomainTypeExtractor`](scripts/diagram/DomainTypeExtractor.ts) and the new [`LayerTypeExtractor`](plans/layer-surface-diagram.md) import from this shared module, eliminating duplication.

### D3 — New extractor for class declarations

[`DomainTypeExtractor.ts`](scripts/diagram/DomainTypeExtractor.ts) handles `interface`, `type` alias, `enum`, and `const`-tuple. The new [`LayerTypeExtractor`](plans/layer-surface-diagram.md) adds **class** declaration support:

- `export class Foo` → `<<class>>` stereotype with property members and method signatures
- `export abstract class Foo` → `<<abstract>>` stereotype
- `extends BaseClass` → `--|>` inheritance arrow
- `implements IFoo, IBar` → `..|>` implementation arrows per interface
- Method parameters rendered as `+methodName(param1: Type, param2: Type): ReturnType`
- Constructor rendered as `+constructor(param1: Type, param2: Type)`

It also handles the same constructs as `DomainTypeExtractor` (interfaces, type aliases, enums) since those also appear in the use-case and adapter layers.

**Input files** selected by directory prefix — see D6.

### D4 — New styler with layer-specific palette

[`LayerSurfaceStyler`](plans/layer-surface-diagram.md) is a concrete [`DiagramStyler<ExtractedClass>`](scripts/diagram/DiagramStyler.ts) with its own color scheme:

| Namespace    | Stereotype    | Style Key      | Color                                                    |
| ------------ | ------------- | -------------- | -------------------------------------------------------- |
| UseCaseLayer | `class`       | `uc_class`     | `fill:#dbeafe,stroke:#3b82f6,color:#1e3a8a` (blue)       |
| UseCaseLayer | `abstract`    | `uc_abstract`  | `fill:#e0e7ff,stroke:#6366f1,color:#312e81` (indigo)     |
| UseCaseLayer | `interface`   | `uc_interface` | `fill:#ede9fe,stroke:#8b5cf6,color:#4c1d95` (purple)     |
| UseCaseLayer | `type`        | `uc_type`      | `fill:#bfdbfe,stroke:#3b82f6,color:#1e3a8a` (light blue) |
| UseCaseLayer | `enum`        | `uc_enum`      | `fill:#fce7f3,stroke:#ec4899,color:#831843` (pink)       |
| UseCaseLayer | `union`       | `uc_union`     | `fill:#e0e7ff,stroke:#6366f1,color:#312e81` (indigo)     |
| UseCaseLayer | `branded`     | `uc_branded`   | `fill:#ede9fe,stroke:#8b5cf6,color:#4c1d95` (purple)     |
| UseCaseLayer | `const-tuple` | `uc_tuple`     | `fill:#fef3c7,stroke:#f59e0b,color:#78350f` (amber)      |
| AdapterLayer | `class`       | `ad_class`     | `fill:#dcfce7,stroke:#22c55e,color:#14532d` (green)      |
| AdapterLayer | `abstract`    | `ad_abstract`  | `fill:#d1fae5,stroke:#14b8a6,color:#134e4a` (teal)       |
| AdapterLayer | `interface`   | `ad_interface` | `fill:#ccfbf1,stroke:#14b8a6,color:#134e4a` (cyan)       |
| AdapterLayer | `type`        | `ad_type`      | `fill:#fef3c7,stroke:#f59e0b,color:#78350f` (amber)      |
| AdapterLayer | `enum`        | `ad_enum`      | `fill:#fce7f3,stroke:#ec4899,color:#831843` (pink)       |
| AdapterLayer | `union`       | `ad_union`     | `fill:#fef3c7,stroke:#f59e0b,color:#78350f` (amber)      |
| AdapterLayer | `branded`     | `ad_branded`   | `fill:#ede9fe,stroke:#8b5cf6,color:#4c1d95` (purple)     |

Each gets a `_warn` variant — same pattern as [`TypeSurfaceStyler.warnStyle()`](scripts/diagram/TypeSurfaceStyler.ts:40-45) — with red border and red text.

Stereotype-to-slug mapping:

```typescript
const STEREO_SLUG: Record<string, string> = {
  class: "class",
  abstract: "abstract",
  interface: "interface",
  union: "union",
  branded: "branded",
  enumeration: "enum",
  "const-tuple": "tuple",
};
```

### D5 — Generator reuse

The [`TypeSurfaceGenerator`](scripts/diagram/TypeSurfaceGenerator.ts) class already works for any `ExtractedClass[] + ExtractedRelationship[]` pair. Create [`LayerSurfaceGenerator`](plans/layer-surface-diagram.md) as a **structural copy** (same implementation) but typed with [`LayerSurfaceStyler`](plans/layer-surface-diagram.md):

```typescript
export class LayerSurfaceGenerator extends ClassDiagramGenerator<ExtractedClass> {
  constructor(
    private readonly classes: ExtractedClass[],
    private readonly relationships: ExtractedRelationship[],
    styler: LayerSurfaceStyler,
  ) {
    super(styler);
  }

  protected getHeaderLines(): string[] {
    return ["classDiagram"];
  }

  protected getClassBody(cls: ExtractedClass): ClassBodyResult {
    return { name: cls.name, members: cls.members, stereotype: cls.stereotype };
  }

  protected getRelationshipLines(): string[] {
    // Deduplicated, known-class-checked arrow emission — same as TypeSurfaceGenerator
    ...
  }
}
```

**Alternative considered:** Making `TypeSurfaceGenerator` accept any styler and be reused directly. Rejected because the two diagrams may diverge in relationship rendering (e.g., the layer diagram might add import-based dashed arrows in addition to type-reference arrows). A structural copy is safer than a shared base that would need to be abstracted prematurely.

### D6 — Folder-prefix based file selection (not hard-coded file list)

Instead of listing every file individually (as [`CONFIG`](scripts/generate-project-diagram.ts:37-77) does for type-surface), derive the file sets from **directory prefixes**:

```typescript
const LAYER_GRAPH_CONFIG = {
  useCasePrefixes: [
    "src/scrum/",
    "src/domain/",
  ],
  adapterPrefixes: [
    "src/adapters/",
  ],
};
```

Module selection:

```typescript
const useCaseModules = modules.filter((m) =>
  LAYER_GRAPH_CONFIG.useCasePrefixes.some((p) => m.filePathName.startsWith(p))
);
const adapterModules = modules.filter((m) =>
  LAYER_GRAPH_CONFIG.adapterPrefixes.some((p) => m.filePathName.startsWith(p))
);
```

**Rationale:**

- The user asked for "classes, types, and interfaces in the use-case layer and adapter layer" — this is a structural property of directories, not a configurable list.
- Adding a new file to either layer automatically includes it in the diagram — no config update needed.
- The type-surface [`CONFIG`](scripts/generate-project-diagram.ts:37-77) hard-codes individual files because it needs specific files (domain types, Zod schemas, tool registrations) and is sensitive to extraction order. The layer-surface is a bulk scan — it needs everything in a directory tree.

**Exclusions:** Files matching the existing [`DEFAULT_EXCLUSIONS`](scripts/generate-project-diagram.ts:33) (generated, graphql, test files) plus any `generated/` path segments are excluded — same as the rest of the scanner.

---

## Architecture Diagram

```
TypeNodeHelpers.ts (NEW)
    ▲                           ▲
    ║ imports                    ║ imports
    ║                            ║
DomainTypeExtractor.ts    LayerTypeExtractor.ts (NEW)
  (refactored - imports     (class support + all DomainTypeExtractor
   helpers from                constructs)
   TypeNodeHelpers.ts)

                            LayerSurfaceStyler.ts (NEW)
                              (extends DiagramStyler<ExtractedClass>)

                            LayerSurfaceGenerator.ts (NEW)
                              (extends ClassDiagramGenerator<ExtractedClass>)

generate-project-diagram.ts
  ├── existing: ModuleImportGenerator → module-imports.mermaid
  ├── existing: TypeSurfaceGenerator  → type-surface.mermaid
  └── NEW:    LayerSurfaceGenerator   → layer-surface.mermaid
                             ↓
                      docs/layer-surface.mermaid
```

---

## New Files

### 1. [`scripts/diagram/TypeNodeHelpers.ts`](scripts/diagram/TypeNodeHelpers.ts) — NEW

Extract from [`DomainTypeExtractor.ts`](scripts/diagram/DomainTypeExtractor.ts):

| Export                                                      | Source Lines | Description                                       |
| ----------------------------------------------------------- | ------------ | ------------------------------------------------- |
| `formatTypeNode(typeNode, warnings, context, warningNodes)` | 266-363      | Render TS type node → Mermaid display string      |
| `collectTypeRefs(typeNode)`                                 | 367-389      | Walk type node, collect all referenced type names |
| `getNodeText(node)`                                         | 397-402      | Extract identifier/literal display text           |
| `sanitizeForMermaid(text)`                                  | 393-395      | `{`→`[`, `}`→`]` substitution                     |

**No behavioral changes** — pure extraction + re-import. All four functions are currently module-private (`function` not exported) in `DomainTypeExtractor.ts`; they become exported from `TypeNodeHelpers.ts`.

### 2. [`scripts/diagram/LayerTypeExtractor.ts`](scripts/diagram/LayerTypeExtractor.ts) — NEW

New extraction function `extractLayerTypes()`. Handles from a [`ParsedModule`](scripts/diagram/ParsedModule.ts):

**Class declarations** (not currently handled by any extractor):

- `export class` → `<<class>>` stereotype
- `export abstract class` → `<<abstract>>` stereotype
- Constructor → `+constructor(param1: Type, param2: Type)`
- Methods → `+methodName(param1: Type): ReturnType`
- Instance properties → `+name: Type`
- `extends BaseClass` → `from: Child, to: Base, arrow: "--|>", label: "extends"`
- `implements IFoo` → `from: Child, to: IFoo, arrow: "..|>", label: "implements"`

**Then delegates to the same constructs as DomainTypeExtractor** for:

- `export interface` — property members + `extends` clauses → inheritance arrows
- `export type` — unions → `<<union>>` members, branded → `<<branded>>` members, object literals
- `export enum` → `<<enumeration>>` members

**Relationship arrows generated for all:**

- Inheritance: `A --|> B : extends`
- Implementation: `A ..|> B : implements`
- Property/method-return type references: `A --> B : memberName`
- Union variant references: `A --> B : name-variant`

**Mermaid `or` syntax for union types:** Uses existing `formatTypeNode()` which already renders unions as `" | ".join(...)` → `" or "`. This matches the `type-surface.mermaid` style exactly.

**All type references** are filtered against [`knownNames`](scripts/diagram/twoPassExtract.ts:23-27) (set from pass 1) — relationship arrows to out-of-scope types are suppressed, same as [`extractDomainTypes()`](scripts/diagram/DomainTypeExtractor.ts:33-82).

```typescript
// Signature
export const extractLayerTypes = (
  module: ParsedModule,
  namespace: NamespaceName,   // "UseCaseLayer" | "AdapterLayer"
  knownNames: Set<string> = new Set(),
): DomainExtractorResult       // same shape as DomainTypeExtractor
```

### 3. [`scripts/diagram/LayerSurfaceStyler.ts`](scripts/diagram/LayerSurfaceStyler.ts) — NEW

Concrete [`DiagramStyler<ExtractedClass>`](scripts/diagram/DiagramStyler.ts):

- **`getNamespaceDefs()`** — groups by `namespace` field; returns in fixed order (UseCaseLayer first, then AdapterLayer); skips empty groups
- **`getNodeStyle(node)`** — derives style key from `{ns_prefix}_{stereotype_slug}`; appends `_warn` suffix for warning nodes
- **`getClassDefs()`** — emits only used style keys + their `_warn` variants

Private module-level constants:

- `LAYER_STYLE_DEFS: Record<string, string>` — color definitions (see D4 table above)
- `LAYER_NAMESPACE_ORDER: NamespaceName[]` — `["UseCaseLayer", "AdapterLayer"]`
- `LAYER_NS_PREFIX: Record<string, string>` — `{ UseCaseLayer: "uc", AdapterLayer: "ad" }`
- `LAYER_STEREO_SLUG: Record<string, string>` — maps stereotype name → slug

Warning-variant style follows [`TypeSurfaceStyler.warnStyle()`](scripts/diagram/TypeSurfaceStyler.ts:40-45) pattern exactly: same fill, but red border (`stroke:#ef4444`) and red text (`color:#dc2626`) with `stroke-width:2px`.

### 4. [`scripts/diagram/LayerSurfaceGenerator.ts`](scripts/diagram/LayerSurfaceGenerator.ts) — NEW

Concrete [`ClassDiagramGenerator<ExtractedClass>`](scripts/diagram/ClassDiagramGenerator.ts):

```typescript
export class LayerSurfaceGenerator extends ClassDiagramGenerator<ExtractedClass> {
  constructor(
    private readonly classes: ExtractedClass[],
    private readonly relationships: ExtractedRelationship[],
    styler: LayerSurfaceStyler,
  ) {
    super(styler);
  }

  protected getHeaderLines(): string[] {
    return ["classDiagram"];
  }

  protected getClassBody(cls: ExtractedClass): ClassBodyResult {
    return { name: cls.name, members: cls.members, stereotype: cls.stereotype };
  }

  protected getRelationshipLines(): string[] {
    // Identical deduplication + known-class check logic as TypeSurfaceGenerator
    const lines: string[] = [];
    const seen = new Set<string>();
    const knownClassNames = new Set(this.classes.map((c) => c.name));
    for (const rel of this.relationships) {
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
```

---

## Modified Files

### 5. [`scripts/diagram/types.ts`](scripts/diagram/types.ts)

Extend `NamespaceName` union type:

```diff
- export type NamespaceName = "TypeScriptTypes" | "ZodSchemas" | "ToolSurface";
+ export type NamespaceName =
+   | "TypeScriptTypes" | "ZodSchemas" | "ToolSurface"
+   | "UseCaseLayer" | "AdapterLayer";
```

### 6. [`scripts/diagram/DomainTypeExtractor.ts`](scripts/diagram/DomainTypeExtractor.ts)

**Remove** the four helper functions that move to [`TypeNodeHelpers.ts`](scripts/diagram/TypeNodeHelpers.ts):

- Remove `formatTypeNode()` (lines 266-363)
- Remove `collectTypeRefs()` (lines 367-389)
- Remove `getNodeText()` (lines 397-402)
- Remove `sanitizeForMermaid()` (lines 393-395)

**Add** import:

```typescript
import {
  collectTypeRefs,
  formatTypeNode,
  getNodeText,
  sanitizeForMermaid,
} from "./TypeNodeHelpers.ts";
```

All internal call sites remain unchanged — the exported function signatures and behavior are identical.

### 7. [`scripts/diagram/TypeSurfaceStyler.ts`](scripts/diagram/TypeSurfaceStyler.ts)

Add the two new namespace entries to existing constants — these are no-ops since no type-surface extractor produces those namespaces:

```diff
const NS_PREFIX: Record<NamespaceName, string> = {
  TypeScriptTypes: "ts",
  ZodSchemas: "zod",
  ToolSurface: "tool",
+ UseCaseLayer: "uc",
+ AdapterLayer: "ad",
};

const NAMESPACE_ORDER: NamespaceName[] = [
  "TypeScriptTypes", "ZodSchemas", "ToolSurface",
+ "UseCaseLayer", "AdapterLayer",
];
```

### 8. [`scripts/generate-project-diagram.ts`](scripts/generate-project-diagram.ts)

**New imports:**

```typescript
import { LayerSurfaceStyler } from "./diagram/LayerSurfaceStyler.ts";
import { LayerSurfaceGenerator } from "./diagram/LayerSurfaceGenerator.ts";
import { extractLayerTypes } from "./diagram/LayerTypeExtractor.ts";
```

**New CONFIG:**

```typescript
const LAYER_GRAPH_CONFIG = {
  useCasePrefixes: ["src/scrum/", "src/domain/"],
  adapterPrefixes: ["src/adapters/"],
} as const;
```

**New generation function:**

```typescript
const generateLayerSurfaceDiagram = (
  modules: ParsedModule[],
): { diagram: string; warnings: string[] } => {
  const useCaseModules = modules.filter((m) =>
    LAYER_GRAPH_CONFIG.useCasePrefixes.some((p) => m.filePathName.startsWith(p))
  );
  const adapterModules = modules.filter((m) =>
    LAYER_GRAPH_CONFIG.adapterPrefixes.some((p) => m.filePathName.startsWith(p))
  );

  const extractors: ExtractorFn[] = [
    ...useCaseModules.map((mod) => (known: Set<string>) =>
      extractLayerTypes(mod, "UseCaseLayer", known)
    ),
    ...adapterModules.map((mod) => (known: Set<string>) =>
      extractLayerTypes(mod, "AdapterLayer", known)
    ),
  ];

  const { classes, relationships, warnings, warningNodes } = twoPassExtract(extractors);

  const styler = new LayerSurfaceStyler(classes, warningNodes);
  const generator = new LayerSurfaceGenerator(classes, relationships, styler);
  const diagram = generator.generate();

  return { diagram, warnings };
};
```

**Wired into `main()` after type-surface generation:**

```typescript
console.log("Generating layer-surface diagram...");
const { diagram: layerSurfaceDiagram, warnings: lsw } = generateLayerSurfaceDiagram(modules);

if (lsw.length > 0) {
  console.log(`\n⚠  ${lsw.length} clean-code warning(s):`);
  for (const w of lsw) console.warn(`\n  ${w}`);
}
```

**Additional artifact:**

```typescript
const layerSurfaceObj = new GeneratedArtifact(
  layerSurfaceDiagram,
  "layer-surface.mermaid",
  args.output,
);
// ... save all three + report
```

---

## What the Diagram Will Show

### UseCaseLayer namespace (examples drawn from real code):

```
class orientUseCase:::uc_function {
    <<function>>
    +async (backend: ProjectReader, scrumConfig: ScrumConfig): UseCaseResult<OrientResult>
}
```

Wait — the task says "classes, types, and interfaces". Function exports should be shown as stand-alone nodes too (like `module-imports.mermaid` does). Let me refine the stereotype handling:

For **function exports** in use-case files (all the `*UseCase` async functions):

- `export const orientUseCase = async (...)` → rendered as a `<<function>>` node with arrow signature (consistent with how [`extractDomainTypes`](scripts/diagram/DomainTypeExtractor.ts) doesn't currently handle functions, but the layer diagram should)

Actually, revisiting: the user said "class diagram with relationship pointers between all classes, types, and interfaces". Functions are not classes, types, or interfaces. So **standalone function exports should NOT be rendered as nodes** in the diagram. The diagram focuses on:

- `class` declarations (including abstract)
- `interface` declarations
- `type` alias declarations
- `enum` declarations

Functions that are exported standalone (like `orientUseCase`, `findItemsUseCase`, etc.) are **not** included. Their signatures appear only as usage/import references within classes that call them. However, since the use-case layer is entirely functional (no classes), we need to reconsider.

**Revised decision:** Include exported functions as `<<function>>` nodes in the layer diagram, since the use-case layer IS the set of exported functions + the port interface. Without functions, the UseCaseLayer namespace would show only [`ProjectReader`](src/scrum/ports.ts), [`ProjectWriter`](src/scrum/ports.ts), and [`ProjectBackend`](src/scrum/ports.ts) interfaces plus the domain types — but it would miss the core use-case logic (orient, findItems, getAnalytics, etc.).

The function node format:

```
class orientUseCase:::uc_function {
    <<function>>
    +(backend: ProjectReader, scrumConfig: ScrumConfig) => Promise~UseCaseResult~OrientResult~~
}
```

Uses `~` for generic type params (Mermaid syntax, same as `type-surface.mermaid`).

### AdapterLayer namespace (examples):

```
class GitHubProjectBackend:::ad_class {
    <<class>>
    +capabilities : PlatformCapabilities
    +constructor(config: RuntimeConfig, gh: GitHubClient, services...)
    +getPlatformState(...)
    +findItems(filter: ResolvedItemFilter)
    +createStory(input: CreateStoryInput)
    ...
}

class AbstractProjectBackend:::ad_abstract {
    <<abstract>>
    +capabilities : PlatformCapabilities
    +abstract getPlatformState(...)
    +abstract findItems(filter: ResolvedItemFilter)
    +resolveRef(ref: StoryRef): StoryRef
}
```

With relationship arrows:

```
AbstractProjectBackend ..|> ProjectReader : implements
AbstractProjectBackend ..|> ProjectWriter : implements
GitHubProjectBackend --|> AbstractProjectBackend : extends
StoryQueryService ..|> FindItemsPort : implements
FieldValueMutator ..|> ... : implements
```

---

## Concrete Roadmap

### Step 1 — Create `TypeNodeHelpers.ts` [file: new]

Extract `formatTypeNode`, `collectTypeRefs`, `getNodeText`, `sanitizeForMermaid` from [`DomainTypeExtractor.ts`](scripts/diagram/DomainTypeExtractor.ts) into a new shared module. Update exports to be `export` instead of module-private `function`.

Depends on: nothing Modified: [`DomainTypeExtractor.ts`](scripts/diagram/DomainTypeExtractor.ts) (remove functions, add import) Created: [`TypeNodeHelpers.ts`](scripts/diagram/TypeNodeHelpers.ts)

### Step 2 — Create `LayerTypeExtractor.ts` [file: new]

New extractor function `extractLayerTypes()` handling:

- `class` declarations (constructor, methods, properties, extends, implements)
- `interface` declarations (same logic as `DomainTypeExtractor`)
- `type` alias declarations (same logic as `DomainTypeExtractor`)
- `enum` declarations (same logic as `DomainTypeExtractor`)
- Function exports (`const fn = async (...) => ...`) with signature rendering

All type formatting via imported helpers from `TypeNodeHelpers.ts`. All relationship arrows filtered against two-pass known-names set.

Depends on: Step 1

### Step 3 — Create `LayerSurfaceStyler.ts` [file: new]

Concrete styler with layer-specific color definitions, namespace ordering, and stereotype-to-slug mapping.

Depends on: nothing (only imports from [`types.ts`](scripts/diagram/types.ts) and [`DiagramStyler.ts`](scripts/diagram/DiagramStyler.ts))

### Step 4 — Create `LayerSurfaceGenerator.ts` [file: new]

Concrete generator extending `ClassDiagramGenerator<ExtractedClass>` with same relationship dedup logic as `TypeSurfaceGenerator`.

Depends on: Step 3, `ClassDiagramGenerator.ts`, `types.ts`

### Step 5 — Extend `NamespaceName` in `types.ts` and `TypeSurfaceStyler.ts`

Add `"UseCaseLayer" | "AdapterLayer"` to the union type [`NamespaceName`](scripts/diagram/types.ts:128). Add corresponding entries to [`NS_PREFIX`](scripts/diagram/TypeSurfaceStyler.ts:49-53) and [`NAMESPACE_ORDER`](scripts/diagram/TypeSurfaceStyler.ts:10-14).

Depends on: nothing

### Step 6 — Wire into `generate-project-diagram.ts`

Add imports, CONFIG block (directory-prefix based), `generateLayerSurfaceDiagram()` function, wire into `main()`, save as third artifact.

Depends on: Steps 1-5

### Step 7 — Verify

```bash
deno task diagram-gen                                              # generates all three diagrams
deno lint                                                          # no lint errors
# Manual review: inspect docs/layer-surface.mermaid for correctness:
#   - UseCaseLayer namespace has port interfaces + domain types
#   - AdapterLayer namespace has backend class + internal services
#   - extends/implements arrows are correct
#   - Style keys are valid (uc_class, ad_interface, etc.)
```

Depends on: Step 6

---

## Fallback: Styling function exports

If function exports overwhelm the diagram, a config option (or fixed limit) can be added:

```typescript
const LAYER_GRAPH_CONFIG = {
  useCasePrefixes: ["src/scrum/", "src/domain/"],
  adapterPrefixes: ["src/adapters/"],
  showFunctions: false, // set to true to include exported function nodes
} as const;
```

Default `false` means only classes, interfaces, types, and enums appear — clean focus on the structural type surface. The user can toggle this on if they want to see function signatures in the diagram.
