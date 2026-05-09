# Workflow — Auditing an Existing Project

Use this workflow when the project is **basically working and shipping**, but the user wants to verify the architecture is sound — or harden it before adding a major feature, before onboarding more developers, before a long-term commitment, or as a periodic health check.

This is *not* the workflow for a system in trouble. If the codebase already feels like a swamp, use `workflow-cleanup.md` instead. If it works but the *internals are dirty*, use `workflow-strangle.md`. Audit is for "looks fine, want to be sure".

## What an audit produces

A short written report (one page is plenty) with three things:

1. **The current architectural shape** — drawn explicitly, even if no diagram has ever existed before.
2. **Specific violations and risks**, ranked by severity.
3. **A short list of recommended actions**, sized for the team's capacity.

Avoid the temptation to produce a 30-page tome. Architects who deliver tomes get read once and ignored thereafter. Deliver something the team will actually act on.

## Stage 1 — Discover the actual architecture

Before judging anything, find out what's there. Don't trust the README or the design doc — those describe intent. The actual architecture lives in the dependency graph.

**Technique**: extract the import / dependency graph, mechanically.

- JS/TS: `madge`, `dependency-cruiser`
- Python: `pydeps`, `pyan`, `import-deps`
- Java: `jdepend`, `jqassistant`, ArchUnit
- C#/.NET: `NDepend`, `dotnet-grapher`
- Go: `go mod graph`, `golang.org/x/tools/cmd/godepgraph`
- Rust: `cargo-modules`, `cargo-deps`
- Generic / cross-language: `ast-grep`, custom AST scripts

Generate two graphs:

- **The component-level graph**: nodes are top-level packages / modules / crates; edges are aggregated. This is what you reason about architecturally.
- **The class / file-level graph**: same shape but at finer grain. Use this to drill into specific suspect components.

Map each node to one of the Clean Architecture layers:
- **Entities** — pure domain objects with business rules and no external dependencies.
- **Use cases** — application orchestration, depending only on entities and ports.
- **Interface adapters** — controllers, presenters, gateway implementations.
- **Frameworks & drivers** — code that's mostly framework-supplied glue.

If you can't classify a component, that itself is a finding (it probably mixes layers).

## Stage 2 — Run the structural checks

Walk the dependency graph and check:

### Check A — The Dependency Rule

For each edge, ask: does it point inward (toward higher policy / lower volatility), or outward?

- **All inward**: pass.
- **Some outward**: violations. List them with file paths and the inverted dependency.

Common outward leaks:
- `import` from a use case file to a database driver.
- An entity referencing a framework annotation (`@Entity`, `@Table`, `[Serializable]`).
- A business-logic class instantiating a concrete logger / HTTP client / file writer.
- Hard-coded references to environment-specific values (URLs, paths) inside policy code.

### Check B — Cycles (ADP)

Run cycle detection. There should be **zero** cycles. Any cycle is a finding, regardless of size — even a 2-component cycle indicates the boundary is wrong.

### Check C — I, A, D metrics (component coupling)

For each component compute:

- **I = Ce / (Ca + Ce)** — instability (0 = stable, 1 = unstable)
- **A = Na / Nc** — abstractness (0 = concrete, 1 = abstract)
- **D = |A + I − 1|** — distance from the Main Sequence

Flag:
- Any component with `D > 0.1`.
- Any component in the **Zone of Pain** (low `I`, low `A`) that is *also volatile* (high commit frequency).
- Any component in the **Zone of Uselessness** (high `I`, high `A`) — abstract code with no real use.

You don't need fancy tooling for this. If the language doesn't have a metric tool, count by hand on the largest 5 components — that's enough to spot the worst offenders.

### Check D — The "screaming" test

Open the project root in a file browser. Pretend you've never seen it before. What does the top level scream?

- "Health-care system" / "shopping cart" / "reactor sim" / "billing engine" → pass.
- "Rails app" / "Spring app" / "ASP.NET MVC" → fail. The framework has eaten the architecture.

Fixing this is a refactor (move from package-by-layer to package-by-component), but the audit's job is just to mark whether it's needed.

### Check E — Volatile leaking inward

Scan inner-layer files for forbidden imports:

