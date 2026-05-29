---
name: typescript-engineering
description: >-
  Advanced TypeScript engineering — writing, reviewing, refactoring, and
  architecting TypeScript codebases. Use whenever the task involves TypeScript:
  writing new TS code, reviewing or auditing existing TS, refactoring messy TS,
  fixing type errors, designing types, choosing between OOP and functional
  style, structuring a TS project, or judging whether code is maintainable and
  scalable. Triggers on phrases like 'review my TypeScript', 'is this
  type-safe', 'how should I type this', 'this code is a mess', 'fix this type
  error', 'should this be a class or a function', 'how do I structure this
  project', 'make this more maintainable', 'refactor this', and ANY task where
  the codebase is TypeScript. Apply proactively — do not wait for the user to
  ask for a 'TypeScript review'. Thinks in TypeScript's type system first, then
  applies Clean Code and Clean Architecture principles.
modeSlugs:
  - code
  - architect
---

# TypeScript Engineering

A code-auditing and code-writing skill for advanced TypeScript. The goal is **maintainable, scalable, type-safe** code. The codebase is assumed to be TypeScript — reason in TypeScript's own concepts (structural typing, set-theoretic types, narrowing, ADTs) *first*, then layer Clean Code and Clean Architecture on top.

The governing idea: **the type system is a design tool, not decoration.** A well-designed type makes illegal states unrepresentable, so whole categories of bug and test become unnecessary. Every typing decision is an architecture decision.

---

## How to Apply This Skill

**Writing new code** — Apply the Core Principles below from the start. Pick the paradigm deliberately (see Paradigm Selection). Never produce "works but loose" code with `any`, lying signatures, or mutable shared state and plan to tighten later.

