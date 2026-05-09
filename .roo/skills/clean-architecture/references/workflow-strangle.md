# Workflow — Converting Dirty-But-Working Code into a Maintainable Project

Use this workflow when the system **works**, ships, and isn't on fire — but the code itself is dirty enough that the team is starting to slow down. There are no cycles in the dependency graph yet, no critical structural failures, but: business logic is mixed with framework code, tests need a database to run, refactoring something feels risky, and "where does this go?" is a recurring argument.

This is the most common situation by far. It's also the most rewarding to work on, because the system isn't broken — you're upgrading a healthy codebase into a *robustly* healthy one. The work is incremental, low-risk, and pays back continuously.

If the codebase is genuinely a Big Ball of Mud, use `workflow-cleanup.md` — that's a heavier intervention. If you're starting from nothing, use `workflow-new-project.md`.

The name "strangle" comes from Martin Fowler's **Strangler Fig** pattern: the new architecture grows incrementally around the old code, gradually replacing it from the outside in, until the old structure can be safely removed.

## The shape of the work

You will repeat the same five-step cycle, once per use case (or per coherent slice of behavior). Each cycle takes hours to days, not weeks. Each cycle leaves the system **strictly better than before** — no half-finished migrations, no broken intermediate states.

The cycle:

1. **Pick a target slice.**
2. **Define the target shape** for that slice (use case, entity, ports).
3. **Introduce ports as seams** without changing behavior.
4. **Move logic across the seam**, leaving adapters behind.
5. **Verify and stabilize**, then move on.

After enough cycles, the architecture has been quietly inverted. The framework becomes a plugin to the business rules, instead of the other way around.

## Stage 0 — Set up the safety net

Before changing any code:

- **Confirm a working test suite.** If tests are slow or unreliable, fix that first. The whole strategy depends on tests as a safety net for refactoring.
- **Add the dependency graph + cycle detection** to CI (see `workflow-audit.md`). This catches the most common backslide.
- **Adopt a baseline directory layout.** It doesn't have to be perfect — just *consistent*. For example, decide that domain types live in `<feature>/domain/`, use cases live in `<feature>/usecase/`, gateways in `<feature>/gateway/`. Document the convention in a CONTRIBUTING file. New code follows it; old code migrates over time.

## Stage 1 — Pick a target slice

A "slice" is one use case — one named thing the system does, like "register a customer" or "process a payment" or "generate a daily report". Pick one with these properties:

