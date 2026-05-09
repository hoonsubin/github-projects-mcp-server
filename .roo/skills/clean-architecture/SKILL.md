---
name: clean-architecture
description: System and software architecting skill grounded in Robert C. Martin's Clean Architecture. Use whenever the user is planning a new project before code, designing project structure, deciding where modules should live, drawing boundaries between layers, choosing monolith vs services, separating business logic from frameworks/databases/UI, evaluating a codebase for architectural problems, refactoring a "big ball of mud", converting working-but-dirty code into maintainable code, applying SOLID, reasoning about dependency direction, or deciding what to defer (e.g. "should I pick the database now?"). Trigger proactively on phrases like "where should this go", "how do I structure this", "is this design right", "hard to change", "how do I decouple X from Y", "starting a new project", "cleaning up", "refactoring", "this is a mess", "design review", or "fragile codebase" — even when "architecture" is never said. Works across any tech stack or domain (web, embedded, games, data pipelines, research code).
---

# Clean Architecture — System Architecting Skill

This skill helps the agent reason about software architecture using the principles laid out in Robert C. Martin's *Clean Architecture*. Architecture here is **not** a high-level layer separate from code — it's the continuous shape of decisions from the highest abstractions down to the lowest details. Every system has an architecture; the question is whether it was designed deliberately or grown by accident.

## When to use this skill

Match the user's situation to one of four workflows. Each has its own reference file with a step-by-step procedure. Pick one and follow it; don't blend them.

| Situation | Workflow file |
|---|---|
| Starting fresh — no code yet, or rewriting from zero | `references/workflow-new-project.md` |
| Existing project, working but you want to verify or harden architecture | `references/workflow-audit.md` |
| Codebase is messy, fragile, "big ball of mud" — needs untangling | `references/workflow-cleanup.md` |
| Code works but is "dirty" — needs to become maintainable without breaking | `references/workflow-strangle.md` |

Read the matching workflow file before giving advice. Do not invent a procedure from this main file alone — the workflows encode the order of decisions.

## The core mental model — read this every time

Internalize these five ideas before answering any architecture question. Everything else in this skill is a consequence of them.

**1. Software has two values: behavior and structure.** Behavior is what the system does today. Structure is how easy it is to change tomorrow. Stakeholders and even developers often optimize behavior at the cost of structure. That's the wrong trade. A program that works perfectly but cannot be changed becomes useless the moment requirements shift; a program that is easy to change but currently broken can be fixed and kept working forever. **Structure is the higher value, even though it never feels urgent.**

**2. The goal of architecture is to minimize human effort over the lifetime of the system.** Not to make the system fast. Not to make it pretty. Not to use the cool framework. Architecture wins when adding a feature next year costs roughly the same as adding one today — when the cost curve is flat instead of asymptotic. If your design forces effort to scale super-linearly with features, it's bad, regardless of how clever it looks.

**3. Architecture is the art of keeping options open.** A good architect maximizes the number of decisions *not yet made*. Database choice, web framework, UI technology, deployment topology, auth provider — these are all *details* that should be deferred as long as possible, because the longer you wait, the more information you have. Treat them as plugins to your business logic, never as foundations beneath it. Even if a decision has already been made by management, *pretend it hasn't* and design so it could be reversed.

**4. Separate policy from details. Point dependencies at policy.** Policy is the business rules — the part that would be valuable even on paper, with no computer. Details are everything that exists only because we automated it: databases, web servers, frameworks, UI toolkits, message queues. The policy must not know about the details. Source-code dependencies must point *inward*, from low-level concrete details toward high-level abstract policy. This is the **Dependency Rule**, and it is the single most load-bearing idea in this skill.

**5. The architecture should scream the use cases, not the framework.** When a new developer opens the top-level directory, they should see "shopping cart" or "payroll" or "reactor simulator" — not "Rails" or "Spring" or "Unity". Frameworks are tools to be used, never architectures to conform to. If your folder structure looks identical to every other project in your language, you have no architecture; you have a framework's opinion.

## Quick principle reference

These are the named principles you'll encounter across the workflows. Each has a deeper treatment in `references/`. Don't try to memorize all of them at once — recognize them when they apply.

**SOLID** (class and module level — see `references/solid-principles.md`)
- **SRP** — Single Responsibility: a module answers to one *actor* (one source of change), not one function.
- **OCP** — Open/Closed: extend without modifying. New features arrive as new code, not edits to old code.
- **LSP** — Liskov Substitution: subtypes must be substitutable for their base types without surprising callers.
- **ISP** — Interface Segregation: don't force clients to depend on methods they don't use.
- **DIP** — Dependency Inversion: depend on abstractions, not concretions. Volatile concrete things should not be imported by stable policy.

**Component cohesion** (which classes go together — see `references/component-principles.md`)
- **REP** — Reuse/Release Equivalence: the granule of reuse is the granule of release.
- **CCP** — Common Closure: things that change together belong together.
- **CRP** — Common Reuse: things used together belong together; don't force consumers to depend on what they don't use.