- Entities importing anything besides standard library / pure-language helpers.
- Use cases importing web framework classes, ORM classes, network clients, file system, OS calls, time-of-day directly (should go through a `Clock` port).
- Tests of business rules that require a database, a network, or a UI to run.

### Check F — Tests as architecture

Look at the test suite:

- Are unit tests of entities and use cases isolated from infrastructure? (Should be.)
- Are tests structurally coupled (one test class per production class, mirroring the production tree)? (Bad sign — Fragile Tests Problem.)
- Does the test suite use a Testing API that bypasses UI/DB/network for verification, or does it drive everything through the GUI?

Fragile tests are an architectural symptom: they show that the policy can't be exercised in isolation, which means policy and detail are coupled.

### Check G — Main is the only place that knows everything

Find the entry-point component(s). Verify:

- Concrete construction (`new`, container registrations) is concentrated here.
- DI annotations / framework wiring is **not** sprinkled throughout the rest of the codebase.
- Inner layers do not `import` Main.

If `@autowired` / `@inject` / equivalent is sprinkled across the codebase, the framework has spread inward — note this as a finding.

## Stage 3 — Score and rank findings

Don't list all findings as equals. Group them:

**P0 — fix soon (architectural fault).**
- Cycles in component graph.
- Entities or use cases imported from frameworks / databases / UI.
- DI wiring spread throughout the codebase.
- "Stable + concrete + volatile" component (Zone of Pain with frequent changes).

**P1 — fix opportunistically.**
- Components with high `D` (drifting from Main Sequence).
- Tests structurally coupled to production code.
- Top-level layout doesn't scream the domain.

**P2 — note, may be fine.**
- Single uses of Strategy/Facade where a full boundary might one day be needed.
- Components that are slightly larger than ideal.
- Naming inconsistencies.

Use this ranking to constrain recommendations to what actually matters. A typical audit produces 3–8 findings worth acting on, not 50.

## Stage 4 — Recommend actions sized to the team

For each finding above P2, propose a **specific, time-boxed action**:

- "Break the cycle between `billing` and `audit` by introducing an `AuditEvent` interface in `billing` and having `audit` implement it. ~2 days."
- "Move all SQL out of `OrderUseCase` into `OrderGateway`, with the gateway interface declared in the use-case package. ~1 day per use case, batchable."
- "Replace direct `LocalDateTime.now()` calls in business rules with a `Clock` port. ~half day; refactors test code to inject a fake clock."

Avoid recommending big-bang rewrites. Each action should be small enough to ship in one sprint, with the codebase strictly better afterward. If a finding requires a big-bang fix, the audit isn't the right vehicle — that's a `workflow-cleanup.md` situation.

## Stage 5 — Set up ongoing monitoring

The audit is a snapshot. Architecture decays continuously. Recommend at least the following be added to CI / project scripts:

- **Cycle detection** in CI — fail the build on any new cycle.
- **An import-restriction rule set** — codify the Dependency Rule with a tool that can enforce it (ArchUnit for Java, `dependency-cruiser` for JS, custom AST checks for Python/Rust).
- **A periodic re-audit** — schedule a lightweight re-run quarterly, or before every major release. The full check takes one engineer a few hours once tooling is in place.

## When audit reveals trouble

Sometimes the audit finds that the codebase is in worse shape than the user thought — a Big Ball of Mud hiding behind a working test suite. In that case, switch to `workflow-cleanup.md` and reset expectations: this is a recovery effort, not a tune-up.

## Output template

Use this short template for the final report. Keep it terse.

```
# Architecture Audit — <project name>
Date: <date>
Auditor: <name>

## Summary
<one paragraph: overall health, top 1-2 risks>

## Architecture as found
<one paragraph + a small dependency diagram>

## Findings
P0 — <finding>: <one-line description>. Fix: <one-line action>.
P0 — <...>
P1 — <...>
P2 — <...>

## Recommended actions (sized)
1. <action> — ~<effort>. Owner: <suggested>.
2. ...

## Monitoring to add
- <CI rule>
- <metric to track>
```

This document, signed and shared with the team, is the deliverable. Anything longer is wasted writing.

## See also

- `assets/audit-checklist.md` — a printable check-by-check version of Stage 2.
- `references/component-principles.md` — for the I/A/D math.
- `references/clean-architecture-layers.md` — for the "is this clean?" checklist.
