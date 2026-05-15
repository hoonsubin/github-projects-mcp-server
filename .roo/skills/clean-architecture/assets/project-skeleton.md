# Project Skeleton — A Starter Directory Layout

A reference layout for a new clean-architecture project, **packaged by component** rather than packaged by layer. Adapt names and depth to your domain.

**Principles encoded:** top level screams the domain; each business component is self-contained (entity + use case + port + adapter as siblings); infrastructure is grouped by external system, not layer; Main is segregated with one per deployment.

## The layout

```text
project-root/
│
├── README.md
├── ARCHITECTURE.md              ← short doc explaining the layout & rules
│
├── customers/                   ← business component (replace with your domain)
│   ├── domain/                  ← Entities + critical business rules
│   │   └── customer.<ext>
│   ├── usecase/                 ← Application-specific business rules
│   │   ├── register_customer.<ext>
│   │   └── deactivate_customer.<ext>
│   └── port/                    ← Interfaces the use cases depend on
│       ├── customer_repository.<ext>
│       └── notification_gateway.<ext>
│
├── billing/                     ← another business component
│   ├── domain/
│   ├── usecase/
│   └── port/
│
├── shared_kernel/               ← OPTIONAL — only for genuinely cross-domain primitives
│   ├── money.<ext>
│   ├── identifier.<ext>
│   └── clock.<ext>
│
├── infrastructure/              ← Concrete adapter implementations, grouped by EXTERNAL SYSTEM
│   ├── postgres/
│   │   ├── customer_repository_postgres.<ext>
│   │   └── invoice_repository_postgres.<ext>
│   ├── stripe/
│   │   └── payment_gateway_stripe.<ext>
│   └── system/
│       └── system_clock.<ext>
│
├── web/                         ← Web delivery (controllers, presenters, view models)
│   ├── customers/
│   │   ├── customer_controller.<ext>
│   │   └── customer_presenter.<ext>
│   └── routes.<ext>
│
├── main/                        ← Wiring: one entry per deployment
│   ├── dev_main.<ext>           ← in-memory repos, fake gateways
│   ├── prod_main.<ext>          ← postgres + stripe + sendgrid
│   └── test_main.<ext>          ← deterministic clock, test fixtures
│
└── tests/
    ├── customers/
    │   ├── unit/                ← entity + use case tests, no I/O
    │   └── integration/         ← tests that need real adapters
    └── e2e/                     ← whole-system smoke tests via Main
```

## Allowed dependency directions

Read as: **a folder may import from folders below it in this list, never above.**

```text
1.  shared_kernel/                ← most stable, most depended on
2.  <feature>/domain/             ← depends only on shared_kernel
3.  <feature>/port/               ← depends on its own domain
4.  <feature>/usecase/            ← depends on its own domain + ports
5.  infrastructure/<external>/    ← depends on the ports it implements
6.  web/, cli/ (delivery)         ← depends on use cases
7.  main/                         ← depends on EVERYTHING; the only place that does
```

## What goes where — quick lookup

| Code that does this...                                 | ...lives here                  |
| ------------------------------------------------------ | ------------------------------ |
| Holds a business invariant ("balance ≥ 0")             | `<feature>/domain/`            |
| Orchestrates a workflow ("apply payment")              | `<feature>/usecase/`           |
| Declares an interface used by a use case               | `<feature>/port/`              |
| Implements an interface using a database               | `infrastructure/<db>/`         |
| Implements an interface using an HTTP API              | `infrastructure/<service>/`    |
| Parses HTTP request, calls use case, formats response  | `web/<feature>/`               |
| Boots the app, builds adapters, injects, starts server | `main/`                        |
| Test for a domain rule (no I/O)                        | `tests/<feature>/unit/`        |
| Test for an adapter against the real external system   | `tests/<feature>/integration/` |
| Smoke test of the whole system                         | `tests/e2e/`                   |
| A type used across multiple business components        | `shared_kernel/` (sparingly)   |

## What does NOT go here

| Anti-pattern                        | Why                                          | Where it belongs instead                                             |
| ----------------------------------- | -------------------------------------------- | -------------------------------------------------------------------- |
| `utils/` or `helpers/` at top level | Becomes a dumping ground                     | `shared_kernel/` if truly cross-domain, otherwise the feature folder |
| `models/` at top level              | Conflates entities with ORM types            | Entities → `<feature>/domain/`; ORM types → `infrastructure/<db>/`   |
| `services/` at top level            | Where logic hides when there's no clear home | Entity method or use case interactor                                 |

## Language-specific notes

| Language      | Component =              | Dependency enforcement                                          |
| ------------- | ------------------------ | --------------------------------------------------------------- |
| Java/Kotlin   | Maven/Gradle module      | ArchUnit tests; `package-private` for internals                 |
| C#/.NET       | Solution project         | `internal` keyword; project-reference rules                     |
| Python        | Package (`__init__.py`)  | `import-linter` or custom pylint plugin                         |
| TypeScript/JS | npm/yarn workspace       | `eslint-plugin-import` with `no-restricted-paths`; Nx/Turborepo |
| Go            | Package under one module | Convention + reviews; `go-cleanarch`, `golangci-lint`           |
| Rust          | Crate in a workspace     | `Cargo.toml` dependency declarations enforce the rule           |

## How to start

**New project:** copy the structure, rename `customers/` and `billing/` to your domain, implement one fully-vertical use case before adding the second.

**Existing project (strangler):** add the clean structure for the first migrated slice alongside the existing layout. Old code stays in place; new slices appear in clean form; retire the old structure piece by piece.

## ARCHITECTURE.md — what to include

- The Dependency Rule as it applies to this project
- Which directories belong to which layer
- List of components with one-line descriptions
- Ports each component exposes (interface names only)
- How to add a new use case (the happy path for contributors)
- How to add a new adapter (wiring up a new external system)
- How the Dependency Rule is enforced (which tool fails the build on violation)
