# Audit Script Refactoring Plan

## Problem Statement

The current [`scripts/generate-project-diagram.ts`](../scripts/generate-project-diagram.ts) produces 4 artifacts ([`docs/report.md`](../docs/report.md) at 1035 lines, [`docs/module-imports.mermaid`](../docs/module-imports.mermaid) at 924 lines, [`docs/layer-surface.mermaid`](../docs/layer-surface.mermaid) at 1603 lines, [`docs/type-surface.mermaid`](../docs/type-surface.mermaid) at 573 lines — **4135 total lines**) that are exhaustive AST dumps rather than actionable diagnostics.

A contributor opening these files sees a wall of every single export, type field, and interface member across 48 source files — information already available in the source code itself. The diagrams do not answer the questions a contributor actually has when onboarding or auditing:

- _"Is the architecture clean right now?"_ (compliance check)
- _"Which layers depend on which?"_ (dependency graph)
- _"Where is the technical debt accumulating?"_ (stability metrics)
- _"What's the size and complexity distribution?"_ (file stats)
- _"Is there dead code?"_ (unused exports)

Additionally, the scanner at [`scripts/diagram/`](../scripts/diagram/) (14 files, ~1364 lines) reimplements dependency analysis that dependency-cruiser already provides with richer features (rule validation, stability metrics, DOT output). The custom TS Compiler API scanner is high-maintenance and produces no insight beyond what depcruise + a lightweight export-scanner can deliver.

## Objectives

1. **Replace the 4 unreadable artifacts** with a single concise audit report (~150 lines) that a contributor can scan in 30 seconds to understand the project's current state.
2. **Leverage dependency-cruiser** (already configured at [`.dependency-cruiser.cjs`](.dependency-cruiser.cjs)) as the primary data source for dependency analysis, architecture rule validation, and stability metrics — rather than maintaining a custom parser.
3. **Preserve only the unused-export detection** from the old TS Compiler API scanner, since depcruise does not provide this.
4. **Design for extensibility**: the new pipeline must allow adding new audit stages (e.g., test coverage, CI diff, adapter complexity) without modifying existing stage code.
5. **Eliminate ~1364 lines of dead diagram-generator code** by deleting 11 of 14 files in [`scripts/diagram/`](../scripts/diagram/).

## Expected Artifacts

| Artifact      | Location                                                              | Content                                                                                                  |
| ------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Audit report  | [`docs/audit.md`](../docs/audit.md) ~150 lines                        | Architecture compliance table, layer dependency flowchart, stability metrics, file stats, unused exports |
| Audit script  | [`scripts/generate-audit.ts`](../scripts/generate-audit.ts) ~50 lines | CLI entry point — parses args, runs pipeline, writes output                                              |
| Audit modules | [`scripts/audit/`](../scripts/audit/) ~720 lines total                | Modular pipeline with `AuditStage<T>` interface, 5 stage modules, 2 renderers                            |
| Deleted       | 11 files in [`scripts/diagram/`](../scripts/diagram/)                 | All diagram generators, extractors, stylers (keep only `ParsedModule.ts`, `helpers.ts`, `types.ts`)      |

## Acceptance Criteria

1. **`deno task audit`** runs successfully and produces [`docs/audit.md`](../docs/audit.md) as output.
2. The audit report contains all 5 diagnostics:
   - 🟢/🔴 Architecture compliance table (all 7 depcruise rules from [`.dependency-cruiser.cjs`](.dependency-cruiser.cjs))
   - Mermaid layer dependency flowchart (layers as subgraphs, violation edges in red)
   - Stability metrics table (abstractness, instability, distance per module grouped by zone)
   - File stats table (files/LOC per layer, top-3 largest files per layer)
   - Unused exports table (file, export name, kind)
