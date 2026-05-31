# Implementation Plan: dependency-cruiser Architecture Test

**Date:** 2026-05-31\
**Status:** Draft for review\
**Based on:** Architecture audit of working directory changes, layer contract from [`AGENT.md`](../AGENT.md), and [`docs/ARCHITECTURE.MD`](../docs/ARCHITECTURE.MD)

---

## 1. Goal

Add a **CI-enforceable** dependency rule check that prevents architectural drift in the project's Clean Architecture layering. Specifically:

- **Fail CI** if any source file imports across layer boundaries in the _wrong_ direction (outward).
- **Fail CI** if any circular dependency exists between source modules.
- **Produce a machine-parseable violation report** (JSON + text) for PR comments and local debugging.

---

## 2. How dependency-cruiser works — and why it's different from the existing diagram generator

**dependency-cruiser** is a static analysis tool that parses every import statement in the codebase, builds a complete dependency graph, and matches it against user-defined rules.

- Rules use `from` (source file pattern) and `to` (target file pattern) with regex path matchers — e.g. "files in `src/domain/` must NOT import files in `src/adapters/`".
- Built-in `circular: true` rule detects cycles of any size.
- Exits with non-zero code on any `error`-severity violation — CI gate.

**Comparison with the existing diagram generator** ([`scripts/generate-project-diagram.ts`](scripts/generate-project-diagram.ts)):

| Aspect                           | dependency-cruiser                                          | Diagram generator script                     |
| -------------------------------- | ----------------------------------------------------------- | -------------------------------------------- |
| **Purpose**                      | **CI enforcement gate**                                     | Documentation visualization                  |
| **What it analyzes**             | Import edges (who imports who)                              | Export symbols (what types a module exposes) |
| **Output**                       | Exit code + text/JSON/HTML violation report                 | Mermaid `classDiagram` artifacts             |
| **When it runs**                 | Every CI run (fails on violation)                           | Manually or on docs refresh                  |
| **Rules engine**                 | Declarative `forbidden/allowed/required` regex rules        | None — purely descriptive                    |
| **Enforces Clean Architecture?** | **Yes** — fails CI if `src/domain/` imports `src/adapters/` | No — only visualises structure               |
| **Cycle detection**              | Built-in (`circular: true`)                                 | Manual inspection of arrows                  |

They are **complementary**: the diagram shows the intended structure; dep-cruiser prevents it from degrading.

---

## 3. Current Layer Architecture (as-found)

```
Layer            │ Directory           │ May Import From              │ Must NOT Import From
─────────────────┼──────────────────────┼─────────────────────────────┼──────────────────────────
Domain           │ src/domain/          │ std lib, npm                │ Anything else in src/
Use-Case         │ src/scrum/           │ domain, std lib, npm        │ adapters, tools, schemas, server
Services         │ src/services/        │ domain, std lib, npm        │ adapters, tools, schemas, server
Adapters         │ src/adapters/        │ domain, scrum/ports,        │ tools, schemas, server
                 │                      │ services, std lib, npm      │
Tools            │ src/tools/           │ scrum, domain, std lib, npm │ adapters, schemas
Schemas          │ src/schemas/         │ external (zod only)         │ domain, scrum, adapters, tools, server
Server (Main)    │ src/server.ts        │ everything (composition)    │ N/A — the one exception
```

**Cross-cutting permissions:**

- `src/services/` is framework-utility layer (logger, pick-defined). Used by both use-case and adapter code. Acceptable as shared infrastructure.
- `src/server.ts` is Main — the one place that depends on concretions by design.

---

## 4. Implementation Steps

### Step 1: Create `.dependency-cruiser.cjs`

Place at project root. See §5 for full configuration.

This file uses CommonJS (`module.exports`) because dependency-cruiser's native config loader expects it. It lives at the project root, same convention as ESLint/Prettier/other tool configs.

**Why `.cjs` and not `.ts`:** dependency-cruiser loads the config file using Node's `require()`, which only works with CommonJS. Deno's npm-compat layer inherits this constraint.

### Step 2: Create `scripts/depcruise.ts`

A Deno wrapper script that:

1. **Imports `dependency-cruiser`** via the npm specifier already declared in [`deno.json`](deno.json:25).
2. **Calls `cruise()`** programmatically — scanning `src/` with the `.dependency-cruiser.cjs` config.
3. **Outputs violations** to stdout in both text and JSON formats.
4. **Exits with code 0** on pass, **non-zero** on any `error`-severity violation.

