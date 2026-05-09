# Component Principles — which classes go together, and how components depend

If SOLID arranges classes into walls and rooms, the **component principles** arrange rooms into buildings. A *component* is the unit of independent deployment — a `.jar`, a `.dll`, a `gem`, a Python package, a Rust crate, a workspace, a Lambda, a service. Two questions govern component design:

1. **Cohesion**: which classes belong inside the same component? (REP, CCP, CRP)
2. **Coupling**: how should one component depend on another? (ADP, SDP, SAP)

These principles are in tension with each other. There is no static "best" arrangement — the right partition shifts with the project's age and concerns.

---

## Component cohesion

### REP — Reuse/Release Equivalence Principle

> The granule of reuse is the granule of release.

If you publish something for others to use, you must publish it under a release process: version numbers, changelogs, a way for consumers to opt in to upgrades. Without that, consumers cannot manage their dependence on you and won't reuse your code. REP is mostly common sense, but it has a structural consequence: **the classes inside a component must form a coherent group with a unifying theme**, because they share a release cadence. A component that's a grab-bag of unrelated utilities forces consumers to take changes they don't care about whenever any one of them moves.

**Practical signal**: if you cannot write a one-sentence release note that genuinely covers all the work in a release of this component, the component is incoherent.

### CCP — Common Closure Principle

> Gather into one component classes that change for the same reasons, at the same times. Separate classes that change at different times or for different reasons.

CCP is **SRP at component scope**. The aim is operational: when a change request arrives, you want it confined to as few components as possible, ideally one — so only one component has to be revalidated, repackaged, and redeployed. Maintainability beats reusability for most application code, and CCP is the principle that buys maintainability.

CCP also extends OCP: 100% closure to all change is impossible, so closure must be *strategic* — closed against the changes you actually expect. CCP gathers classes that share that expected axis of change.

**Practical signal**: when a single change request touches files across five components, those components are misaligned with how the system actually changes.

### CRP — Common Reuse Principle

> Don't force users of a component to depend on things they don't need.

CRP is **ISP at component scope**. When a component bundles together classes that aren't actually used together, every consumer who wants any one of them inherits a dependency on all of them — and on every transitive dependency they bring along. CRP says: classes that are reused together belong together; classes that aren't, don't.

CRP tells you more about what to **leave out** of a component than what to put in. A `Container` class and its `Iterator` belong together. A `Container` class and a `Logger` do not, however convenient that grouping seemed at the time.

**Practical signal**: a component is consistently imported and used for only a small fraction of what it contains.

### The cohesion tension diagram

REP and CCP are *inclusive* — they push components to be larger. CRP is *exclusive* — it pushes components to be smaller. A good architect picks a position in the triangle that fits the project's *current* concerns and accepts that the position will move over time:

- Early in a project, **CCP dominates**. Develop-ability matters more than reuse. Components grow.
- As the project matures and other systems start consuming it, **CRP and REP** pull in. Components fragment along reuse boundaries.
- The component structure of a healthy project should *evolve*. A static partition decided up front is almost always wrong.

---

## Component coupling

### ADP — Acyclic Dependencies Principle

> Allow no cycles in the component dependency graph.

The component dependency graph must be a DAG (directed acyclic graph). Cycles are the cause of the "morning after syndrome" — you arrive to find your work broken because someone changed code on the other side of a cycle, and now those components have effectively merged into one giant unreleasable blob.

Why a cycle is so destructive: if A depends on B and B depends on A, then to release A you must release B, and to release B you must release A. Their tests can't run independently. Their teams can't move independently. Any change in either is, in practice, a change in both.

**Detecting cycles**
Cycles are best caught by static analysis. Almost every ecosystem has a tool: `madge` (JS), `pydeps` (Python), `cargo-modules` / `cargo deps` (Rust), `jdepend` (Java), `NDepend` (.NET), `go-mod-graph` (Go). Run it as part of CI and fail the build on a new cycle.

**Breaking a cycle**

Two reliable techniques:

1. **DIP inversion.** If `Entities` accidentally calls into `Authorizer`, introduce an interface in `Entities` that expresses what `Entities` needs, and have `Authorizer` implement it. The dependency arrow now points the right way.

2. **Extract a third component.** Move the shared classes into a new component that both former cycle members depend on. Both now point inward to the new shared piece, and the cycle is gone.

The second technique implies the component graph will *jitter and grow* as the system evolves — and that's correct. Component structure is not designed top-down; it emerges as the system grows. **Don't try to design the full component graph before the code exists.** You don't know the closure axes yet.

