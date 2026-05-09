# SOLID Principles — class and module level

The five SOLID principles tell you how to arrange functions and data into classes, and how those classes should depend on each other. They are the smallest unit of architectural thinking. Apply them at module / class scope; their analogs at component scope live in `component-principles.md`.

## SRP — Single Responsibility Principle

> A module should be responsible to one, and only one, *actor*.

The common misreading is "a class should do only one thing". That's a refactoring rule for *functions*, not the SRP. SRP is about *who asks for changes*. A `Employee` class that contains `calculatePay()` (asked for by the CFO), `reportHours()` (asked for by HR), and `save()` (asked for by the DBA) violates SRP — three actors share one module, and a change demanded by one will ripple into work the others didn't ask for.

**Symptoms of violation**
- Two unrelated stakeholders both have to be consulted before you change a single class.
- Merge conflicts where two developers edited the same file for completely unrelated reasons.
- Tests for one feature break when an unrelated feature is modified.

**Fix patterns**
- Split the class along the actor seam. Move each actor's methods to its own class with its own data view.
- If shared behavior remains, use a Facade that delegates to the split classes — the Facade preserves the original API while the responsibilities live separately.

**Architectural echo**
SRP at component scope becomes the **Common Closure Principle** (CCP — see `component-principles.md`). At system scope it becomes the *axis of change*, which is what determines where to draw architectural boundaries.

## OCP — Open/Closed Principle

> A software artifact should be open for extension but closed for modification.

Adding a feature should mean writing new code, not editing old code. The system is open to new behavior (extension) and closed against the destabilizing churn of edits (modification). This is the most fundamental reason architecture exists at all — if simple new requirements force massive rewrites, the architecture has failed.

The mechanism is *partitioning the system into components* and *arranging dependencies in a hierarchy* so that high-level components are insulated from changes in low-level ones. A printable report and a web report should share business logic without each having to know about the other; a new export format should not require editing the calculator.

**Symptoms of violation**
- A small new requirement (e.g., "also output to CSV") forces edits in many existing files.
- A class has a long `if/else if` ladder over a "type" field that grows every time a new variant is added.

**Fix patterns**
- Extract an interface for the variant axis (output format, persistence backend, notification channel) and let each variant be a separate implementation.
- Apply DIP: the high-level policy depends on the abstraction; the new variant plugs in from outside.

## LSP — Liskov Substitution Principle

> If S is a subtype of T, then objects of type T may be replaced with objects of type S without altering the desirable properties of the program.

LSP says inheritance / polymorphism must preserve a contract. The classic violation is `Square extends Rectangle`: `Rectangle` lets width and height vary independently, `Square` cannot, so any code that worked with `Rectangle` may break when handed a `Square`. The square is not, in the LSP sense, a rectangle.

LSP scales beyond OO. At architectural level, it applies to any pair of components that are supposed to be interchangeable — REST endpoints with the same shape, drivers behind a common interface, services behind a load balancer. A single non-substitutable variant forces the architecture to grow special-case dispatch logic that didn't need to exist.

**Symptoms of violation**
- `if (instanceof X)` checks scattered through code that should not care which subtype it has.
- A subclass overrides a method to throw `UnsupportedOperationException`.
- "This works for everything except Y" notes in documentation.

**Fix patterns**
- Question the inheritance: prefer composition, or pull the differing behavior up so it's visible in the abstract contract.
- If subtypes truly diverge, they're probably not subtypes — split the abstraction.

## ISP — Interface Segregation Principle

> Don't force clients to depend on methods they don't use.

A wide interface (`Ops` with 20 methods) drags every client into a recompile-and-redeploy whenever any of its methods change, even clients that only use one of them. Split the wide interface into narrow client-specific ones (`U1Ops` with just the methods `User1` cares about). Each client now sees only what it uses, and changes to unrelated methods don't propagate.

In dynamic languages with no compile step, the static-coupling form of this problem softens — but the architectural form remains: don't depend on a thing that carries baggage you don't need. If your service requires a framework that requires a database that requires a clustering library, you have inherited every transitive failure mode of that stack.

**Symptoms of violation**
- A "kitchen sink" interface that all consumers implement but most leave half-empty.
- Recompiling 30 modules because one method on a popular interface changed.
- Deploying a transitive dependency you never call because the framework demands it.

**Fix patterns**
- Split the interface along client lines. One narrow interface per use-pattern.
- At component scale this becomes **CRP** (Common Reuse Principle).

## DIP — Dependency Inversion Principle

> Source code dependencies should refer only to abstractions, not concretions.

This is the load-bearing principle of clean architecture. In a naïve design, the high-level policy `import`s the low-level detail (`OrderService` imports `MySqlDatabase`), so the policy is held hostage by every choice the detail makes. DIP inverts that arrow: the policy declares an interface (`OrderRepository`), and the detail implements it. Now the policy depends on nothing concrete, and the detail is a plugin to the policy — replaceable, testable, deferrable.

The qualifier "volatile" matters. You don't have to abstract `String` or `int` or the standard library; those are stable enough to depend on directly. DIP targets the things that are actively under development and likely to change: your own modules, frameworks, databases, third-party services.

**Concretely, DIP means**
- High-level modules **never** `import` / `use` / `require` modules from a less stable layer.
- Interfaces live with the *consumer* (the high-level module), not the implementer.
- The implementer is wired up at the system's edge — the **Main** component — and injected into the policy.
- Abstract factories are an acceptable substitute when language constraints prevent direct interface inversion.

**The one place concrete dependencies are concentrated**
Every system has one component that *does* depend directly on concretions — the one that constructs everything and wires it together. This is the **Main** component (see `clean-architecture-layers.md`). Main is the dirtiest, lowest-level module, and that's fine: it's a plugin, the only one that knows about the rest.

**Symptoms of violation**
- Business logic files contain `import psycopg2` / `import django` / `using System.Web`.
- You can't write a unit test without spinning up a database or a web server.
- Replacing a vendor SDK requires touching dozens of business-rule files.

**Fix patterns**
- Define the interface where the policy lives. Move the concrete implementation outward.
- Use constructor injection (or the language's equivalent). Wire dependencies in `main` / `app.py` / `Program.cs` — once, at the boundary.
- For pervasive concrete dependencies, do the inversion incrementally — see `workflow-strangle.md`.

## How SOLID composes

The five principles aren't independent rules; they're facets of one underlying idea: **isolate change**. SRP says modules change for one reason. OCP says modules change rarely. LSP says substitutes don't surprise consumers when things change. ISP says clients don't see changes in things they don't use. DIP says policy doesn't change when details change. Read together, SOLID describes the local conditions under which a module can be changed (or replaced) without dragging the rest of the system with it.

The next scale up — *which* modules belong in which component, and *how* components depend on each other — is covered in `component-principles.md`.