```
┌─────────────────────────────────────────────────────────────┐
│  scripts/depcruise.ts                                        │
│                                                              │
│  1. Resolve path to .dependency-cruiser.cjs                  │
│  2. Import { cruise, format } from "dependency-cruiser"      │
│  3. Call cruise(["src/"], config, {})                        │
│  4. Format output via format() → text reporter               │
│  5. Write formatted output to stdout                         │
│  6. Write JSON output to stdout or file                      │
│  7. Count error-severity violations                          │
│  8. Deno.exit(violationCount > 0 ? 1 : 0)                   │
└─────────────────────────────────────────────────────────────┘
```

**Programmatic API usage** (signatures from dependency-cruiser v17 docs):

```typescript
import { cruise, format } from "dependency-cruiser";

const cruiseResult = cruise(["src/"], depcruiseConfig, {});
const output = format(cruiseResult, "text");
console.log(output);

// Count violations
const errorCount = cruiseResult.summary.error;
Deno.exit(errorCount > 0 ? 1 : 0);
```

### Step 3: Add `deno task` entries to [`deno.json`](deno.json)

```json
"depcruise": "deno run --allow-read --allow-env scripts/depcruise.ts",
"depcruise:json": "deno run --allow-read --allow-env scripts/depcruise.ts --json",
"depcruise:html": "deno run --allow-read --allow-env --allow-write scripts/depcruise.ts --html"
```

Required permissions:

- `--allow-read` — to scan `src/` files and read config
- `--allow-env` — for `dependency-cruiser` internals that read `NODE_ENV` etc.

### Step 4: Add CI step

In `.github/workflows/`, add a step after lint:

```yaml
- name: Architecture boundary validation
  run: deno task depcruise
```

---

## 5. `.dependency-cruiser.cjs` — Full Configuration

```javascript
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    // ── Rule 1: Domain must not depend on anything else in src/ ──────────
    {
      name: "domain-must-not-depend-on-inner-layers",
      comment: "src/domain/ is the innermost layer. It must not import from scrum, " +
        "adapters, tools, schemas, services, or server.",
      severity: "error",
      from: { path: "^src/domain/" },
      to: { path: "^src/(scrum|adapters|tools|schemas|services|server\\.ts)" },
    },

    // ── Rule 2: Use-case must not depend on adapters or outer layers ─────
    {
      name: "use-case-must-not-depend-on-adapters",
      comment: "src/scrum/ (use-cases) must not import adapters, tools, schemas, " +
        "or server. Only domain, std lib, and same-layer imports are allowed.",
      severity: "error",
      from: { path: "^src/scrum/" },
      to: { path: "^src/(adapters|tools|schemas|server\\.ts)" },
    },

    // ── Rule 3: Services must not depend on adapters or outer layers ─────
    {
      name: "services-must-not-depend-on-adapters",
      comment: "src/services/ (framework utilities) must not import adapters, " +
        "tools, schemas, or server.",
      severity: "error",
      from: { path: "^src/services/" },
      to: { path: "^src/(adapters|tools|schemas|server\\.ts)" },
    },

    // ── Rule 4: Adapters must not depend on tools, schemas, or server ────
    {
      name: "adapters-must-not-depend-on-tools-schemas-server",
      comment: "src/adapters/ must not import tools, schemas, or server. " +
        "They may import domain, scrum/ports, and services.",
      severity: "error",
      from: { path: "^src/adapters/" },
      to: { path: "^src/(tools|schemas|server\\.ts)" },
    },

    // ── Rule 5: Tools must not depend on adapters ───────────────────────
    {
      name: "tools-must-not-depend-on-adapters",
      comment: "src/tools/ (framework handlers) must not import adapters directly " +
        "— they use use-cases which depend on the port interface.",
      severity: "error",
      from: { path: "^src/tools/" },
      to: { path: "^src/adapters/" },
    },

    // ── Rule 6: Schemas must not depend on any src/ layer ────────────────
    {
      name: "schemas-must-not-depend-on-src",
      comment: "src/schemas/ is the outermost validation layer. " +
        "It must only depend on external libraries (zod).",
      severity: "error",
      from: { path: "^src/schemas/" },
      to: { path: "^src/(domain|scrum|adapters|tools|services|server\\.ts)" },
    },

    // ── Rule 7: No circular dependencies ─────────────────────────────────
    {
      name: "no-circular-dependencies",
      comment: "Circular dependencies cause coupling and fragility. " +
        "Break cycles via DIP or extraction.",
      severity: "error",
      from: {},
      to: { circular: true },
    },

    // ── Rule 8: No console.log in src/ ───────────────────────────────────
    {
      name: "no-console-log",
      comment: "console.log pollutes MCP stdio transport. " +
        "Use log.* from src/services/logger.ts instead.",
      severity: "error",
      from: { path: "^src/" },
      to: { dependencyTypes: ["core"], path: "console" },
    },
  ],

  options: {
    // Don't follow external dependencies
    doNotFollow: {
      dependencyTypes: [
        "npm",
        "npm-dev",
        "npm-optional",
        "npm-peer",
        "npm-bundled",
        "npm-no-pkg",
      ],
    },

    // Exclude generated files, fixtures, snapshots
    exclude: {
      path: [
        "node_modules",
        "src/adapters/github/generated/",
        "src/adapters/github/internal/__fixtures__/",
        "src/scrum/__snapshots__/",
        "dist/",
      ],
    },

    // Only scan src/ directory
    includeOnly: "^src/",

    // Module system: Deno uses ESM with .ts extensions
    moduleSystems: ["es6", "cjs"],

    // Enhanced resolution for MCP SDK .js imports
    enhancedResolve: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "default"],
    },

    preserveSymlinks: false,
  },
};
```

