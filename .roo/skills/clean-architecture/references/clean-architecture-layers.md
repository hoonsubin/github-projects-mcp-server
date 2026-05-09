# The Clean Architecture — Layers, the Dependency Rule, and Humble Objects

Clean Architecture is one specific way to apply the principles in `solid-principles.md` and `component-principles.md` to a whole system. It synthesizes earlier ideas — Cockburn's Hexagonal / Ports-and-Adapters, Jacobson's BCE (Boundary-Control-Entity), DCI (Data-Context-Interaction) — into a single shape. The shape is concentric: business policy at the center, frameworks and devices at the edge.

## The four layers

Picture four concentric circles. The **inner** circles are *high-level policy*; they're stable, abstract, valuable. The **outer** circles are *details*; they're volatile, concrete, replaceable. The central insight: **source-code dependencies must point only inward.** Nothing in an inner circle may name anything in an outer circle.

```
              ┌────────────────────────────────────┐
              │   FRAMEWORKS & DRIVERS             │
              │   (DB, web, UI, devices, ext APIs) │
              │                                    │
              │   ┌─────────────────────────────┐  │
              │   │ INTERFACE ADAPTERS          │  │
              │   │ (controllers, presenters,   │  │
              │   │  gateways, view-models)     │  │
              │   │                             │  │
              │   │   ┌──────────────────────┐  │  │
              │   │   │ USE CASES            │  │  │
              │   │   │ (application policy) │  │  │
              │   │   │                      │  │  │
              │   │   │ ┌──────────────────┐ │  │  │
              │   │   │ │ ENTITIES         │ │  │  │
              │   │   │ │ (enterprise      │ │  │  │
              │   │   │ │  policy, data)   │ │  │  │
              │   │   │ └──────────────────┘ │  │  │
              │   │   └──────────────────────┘  │  │
              │   └─────────────────────────────┘  │
              └────────────────────────────────────┘
                  Source code dependencies →→→→ inward
```

There's nothing magical about *four* layers. You may need more or fewer in a given system. What's invariant is **the Dependency Rule**: dependencies cross boundaries only one way, toward higher-level / more abstract policy.

### Layer 1 — Entities (innermost)

**Entities encapsulate enterprise-wide critical business rules and the data those rules operate on.** A `Loan` entity that knows how to compute interest, validate a payment schedule, and check whether it's past due — that's an entity. The rules inside it would still be true and valuable even if the company had no software at all and ran the business on paper. The data it holds (loan principal, rate, term) is *Critical Business Data*.

Entities are the most abstract, most stable, most reusable code in the system. **They depend on nothing.** No database, no web framework, no UI, no logging library, no DI container. If you find yourself adding `import` statements at the entity layer that aren't part of the language standard library or pure-language utilities, stop and reconsider.

In a single-application project, "Entities" are the domain objects of the application. In a multi-application enterprise, entities are shared across apps and live in their own component, depended on by all of them.

### Layer 2 — Use Cases

**Use cases encapsulate application-specific business rules.** They orchestrate the entities. A use case like "officer creates a loan application" knows the flow: gather customer data, validate credit score, ask the `Loan` entity to construct itself, persist it, return a confirmation. The business rule "credit score must be ≥ 500" lives here — it's specific to the *application*, not to the bank's existence.

Use cases depend inward on entities and **outward on nothing**. They define what they need from the outer world via interfaces (`OrderRepository`, `EmailGateway`, `PaymentProcessor`) — interfaces that live *here*, in the use-case layer, with the use case that needs them. Implementations live further out.

A well-designed use case takes a simple input data structure (a request DTO) and produces a simple output data structure (a response DTO). It does **not** receive `HttpRequest`, `Session`, `User-Agent`, or any framework type. It does **not** return JSON, HTML, or anything that knows how to format itself.

### Layer 3 — Interface Adapters

**Adapters convert between the form most convenient for use cases / entities and the form most convenient for whatever lives outside.** The MVC of a typical web app lives entirely here:

