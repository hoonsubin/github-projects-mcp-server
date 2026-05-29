---
name: clean-architecture
description: >-
  Clean Architecture skill. Project structure, layer design, dependency
  direction, SOLID, module/component boundaries, monolith vs microservices,
  decoupling, coupling/cohesion metrics, refactoring a big ball of mud,
  architecture audits, greenfield design, separation of concerns. Phrases:
  'where does this go', 'how do I structure this', 'hard to change', 'fragile',
  'circular dependency', 'should I use microservices', 'starting a new project',
  'decouple X from Y', 'design review', 'this is a mess'. Any stack or domain.
modeSlugs:
  - architect
  - code
  - project-research
---

# Clean Architecture - System Architecting Skill

Based on Robert C. Martin's *Clean Architecture*. Every system has an architecture - the question is whether it was deliberate.

## Workflow selection

Identify the user's situation and read the matching workflow file before advising. Each workflow encodes the order of decisions; don't improvise from this file alone.

| Situation | Workflow file |
|---|---|
| Starting fresh - no code yet, or rewriting from zero | `references/workflow-new-project.md` |
| Working project - verify or harden architecture | `references/workflow-audit.md` |
| Messy, fragile, or "big ball of mud" | `references/workflow-cleanup.md` |
| Works but dirty - incremental migration to clean | `references/workflow-strangle.md` |

## Core principles

**1. Structure over behavior.** Behavior is what the system does today; structure is how easily it changes tomorrow. A system that works but can't be changed becomes useless the moment requirements shift. Structure is the higher value even when it never feels urgent.

**2. Minimize lifetime effort.** Good architecture keeps the cost curve flat - adding a feature next year costs roughly the same as today. When effort scales super-linearly with features, the architecture is failing regardless of how it looks.

**3. Keep options open.** A good architect maximizes undecided decisions. Database, framework, UI, auth provider, deployment topology - these are *details* that should be deferred as long as possible because later decisions use more information. Design so each could be reversed even after it's been made.

**4. Separate policy from details. Dependencies point inward.** Policy = business rules valuable even on paper, independent of automation. Details = database, web server, framework, UI. Policy must not know about details. Source-code dependencies point *inward*, from volatile concrete details toward stable abstract policy. This is the **Dependency Rule** - the single most load-bearing idea in this skill.

**5. Architecture screams the use cases, not the framework.** Opening the top-level directory should reveal the domain ("shopping cart", "payroll", "reactor sim"), not the stack ("Rails", "Spring", "Unity"). If the project looks identical to every other project in its language, there is no architecture - only a framework's opinion.

## SOLID - class and module level (`references/solid-principles.md`)

- **SRP** - A module answers to one *actor* (one source of change), not one function. Merge conflicts from unrelated changes to one file are a symptom.
- **OCP** - Extend by writing new code; don't modify old code. New behavior arrives as new implementations of an abstraction.
- **LSP** - Subtypes must be substitutable for their base type without surprising callers. Violations force special-case dispatch into code that should be agnostic.
- **ISP** - Don't force clients to depend on methods they don't use. Wide interfaces propagate unneeded recompiles and transitive dependencies.
- **DIP** - Depend on abstractions, not concretions. Interfaces live with the *consumer* (high-level policy), not the implementer. Concrete construction is concentrated in Main.

## Component cohesion (`references/component-principles.md`)

- **REP** - The granule of reuse is the granule of release. Classes in a component must share a coherent release.
- **CCP** - Things that change together belong together. (SRP at component scope.) A change request should touch as few components as possible.
- **CRP** - Don't force consumers to depend on what they don't use. (ISP at component scope.) Leave unrelated classes out.

REP and CCP are inclusive (push components larger); CRP is exclusive (push components smaller). The right balance shifts as the project ages - early projects favor CCP; mature ones favor CRP and REP.

## Component coupling (`references/component-principles.md`)

- **ADP** - No cycles in the component dependency graph. Break cycles with DIP or by extracting a third component.
- **SDP** - Depend in the direction of stability. Volatile components depend on stable ones; never the reverse.
- **SAP** - Stable components are abstract; unstable components are concrete. Stable + concrete = Zone of Pain. Abstract + unstable = Zone of Uselessness.