3. **No regressions**: the old `deno task diagram-gen` is removed; nothing else in the project references the deleted files.
4. The unused-export numbers match the current report (cross-check against the existing [`docs/report.md`](../docs/report.md) unused exports section).
5. All 7 depcruise architecture rules are checked and their pass/fail status is clearly shown.
6. `deno lint` and `deno fmt --check` pass on all new files.
7. Any of the 5 stages can be individually disabled via CLI flags (e.g., `--skip unused-exports` for faster runs).

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│  scripts/generate-audit.ts  (orchestrator, ~50 lines)       │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐            │
│  │ Config     │→ │ Stage      │→ │ Renderer   │→ output    │
│  │ (stages)   │  │ Pipeline   │  │ Pipeline   │  files      │
│  └────────────┘  └─────┬──────┘  └─────┬──────┘            │
│                         │               │                    │
│              ┌──────────┼──────┐       │                    │
│              ▼          ▼      ▼       │                    │
│  ┌───────────┐ ┌─────────┐ ┌────────┐  │                    │
│  │Compliance │ │Layer    │ │Stabil- │  │                    │
│  │Stage      │ │Graph    │ │ity     │  │                    │
│  │           │ │Stage    │ │Stage   │  │                    │
│  └───────────┘ └─────────┘ └────────┘  │                    │
│  ┌───────────┐ ┌─────────┐            │                    │
│  │FileStats  │ │Unused   │            │                    │
│  │Stage      │ │Exports  │            │                    │
│  │           │ │Stage    │            │                    │
│  └───────────┘ └─────────┘            │                    │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## Directory Layout (Guideline)

The implementation should create a structure similar to this. The exact module boundaries are at the implementer's discretion — what matters is the separation of concerns:

```
scripts/
  generate-audit.ts          # Entry point: loads config, runs pipeline, writes output
  audit/
    config.ts                # AuditConfig type + defaults + CLI argument parsing
    types.ts                 # Shared result types + stage/renderer interfaces
    pipeline.ts              # Stage orchestration + data flow
    stages/
      compliance.ts          # Parse depcruise JSON violations → ComplianceResult
      layer-graph.ts         # Derive layer adjacency from depcruise modules → LayerGraphResult
      stability.ts           # Compute A/I/D metrics from depcruise JSON → StabilityResult
      file-stats.ts          # Walk src/, count LOC per file/layer → FileStatsResult
      unused-exports.ts      # Reuse TS Compiler API scanner → UnusedExportResult
    renderers/
      markdown.ts            # Assemble all results into docs/audit.md
      mermaid.ts             # Render layer graph as mermaid flowchart string
```

## Stage Interface (OCP Design Intent)

Every stage should implement a common interface so that adding a new stage requires no changes to existing code. This is the key extensibility mechanism:

```typescript
// scripts/audit/types.ts

/** A single audit stage: collects data, returns structured result. */
export interface AuditStage<TStageResult> {
  readonly name: string; // e.g. "compliance", "layerGraph"
  run(config: AuditConfig): Promise<TStageResult>;
}
```

Stages are file-system-scoped modules. Adding a new stage = new file in `stages/` + wire it in the pipeline config. No other file changes.

## Stage Definitions (Guidance, Not Prescription)

The implementations below describe the **intent** of each stage. The implementer should feel free to adjust output types, data structures, or the approach to achieve the right result.

### 1. Compliance Stage

**Input:** depcruise JSON (spawn via `Deno.Command` with `--output-type json`)

**Output:** per-rule pass/fail summary with violation counts

**What to check:**

- All 7 rules defined in [`.dependency-cruiser.cjs`](.dependency-cruiser.cjs) must be evaluated
- Show total modules scanned, total violations, breakdown per rule
- Link each violated rule to the module(s) that triggered it

### 2. Layer Graph Stage

**Input:** depcruise JSON (reuse from compliance stage)

**Output:** a data structure representing layers as nodes and cross-layer imports as edges

**Classification:** Use the layer directory prefixes from config:

- `src/server.ts` → "entrypoint"
- `src/tools/` → "framework"
- `src/schemas/` → "framework"
- `src/services/` → "framework"
- `src/scrum/` → "use-case"
- `src/domain/` → "domain"
- `src/adapters/` → "adapter"

**Output goes to the mermaid renderer:** each layer becomes a subgraph, each cross-layer dependency creates a directional arrow. Edges that violate architecture rules should be visually distinct (e.g., red color).

