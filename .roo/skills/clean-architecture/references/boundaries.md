# Boundaries — Drawing Lines, Decoupling Modes, Partial Boundaries

A boundary is a line in the system across which one side knows nothing about the other (or knows only what's promised at a tightly defined interface). Architecture is, more than anything else, the art of **drawing the right boundaries in the right places at the right times**. This file covers three things:

1. **What forms boundaries take** at runtime (boundary anatomy / decoupling modes).
2. **Where to draw them** (axes of change, the plugin argument).
3. **How much boundary to commit to** at each line (full vs. partial boundaries).

## Why boundaries exist at all

Boundaries protect against **coupling to premature decisions**. The decisions you most want to defer — database, web framework, message broker, auth provider, microservices vs. monolith — are not part of the *use cases*. They're details. A boundary lets you delay each of these decisions until you have enough information to make it well. The famous cautionary tale (Martin's "Company P") is a team that decided in 1999 to build a three-tier architecture for a system that never, in its entire commercial life, ran on more than one server — and paid for that imagined server farm with years of unnecessary serialization, marshalling, and inter-tier complexity.

The lesson: **a premature decision is a worse decision**, because you make it with the least information. Architecture buys time.

## Where to draw lines

Boundaries belong **on axes of change**. Two pieces of code change for different reasons, at different rates, requested by different people? They live on opposite sides of a boundary. Same axis of change? They live on the same side.

This is just the SRP / CCP argument applied at architectural scale. The signals are:

- **GUI vs. business rules** — UI changes constantly for cosmetic reasons; rules change for stakeholder reasons. Boundary.
- **Business rules vs. database** — rules express what the business does; the database is a detail of how data persists. Boundary.
- **Business rules vs. framework** — rules belong to your domain forever; the framework is a fashion. Boundary.
- **Plugin vs. core** — anything that could plausibly be replaced (driver, codec, integration) goes on its own side.

The **plugin argument**: ReSharper and Visual Studio have a deeply asymmetric relationship — ReSharper depends on Visual Studio; Visual Studio doesn't know ReSharper exists. Microsoft can break ReSharper at will; JetBrains can do nothing to disturb Microsoft. *That asymmetry is exactly what we want inside our own systems*. The business rules should be Visual Studio. The GUI, the database, the message bus — those should be ReSharper.

## Decoupling modes — the four boundary strengths

Not every boundary is the same kind of line. There are four distinct levels of physical separation, ordered from cheapest to strongest:

### 1. Source-level decoupling (the disciplined monolith)

Everything compiles into a single executable, but the source is partitioned into modules with controlled dependencies. Boundaries are **maintained by source code organization and access modifiers**, not by physical separation. Dynamic polymorphism (interfaces / virtual dispatch) carries the dependency inversion across boundary lines.

- **Communication cost**: a function call. Practically free.
- **Deployment**: a single binary. One file to ship.
- **Use when**: starting fresh; small team; uncertain operational requirements; want the architecture to be flexible enough to promote later.

This is the **default**. Don't move beyond it without a concrete reason.

### 2. Deployment-level decoupling

Components are compiled into separately deployable units — `.jar`s, DLLs, gems, shared libraries — but loaded into the same process at runtime. Communication is still function calls; the only added cost is dynamic linking on startup. The advantage is that components can be redeployed independently — fix a bug in one DLL without rebuilding the whole world.

- **Communication cost**: function call (slight one-time link cost).
- **Deployment**: multiple files, single process.
- **Use when**: independent release cadences matter; large team where component teams want to ship without waiting for the integration build.

### 3. Process-level decoupling

Each component runs in a separate OS process, with its own address space. They communicate through sockets, pipes, shared memory, or OS message queues. Process boundaries are real *memory protection* — one process can't directly read another's data — and offer real fault isolation.

- **Communication cost**: process boundary crossing (system calls, marshalling, context switches). Moderate; chatty interfaces become expensive.
- **Deployment**: multiple processes on one or more machines.
- **Use when**: fault isolation matters; you need to run separate components with different privilege levels or runtimes.

### 4. Service-level decoupling

Each component is a network service. Communication is over the network and assumes nothing about colocation. This is the strongest boundary and also the most expensive one.

- **Communication cost**: tens of milliseconds to seconds. Latency dominates. Chattiness is fatal.
- **Deployment**: independent services, network configuration, service discovery, observability stack, retry / timeout / circuit-breaker logic, etc.
- **Use when**: components must scale independently; teams need full operational autonomy; the latency cost is genuinely justified.

### Picking the mode (and changing your mind)

The hard truth: you usually **can't tell which mode you need at the start of a project**. And the right mode shifts as the project matures — what was source-level decoupled in year one may need to be a service in year three.

The correct strategy:

1. **Start at the cheapest mode that works** — usually source-level inside a monolith.
2. **Decouple internally as if a stronger mode might be needed**: clean interfaces between components, no shared mutable state across them, data structures (not entities) crossing boundaries, no network-addressable knowledge baked into upper layers.
3. **Promote individual boundaries to stronger modes when, and only when, operational pressure justifies it**. One component starts needing independent scaling? Lift just that one to a service. Don't break up the rest.
4. **Be willing to reverse**. If a service no longer earns its keep, fold it back into the monolith.

