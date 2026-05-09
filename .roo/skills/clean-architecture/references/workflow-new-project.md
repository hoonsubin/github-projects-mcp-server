# Workflow — Starting a New Project (Greenfield)

Use this workflow when no code exists yet, or the user is about to start writing some, and they want the architecture sketched first. The temptation at this stage is to pick a stack ("Rails + Postgres + Redis"), run `rails new`, and start filling in controllers. **Don't.** That's letting the framework choose the architecture for you, and you'll spend the rest of the project's life paying for it.

The workflow has six stages. Don't skip stages, but adapt the depth to project size. A weekend hack might spend ten minutes on each. A year-long product effort might spend a week.

## Stage 1 — Establish the use cases (before anything technical)

**Goal**: a written list of the *use cases* the system must support, expressed in business language with no technical detail.

A use case is a description of how the system is used by an actor (a user, another system, a scheduled job) to accomplish a goal. The format isn't sacred — you can use Cockburn's templates, BDD scenarios, or plain bullet points — but the constraint is rigid: **no UI, no database, no framework, no protocol** appears in the description.

Bad: *"User submits the registration form via POST to /api/users, the controller validates input and writes to the users table."*

Good: *"A new customer provides their identity and contact information; the system verifies the information is well-formed and unique, records the customer, and returns confirmation."*

If you cannot write a use case without naming a technology, you don't yet understand the use case — you understand a draft implementation. Strip it back further.

**Output of this stage**: a list of 5–30 use cases. For most systems you don't need to be exhaustive. You need enough to see the *shape* of the domain.

## Stage 2 — Identify entities and critical business rules

**Goal**: name the *entities* — the nouns that would be valuable even on paper — and identify the rules that govern them.

For each use case, ask: *what nouns does this manipulate, and what rules govern those nouns?* Most use cases will refer to entities you've already named; some will introduce new ones.

A good entity:

- Has a name that comes from the business domain, not the technical stack. `Loan`, not `LoanRecord`. `Patient`, not `PatientDTO`.
- Holds the data necessary for the rules to operate (`balance`, `rate`, `term`).
- Holds the *rules* that must be true regardless of how the system is built (`balance >= 0`, `applyPayment()` cannot make an expired loan active).
- Has no references to anything technical — no `@Entity`, no `extends Model`, no annotations from a persistence framework, no logging, no IDs that smell of databases (auto-increment keys are an implementation choice; the entity should know about *identity*, not specifically about an integer column).

**Critical Business Data** is the data inside the entity that would still need to exist if the system were a paper ledger. **Critical Business Rules** are the rules that would be true even on paper. Together, they're the most stable, most reusable code in the system. Pour care into them.

**Output of this stage**: a list of entities, each with its data and the rules that govern it. No code yet — sketches, plain text, or class diagrams.

## Stage 3 — Sketch the use-case interactors

**Goal**: for each use case from Stage 1, describe the *interactor* — the object that orchestrates entities to accomplish the use case — at the level of inputs, outputs, and the dependencies it needs from the outside world.

For each use case, write down:

- **Input request structure**: what data the use case needs to start. A plain DTO. No `HttpRequest`, no session, no framework type.
- **Output response structure**: what data the use case produces. Also a plain DTO.
- **Steps**: the sequence of actions, expressed in terms of entities and abstract gateways.
- **Required ports**: the interfaces the use case needs from outside — a `CustomerRepository` to load and save, an `EmailGateway` to notify, a `Clock` to read the current time. **These interfaces live with the use case**, not with their implementations.

Example sketch:

```
UseCase: RegisterNewCustomer
Input: { name, email, address }
Output: { customerId, registeredAt }
Required ports:
  - CustomerRepository.findByEmail(email) -> Customer | null
  - CustomerRepository.save(customer) -> void
  - Clock.now() -> Instant
  - EmailGateway.sendWelcome(customer) -> void
Steps:
  1. Validate input shape (request DTO has its own validators, not framework ones)
  2. CustomerRepository.findByEmail(email); if exists, return Conflict
  3. Construct Customer entity (entity validates business rules)
  4. CustomerRepository.save(customer)
  5. EmailGateway.sendWelcome(customer)  (best-effort, may be async; don't fail use case)
  6. Return { customerId, registeredAt: clock.now() }
```

**Output of this stage**: one sketch per use case. Notice that you've now identified every interface the system will need — every gateway, every clock, every external integration — without specifying what implements them.

## Stage 4 — Defer details deliberately

**Goal**: list the technical decisions that don't need to be made yet, and consciously defer them.

Walk through these questions. For each, write the answer **and** the latest moment you must commit:

- Database? *Defer.* The entities and use cases don't care. You'll need a `Repository` implementation eventually; it can target SQL, NoSQL, flat files, or in-memory hashmap.
- Web framework? *Defer.* The use cases don't know they're called over HTTP. They might be called from a CLI in the meantime.
- UI? *Defer.* The use cases produce response DTOs. A presenter — written later — converts them into whatever shape the UI wants.
- DI framework? *Defer.* Construct dependencies manually in `main` until / unless the project grows enough to need automated wiring.
- Message broker / queue? *Defer.* Cross-component messages can be in-process method calls until you have a deployment-level reason to externalize.
- Cloud provider? *Defer.* Run on whatever the developers have locally. Cloud is a deployment detail.
- Authentication provider? *Defer.* The use case knows there's a *currently authenticated user*; how that's established is an outer-layer concern.