**Component coupling** (how components depend on each other — see `references/component-principles.md`)
- **ADP** — Acyclic Dependencies: no cycles in the component dependency graph, ever.
- **SDP** — Stable Dependencies: depend in the direction of stability. Volatile components depend on stable ones, never the reverse.
- **SAP** — Stable Abstractions: the more stable a component, the more abstract it should be. Stable + concrete = the Zone of Pain.

**The Clean Architecture layers** (see `references/clean-architecture-layers.md`)
From innermost (most stable, most abstract) to outermost (most volatile, most concrete):
1. **Entities** — enterprise-wide critical business rules + critical business data. Independent of any application.
2. **Use Cases** — application-specific business rules. Orchestrate entities. Contain no UI/DB/framework code.
3. **Interface Adapters** — controllers, presenters, gateways. Translate between use-case data and external formats.
4. **Frameworks & Drivers** — DB, web framework, UI toolkit, devices. The "details" that live at the edge.

The **Dependency Rule**: source code dependencies point only inward. An inner layer must never name anything declared in an outer layer.

## Decision shortcuts

When the user asks a specific architectural question, these shortcuts often apply.

- *"Where should this code go?"* → It goes in the innermost layer that doesn't force it to depend on anything more concrete than itself. If it would have to import a framework / DB / UI thing to live in that layer, it belongs further out.
- *"Should I pick a database / framework / UI now?"* → No. Defer it. Sketch the use cases and entities first; treat the missing piece as an interface that will be implemented later.
- *"Should I use microservices?"* → Almost certainly not yet. Service boundaries are the strongest, slowest, most expensive form of decoupling. Start with source-level decoupling inside a monolith. Promote to deployable units, then processes, then services *only* when operational pressure demands it. The architecture should let you slide up and down that scale without rewriting.
- *"Should I add this abstraction now?"* → Apply YAGNI, but with one eye open. Note the seam where a boundary may eventually be needed. If the cost of adding it later looks much higher than adding it now, add a partial boundary (a Strategy or Facade — see `references/boundaries.md`).
- *"This circular dependency is annoying"* → It is also a defect. Break it via DIP (introduce an interface in the more stable component) or by extracting a third component both depend on. See `references/component-principles.md` (ADP section).
- *"How do I make this testable?"* → Drive a wedge of abstraction between the volatile thing (UI, DB, network, time, randomness) and the policy. The policy depends on an interface; the volatile thing implements it; tests substitute a fake. This is the **Humble Object** pattern. See `references/clean-architecture-layers.md`.

## How The Agent should respond

- **Diagnose before prescribing.** Ask which workflow situation the user is in if it isn't obvious. The right move differs sharply between "starting fresh" and "fixing what exists".
- **Stay tech-agnostic by default.** Clean Architecture applies equally to a Rust CLI, a Python data pipeline, a Unity game, a research codebase, or a microservices fleet. Only invoke language- or framework-specific advice once the user's stack is known.
- **Resist over-engineering.** A 200-line script does not need four concentric layers. The principles scale down: the *direction* of dependencies and the separation of policy from details matter at every size, but the number of named layers does not.
- **Be willing to push back.** Stakeholders frequently ask for things ("just add it to the controller", "we'll deal with the architecture later", "it's only a prototype") that trade structure for short-term behavior. The skill's job — and the agent's — is to make that trade visible, not to silently accept it. Be respectful but honest about cost curves.
- **Diagrams help, prose helps more.** Reach for a small diagram (text-based or Mermaid) when describing layer boundaries or dependency direction. But the *reasoning* should live in prose the user can follow.
- **Quote the book sparingly.** The principles are paraphraseable. If you cite a passage, keep it short and attribute it to Martin (and Brown, for the "Missing Chapter" / package-by-component material).

## Files in this skill

```
clean-architecture/
├── SKILL.md                                     ← you are here
├── references/
│   ├── solid-principles.md                      ← SRP, OCP, LSP, ISP, DIP — class/module level
│   ├── component-principles.md                  ← REP/CCP/CRP, ADP/SDP/SAP, I/A/D metrics
│   ├── clean-architecture-layers.md             ← The four layers, Dependency Rule, Humble Object
│   ├── boundaries.md                            ← Boundary anatomy, partial boundaries, decoupling modes
│   ├── workflow-new-project.md                  ← Greenfield: starting before any code
│   ├── workflow-audit.md                        ← Healthy project: verify and harden
│   ├── workflow-cleanup.md                      ← Messy codebase: untangle a big ball of mud
│   └── workflow-strangle.md                     ← Working-but-dirty: incremental migration to clean
└── assets/
    ├── audit-checklist.md                       ← Concrete checks for an architecture review
    └── project-skeleton.md                      ← A starter directory layout for a new clean project
```

When a workflow file or principle file is relevant, **read it** before continuing the conversation. The main SKILL.md gives the map; the references give the terrain.
