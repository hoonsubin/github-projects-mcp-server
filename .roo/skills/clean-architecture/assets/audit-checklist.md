# Architecture Audit — Concrete Checklist

A printable checklist for running the audit defined in `references/workflow-audit.md`. Any unticked item is either a finding or a blocker for the audit itself.

## A. Setup

- [ ] Cloned the repository at the latest commit on the main branch.
- [ ] Identified build/test commands and confirmed they run locally.
- [ ] Identified languages and frameworks in use.
- [ ] Found and read any existing architecture docs/ADRs (without trusting them as fact).

## B. The dependency graph

- [ ] Generated a component-level dependency graph (one node per top-level package/module/crate).
- [ ] Generated a class/file-level graph for at least the largest 3 components.
- [ ] Saved both graphs as artifacts of the audit.

## C. Layer classification

For each top-level component, mark which Clean Architecture layer it belongs to:

| Component | Layer (entity / use case / adapter / framework / mixed) | Notes |
| --------- | ------------------------------------------------------- | ----- |
|           |                                                         |       |

- [ ] Every component classified.
- [ ] Components marked "mixed" listed as findings.

## D. The Dependency Rule

- [ ] All dependency arrows point from less-stable to more-stable.
- [ ] No business-logic file imports a framework class (web, ORM, network, UI).
- [ ] No entity file imports anything outside the standard library.
- [ ] No entity has framework annotations (`@Entity`, `@Table`, `[Serializable]`, etc.).
- [ ] No use case imports `HttpRequest`, `HttpResponse`, `Session`, or equivalents.
- [ ] No use case contains SQL.
- [ ] No use case calls `LocalDateTime.now()` / `time.time()` directly (should use a Clock port).
- [ ] No use case constructs concrete external clients directly.

## E. Cycles (ADP)

- [ ] Component graph has zero cycles.
- [ ] CI has automated cycle detection. If not, recommend adding it.
- [ ] If cycles exist, each is listed with components involved and a proposed break.

## F. I / A / D metrics (top 5–10 components)

| Component | Fan-in (Ca) | Fan-out (Ce) | I = Ce/(Ca+Ce) | Na  | Nc  | A = Na/Nc | D = \|A+I−1\| | Verdict |
| --------- | ----------- | ------------ | -------------- | --- | --- | --------- | ------------- | ------- |
|           |             |              |                |     |     |           |               |         |

Verdicts: **OK** (`D ≤ 0.1`) · **Drift** (`D > 0.1`, watch) · **Zone of Pain** (low I, low A, volatile) · **Zone of Uselessness** (high I, high A)

- [ ] Metrics computed for top 5–10 components with verdicts assigned.

## G. The "screaming" test

- [ ] Top level reflects the **business domain** (e.g., `customers`, `orders`, `inventory`).
- [ ] Top level does **not** reflect the framework (`controllers`, `models`, `views`, `services` as root siblings).
- [ ] A new developer could guess what the system does from `ls` alone.

## H. The Main component

- [ ] A single (or small number of) Main component(s) exists, distinct from business code.
- [ ] All concrete construction (`new ConcreteThing()` or DI registrations) is concentrated in Main.
- [ ] DI annotations (`@Autowired`, `@Inject`, `@Component`) are **not** in business-logic code.
- [ ] Inner layers do not `import` Main.

## I. Tests as architecture

- [ ] Unit tests of business rules run without a database.
- [ ] Unit tests of business rules run without a web server or browser.
- [ ] Unit tests of business rules run without network access.
- [ ] Test suite is not 1:1 structurally coupled to production class structure.
- [ ] Tests can exercise use cases directly (not only through the GUI).
- [ ] Full unit suite runs in < 1 minute; full suite in < 10 minutes.

## J. Volatile imports leaking inward (spot-checks)

Pick 5 random files from each inner layer and grep their imports:

- [ ] Sampled entity files — imports look pure (standard library + own domain types only).
- [ ] Sampled use case files — own domain + own ports + standard library only.
- [ ] Sampled controller/adapter files — framework imports OK here; no leak in either direction.

## K. Boundaries

- [ ] Each architectural boundary identified with its decoupling mode (source / deployment / process / service).
- [ ] Boundary form named (full / Strategy / Facade / accidental).
- [ ] Backchannels around partial boundaries flagged.
- [ ] Service-level boundaries are justified (not just "because microservices").

## L. Drift over time (if history is accessible)

- [ ] Sampled D for top components 1 year ago vs. now; components drifting outward flagged.
- [ ] Change-frequency analyzed; frequently-changing components in Zone of Pain flagged as urgent.

## M. Findings summary

| Priority | Finding | Recommended action | Effort |
| -------- | ------- | ------------------ | ------ |
| P0       |         |                    |        |
| P1       |         |                    |        |
| P2       |         |                    |        |

- [ ] Priorities assigned per the rubric in `workflow-audit.md`.
- [ ] Effort estimates roughly sized (hours / days / weeks).
- [ ] Recommended actions are specific (named files/components, not "improve the architecture").

## N. Monitoring to add

- [ ] Cycle detection in CI (cite the tool).
- [ ] Import-restriction rules codified (ArchUnit / dependency-cruiser / custom).
- [ ] Periodic re-audit cadence agreed (quarterly is standard).

## O. Final report assembled

- [ ] One-paragraph summary written.
- [ ] Architecture-as-found described with the dependency diagram.
- [ ] Findings table populated and prioritized.
- [ ] Recommended actions listed with sizing.
- [ ] Report fits on one page (two max) and has been shared with the team.
