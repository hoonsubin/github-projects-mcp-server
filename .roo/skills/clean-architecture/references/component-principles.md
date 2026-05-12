# Component Principles — which classes go together, and how components depend

A _component_ is the unit of independent deployment — a `.jar`, gem, Python package, Rust crate, Lambda, service. Two questions govern component design:

1. **Cohesion**: which classes belong inside the same component? (REP, CCP, CRP)
2. **Coupling**: how should one component depend on another? (ADP, SDP, SAP)

These principles are in tension. The right partition shifts with the project's age and concerns.

## Component Cohesion

### REP — Reuse/Release Equivalence Principle

> The granule of reuse is the granule of release.

Classes inside a component must form a coherent group with a unifying theme — they share a release cadence. A grab-bag component forces consumers to take changes they don't care about whenever any one element moves.

**Signal:** If you can't write a one-sentence release note covering all work in a release of this component, the component is incoherent.

### CCP — Common Closure Principle

> Gather into one component classes that change for the same reasons, at the same times.

CCP is **SRP at component scope**. When a change request arrives, you want it confined to as few components as possible — so only one needs revalidation, repackaging, and redeployment.

**Signal:** When a single change touches files across five components, those components are misaligned with how the system actually changes.

### CRP — Common Reuse Principle

> Don't force users of a component to depend on things they don't need.

CRP is **ISP at component scope**. Classes that are reused together belong together; classes that aren't, don't.

**Signal:** A component is consistently imported but only a fraction of it is used.

### The Cohesion Tension

REP and CCP are _inclusive_ — they push components larger. CRP is _exclusive_ — it pushes them smaller.

- Early in a project: **CCP dominates** — develop-ability matters more than reuse; components grow.
- As it matures: **CRP and REP** pull in — components fragment along reuse lines.
- The component structure of a healthy project _evolves_. A static partition decided up front is almost always wrong.

## Component Coupling

### ADP — Acyclic Dependencies Principle

> Allow no cycles in the component dependency graph.

Cycles cause "morning after syndrome" — you arrive to find your work broken by a change on the other side of a cycle. Cyclic components can't be tested or released independently.

**Detecting cycles:** Use static analysis in CI: `madge` (JS), `pydeps` (Python), `cargo-modules` (Rust), `jdepend` (Java), `NDepend` (.NET), `go-mod-graph` (Go). Fail the build on any new cycle.

**Breaking cycles:**

1. **DIP:** introduce an interface in the more stable component; have the less stable one implement it.
2. **Extract a third component** both former cycle members depend on.

Don't design the full component graph before the code exists — you don't know the closure axes yet. Let it emerge, and let the graph grow as it needs to.

### SDP — Stable Dependencies Principle

> Depend in the direction of stability.

Volatile components depend on stable ones — never the reverse. Stability = cost of change, which is proportional to how many other components depend on you.

**I metric (instability):** `I = Ce / (Ca + Ce)` where `Ce` = fan-out (outgoing deps), `Ca` = fan-in (incoming deps). Range `[0, 1]`. `I = 0` → maximally stable; `I = 1` → maximally unstable. Dependencies must flow from high-I toward low-I.

### SAP — Stable Abstractions Principle

> A component should be as abstract as it is stable.

Stable + concrete = **Zone of Pain** (can't modify because it's depended on; can't extend because it's concrete). Unstable + abstract = **Zone of Uselessness** (abstract code nobody implements).

**A metric:** `A = Na / Nc` (abstract classes + interfaces / total classes).
**D metric:** `D = |A + I − 1|` — distance from the Main Sequence. `D = 0` is ideal.

- **Interpreting Metrics**:
  - **Low I, high A**: Policy components (stable and extensible)
  - **High I, low A**: Detail/driver components (free to change)
  - **Low I, low A**: Zone of Pain (avoid for volatile code)
  - **High I, high A**: Zone of Uselessness (clean up)
- **Early Warning**: Track `D` over time; drift away from the Main Sequence indicates architectural decay.

## How to apply

1. Don't design the component graph up front — structure emerges as closure axes become visible.
2. Add cycle detection to CI from day one; it's cheap and catches the most expensive class of architectural error.
3. At each release, compute I/A/D for a sample of components and watch for drift.
4. When a change hits multiple components, ask whether the partition is misaligned with how the system actually changes.
5. Name components for what they _do_, not which technology they use (`BillingPolicy`, not `BillingService`).