- **Visible value**: it's a use case stakeholders care about. Cleanup of obscure utilities first looks busy but doesn't move the needle.
- **Moderate complexity**: not the simplest (so the win is real), not the most tangled (you're not yet ready to fight that one).
- **Active**: it's been changed recently and is likely to change soon. Refactoring cold code is wasted effort.
- **Bounded**: you can name the slice in one sentence. If the slice is "everything billing-related", it's too big — pick "calculate monthly invoice" instead.

Aim for a slice you can finish in 1–3 days. Bigger slices fail; smaller slices feel pointless.

## Stage 2 — Define the target shape

For the chosen slice, sketch (text or diagram) what it should look like in clean form:

- **Entity**: the domain noun and its critical rules. (E.g., `Invoice` with rules about totals, due dates, allowed states.)
- **Use case interactor**: the orchestration. Input DTO → steps → output DTO.
- **Ports**: the interfaces the use case will consume — `InvoiceRepository`, `Clock`, `EmailGateway`, etc. **The interfaces live with the use case**, not with their current implementations.
- **Adapters**: where current code lives, before and after migration.

Don't write the code yet. The sketch is an architectural target. It tells you where you're going so you can move incrementally toward it without losing your way.

A useful exercise: write down "if a new dev opened this slice, this is what they'd see" — and verify the description doesn't mention any framework or database. If the description is "the `InvoiceController` calls `InvoiceService` which calls `InvoiceRepository`...", that's the wrong shape. The right shape is "a use case `CalculateMonthlyInvoice` that loads an `Invoice`, applies billing rules, returns an `InvoiceCalculation` DTO".

## Stage 3 — Introduce ports as seams

This is the heart of the work, and the most counterintuitive step: **add the interfaces before moving any logic**. The seams come first; the migration follows.

For each port the use case will need:

1. **Define the interface** in the use-case package, expressed in domain language. (`InvoiceRepository.findUnpaid(customerId): List<Invoice>`.)
2. **Implement the interface** with a thin adapter that calls the existing messy code. The adapter does no transformation; it's a 1:1 wrapper. *Behavior is unchanged.*
3. **Register the adapter** in Main / wiring code. The port is now real.
4. **Run the tests.** They should still pass — you haven't changed any logic.

Repeat for each port the slice needs. The result: the old code still does all the work, but it's now reachable through clean interfaces. The seams exist.

This is dependency inversion applied incrementally. You haven't moved any logic yet — you've just *enabled* the move.

## Stage 4 — Move logic across the seam

Now build the use case interactor properly:

1. **Construct the use case object** that depends only on the port interfaces. Inject the existing adapters from Main.
2. **Move orchestration logic** out of the framework class (controller / handler / view function) and into the use case. The framework class becomes thin: parse input → call use case → format output.
3. **Move business rules** out of services and helpers and into the entity, where they belong. (This often reveals that several "services" are actually behaviors of one or two entities.)
4. **Move data access details** behind the gateway. SQL leaves the use case (if it was there). ORM types stay on the gateway side; only domain types cross the seam.
5. **Update tests**. The use case is now testable with fake adapters — write or convert tests that don't need a database. Older tests that hit the database can stay (they're now integration tests, not unit tests, but that's fine).

Rules of the road during this stage:

- **One change at a time.** Move one rule, run tests, commit. If tests fail, you know why.
- **Behavior preservation is paramount.** Even if the existing behavior has bugs, preserve it for now. Note the bugs; fix them in separate, named commits *after* the migration.
- **Resist scope creep.** "While I'm in here, let me also fix..." is how 1-day refactors become 1-week refactors and then never finish. Note the side issue, save it for later.
- **The framework class is allowed to stay messy.** It's now in the outer layer where mess is least costly. Cleaning it up is optional and low priority.

## Stage 5 — Verify and stabilize

Before declaring the slice done:

- All tests pass, including the ones that previously needed a database (now run as integration tests if they still need one).
- The use case can be unit tested with fakes — write at least one such test as proof.
- The framework class (controller / handler) has no business rules in it.
- The use case has no framework / DB / UI imports.
- The dependency graph still has no cycles, and the new arrows all point inward.
- A new developer reading the slice can describe what it does in business terms.

Ship it. The slice is now clean. The rest of the system is unaffected. The next slice can begin.

## Stage 6 — After several slices: extract the deeper structure

After 3–8 slices have been converted, patterns will be visible:

- **Repeated ports** — multiple use cases need a `Clock`, a `EventPublisher`, an `IdGenerator`. Extract these to a shared kernel.
- **Recurring entities** — slices keep operating on the same domain objects. Promote shared entities to a domain core that all slices can depend on (always inward).
- **Adapter consolidation** — multiple slices have adapters to the same external system. Group them; consider whether the adapter is its own component now.
- **Component boundaries become visible** — clusters of slices that change together (CCP) suggest where to draw a real component line.

This is where the actual *architecture* emerges — not from advance planning, but from observed change patterns. The component graph you sketch at this point is far more accurate than anything you could have drawn before starting.

## Pacing and prioritization

Realistic pacing for a team of 3–5 engineers, with cleanup running alongside feature work:

- **Week 1–2**: Set up the safety net (Stage 0). Pick the first slice. Maybe finish it.
- **Week 3–8**: One slice per week, on average. Some take a day, some take a week. Two failed slice attempts (where you discover the slice was bigger than expected and back out) is normal.
- **Week 8–12**: Pace picks up; team has internalized the pattern. Multiple slices in parallel.
- **Month 4+**: Most active code is in clean slices. New features are written in the new shape from the start. Old, cold code stays as-is — that's fine.

The expected pattern: a few slow weeks at the start, an inflection point around slice 5–8, then accelerating returns.

## Anti-patterns to watch for

- **Architecture astronaut creep.** Every cleaned-up slice doesn't need a registry, a factory, an event bus, and a CQRS read-side. Use the simplest seam that fits the slice. Promote to fancier patterns only when justified by a real second use.
- **Recreating the framework's structure inside the use case.** If your use case ends up looking like the controller it replaced, just with `UseCase` in the name, you haven't actually inverted anything. The use case should be expressed in business steps, not HTTP steps.
- **Premature interface explosion.** Defining a port for every imaginable future need. Define the ports the *current slice* needs. New slices may or may not reuse them.
- **Treating tests as documentation of the migration.** Tests prove behavior; they're not narrative. Don't let test files balloon to record what you did and why — that goes in commit messages and ADRs.
- **Skipping Main.** Wiring concrete adapters inside use cases or domain code. Main is the *only* place that knows about concrete implementations. If you're tempted to wire elsewhere, you're rebuilding the original mess.
- **"Pure" entities with anemic data classes plus separate "services"**. The services are where rules end up; the entities become bags of fields. This recreates the procedural style under a domain veneer. Push rules into the entity that owns the data.

## A worked example (sketch)

Imagine a Django (or Rails / Express / Spring) app with this pre-cleanup shape:

```
app/
├── views.py        ← contains: validation, business logic, ORM queries, response building
├── models.py       ← Django models with @classmethod helpers for "business" logic
├── serializers.py
└── urls.py
```

After applying this workflow to one slice ("create order"):

```
app/
├── orders/
│   ├── domain/
│   │   └── order.py             ← Order entity, business rules, no framework
│   ├── usecase/
│   │   ├── create_order.py      ← CreateOrderUseCase, depends on ports
│   │   └── ports.py             ← OrderRepository, Clock, NotificationGateway
│   ├── adapter/
│   │   ├── django_repository.py ← Implements OrderRepository using ORM
│   │   └── system_clock.py      ← Implements Clock
│   └── web/
│       ├── views.py             ← Thin: parse request, call use case, format response
│       └── urls.py
├── views.py        ← still messy for other slices, untouched
├── models.py       ← still has the Order Django model + others
└── ...
```

The Django ORM still exists and is still used — it's an implementation detail of `django_repository.py`. The use case knows nothing of Django. Tests for `CreateOrderUseCase` run in milliseconds with a fake repository. The next slice (e.g., "cancel order") follows the same pattern, possibly reusing the same `OrderRepository` interface.

The system is still a Django app. It just happens to have a clean architecture inside it — and could, if needed, become not-a-Django-app without rewriting the business rules.

## See also

- `references/clean-architecture-layers.md` — for the target shape.
- `references/boundaries.md` — for choosing seam strength.
- `references/workflow-cleanup.md` — for the heavier-handed version when the codebase is genuinely a swamp.
- `assets/project-skeleton.md` — for a reference layout the slices are migrating toward.