### 3. Stability Stage

**Input:** depcruise JSON

**Output:** per-module abstractness (A), instability (I), distance from main sequence (D = |A + I - 1|), and zone classification

**Zone thresholds (suggested, adjust as needed):**

- D > 0.7 → **Zone of Pain/Uselessness** — concrete + heavily depended-upon, or abstract + unused
- D < 0.1 → **Main Sequence** — well-balanced
- 0.1 ≤ D ≤ 0.7 → **Transitioning** — moving toward/away from balance

### 4. File Stats Stage

**Input:** file system (walk `src/`)

**Output:** per-layer file count, total lines of code, top-3 largest files per layer

**Exclusions:** Same as current: `generated/`, `graphql/`, `*test.ts`, `__snapshots__/`, `__fixtures__/`

### 5. Unused Exports Stage

**Input:** source files (reuse existing TS Compiler API scanner)

**Output:** list of exported symbols that are never imported by another module in the codebase

**Implementation note:** This is the only stage that keeps the old code. Import [`ParsedModule`](../scripts/diagram/ParsedModule.ts) and [`findUnusedExports`](../scripts/diagram/helpers.ts) — everything else in [`scripts/diagram/`](../scripts/diagram/) gets deleted.

## Renderers

### Markdown Renderer

Assembles all stage results into a single `docs/audit.md` file. Sections in order:

1. **Header** — title, timestamp, commit SHA if available
2. **Architecture Compliance** — 🟢/🔴 table with per-rule pass/fail
3. **Layer Dependency Graph** — embedded mermaid flowchart
4. **Stability Metrics** — table grouped by zone with A/I/D values
5. **File Stats** — per-layer file count + LOC + top-3 largest files
6. **Unused Exports** — table with file, export name, kind
7. **Footer** — auto-generated notice + command that produced this

### Mermaid Renderer

Transforms the layer graph data into a `flowchart TB` string. Each layer is a subgraph. Nodes are labeled with directory name + file count. Arrows are colored:

- **Green** for valid cross-layer dependencies
- **Red** for architecture rule violations

## Pipeline Orchestration

1. **Phase 1: Collect** — call depcruise once via `Deno.Command` with `--output-type json`. Cache the result.
2. **Phase 2: Analyze** — run the enabled stages in order. Stages that need depcruise data share the cached result.
3. **Phase 3: Render** — feed all results into the markdown renderer, and the layer-graph result into the mermaid renderer.

The pipeline should be explicit about which stages run and in what order. A grep-friendly checklist style in the code is preferred over clever metaprogramming.

## Depcruise JSON Output Reference

The dependency-cruiser `--output-type json` produces this structure. Be aware that fields may vary slightly between versions — handle with defensive parsing:

```jsonc
{
  "modules": [
    {
      "source": "src/adapters/github/backend.ts",
      "dependencies": [
        {
          "module": "src/adapters/capabilities.ts",
          "modulePath": "src/adapters/capabilities.ts",
          "dependencyTypes": ["local"],
          "valid": true,
          "circular": false,
          "rules": [
            {
              "severity": "error",
              "name": "adapters-must-not-depend-on-tools-schemas-server",
              "comment": "..."
            }
          ]
        }
      ],
      "instability": 0.05,
      "abstractness": 0.0,
      "distance": 0.95
    }
  ],
  "summary": {
    "violations": {
      "error": 0,
      "warn": 0,
      "info": 0,
      "ignore": 0
    },
    "totalCruised": 48
  },
  "rules": [
    { "name": "domain-must-not-depend-on-inner-layers", "severity": "error" }
    // ... each rule from the cjs config
  ]
}
```

## What Gets Deleted