### SDP — Stable Dependencies Principle

> Depend in the direction of stability.

Some components are *designed* to be volatile — that's their job, that's where the system needs to flex. Others are designed to be stable — they encode policy that should not move. SDP says: the volatile ones must depend on the stable ones. Never the reverse. Otherwise a component you intended to be easy to change becomes hard to change because a stable component now hangs off it.

A component is **stable** if it's hard to change — typically because lots of other components depend on it. Stability is not the same as immutability; it's about the *cost of change*. A penny on its side has been still for a year but is not stable; a marble countertop is stable.

**Stability metrics** (Martin's *I* metric)

- **Fan-in (Ca)** = number of classes outside the component that depend on classes inside it. *Incoming*.
- **Fan-out (Ce)** = number of classes inside the component that depend on classes outside it. *Outgoing*.
- **I = Ce / (Ca + Ce)**, range `[0, 1]`.
  - `I = 0` → maximally stable: nothing inside depends outward, lots of things depend on it. *Responsible and independent.*
  - `I = 1` → maximally unstable: nothing depends on it, but it depends on lots. *Irresponsible and dependent.*

**The rule**: `I` must *decrease* in the direction of dependency. If component A depends on component B, then `I_A > I_B`. A violation means a stable component is leaning on a volatile one — fragility built in.

### SAP — Stable Abstractions Principle

> A component should be as abstract as it is stable.

If a component is stable (`I = 0`) but concrete, it is *rigid*: it can't be modified (because everyone depends on it) and it can't be extended (because there's no abstraction to extend through). This is the **Zone of Pain**, and a database schema typically lives there — concrete, depended-on, painful to change.

If a component is unstable (`I = 1`) but maximally abstract, it is *useless*: it has no implementations and no dependents. This is the **Zone of Uselessness** — leftover abstract classes nobody ever wired up.

The healthy diagonal between them is the **Main Sequence**.

**Abstractness metric**

- **A = Na / Nc**, where `Nc` = total classes in the component and `Na` = abstract classes + interfaces.
  - `A = 0` → fully concrete.
  - `A = 1` → fully abstract.

**The rule**: stable components should be abstract (`A` near 1, `I` near 0). Unstable components should be concrete (`A` near 0, `I` near 1).

**Distance from the Main Sequence**

- **D = |A + I - 1|**, range `[0, 1]`.
  - `D = 0` → on the Main Sequence (good).
  - `D = 1` → in a Zone of Exclusion (bad).

Compute `D` for every component. Flag any with `D > 0.1` or that are more than one standard deviation from the project mean. Track `D` over time; a component drifting away from the Main Sequence between releases is an early warning of architectural decay.

### Summary table

| Component property | Where it should sit | Why |
|---|---|---|
| Stable + abstract (low `I`, high `A`) | Top-left of A/I graph — **policy components** | Stable enough to be depended on; abstract enough to be extended |
| Unstable + concrete (high `I`, low `A`) | Bottom-right — **detail / driver components** | Free to change because nothing depends on them |
| Stable + concrete (low `I`, low `A`) | **Zone of Pain** — avoid for volatile code | Rigid: can't modify (depended on) or extend (concrete) |
| Unstable + abstract (high `I`, high `A`) | **Zone of Uselessness** — clean up | Abstractions nobody implements |

Special cases that look like Zone of Pain but aren't a real problem: very stable utility libraries like `String`, the standard collections, well-vetted crypto. They sit in the painful zone but never change, so the pain never materializes. The danger zone is **volatile + stable + concrete**, not stable + concrete.

---

## How to actually apply this

1. **In a new project, don't design the component graph up front.** You don't yet know the closure axes. Start with a sensible monolith broken into modules along obvious lines. Let the structure emerge.

2. **Add a static-analysis check for cycles to CI from day one.** This is cheap and catches the most expensive class of architectural error early.

3. **At each release, sample a few components and compute *I*, *A*, *D*.** You don't need a full dashboard — just enough to notice if a component is sliding into a zone of exclusion.

4. **When a change request hits multiple components, ask why.** Either the change axis is genuinely cross-cutting (rare; usually means the change touches policy *and* details, which is correct), or your component partition is misaligned with how the system actually changes (common).

5. **When extracting a new component, name it for what it *does*, not which technology it uses.** `BillingPolicy` is a better component name than `BillingService` or `BillingApiV2`. The first describes purpose; the second two describe shape, which will change.