The default-to-microservices reflex (popular at the time of writing) inverts this: it pays the cost of the strongest mode upfront, regardless of whether the system needs it. **Service-level decoupling is not free, and architecturally it's not even the most decoupled — services can still be tightly coupled by shared data formats, shared assumptions, and cross-service transactions.** Decoupling lives in the source code, not the network topology.

## Full boundaries vs. partial boundaries

A **full architectural boundary** has every part: reciprocal interfaces (an output port and an input port), input and output data structures, dependency inversion in both directions, and independent compilation / deployment. That's expensive to set up *and* expensive to maintain.

For lines you're not yet sure about, you have two options short of a full boundary:

### Skip-the-last-step boundary

Build the full boundary — interfaces, DTOs, both directions of inversion — but compile and ship the two sides as a single component. You haven't paid the deployment / versioning cost, but the structural seam is fully in place. If you later need to split, the work is mostly done.

The risk: dependencies leak across the seam over time, because nothing in the build prevents them. Use this when the team is disciplined enough to maintain the seam without enforcement.

### One-dimensional boundary (Strategy pattern)

Use a single interface in the inner side, implemented in the outer side. The dependency inverts in *one* direction only. This is the classic **Strategy** pattern: `Client` depends on `ServiceBoundary` interface; `ServiceImpl` implements it.

The risk: nothing prevents a "backchannel" — a call directly from `Client` into `ServiceImpl` bypassing the interface. Without reciprocal interfaces, only developer discipline holds the line.

### Facade

The cheapest seam: a `Facade` class that exposes a curated set of methods, delegating to internal classes the client isn't supposed to touch directly. There's no dependency inversion — the client transitively sees everything the Facade does — but you've at least signposted the intended entry point.

Use a Facade when you want to mark "this is the door; don't reach around it" but you can't yet justify the cost of full inversion.

### Choosing a degree of boundary

Decide deliberately. The architect's job here is to **see the future, intelligently**. Watch the system as it evolves; note where boundaries *might* be needed; pay attention to the first inklings of friction caused by their absence; and implement *right at the inflection point* where the cost of adding the boundary becomes less than the cost of not having it.

YAGNI ("you aren't going to need it") is wisdom for the *implementation* of features, not always for *architectural seams*. Adding an architectural boundary later, into a codebase that's spent years assuming none was needed, is brutally expensive — sometimes brutal enough that the team gives up and lives with the mess. Adding too much speculative architecture upfront wastes effort on imaginary needs. The right answer is somewhere between: sketch boundaries lightly with cheap seams, and upgrade them when the pressure is real.

## Crossing a boundary — the data that flows across

Whatever the boundary's strength, the same rule applies to the *data* that crosses it: **isolated, simple data structures**. Plain dictionaries, structs, dataclasses, DTOs. Never:

- An entity object (exposes private invariants).
- A database row (couples inner side to outer schema).
- A framework object (`HttpRequest`, `HttpResponse`, ORM proxies — couples inner side to the framework's release cycle).
- A reference to something the inner side doesn't already know about (would force the inner side to import outward).

The data is always shaped for **the inner circle's convenience**. The outer side translates: the controller assembles the use case's input DTO from whatever raw form arrived; the gateway converts an entity into rows for the database; the presenter converts the use case's output DTO into a view model. Translation is the price of the boundary, and it's worth paying.

## A note on services and architecture

Two confusions worth flushing out:

**"Microservices is an architecture."** No. Microservices is a *deployment topology*. The architecture is whatever boundaries exist in the source code. A microservices system without internal Clean Architecture is *not* well-decoupled — it's just a Big Ball of Mud distributed over a network, which is much worse than a Big Ball of Mud on one machine.

**"Services decouple by their nature."** Only at the level of individual variables. They're still coupled through shared data formats — add a field to a record and every service touching that record must change. They're still coupled by shared resources (network, message broker, common database). The decoupling is real but partial.

Architecturally, the boundaries that matter run **through services, not between them**. Each service should have its own internal Clean Architecture: its own use cases, its own entities, its own adapters. Cross-cutting concerns are addressed by drawing boundaries inside each service, not by adding more services.

## Putting it together — the boundary review

When evaluating an existing system or proposing one, walk through these questions for each candidate boundary:

1. **What axis of change does this boundary protect?** (If you can't name one, the boundary may be cosmetic.)
2. **Which side is policy, which is detail?** (Dependencies must point from detail to policy.)
3. **What level of decoupling does this boundary need today? In a year?** (Default to source-level. Justify any stronger mode.)
4. **Full, partial, or skipped?** (How disciplined is the team, and how high is the cost of adding the boundary later?)
5. **What data crosses, and in what shape?** (Plain DTOs only — never entities, rows, or framework types.)
6. **Who owns the interface — the consumer or the implementer?** (The consumer. Always. That's how dependency inversion works.)

Run this review on any new component split, any proposed service extraction, any request to "let me just import that directly". The answers expose whether the boundary is paying for itself.
