---
name: clean-architecture
description: >-
  System and software architecting skill. Use when planning a new project, designing module structure,
  drawing layer/component boundaries, evaluating an existing codebase,
  refactoring a "big ball of mud", applying SOLID, or reasoning about dependency
  direction. Trigger on: "where should this go", "how do I structure this",
  "hard to change", "decouple X from Y", "starting a new project",
  "refactoring", "house cleaning", "design review". Works across any tech stack
  or domain.
---

# Clean Architecture — System Architecting Skill

Architecture is the continuous shape of decisions across a system — designed deliberately or grown by accident. Every system has one.

## When to use this skill

Pick the matching workflow and follow it. Don't blend workflows.

| Situation | Workflow file |
|---|---|
| Starting fresh — no code yet, or rewriting from zero | `references/workflow-new-project.md` |
| Existing project, working — verify or harden architecture | `references/workflow-audit.md` |
| Messy, fragile codebase — needs untangling | `references/workflow-cleanup.md` |
| Works but dirty — incremental migration to clean | `references/workflow-strangle.md` |

Read the matching workflow file before giving advice.

## Core mental model

**1. Structure is the higher value.** Behavior is what the system does today; structure is how easy it is to change tomorrow. Stakeholders sacrifice structure for behavior — that's the wrong trade.

**2. Minimize human effort over the system's lifetime.** Architecture wins when the cost of adding a feature stays flat year over year. A flat effort curve beats a clever early design.

**3. Maximize decisions not yet made.** Database, framework, UI, auth provider — these are *details*. Defer them as long as possible; treat them as plugins to business logic, never as foundations beneath it.

**4. Separate policy from details. Point dependencies at policy.** Policy = business rules (valuable on paper, no computer needed). Details = everything that only exists because we automated. Source-code dependencies point *inward*, from volatile details toward stable abstract policy. This is the **Dependency Rule**.

**5. The architecture should scream the use cases, not the framework.** Opening the repo should reveal "shopping cart" or "payroll", not "Rails" or "Spring". Frameworks are tools, never architectures.

## Quick principle reference

**SOLID** — class/module level (see `references/solid-principles.md`)
- **SRP**: one module, one *actor* (one source of change — not "one function")
- **OCP**: new behavior arrives as new code, not edits to old code
- **LSP**: subtypes must be substitutable without surprising callers
- **ISP**: don't force clients to depend on methods they don't use
- **DIP**: depend on abstractions; volatile concretions are plugins

**Component cohesion** — which classes belong together (see `references/component-principles.md`)
- **REP**: granule of reuse = granule of release
- **CCP**: things that change together belong together (SRP at component scope)
- **CRP**: don't force consumers to depend on what they don't use (ISP at component scope)

**Component coupling** — how components depend on each other (see `references/component-principles.md`)
- **ADP**: no cycles in the component dependency graph — ever
- **SDP**: depend in the direction of stability; volatile depends on stable, never the reverse
- **SAP**: stable components must be abstract; stable + concrete = Zone of Pain

**Layers** — innermost to outermost (see `references/clean-architecture-layers.md`)
1. **Entities** — enterprise business rules + critical data; depends on nothing
2. **Use Cases** — application-specific rules; orchestrates entities via declared interfaces
3. **Interface Adapters** — controllers, presenters, gateways; translates outer ↔ inner
4. **Frameworks & Drivers** — DB, web, UI; all details live here at the edge

**Dependency Rule**: source-code dependencies point only inward. Nothing in an inner circle may name anything in an outer circle.

## Decision shortcuts

- *"Where does this code go?"* → Innermost layer that doesn't require importing anything more concrete than itself.
- *"Should I pick a DB/framework now?"* → No. Sketch use cases first; treat the missing piece as an interface.
- *"Should I use microservices?"* → Almost certainly not yet. Start with source-level decoupling inside a monolith; promote to services only when operational pressure justifies it.
- *"Should I add this abstraction now?"* → Note the seam. If adding it later costs significantly more, add a partial boundary (Strategy or Facade — see `references/boundaries.md`).
- *"Circular dependency?"* → Defect. Break via DIP (interface in the more stable component) or extract a third component.
- *"How do I make this testable?"* → Wedge abstraction between the volatile thing and the policy (Humble Object — see `references/clean-architecture-layers.md`).

## How the agent should respond

- **Diagnose before prescribing.** Identify which workflow situation applies; the right move differs sharply between "starting fresh" and "fixing what exists".
- **Stay tech-agnostic by default.** These principles apply equally to a Rust CLI, Python pipeline, Unity game, or microservice fleet.
- **Resist over-engineering.** A 200-line script doesn't need four named layers — but dependency direction and policy/detail separation matter at any size.
- **Push back on structural shortcuts.** Make the trade-off visible: "just add it to the controller" has a real long-term cost.
- **Diagrams help, prose helps more.** Use Mermaid for boundaries and dependency direction; the reasoning lives in prose.

## Files in this skill

```
clean-architecture/
├── SKILL.md
├── references/
│   ├── solid-principles.md
│   ├── component-principles.md
│   ├── clean-architecture-layers.md
│   ├── boundaries.md
│   ├── workflow-new-project.md
│   ├── workflow-audit.md
│   ├── workflow-cleanup.md
│   └── workflow-strangle.md
└── assets/
    ├── audit-checklist.md
    └── project-skeleton.md
```

When a workflow or principle file is relevant, **read it** before continuing the conversation.
