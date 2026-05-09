# Boundaries — Drawing Lines, Decoupling Modes, Partial Boundaries

A boundary is a line across which one side knows nothing about the other. Architecture is the art of **drawing the right boundaries in the right places at the right times** — primarily to defer premature decisions until you have enough information to make them well.

## Where to draw lines

Boundaries belong **on axes of change** — where two pieces of code change for different reasons, at different rates, requested by different actors.

- **GUI vs. business rules** — UI changes for cosmetic reasons; rules change for stakeholder reasons.
- **Business rules vs. database** — rules express what the business does; DB is a persistence detail.
- **Business rules vs. framework** — rules belong to your domain forever; frameworks are fashion.
- **Plugin vs. core** — anything plausibly replaceable (driver, codec, integration) goes on its own side.

**The plugin argument:** ReSharper depends on Visual Studio; Visual Studio doesn't know ReSharper exists. Your DB, GUI, and message bus should be ReSharper. Your business rules should be Visual Studio.

## Decoupling modes (cheapest → strongest)

| Mode                 | Communication cost            | Deployment                     | Use when                                                   |
| -------------------- | ----------------------------- | ------------------------------ | ---------------------------------------------------------- |
| **Source-level**     | Function call (free)          | Single binary                  | **Default** — use unless there's a concrete reason not to  |
| **Deployment-level** | Function call + link overhead | Multiple files, single process | Independent release cadences matter                        |
| **Process-level**    | System calls + marshalling    | Multiple processes             | Fault isolation; different runtimes or privilege levels    |
| **Service-level**    | Network (10ms–seconds)        | Independent services           | Independent scaling or full operational autonomy justified |

**Default to source-level.** Service-level decoupling is expensive and not even the most architecturally decoupled — services can still be tightly coupled through shared data formats and cross-service transactions. Decoupling lives in the source code, not the network topology.

**Correct strategy:**

1. Start at the cheapest mode that works.
2. Decouple internally as if a stronger mode might be needed (clean interfaces, no shared mutable state, DTOs crossing boundaries).
3. Promote individual boundaries to stronger modes only when operational pressure justifies it.
4. Be willing to reverse — fold a service back into the monolith if it no longer earns its keep.

## Full boundaries vs. partial boundaries

A **full boundary** has reciprocal interfaces, input/output DTOs, dependency inversion in both directions, and independent compilation. Expensive to set up and maintain.

**Partial boundary options:**

| Option                 | What it is                                                     | Risk                                                                  |
| ---------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------- |
| **Skip-the-last-step** | Full structure compiled as a single component                  | Dependencies leak across the seam without build enforcement           |
| **Strategy pattern**   | Single interface in the inner side; one direction of inversion | Backchannel: caller reaches past the interface directly into the impl |
| **Facade**             | Curated entry point; no DIP                                    | Client transitively sees everything behind the Facade                 |

Add the right degree of boundary at the _inflection point_ — when the cost of adding it becomes less than the cost of not having it. YAGNI applies to features; architectural seams that cost a fortune to retrofit deserve earlier consideration.

## What crosses a boundary

Always **isolated, simple data structures** — plain dicts, structs, DTOs. Never:

- An entity (exposes private invariants)
- A database row (couples inner side to outer schema)
- A framework object (`HttpRequest`, ORM proxy)

Data is always shaped for the **inner circle's convenience**. The outer side translates.

## Boundary review checklist

For each candidate boundary:

1. What axis of change does this protect? (If you can't name one, the boundary may be cosmetic.)
2. Which side is policy, which is detail? (Dependencies must point from detail to policy.)
3. What level of decoupling is needed today? In a year? (Default to source-level.)
4. Full, partial, or skipped? (How disciplined is the team; how expensive to add later?)
5. What data crosses, and in what shape? (DTOs only — never entities, rows, or framework types.)
6. Who owns the interface — consumer or implementer? (The consumer. Always.)
