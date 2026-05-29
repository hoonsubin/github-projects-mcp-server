# SOLID Principles - class and module level

The five principles tell you how to arrange functions and data into classes, and how those classes should depend on each other. Apply at module/class scope.

## SRP - Single Responsibility Principle

> A module should be responsible to one, and only one, *actor*.

The common misreading is "a class should do only one thing" - that's a refactoring rule for functions. SRP is about *who asks for changes*. An `Employee` class with `calculatePay()` (CFO), `reportHours()` (HR), and `save()` (DBA) violates SRP - three actors share one module.

**Symptoms:** Two unrelated stakeholders must both be consulted before changing one class; merge conflicts from completely unrelated reasons; tests for one feature break when an unrelated feature changes.

**Fix:** Split the class along the actor seam. If shared behavior remains, use a Facade that delegates to the split classes while preserving the original API.

## OCP - Open/Closed Principle

> A software artifact should be open for extension but closed for modification.

Adding a feature should mean writing new code, not editing old code. The mechanism: partition into components and arrange dependencies so high-level components are insulated from changes in low-level ones.

**Symptoms:** A small new requirement forces edits across many existing files; a class has a growing `if/else if` ladder over a "type" field that expands with every new variant.

**Fix:** Extract an interface for the variant axis; let each variant be a separate implementation; apply DIP so the high-level policy depends on the abstraction.

## LSP - Liskov Substitution Principle

> If S is a subtype of T, objects of type T may be replaced with objects of type S without altering the desirable properties of the program.

Inheritance must preserve a contract. Classic violation: `Square extends Rectangle` - `Rectangle` lets width/height vary independently; `Square` cannot, so code that worked with `Rectangle` breaks when handed a `Square`. At architectural scale, LSP applies to any interchangeable components behind a common interface.

**Symptoms:** `if (instanceof X)` checks in code that shouldn't care which subtype it has; a subclass overrides a method to throw `UnsupportedOperationException`.

**Fix:** Question the inheritance - prefer composition, or pull diverging behavior into the abstract contract. If subtypes truly diverge, they're probably not subtypes; split the abstraction.

## ISP - Interface Segregation Principle

> Don't force clients to depend on methods they don't use.

A wide interface drags every client into a recompile-and-redeploy whenever any of its methods change. Split into narrow client-specific interfaces.

**Symptoms:** A "kitchen sink" interface most consumers leave half-empty; recompiling 30 modules because one method on a popular interface changed.

**Fix:** Split the interface along client lines - one narrow interface per use-pattern. At component scale this becomes **CRP** (see `component-principles.md`).

## DIP - Dependency Inversion Principle

> Source code dependencies should refer only to abstractions, not concretions.

High-level policy must not import low-level detail. The policy declares an interface (`OrderRepository`); the detail implements it. Interfaces live with the *consumer* (the high-level module), not the implementer. The one place concrete dependencies are concentrated is **Main** - see `clean-architecture-layers.md`.

**Symptoms:** Business logic files contain `import psycopg2` / `import django`; can't write a unit test without spinning up a database; replacing a vendor SDK requires touching business-rule files.

**Fix:** Define the interface where the policy lives. Move the concrete implementation outward. Wire dependencies in `main` - once, at the boundary. Use constructor injection; don't sprinkle `@inject` through business objects.

## How SOLID composes

All five principles isolate change: SRP says modules change for one reason; OCP says modules change rarely; LSP says substitutes don't surprise; ISP says clients don't see unrelated changes; DIP says policy doesn't change when details do. Together they describe the local conditions under which a module can be changed or replaced without dragging the rest of the system.

The next scale up - which modules belong in which component - is in `component-principles.md`.