- **Controllers** receive raw input from the framework, parse it into the use case's request structure, invoke the use case.
- **Presenters** receive the use case's response structure, format it (dates as strings, currency with symbols, booleans for "should this button be greyed?") into a *View Model* the view can dumbly render.
- **Gateways** (a.k.a. repository implementations) translate between the use case's domain language ("find loans past due") and whatever the database or external service speaks (SQL, ORM calls, REST queries).

If your system uses SQL, *all SQL lives in this layer or further out*. The use cases must never see a row, a `ResultSet`, an ORM entity, or a `Connection`. They see only the gateway interface they declared themselves.

### Layer 4 — Frameworks & Drivers (outermost)

**This is where all the details go.** Web framework, ORM, browser, database driver, message queue client, UI toolkit, OS calls, devices. You write very little code here yourself; mostly you're configuring and wiring framework-supplied pieces together. Treat each framework as a tool you might one day replace, not a foundation to build on.

The outermost ring is also where the **Main** component lives — see below.

## The Dependency Rule, stated precisely

> *Source code dependencies must point only inward, toward higher-level policy.*

Concretely: nothing in an inner circle may *name* anything in an outer circle. No imports, no class references, no string-typed lookups by name, no shared data formats authored by an outer layer. If `OrderUseCase` mentions `HttpServletRequest`, the rule is broken. If `Loan` knows the name of a database column, the rule is broken.

The rule sounds restrictive, and it is. But it's also why the inner circles can be tested in isolation, swapped between deployment modes, and survive framework migrations. Every time you're tempted to break the rule "just for this one thing", you're trading future flexibility for present convenience. That trade is the *exact* anti-pattern this skill exists to prevent.

## Crossing boundaries against the flow of control

Here's the puzzle: sometimes the flow of control needs to go from inner to outer. A use case finishes its work and needs the presenter to format the result. But the use case can't *name* the presenter — that would be an outward dependency. How?

**Dependency inversion via an output port.** The use case declares an interface (the *output port*) that describes what it needs from a presenter — `void present(OutputData data)`. The presenter, in the outer layer, *implements* this interface. At runtime, control flows from the use case through the interface and into the presenter. At source-code level, the dependency arrow still points inward: the presenter depends on the interface, not the other way around.

This is the workhorse pattern at every clean architecture boundary. You'll use it for:
- Use case calling a presenter (output port).
- Use case calling a gateway (gateway interface lives in use-case layer; implementation lives outward).
- Use case publishing an event to outside listeners (publisher interface in use case; subscribers in adapters).