### Rule Reference

| # | Rule Name                                          | Severity | Violation Example                                    | Fix                                    |
| - | -------------------------------------------------- | -------- | ---------------------------------------------------- | -------------------------------------- |
| 1 | `domain-must-not-depend-on-inner-layers`           | error    | `domain/errors.ts` → `scrum/ports.ts`                | Invert dependency or extract to domain |
| 2 | `use-case-must-not-depend-on-adapters`             | error    | `scrum/find-items.ts` → `adapters/github/`           | Depend on port interface only          |
| 3 | `services-must-not-depend-on-adapters`             | error    | `services/*` → `adapters/*`                          | Keep services thin and agnostic        |
| 4 | `adapters-must-not-depend-on-tools-schemas-server` | error    | `adapters/factory.ts` → `tools/scrum-read.ts`        | Tools call adapters, not reverse       |
| 5 | `tools-must-not-depend-on-adapters`                | error    | `tools/scrum-read.ts` → `adapters/github/backend.ts` | Tools call use-cases, not adapters     |
| 6 | `schemas-must-not-depend-on-src`                   | error    | `schemas/scrum.ts` → `domain/types.ts`               | Duplicate minimal type in schema file  |
| 7 | `no-circular-dependencies`                         | error    | Module A → B → A                                     | Break via DIP or extract shared        |
| 8 | `no-console-log`                                   | error    | Any `console.log()` in src/                          | Replace with `log.*()`                 |

---

## 6. Expected Results

Based on the architecture audit confirming a clean layering, the **current codebase should pass all 8 rules** with zero violations. The rules act as a **regression guard** — any future change that introduces an outward-pointing dependency will fail CI.

---

## 7. Risk Assessment

| Risk                                                                               | Likelihood | Mitigation                                                                                                                                      |
| ---------------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| dependency-cruiser's programmatic API doesn't work through Deno's npm-compat layer | Medium     | Fallback: invoke the CLI via `new Deno.Command("deno", ["run", "-A", "npm:dependency-cruiser", "src/", "--config", ".dependency-cruiser.cjs"])` |
| `.cjs` config not found at correct path                                            | Low        | Script resolves relative to project root via `import.meta.dirname`                                                                              |
| False positives on MCP SDK `.js` imports                                           | Low        | `moduleSystems: ["es6", "cjs"]` handles CJS interop                                                                                             |
| Performance — scanning full src/ on every CI run                                   | Low        | ~2-5 seconds for <200 files                                                                                                                     |

---

## 8. Implementation Todo List

- [ ] **Create [`.dependency-cruiser.cjs`](../.dependency-cruiser.cjs)** at project root with 8 rules from §5
- [ ] **Create [`scripts/depcruise.ts`](../scripts/depcruise.ts)** — wrapper script that:
  - Imports `{ cruise, format }` from `npm:dependency-cruiser`
  - Loads config from `.dependency-cruiser.cjs`
  - Calls `cruise(["src/"], config, {})`
  - Formats output as text and writes to stdout
  - Exits non-zero if any `error`-severity violation found
- [ ] **Add `deno task depcruise`** to [`deno.json`](deno.json) — `deno run --allow-read --allow-env scripts/depcruise.ts`
- [ ] **Initial scan** — `deno task depcruise` and verify zero violations
- [ ] **Add CI step** in `.github/workflows/` — `deno task depcruise`
- [ ] **Induced-violation test** — temporarily add a bad import, confirm depcruise fails