Metrics: **I = Ce / (Ca + Ce)** (instability, 0=stable, 1=unstable), **A = Na / Nc** (abstractness), **D = |A + I − 1|** (distance from Main Sequence, target ≤ 0.1).

## Clean Architecture layers (`references/clean-architecture-layers.md`)

Innermost (most stable, most abstract) → outermost (most volatile, most concrete):

1. **Entities** - enterprise business rules + the data they operate on. No external imports.
2. **Use Cases** - application-specific orchestration of entities. Port interfaces declared here; implementations live in outer layers.
3. **Interface Adapters** - controllers, presenters, gateways. Translate between use-case DTOs and external formats. All SQL lives here or further out.
4. **Frameworks & Drivers** - DB, web framework, UI, devices. The details that live at the edge.

**Dependency Rule**: source-code dependencies point only inward. An inner layer never names anything declared in an outer layer - no imports, no class references, no shared data formats authored by an outer layer.

**Humble Object pattern**: wherever a boundary separates testable from hard-to-test behavior (GUI, DB, network), split it in two. The humble object holds only the hard-to-test part (as thin and logic-free as possible); the testable object holds everything else. Every boundary in a clean architecture corresponds to a Humble Object split.

**Main component**: the one place that depends on concretions - constructs all implementations, wires them into inner layers via constructor injection, then hands control to policy. Inner layers never import Main. Multiple Mains (dev, prod, per-region) are a plugin to the application, not its foundation.

## Decision shortcuts

**"Where does this code go?"** - The innermost layer that doesn't force a dependency on anything more concrete. If it would need to import a framework, DB, or UI type to live there, move it outward.

**"Should I pick a database / framework now?"** - No. Sketch use cases and entities first; treat the missing piece as an interface with no implementation yet.

**"Should I use microservices?"** - Start with source-level decoupling inside a monolith. Promote individual boundaries to deployment units → processes → services only when operational pressure justifies it. The architecture should support sliding up and down that scale without rewriting. Service-level decoupling is not free and is not automatically the most decoupled - tightly coupled services over a network are worse than a well-structured monolith.

**"Should I add this abstraction now?"** - Note the seam. If adding it later will cost much more than now, add a partial boundary (Strategy or Facade - see `references/boundaries.md`). YAGNI applies to features; it applies less to architectural seams, which are exponentially more expensive to retrofit.

**"There's a circular dependency."** - It is a defect. Break it via DIP (introduce an interface in the more stable component) or by extracting a third component both depend on. See `references/component-principles.md` (ADP).

**"How do I make this testable?"** - Drive a wedge of abstraction between the volatile thing (UI, DB, network, time, randomness) and the policy. Policy depends on an interface; the volatile thing implements it; tests substitute a fake. This is the Humble Object pattern.

## Response guidance

- Identify which workflow situation applies before prescribing - the right move differs sharply between greenfield and recovery.
- Stay tech-agnostic until the user's stack is confirmed; Clean Architecture applies equally to any language or domain.
- Scale layers to complexity: a 200-line script doesn't need four named concentric layers. The *direction* of dependencies and separation of policy from details matter at every scale.
- When stakeholders push structural shortcuts ("just add it to the controller", "we'll deal with this later"), name the cost curve impact explicitly.

## Reference files

```
clean-architecture/
├── SKILL.md
├── references/
│   ├── solid-principles.md            ← SRP, OCP, LSP, ISP, DIP
│   ├── component-principles.md        ← REP/CCP/CRP, ADP/SDP/SAP, I/A/D metrics
│   ├── clean-architecture-layers.md   ← Four layers, Dependency Rule, Humble Object
│   ├── boundaries.md                  ← Boundary anatomy, partial boundaries, decoupling modes
│   ├── workflow-new-project.md
│   ├── workflow-audit.md
│   ├── workflow-cleanup.md
│   └── workflow-strangle.md
└── assets/
    ├── audit-checklist.md
    └── project-skeleton.md
```
