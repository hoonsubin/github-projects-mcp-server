# Workflow — Converting Dirty-But-Working Code into a Maintainable Project

Use when the system works and ships but the code is dirty enough to slow the team: business logic mixed with framework code, tests need a database to run, refactoring feels risky.

The name comes from Fowler's **Strangler Fig** pattern: the new architecture grows around the old code, gradually replacing it from the outside in.

## The shape of the work

Repeat one five-step cycle per use case (hours to days, not weeks). Each cycle leaves the system strictly better — no half-finished migrations, no broken intermediate states:

1. Pick a target slice
2. Define the target shape
3. Introduce ports as seams — without changing behavior
4. Move logic across the seam
5. Verify and stabilize

## Stage 0 — Set up the safety net

- Confirm a working, fast test suite. Fix slow or unreliable tests first.
- Add dependency graph + cycle detection to CI (see `workflow-audit.md`).
- Adopt a consistent baseline directory layout and document it in CONTRIBUTING.

## Stage 1 — Pick a target slice

A slice is one named use case ("register a customer", "process a payment"). Pick one that is:
- **Visible value** — stakeholders care about it
- **Moderate complexity** — not the simplest, not the most tangled
- **Active** — changed recently and likely to change soon
- **Bounded** — describable in one sentence

Aim for a slice you can finish in 1–3 days.

## Stage 2 — Define the target shape

Sketch what the slice should look like in clean form:
- Entity: domain noun + critical rules
- Use case interactor: input DTO → steps → output DTO
- Ports: interfaces the use case needs — **interfaces live with the use case**
- Adapters: where current code lives before and after migration

Don't write code yet. The sketch keeps you oriented as you move incrementally.

## Stage 3 — Introduce ports as seams

**Add interfaces before moving any logic.** For each port the use case needs:
1. Define the interface in the use-case package in domain language.
2. Implement it with a thin adapter wrapping the existing messy code. Behavior is unchanged.
3. Register the adapter in Main.
4. Run tests — they must still pass.

This is dependency inversion applied incrementally. You've enabled the move without making it yet.

## Stage 4 — Move logic across the seam

1. Construct the use case depending only on port interfaces; inject existing adapters from Main.
2. Move orchestration out of the framework class into the use case.
3. Move business rules out of services into the entity that owns the data.
4. Move data access details behind the gateway — ORM types stay on the gateway side; only domain types cross the seam.
5. Update tests: write at least one use case test with fake adapters (no DB needed).

Rules: one change at a time; preserve behavior (note bugs, fix them in separate commits after migration); resist scope creep; the framework class is allowed to stay messy (it's in the outer layer now).

## Stage 5 — Verify and stabilize

Before declaring done:
- All tests pass
- Use case can be unit-tested with fakes
- Framework class has no business rules
- Use case has no framework/DB/UI imports
- Dependency graph still acyclic; new arrows all point inward

Ship it. The next slice begins.

## Stage 6 — After several slices: extract the deeper structure

After 3–8 slices, patterns emerge: repeated ports (`Clock`, `EventPublisher`), recurring entities, adapter consolidation opportunities, component boundaries becoming visible (clusters of slices that change together → CCP). The architecture emerges from observed change patterns, not advance planning.

## Anti-patterns to watch for

- **Architecture astronaut creep** — every slice doesn't need a registry, factory, event bus, and CQRS read-side. Use the simplest seam that fits.
- **Recreating the framework's structure** — if the use case looks like the controller it replaced, you haven't inverted anything.
- **Premature interface explosion** — define ports the *current slice* needs, not every imaginable future need.
- **Skipping Main** — wiring concrete adapters inside use cases or domain code rebuilds the original mess.
- **Anemic entities** — rules ending up in "services" while entities become bags of fields is the procedural style under a domain veneer.

## Worked example (Django)

**Before:**
```
app/
├── views.py   ← validation + business logic + ORM queries + response building
├── models.py  ← Django models with @classmethod "business" helpers
```

**After one slice ("create order"):**
```
app/
├── orders/
│   ├── domain/order.py              ← Order entity, no framework
│   ├── usecase/create_order.py      ← CreateOrderUseCase, depends on ports
│   ├── usecase/ports.py             ← OrderRepository, Clock, NotificationGateway
│   ├── adapter/django_repository.py ← implements OrderRepository via ORM
│   └── web/views.py                 ← thin: parse → call use case → format
├── views.py   ← still messy for other slices, untouched
```

The Django ORM still exists — it's an implementation detail of `django_repository.py`. The use case knows nothing of Django. Tests run in milliseconds with a fake repository. The next slice follows the same pattern.