| File                                                                                                      | Lines           | Reason                                                                           |
| --------------------------------------------------------------------------------------------------------- | --------------- | -------------------------------------------------------------------------------- |
| [`scripts/generate-project-diagram.ts`](../scripts/generate-project-diagram.ts)                           | 453             | Replaced entirely by [`scripts/generate-audit.ts`](../scripts/generate-audit.ts) |
| All files in [`scripts/diagram/`](../scripts/diagram/) except `ParsedModule.ts`, `helpers.ts`, `types.ts` | ~1364           | Diagram generators/extractors/stylers no longer needed                           |
| [`docs/report.md`](../docs/report.md)                                                                     | 1035            | Replaced by [`docs/audit.md`](../docs/audit.md)                                  |
| [`docs/module-imports.mermaid`](../docs/module-imports.mermaid)                                           | 924             | Replaced by mermaid flowchart embedded in audit.md                               |
| [`docs/layer-surface.mermaid`](../docs/layer-surface.mermaid)                                             | 1603            | Replaced by mermaid flowchart embedded in audit.md                               |
| [`docs/type-surface.mermaid`](../docs/type-surface.mermaid)                                               | 573             | Information no longer surfaced as standalone diagram                             |
| **Total deleted**                                                                                         | **~5952 lines** |                                                                                  |

**Kept files** (in [`scripts/diagram/`](../scripts/diagram/)):

- [`ParsedModule.ts`](../scripts/diagram/ParsedModule.ts) — TS Compiler API scanner for unused exports
- [`helpers.ts`](../scripts/diagram/helpers.ts) — `findUnusedExports()` and `resolveImport()`
- [`types.ts`](../scripts/diagram/types.ts) — `UnusedExport`, `ExportInfo`, `ImportInfo`, `ExportKind`, `ImportKind`

These kept files should be cleaned up: remove mermaid-specific code (`sanitizeForMermaid`, `formatTypeNode`, `collectTypeRefs`, `getNodeText`) from [`helpers.ts`](../scripts/diagram/helpers.ts) and remove diagram types (`Layer`, `LayerMapping`, `NamespaceDef`, `ClassBodyResult`, etc.) from [`types.ts`](../scripts/diagram/types.ts).

## Changes to `deno.json`

Add an `audit` task and remove the old `diagram-gen` task. The audit task needs `--allow-run` in addition to read/write because it spawns depcruise as a subprocess:

```json
"audit": "deno run --allow-read --allow-env --allow-write --allow-run scripts/generate-audit.ts"
```

## Implementation Guidance

The sections below provide a suggested implementation order and reference details. Treat them as a starting point — adjust based on what works best during development.

### Suggested Order

1. Create `scripts/audit/` directories and the `types.ts` + `config.ts` foundation
2. Implement `stages/compliance.ts` (simplest — just parse depcruise JSON)
3. Implement `stages/layer-graph.ts` and `renderers/mermaid.ts` (together, so you can see output)
4. Implement `stages/stability.ts` (metrics computation)
5. Implement `stages/file-stats.ts` (pure filesystem, no depcruise)
6. Implement `stages/unused-exports.ts` (reuse existing scanner)
7. Implement `renderers/markdown.ts` (assemble everything)
8. Implement `pipeline.ts` (orchestration)
9. Implement `scripts/generate-audit.ts` (entry point)
10. Delete old files and update `deno.json`
11. Run `deno task audit`, verify output, run `deno lint` and `deno fmt --check`

### Error Handling

- If depcruise returns non-zero exit code, the compliance stage should still parse whatever output exists and report the failure clearly
- Unused-export scanning can be disabled via `--skip unused-exports` for faster runs
- All stages should handle empty results gracefully (empty arrays, zero counts)

### Testing

- `--dry-run` flag: print generated markdown to stdout instead of writing to file
- Compare unused-export count against the existing [`docs/report.md`](../docs/report.md) to verify correctness
- After deleting old files, verify no remaining imports reference the deleted modules

## Future Extension Points

The interface-based stage design allows these additions without modifying existing code:

| New Feature            | What to Add                                                    |
| ---------------------- | -------------------------------------------------------------- |
| HTML output            | New `renderers/html.ts`                                        |
| SVG graph              | New `renderers/svg.ts` using depcruise DOT → graphviz          |
| CI comparison          | New `stages/diff.ts` comparing against previous audit snapshot |
| Test coverage check    | New `stages/coverage.ts`                                       |
| Adapter-specific stats | New `stages/adapter-complexity.ts`                             |