**Output**: a written list of deferred decisions, each with the conditions under which you'd revisit it. Put this list in a `DECISIONS.md` or ADR (Architecture Decision Record) folder. Re-read it before sprint planning.

## Stage 5 — Draw the boundaries and pick decoupling modes

**Goal**: decide which components exist and how strongly each pair is decoupled.

Group your use cases and entities into components along **axes of change** (CCP). Common partitions:

- A component per bounded context / business sub-domain (`accounts`, `billing`, `notifications`).
- A component for cross-cutting concerns that genuinely don't change with the domain (`audit`, `auth-policy`).
- A separate component for adapters to *each* significant external system (one per database, one per third-party API).

For each pair of components, pick a **decoupling mode** (see `boundaries.md`):

- **Source-level** (single binary, modules): the default. Use unless there's a specific reason not to.
- **Deployment-level** (separate jars / DLLs / packages): if independent release cadences matter.
- **Process-level**: if fault isolation matters and the latency cost is acceptable.
- **Service-level**: only if independent scaling, independent deployment, or genuinely separate teams justify the operational overhead.

Resist the urge to default to services. The cost is real and the gains are often imaginary. **Start as a monolith with strong internal source-level boundaries.** Promote individual seams to stronger modes as evidence accumulates.

**Output**: a component diagram (text, Mermaid, or sketch). Each node is a component; each arrow is a dependency, pointing from less stable to more stable. Verify it's acyclic. Verify each arrow points toward more abstract / more stable code.

## Stage 6 — Plan the directory layout and Main

**Goal**: a concrete starter layout that screams the domain, plus a Main component plan.

For directory layout, prefer **package by component** (see Simon Brown's "Missing Chapter" / `clean-architecture-layers.md`):

```
project-root/
├── customers/          ← business component
│   ├── usecase/
│   ├── entity/
│   ├── port/           ← interfaces consumed by use cases
│   └── adapter/        ← implementations of those interfaces (or one adapter dir up)
├── billing/            ← another business component
│   └── ...
├── shared-kernel/      ← shared domain types, only if truly cross-cutting
├── infrastructure/     ← adapter implementations grouped by external system
│   ├── postgres/
│   ├── mailgun/
│   └── stripe/
├── web/                ← controllers + view models + framework wiring
└── main/               ← entry points: dev, prod, test fixtures
```

The exact names depend on your domain. The constraint is that the **top-level folders read like the business**, not like the framework.

For **Main**, plan:

- One Main per deployment (dev, staging, prod, per-region, per-customer if needed).
- All concrete construction lives here. All `new ConcreteThing()` and DI-container registration calls live here.
- Main reads config, builds adapters, injects them into use cases, hands control to the entry point (HTTP server start, CLI dispatcher, scheduler, etc.).
- Main is allowed to know about everything. Nothing else is allowed to know about Main.

**Output of this stage**: a starter directory structure, a stubbed Main, and a rough list of which interfaces will need concrete implementations before "hello world" works.

## Stage 7 — Write the first vertical slice

Now, finally, write code. Pick **one** use case — usually the simplest happy-path flow — and implement it end-to-end:

1. Entity with its rules (and unit tests of those rules — no DB, no framework).
2. Use case interactor, calling the entity and using mocked ports (and unit tests of the interactor with mocked ports).
3. In-memory implementations of the ports (so the use case can run in a test).
4. The simplest possible presenter and controller.
5. Wire it all up in Main.
6. End-to-end smoke test that exercises the whole vertical slice.

This first slice is the architectural sanity check. If implementing it reveals friction in any of the prior stages — entities are wrong, ports are wrong, boundaries are wrong — **revise the plan, not the slice**. The slice should fall out cleanly from the architecture; if it doesn't, the architecture is wrong.

After the first slice works, the rest of the use cases mostly just slot in.

## Common pitfalls during greenfield architecture

- **"We'll add the boundaries later when we need them."** You almost certainly won't — adding architectural boundaries to a codebase that's grown without them is one of the most expensive things you can do.
- **"This is just a prototype, none of this matters."** Every successful prototype becomes a product. The cost of architecture during the prototype phase is small; the cost of *not* having it once the prototype ships is enormous.
- **"The framework gives us the structure already."** It gives you *its* structure, optimized for *its* concerns, not yours. That's exactly the trap to avoid.
- **"We need to decide on the database first because of the schema."** No. Sketch the data model in domain terms. The schema is a translation that happens later.
- **"Premature abstraction is bad."** True at the function and class level. Less true at the architectural level — *premature concretion* (binding the system to a specific database, framework, or topology before you have to) is a vastly bigger trap than premature abstraction.

## Output checklist

Before letting the user start coding the second use case, confirm:

- [ ] Use cases written without technical vocabulary.
- [ ] Entities named and rules listed.
- [ ] Each use case has a sketch with input DTO, output DTO, and required ports.
- [ ] A list of deferred decisions exists, with revisit conditions.
- [ ] Components and dependency arrows drawn; graph is acyclic.
- [ ] Directory layout screams the domain.
- [ ] Main component planned.
- [ ] One vertical slice working end-to-end with tests.

If any of these is missing, fix it before going further. The cost of correction grows fast.