**What crosses the boundary**: simple data structures only. Plain DTOs, structs, dictionaries, dataclasses. Never an entity object (that would expose internals). Never a database row (that would couple the inner side to the outer side's schema). The data is always shaped for the *inner* circle's convenience, not the outer's.

## The Humble Object Pattern

The Humble Object pattern is the practical lever that makes clean architecture testable. Wherever a boundary separates testable behavior from hard-to-test behavior (a GUI, a database call, a network round-trip), split the work in two:

- **The humble object** holds only the part that's hard to test. It's kept as small and stupid as possible — no logic, just "move this string into that field, call this driver method".
- **The testable object** holds everything else. It does the work, decides the shape of outputs, then hands the data to the humble object.

Examples throughout clean architecture:
- **View / Presenter**: The View is the humble object — it just shoves strings into UI elements. The Presenter is testable — it formats and decides.
- **Database gateway / repository implementation**: The gateway *interface* is testable; the implementation that talks SQL is humble.
- **Service listener**: The protocol marshalling is humble; the use case it calls is testable.

The architectural payoff: every boundary in the system corresponds to a Humble Object split, which means every boundary improves testability. If a boundary doesn't seem to improve testability, it probably isn't in the right place.

## The Main Component

Every system has one component that *does* depend on concretions: the entry point. `main()`, `Program.cs`, `app.py`, `index.js`. **Main is the dirtiest component**, and that's correct — it's the one place where you allow yourself to know about every concrete class, every framework, every config value. Its job is to:

1. Read configuration.
2. Construct the concrete implementations of every interface the inner layers declared (gateways, presenters, factories, clients).
3. Wire them into the inner-layer use cases via constructor injection.
4. Hand control to the high-level policy.

Main is a **plugin to the application** — not the other way around. The use cases don't import Main. The entities don't know Main exists. Main reaches in, configures everything, then steps back. You can have multiple Mains: one for development, one for production, one per customer or deployment region. Each is a separate plugin selecting a different bundle of concrete implementations.

If you use a DI framework (Spring, Dagger, FastAPI's `Depends`, Microsoft.Extensions.DependencyInjection), it lives in Main, not throughout the codebase. Don't sprinkle `@autowired` or `@inject` annotations through your business objects — that couples them to the framework, defeating the point.

## Tests as a system component

Tests are part of the architecture. They follow the Dependency Rule too: tests are the **outermost** circle, depending inward on production code. Nothing inside the system depends on tests; tests depend on the system.

The risk is **structural coupling** — tests that mirror the production class structure one-to-one. Every refactor of production code breaks dozens of tests, regardless of whether behavior changed. This is the *Fragile Tests Problem*, and over time it makes teams refuse to refactor at all.

The fix: write tests against use cases (and the testing API that exposes them), not against the GUI and not against individual production classes. The testing API is a layer parallel to the controllers / presenters — it gives tests the ability to drive the application, bypass slow resources, and force specific states, without ever going through the UI. Tests should be able to verify business rules without booting a web server, opening a browser, or connecting to a real database.

## What screams from the top of the directory

If a stranger opens your project and looks at the top-level folder, what should they see?

- A health-care system should look like a health-care system. Folders named `patients`, `appointments`, `prescriptions`, `billing`.
- A reactor simulator should look like a reactor simulator. Folders named `core`, `coolant`, `controlrods`, `safety`.
- A shopping cart should look like a shopping cart. `cart`, `checkout`, `orders`, `inventory`.

It should *not* look like every other project in your language. If your top level is `controllers/`, `models/`, `views/`, `services/`, `repositories/` — what you've shown the reader is which framework you're using, not what the system does. That's "package by layer", and Simon Brown's "Missing Chapter" of the book argues correctly that it's worse than the alternatives. Prefer **package by component**: each top-level folder is a feature of the business domain, and inside each folder the layers (use case, gateway, entity) live as siblings, with access modifiers used to encapsulate.

See `assets/project-skeleton.md` for a starter layout.

## Common confusions and traps

- **"Entities should be database rows / ORM objects."** No. Entities are pure business objects. ORM-mapped data classes belong in the gateway layer; convert them to entities at the boundary.
- **"The use case should return a DTO that knows how to render itself."** No. The use case returns a passive data structure. The presenter, in the outer layer, knows how to render.
- **"I'll just have the controller call the database directly for this one query."** That's the relaxed-layered slip described in the Missing Chapter. Once one developer does it, the architectural intent dies. Either go through a use case, or formalize a different pattern (CQRS read-side) — don't quietly bypass.
- **"Clean Architecture means microservices."** It does not. Microservices are a *deployment* pattern; Clean Architecture is a *source-code* pattern. You can do Clean Architecture in a tight monolith. You can ignore it in a sprawl of microservices and still produce a Big Ball of Mud, just with more YAML.
- **"I have to set up all four layers from day one."** No. The number of layers should match the system's complexity. A 200-line script needs none of this. Start simple, introduce a layer when the *cost of not having it* starts to bite.

## Quick checklist for "is this clean?"

Ask these questions of any candidate piece of code:

1. **Independent of frameworks?** Could you swap Express for Flask without touching this file? If not, this file is too far in.
2. **Testable without externalities?** Can you unit-test it with no DB, no network, no UI? If not, the policy is leaking into a detail.
3. **Independent of UI?** Could the system work as a CLI, a web app, *and* a desktop app with the same business code? If not, the UI is bleeding inward.
4. **Independent of database?** Could you replace PostgreSQL with DynamoDB or flat files without touching business rules? If not, the database is leaking inward.
5. **Independent of any external agency?** Do the inner circles know nothing about the outside world? If they do, those references are violations.

Five "yes" answers means the architecture is doing its job. Each "no" is a specific debt to pay down.
