# Workflow — Auditing an Existing Project

Use when the project is basically working and shipping but you want to verify architectural soundness — before adding a major feature, onboarding more developers, or as a periodic health check.

Delivers: (1) the actual architectural shape drawn explicitly, (2) findings ranked by severity, (3) a short list of sized actions. Keep the report to one page.

## Stage 1 — Discover the actual architecture

Don't trust the README — the actual architecture lives in the dependency graph. Generate it mechanically:

| Ecosystem | Tools |
|---|---|
| JS/TS | `madge`, `dependency-cruiser` |
| Python | `pydeps`, `pyan` |
| Java | `jdepend`, `jqassistant`, ArchUnit |
| C#/.NET | `NDepend`, `dotnet-grapher` |
| Go | `go mod graph`, `godepgraph` |
| Rust | `cargo-modules`, `cargo-deps` |

Generate: (a) a component-level graph and (b) a file-level graph for the largest 3 suspect components. Classify each node as entity / use case / adapter / framework / **mixed** (mixed = finding).

## Stage 2 — Run the structural checks

### Check A — The Dependency Rule
Walk every edge: do all arrows point inward (toward higher policy / lower volatility)? Common outward leaks: use cases importing DB drivers; entities with framework annotations (`@Entity`, `@Table`); business logic instantiating HTTP clients or loggers directly; hard-coded env-specific URLs in policy code.

### Check B — Cycles (ADP)
Run cycle detection. Zero cycles is the target. Any cycle is a finding, regardless of size.

### Check C — I, A, D metrics
For top 5–10 components, compute `I = Ce/(Ca+Ce)`, `A = Na/Nc`, `D = |A+I−1|`. Flag components with `D > 0.1` or in a Zone of Exclusion (stable+concrete+volatile = Zone of Pain; unstable+abstract = Zone of Uselessness).

### Check D — The "screaming" test
Does the project root scream the *business domain* (`customers/`, `orders/`) or the *framework* (`controllers/`, `models/`, `views/` as root siblings)? Framework-screaming = finding.

### Check E — Volatile imports leaking inward
Scan inner-layer files: entities importing anything outside the standard library; use cases importing web/ORM/network classes; use cases calling `LocalDateTime.now()` directly (should use a `Clock` port).

### Check F — Tests as architecture
- Are entity/use-case unit tests isolated from infrastructure?
- Are tests structurally coupled 1:1 to production classes (Fragile Tests Problem)?
- Can tests exercise use cases without booting a web server or hitting a DB?

### Check G — Main is the only place that knows everything
Concrete construction and DI wiring must be concentrated in Main. `@Autowired`/`@inject` sprinkled across business objects = framework has spread inward = finding.

## Stage 3 — Score and rank findings

**P0 — fix soon:** cycles; entities/use cases importing frameworks or DB; DI wiring spread through codebase; stable+concrete+volatile component.

**P1 — fix opportunistically:** high-D components; structurally-coupled tests; top-level layout doesn't scream the domain.

**P2 — note, may be fine:** single Strategy/Facade where a full boundary might one day be needed; naming inconsistencies.

A typical audit produces 3–8 findings worth acting on, not 50.

## Stage 4 — Recommend sized actions

For each P0/P1, propose a specific, time-boxed action small enough to ship in one sprint:

> "Break the cycle between `billing` and `audit` by introducing an `AuditEvent` interface in `billing`; `audit` implements it. ~2 days."

> "Move all SQL out of `OrderUseCase` into `OrderGateway`, with the interface declared in the use-case package. ~1 day per use case."

## Stage 5 — Set up ongoing monitoring

Add to CI: cycle detection (fail on any new cycle); import-restriction rules (ArchUnit / `dependency-cruiser` / custom AST); schedule a lightweight re-audit quarterly.

## Output template

```
# Architecture Audit — <project name>
Date: <date> | Auditor: <name>

## Summary
<one paragraph: overall health, top 1–2 risks>

## Architecture as found
<one paragraph + small dependency diagram>

## Findings
P0 — <finding>: <description>. Fix: <action>.
P1 — <...>
P2 — <...>

## Recommended actions (sized)
1. <action> — ~<effort>. Owner: <suggested>.

## Monitoring to add
- <CI rule>
- <metric to track>
```

Deliver a signed, shared report — not just the act of running checks. See `assets/audit-checklist.md` for the printable check-by-check version.
