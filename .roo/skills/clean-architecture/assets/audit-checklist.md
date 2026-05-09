# Architecture Audit — Concrete Checklist

A printable / pasteable checklist for running the audit defined in `references/workflow-audit.md`. Tick each item as you go. Anything not ticked is either a finding or a blocker for the audit itself.

## A. Setup

- [ ] Cloned the repository at the latest commit on the main branch.
- [ ] Identified the build / test commands and confirmed they run locally.
- [ ] Identified the languages and frameworks in use.
- [ ] Found and read any existing architecture docs / ADRs (without trusting them as fact).

## B. The dependency graph

- [ ] Generated a component-level dependency graph (one node per top-level package / module / crate).
- [ ] Generated a class- or file-level dependency graph for at least the largest 3 components.
- [ ] Saved both graphs as artifacts of the audit (image or text).

## C. Layer classification

For each top-level component, mark which Clean Architecture layer it belongs to:

| Component | Layer (entity / use case / adapter / framework / mixed) | Notes |
|---|---|---|
|   |   |   |
|   |   |   |

- [ ] Every component classified.
- [ ] Components marked "mixed" listed as findings (mixed layers usually means the boundary is wrong).

## D. The Dependency Rule

Walk every edge in the component graph:

- [ ] All dependency arrows point from less-stable to more-stable.
- [ ] All dependency arrows point from concrete-detail layers toward abstract-policy layers.
- [ ] No business-logic file imports a framework class (web, ORM, network, UI).
- [ ] No entity file imports anything outside the language standard library / pure-language helpers.
- [ ] No entity has framework annotations (`@Entity`, `@Table`, `[Serializable]`, etc.).
- [ ] No use case imports `HttpRequest`, `HttpResponse`, `Session`, or equivalents.
- [ ] No use case contains SQL.
- [ ] No use case calls `LocalDateTime.now()` / `time.time()` / equivalent directly (should use a Clock port).
- [ ] No use case constructs concrete external clients directly (HTTP clients, DB connections).

Each unchecked item is a P0 or P1 finding depending on prevalence.

## E. Cycles (ADP)

- [ ] Component graph has zero cycles.
- [ ] CI / build has automated cycle detection. If not, recommend adding it.
- [ ] If cycles exist, list each cycle with the components involved and a proposed break (DIP inversion or extract third component).

## F. I / A / D metrics (top 5–10 components)

| Component | Fan-in (Ca) | Fan-out (Ce) | I = Ce/(Ca+Ce) | Na | Nc | A = Na/Nc | D = \|A+I−1\| | Verdict |
|---|---|---|---|---|---|---|---|---|
|   |   |   |   |   |   |   |   |   |
|   |   |   |   |   |   |   |   |   |

Verdict possibilities:
- **OK** — `D ≤ 0.1`, on/near the Main Sequence.
- **Drift** — `D > 0.1` but not in a Zone of Exclusion. Watch.
- **Zone of Pain** — low `I`, low `A`, *and* volatile (frequent changes). Finding.
- **Zone of Uselessness** — high `I`, high `A`. Finding (probably abandoned abstractions).

- [ ] Metrics computed for top 5–10 components.
- [ ] Each component verdicted.
- [ ] Findings logged for components in either Zone of Exclusion.

## G. The "screaming" test

Open the project root. Without consulting docs, what does the top-level layout suggest the system *does*?

- [ ] Top level reflects the **business domain** (e.g., `customers`, `orders`, `inventory`).
- [ ] Top level does **not** reflect the framework (e.g., `controllers`, `models`, `views`, `services`, `repositories` as siblings at root).
- [ ] A new developer could form a correct guess about what the system does from `ls` alone.

If any of these are unticked, recommend a migration toward package-by-component (over time, not big-bang).

## H. The Main component

- [ ] A single (or small number of) Main component(s) exists, distinct from business code.
- [ ] All concrete construction (`new ConcreteThing()` or DI registrations) is concentrated in Main.
- [ ] DI annotations / framework wiring (`@Autowired`, `@Inject`, `@Component`, etc.) are **not** sprinkled throughout business-logic code.
- [ ] Inner layers do not `import` Main (or the DI framework directly).
- [ ] Multiple Mains exist or could exist for different deployments (dev / prod / per-customer / per-region).

## I. Tests as architecture

- [ ] Unit tests of business rules run without a database.
- [ ] Unit tests of business rules run without booting a web server / browser.
- [ ] Unit tests of business rules run without network access.
- [ ] Test suite is not 1:1 structurally coupled to production class structure (Fragile Tests Problem).
- [ ] A "Testing API" or equivalent allows tests to exercise use cases directly (not only through the GUI).
- [ ] Test runtime is reasonable (full unit suite < 1 minute; full suite < 10 minutes).

## J. Volatile imports leaking inward (spot-checks)

Pick 5 random files from each inner layer and grep their imports.

- [ ] Sampled entity files. Imports look pure (standard library + own domain types only).
- [ ] Sampled use case files. Imports are own domain + own ports + standard library only.
- [ ] Sampled controller / adapter files. Framework imports OK here; no leak in either direction.

Findings: list any sampled file with a forbidden import.

## K. Boundaries (full / partial / accidental)

- [ ] Each architectural boundary identified.
- [ ] For each boundary, the decoupling mode is named (source / deployment / process / service).
- [ ] For each boundary, the boundary form is named (full / Strategy / Facade / accidental).
- [ ] Backchannels around partial boundaries flagged. (Code reaching past a Facade or Strategy directly to internal classes.)
- [ ] Service-level boundaries are justified. (If "we have microservices because microservices", that's a finding.)

## L. Drift over time (if history is accessible)

- [ ] Sampled `D` for top components 1 year ago vs. now. Components drifting outward (away from Main Sequence) flagged.
- [ ] Component change-frequency analyzed. Frequently-changing components in the Zone of Pain flagged as urgent.
- [ ] Defect rate per component analyzed if data is available. Components with high defect rates and high `D` doubly flagged.

## M. Findings summary

| Priority | Finding | Recommended action | Effort |
|---|---|---|---|
| P0 |   |   |   |
| P0 |   |   |   |
| P1 |   |   |   |
| P1 |   |   |   |
| P2 |   |   |   |

- [ ] Priorities assigned per the rubric in `workflow-audit.md`.
- [ ] Effort estimates roughly sized (hours / days / weeks).
- [ ] Recommended actions are **specific** (named files / components / commits, not "improve the architecture").

## N. Monitoring to add

- [ ] Cycle detection in CI (cite the tool).
- [ ] Import-restriction rules codified (cite the tool: ArchUnit / dependency-cruiser / custom).
- [ ] Periodic re-audit cadence agreed (quarterly is standard).
- [ ] Any component-specific alarm (e.g., "alert if `D` of `CoreBilling` exceeds 0.2").

## O. Final report assembled

- [ ] One-paragraph summary written.
- [ ] Architecture-as-found described in one paragraph + the dependency diagram.
- [ ] Findings table populated.
- [ ] Recommended actions listed with sizing.
- [ ] Monitoring recommendations included.
- [ ] Report fits on one page (or two, max).
- [ ] Report shared with the team and the engineering lead.

A finished audit is a delivered, signed report — not the act of running these checks. Don't forget to write the document and hand it over.
