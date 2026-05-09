# The Clean Architecture — Layers, the Dependency Rule, and Humble Objects

Clean Architecture synthesizes Hexagonal/Ports-and-Adapters, BCE, and DCI into concentric rings: policy at the center, details at the edge.

## The four layers

| Ring | Layer | Contents | Depends on |
|---|---|---|---|
| outermost | Frameworks and Drivers | DB, web, UI, devices, external APIs | Interface Adapters |
| 3 | Interface Adapters | Controllers, presenters, gateways, view-models | Use Cases |
| 2 | Use Cases | Application policy | Entities |
| innermost | Entities | Enterprise policy and data | Nothing |

Source-code dependencies point inward only — outer layers depend on inner, never the reverse.

**Layer 1 — Entities (innermost):** enterprise-wide critical business rules and the data they operate on — valuable even on paper. **Depend on nothing.** No DB, no framework, no logging, no DI container. If you're adding non-stdlib imports here, stop and reconsider.

**Layer 2 — Use Cases:** application-specific business rules; orchestrate entities. Declare what they need from outside via interfaces (`OrderRepository`, `EmailGateway`) — those interfaces **live here**, with the use case. Input and output are plain DTOs — never `HttpRequest`, never JSON.

**Layer 3 — Interface Adapters:** controllers parse raw input → call use case; presenters format response DTO → view model; gateways translate domain language → DB/external service. All SQL lives here or further out — use cases never see a row or a `ResultSet`.

**Layer 4 — Frameworks & Drivers (outermost):** web framework, ORM, UI toolkit, DB drivers — the details. Write very little code here; mostly configure and wire. The **Main** component also lives here.

There's nothing magical about four layers. You may need more or fewer. What's invariant is the Dependency Rule.

## The Dependency Rule

> _Source code dependencies must point only inward, toward higher-level policy._

Nothing in an inner circle may _name_ anything in an outer circle — no imports, no class references, no string-typed lookups. Every rule violation trades future flexibility for present convenience. That trade is the exact anti-pattern this skill exists to prevent.

## Crossing boundaries against the flow of control

When a use case needs to call a presenter (inner → outer), use **dependency inversion via an output port**: the use case declares an interface (`present(OutputData data)`); the presenter implements it; the source-code dependency still points inward.

**What crosses the boundary:** simple DTOs only — never an entity, a database row, or a framework object. Data is always shaped for the _inner_ circle's convenience; the outer side translates.

## The Humble Object Pattern

Wherever a boundary separates testable from hard-to-test behavior (GUI, DB, network), split in two:

- **Humble object:** holds only the hard-to-test part — no logic, just mechanical plumbing.
- **Testable object:** holds everything else — all the work, decisions, and formatting.

Examples: View (humble) / Presenter (testable); DB implementation (humble) / gateway interface (testable). Every boundary corresponds to a Humble Object split, which means every boundary improves testability. If a boundary doesn't improve testability, it's probably in the wrong place.

## The Main Component

Main is the dirtiest, lowest-level module — the one place that knows about every concrete class. Its job: read config, construct all concrete implementations, inject them into use cases, hand control to policy. Main is a **plugin to the application**, not the other way around.

You can have multiple Mains (dev, prod, per-customer). DI framework wiring lives _only_ in Main — don't sprinkle `@autowired` through business objects. If you use a DI framework, it belongs in Main, not throughout the codebase.

## Tests as a system component

Tests are the **outermost** circle. The risk is structural coupling — tests mirroring production class structure 1:1, so every refactor breaks tests regardless of whether behavior changed (the Fragile Tests Problem). Fix: write tests against use cases via a Testing API, not the GUI and not individual production classes.

## What screams from the top of the directory

The top-level folder should reveal the _business domain_ — `patients`, `orders`, `billing` — not the framework (`controllers`, `models`, `views`, `services` as siblings at root). Prefer **package by component**: each top-level folder is a business feature; layers live as siblings inside it. See `assets/project-skeleton.md`.

## Quick checklist for "is this clean?"

1. **Independent of frameworks?** Could you swap Express for Flask without touching this file?
2. **Testable without externalities?** Can you unit-test with no DB, no network, no UI?
3. **Independent of UI?** Could the same business code serve CLI, web, and desktop?
4. **Independent of database?** Could you replace Postgres with flat files without touching rules?
5. **Independent of external agencies?** Do inner circles know nothing about the outside world?

Five "yes" = architecture doing its job. Each "no" = specific debt to address.
