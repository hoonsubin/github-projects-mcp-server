# Workflow - Starting a New Project (Greenfield)

Use when no code exists yet. Resist the urge to pick a stack and run `rails new` - that lets the framework choose the architecture.

## Stage 1 - Establish the use cases (before anything technical)

Write a list of use cases in business language - no UI, no DB, no framework, no protocol.

Bad: _"User submits POST to /api/users; controller validates and writes to the users table."_
Good: _"A new customer provides identity and contact info; the system verifies uniqueness, records the customer, and returns confirmation."_

If you can't write a use case without naming a technology, you don't yet understand the use case.

**Output:** 5–30 use cases in business language.

## Stage 2 - Identify entities and critical business rules

For each use case, ask: _what nouns does this manipulate, and what rules govern those nouns?_

A good entity has a domain name (`Loan`, not `LoanRecord`), holds the data and rules that would exist on paper, and has **no technical references** - no ORM annotations, no logging, no auto-increment IDs.

**Output:** list of entities with their data and governing rules. Sketches or plain text - no code yet.

## Stage 3 - Sketch the use-case interactors

For each use case, write:

- **Input DTO:** data the use case needs to start (no `HttpRequest`, no session, no framework type)
- **Output DTO:** data it produces (no JSON, no framework type)
- **Steps:** in terms of entities and abstract gateways
- **Required ports:** interfaces the use case needs - these **live with the use case**, not with their implementations

```text
UseCase: RegisterNewCustomer
Input:  { name, email, address }
Output: { customerId, registeredAt }
Ports:  CustomerRepository.findByEmail, CustomerRepository.save, Clock.now, EmailGateway.sendWelcome
Steps:
  1. Validate input shape
  2. findByEmail → if exists, return Conflict
  3. Construct Customer entity (entity validates business rules)
  4. save(customer)
  5. sendWelcome(customer) - best-effort, async ok; don't fail use case
  6. Return { customerId, registeredAt }
```

**Output:** one sketch per use case; every interface the system needs identified without specifying any implementation.

## Stage 4 - Defer details deliberately

For each of the following, write the answer ("defer") and the _latest moment you must commit_:

Database, web framework, UI, DI framework, message broker, cloud provider, auth provider - all defer. Use cases don't know they're called over HTTP; entities don't know how they're persisted.

Put this list in `DECISIONS.md` or an ADR folder. Re-read it before sprint planning.

## Stage 5 - Draw the boundaries and pick decoupling modes

Group use cases and entities into components along **axes of change** (CCP). Common partitions: one component per business sub-domain; one per cross-cutting concern; one adapter per external system.

For each pair of components, pick a decoupling mode (see `boundaries.md`). Default: source-level inside a monolith. Resist defaulting to services.

**Output:** an acyclic component diagram where arrows point toward more stable/abstract code. Verify no cycles.

## Stage 6 - Plan the directory layout and Main

Prefer **package by component** (see `assets/project-skeleton.md`): top-level folders name business domains; layers live as siblings inside each folder.

Plan Main: one per deployment, all concrete construction lives here, inner layers never import Main.

## Stage 7 - Write the first vertical slice

Now write code. Pick the simplest happy-path use case and implement end-to-end:

1. Entity + unit tests (no DB, no framework)
2. Use case interactor + unit tests with mocked ports
3. In-memory port implementations
4. Simplest presenter and controller
5. Wire in Main
6. End-to-end smoke test

The first slice is the architectural sanity check. If it reveals friction, **revise the plan, not the slice**.

## Common pitfalls

- **"We'll add boundaries later."** Adding boundaries to a grown codebase is one of the most expensive things you can do.
- **"It's just a prototype."** Every successful prototype becomes a product. Architecture during the prototype phase is cheap; the cost of not having it once it ships is enormous.
- **"The framework gives us the structure."** It gives you _its_ structure, optimized for _its_ concerns.
- **"We need to decide the database first."** Sketch the data model in domain terms; the schema is a later translation.

## Output checklist

- [ ] Use cases written without technical vocabulary
- [ ] Entities named with data and rules listed
- [ ] Each use case has input DTO, output DTO, and required ports
- [ ] List of deferred decisions with revisit conditions
- [ ] Acyclic component diagram with arrows pointing toward stable/abstract code
- [ ] Directory layout screams the domain
- [ ] Main component planned
- [ ] One vertical slice working end-to-end with tests