**Reviewing / auditing code** — Scan against the anti-pattern catalog in `references/anti-patterns.md`. Each smell has a code (T#, P#, A#). Report findings grouped by category, cite the code, explain *why* it bites, show the before/after fix, and prioritize by blast radius (a wrong dependency direction outranks a naming nit).

**Refactoring** — Name the smell, cite the principle, show the fix. If the refactor is large, sequence it into safe incremental steps the user can land one at a time.

**Reference files — load based on task type:**

| Task | Load |
|---|---|
| Type errors, choosing `type` vs `interface`, `satisfies`, brands, generics, narrowing | `references/type-system.md` |
| Auditing or reviewing existing code for smells | `references/anti-patterns.md` |
| "Class or function?", design patterns, OOP vs FP, testing strategy | `references/paradigms.md` |
| Project structure, module boundaries, ports/DI, adding a feature | `references/architecture.md` |

For a full audit, load `anti-patterns.md` first (the checklist), then the others as findings require depth.

---

## The TypeScript-First Mindset

Before reaching for an OOP pattern or an architecture rule, ask what the type system can do directly. TypeScript expresses many designs as *types* that other languages can only express as *classes*.

- A state machine is a **discriminated union**, not a class hierarchy.
- A "this could be absent" is `T | undefined` or an `Option`, not a nullable field you `!` past.
- A "this could fail" is a `Result<T, E>`, not a thrown exception for an expected case.
- A constrained value (email, positive money, an entity ID) is a **branded type** or a **value object**, not a raw `string`/`number`.
- A contract is an `interface`; a derived, computed, or union shape is a `type`.
- "Closed for modification" is often a `Record`-keyed lookup or a registry, not an `abstract class`.
- An async function's error path is part of its type — use `Promise<Result<T, E>>` for expected failures, not untyped `catch`.
- A function parameter that won't be mutated is `readonly` — it's a contract, not just style.

If the type system can enforce an invariant, enforcing it in runtime code or tests instead is a missed design.

---

## Core Principles (always active — no reference file needed)

### 1. Type honesty
Every type must tell the truth. A signature that claims `T` but can return `undefined` is a lie that propagates.
- `unknown` over `any`. `any` disables the checker and spreads silently; `unknown` forces proof before use.
- No `!` (non-null assertion) without a guarantee right above it. `!` is a permanent unchecked promise.
- No `as` cast that widens or fakes a type. `as const` and narrowing assertions are fine; lying casts are not.
- Total functions: handle every input the signature admits, or narrow the signature to match reality.

### 2. Make illegal states unrepresentable
Model the domain so bad states *cannot be constructed*. Prefer discriminated unions over flag soup (`isLoading`, `isError`, `data` all optional → four impossible combinations). Prefer value objects with validating constructors over raw primitives.

### 3. `strict` is assumed
Code is written as if `strict: true`, `noUncheckedIndexedAccess`, and `noImplicitOverride` are on. `arr[i]` is `T | undefined`. If a project lacks these flags, flag it (see `references/architecture.md`).

### 4. Immutability by default
Don't mutate inputs or shared state. Return new values. Use `readonly` on fields and `ReadonlyArray<T>` on collections that callers shouldn't change. `let` accumulators mutated in a loop are a smell — usually `reduce` or `map`.

### 5. Encapsulation = behavior, not accessors
Expose meaningful operations, hide representation. Mindless `get`/`set` pairs are public fields with ceremony — they leak the storage format and destroy the abstraction.

### 6. Dependencies point inward, wired at one place
Domain code never imports infrastructure. Depend on interfaces; concrete construction happens only at the composition root (`main.ts`). An interface lives with its *consumer*, not its implementer.

### 7. One responsibility per unit
A function does one thing; if you can extract a well-named function from it, it did more than one. A class/module has one reason to change; if describing it needs "and", split it.

---

## Paradigm Selection

TypeScript is multi-paradigm by design. Choose per *unit of code* based on what is most likely to change — this is the Objects-vs-Data-Structures dichotomy applied as a decision rule.

| The code's job | Likely to change | Choose | Mechanism |
|---|---|---|---|
| New *variants* of a thing keep appearing | New types | Polymorphism | `interface` + implementations, or discriminated union |
| New *operations* on stable data keep appearing | New functions | Functional | Plain data (`type`/`readonly`) + pure functions |
| Modeling domain state & transitions | Both | ADTs | Discriminated unions + value objects + total transition functions |
| Module boundaries, dependency wiring, swappable infra | Implementations | OOP-leaning | Interfaces, dependency injection, composition root |
| Business logic *inside* a boundary | Rules | Functional-leaning | Pure functions, effects pushed to the edges |

**The default architecture for a non-trivial TypeScript project:** OOP-style boundaries (interfaces + DI for testability and swappability) wrapping a functional core (pure functions, immutable data, illegal states unrepresentable). This is the "imperative shell, functional core" shape. Do not pick one paradigm as an identity — pick per unit.

Two anti-patterns at the extremes: forcing class hierarchies onto data that just needs transformation (over-OOP — see P10, P11), and threading `Option`/`Result`/monads through code that gains nothing from them (over-FP — see `references/paradigms.md`). Match the tool to the job.

---

## Decision Shortcuts

**"`interface` or `type`?"** — `interface` for an object contract meant to be implemented or extended (especially DI ports). `type` for unions, intersections, tuples, mapped/conditional/template-literal types, and primitive aliases. A discriminated union is always a `type`.

**"Class or function?"** — Class when you need encapsulated mutable state, or an instance to satisfy a DI port. Otherwise a function. A class with one method and no state is a function in disguise (P11).

**"`any` here is unavoidable."** — Almost never true. Use `unknown` + a type predicate or schema parse at the boundary. If `any` truly must stay, it gets a comment justifying it.

**"Where does this type go?"** — With the code that *consumes* it. A repository port belongs in the domain module that uses it; the database module implements it. (DIP — see `references/architecture.md`.)

**"Throw or return a Result?"** — Throw for *programmer errors* and truly exceptional conditions. Return `Result<T, E>` for *expected* failures (validation, not-found, conflict) so the caller is forced by the type to handle them (P14).

**"This needs an abstraction... now?"** — Add the seam, not the speculative generality. One implementation needs no `interface`; extract it when the second concrete case arrives, or when a test needs to substitute a fake. Premature abstraction is a smell (P12); a missing architectural seam is expensive to retrofit — note it either way.

**"Should I add this `enum`?"** — Default to a `const` object + derived union type instead; better runtime semantics, readable serialization, no IIFE. (T6.)

**"Is this type wrong, or is the design wrong?"** — A fighting type error usually means the design is wrong. Before adding `as`/`!`, ask whether the data model should change so the error disappears honestly.

---

## Response Guidance

- When reviewing, lead with a one or two sentence overall assessment, then grouped findings (Types / Design / Architecture), most impactful first, each with a smell code and a before/after.
- Scale rigor to the code: a 40-line script does not need ports, DI, and four layers. The *direction* of dependencies, type honesty, and illegal-states-unrepresentable hold at every size.
- Think in TypeScript concepts before importing OOP patterns or architecture vocabulary — often the cleaner fix is a sharper type, not a new class.
- Be honest about trade-offs. Explain *why* a change matters (the bug it prevents, the change it makes cheap), not just that a rule says so.
- When the user proposes a shortcut (`any` to "move fast", logic in the controller, skip the port), name the concrete cost rather than refusing.

## Reference Files

```
typescript-engineering/
├── SKILL.md
└── references/
    ├── type-system.md     ← Types as a design toolkit: generics, narrowing, mapped/conditional/template types, brands
    ├── anti-patterns.md   ← Smell catalog: T# (types), P# (design), A# (architecture) + writing checklist
    ├── paradigms.md       ← OOP & functional patterns, decision framework, testing strategy
    └── architecture.md    ← Module boundaries, dependency direction, cross-cutting concerns, Clean Architecture in TS
```
