# Project Skeleton — A Starter Directory Layout

A reference layout for a new clean-architecture project, **packaged by component** (per Simon Brown's "Missing Chapter") rather than packaged by layer. This is a *starting* point, not a template to copy verbatim — adapt names and depth to your domain.

## Principles encoded in this layout

1. **Top level screams the domain.** If you `ls` the root, the folder names should tell you what business the system is in. Frameworks are not visible at the top level.
2. **Each business component is self-contained.** Inside a component you find its entities, its use cases, its ports, and its adapter implementations — siblings, not separated by framework concern.
3. **The Dependency Rule is enforced by directory layout.** Inner-layer folders are siblings of outer-layer folders, but only outer folders import from inner. Static analysis or access modifiers should make violations visible.
4. **Main is segregated.** Wiring lives in one place. Multiple Mains for multiple deployments.
5. **Infrastructure is grouped by external system.** Adapters that talk to Postgres live together. Adapters that talk to Stripe live together. Not "all repositories in one folder, all clients in another".

## The layout

```
project-root/
│
├── README.md
├── ARCHITECTURE.md              ← short doc explaining the layout & rules
│
├── customers/                   ← business component (replace with your domain)
│   ├── domain/                  ← Entities + critical business rules
│   │   ├── customer.<ext>
│   │   └── customer_status.<ext>
│   ├── usecase/                 ← Application-specific business rules
│   │   ├── register_customer.<ext>
│   │   ├── deactivate_customer.<ext>
│   │   └── list_active_customers.<ext>
│   └── port/                    ← Interfaces the use cases depend on
│       ├── customer_repository.<ext>
│       └── notification_gateway.<ext>
│
├── billing/                     ← another business component
│   ├── domain/
│   │   ├── invoice.<ext>
│   │   ├── line_item.<ext>
│   │   └── tax_rule.<ext>
│   ├── usecase/
│   │   ├── calculate_invoice.<ext>
│   │   └── apply_payment.<ext>
│   └── port/
│       ├── invoice_repository.<ext>
│       └── payment_gateway.<ext>
│
├── orders/                      ← yet another business component
│   └── ...
│
├── shared_kernel/               ← OPTIONAL — only for genuinely cross-domain primitives
│   ├── money.<ext>              ← e.g., a Money value type used by billing AND orders
│   ├── identifier.<ext>
│   └── clock.<ext>              ← Clock port used widely
│
├── infrastructure/              ← Concrete adapter implementations
│   │                              (grouped by EXTERNAL SYSTEM, not by layer)
│   ├── postgres/
│   │   ├── customer_repository_postgres.<ext>   ← implements customers/port/CustomerRepository
│   │   ├── invoice_repository_postgres.<ext>    ← implements billing/port/InvoiceRepository
│   │   └── migrations/
│   ├── stripe/
│   │   └── payment_gateway_stripe.<ext>         ← implements billing/port/PaymentGateway
│   ├── sendgrid/
│   │   └── notification_gateway_sendgrid.<ext>  ← implements customers/port/NotificationGateway
│   └── system/
│       └── system_clock.<ext>                   ← implements shared_kernel/Clock
│
├── web/                         ← Web delivery layer (controllers, presenters, view models)
│   ├── customers/
│   │   ├── customer_controller.<ext>
│   │   └── customer_presenter.<ext>
│   ├── billing/
│   │   ├── invoice_controller.<ext>
│   │   └── invoice_presenter.<ext>
│   └── routes.<ext>             ← URL → controller mapping. Framework lives here.
│
├── cli/                         ← Optional alternate delivery (CLI commands)
│   └── ...
│
├── main/                        ← Wiring: one entry per deployment
│   ├── dev_main.<ext>           ← uses in-memory repositories, fake gateways
│   ├── prod_main.<ext>          ← uses postgres + stripe + sendgrid
│   └── test_main.<ext>          ← test fixtures, deterministic clock
│
└── tests/                       ← Tests follow the same component shape
    ├── customers/
    │   ├── unit/                ← entity + use case tests, no I/O
    │   └── integration/         ← tests that need real adapters
    ├── billing/
    │   └── ...
    └── e2e/                     ← whole-system smoke tests via Main
```

## Allowed dependency directions

Read this as: **a folder may import from folders below it in this list, never above.**

```
1.  shared_kernel/                      ← most stable, most depended on
2.  <feature>/domain/                   ← depends only on shared_kernel
3.  <feature>/port/                     ← depends on its own domain (rarely shared_kernel)
4.  <feature>/usecase/                  ← depends on its own domain + ports
5.  infrastructure/<external>/          ← depends on the ports it implements
6.  web/, cli/, etc. (delivery)         ← depends on use cases (input ports)
7.  main/                                ← depends on EVERYTHING. The only place that does.
```

A use case **never** imports from `infrastructure/`, `web/`, or `main/`. An entity **never** imports from anywhere except possibly `shared_kernel/`. Main imports from everywhere — that's its job.

## Notes on common variations

- **Single-language conventions.** Translate `<ext>` to your language: `.py`, `.ts`, `.rs`, `.go`, `.cs`, `.kt`, `.java`. The file naming convention follows your language's idioms (snake_case in Python and Rust; PascalCase files in C# and Java; camelCase in JS/TS).

- **For Rust**, components are usually crates inside a workspace. Each business component is one crate; `infrastructure/<system>` is one crate per external system; `main` is one or more bin crates. The Dependency Rule is enforced by the crate dependency declarations in `Cargo.toml`.

- **For Python**, components are packages. Use absolute imports. Consider `pylint`'s `--good-names` plus a custom `pylint` plugin or `import-linter` to enforce dependency rules. `__init__.py` files are minimal — just exporting the public surface.

- **For Java/Kotlin**, components map to Maven/Gradle modules. Use ArchUnit to encode the Dependency Rule as a test that fails the build on violations. Inside a module, use `package-private` to hide implementation classes — only the use cases and ports should be `public`.

- **For Go**, the layout above maps well to packages. Use `go mod` if you split components into separate modules; otherwise keep them as siblings under one module and rely on convention + reviews. Tools: `go-cleanarch`, `golangci-lint` with import rules.

- **For TypeScript/JavaScript**, use `eslint-plugin-import` with `import/no-restricted-paths` to encode dependency rules. For larger projects, use Nx, Turborepo, or yarn workspaces to make components actual packages.

- **For C#/.NET**, components are projects in a solution; project-reference rules enforce dependency direction. Use `internal` aggressively — only the contract surface needs to be `public`.

## What goes where — quick lookup

| Code that does this... | ...lives here |
|---|---|
| Holds a business invariant ("balance ≥ 0") | `<feature>/domain/` |
| Orchestrates a workflow ("apply payment") | `<feature>/usecase/` |
| Declares an interface used by a use case | `<feature>/port/` |
| Implements an interface using a database | `infrastructure/<db>/` |
| Implements an interface using an HTTP API | `infrastructure/<service>/` |
| Parses an HTTP request, calls a use case, formats the response | `web/<feature>/` |
| Boots the app, builds adapters, injects them, starts the server | `main/` |
| Test for a domain rule (no I/O) | `tests/<feature>/unit/` |
| Test for an adapter against the real external system | `tests/<feature>/integration/` |
| Smoke test of the whole system | `tests/e2e/` |
| A type used across multiple business components | `shared_kernel/` (sparingly!) |

## What does not go in this skeleton

- **`utils/` or `helpers/` or `common/`** at the top level. These become dumping grounds. If something is genuinely shared, it's a domain primitive (`shared_kernel`) or it's an infrastructure concern (which file in `infrastructure/`?). Don't create a folder whose entry criterion is "I didn't know where else to put it".

- **`models/` at the top level.** "Models" usually conflates entities (domain-pure) and ORM-mapped data classes (framework-coupled). Keep them apart: entities go in `<feature>/domain/`; ORM types go in `infrastructure/<db>/`.

- **`services/` at the top level.** "Services" is usually where business logic ends up when there's no clear home. The clear home is either an entity (if it's a rule about a domain object) or a use case (if it's an orchestration of multiple objects). Pick one.

- **`config/`** for runtime settings can sit at the root, but it's read only by Main. It's not a layer.

- **`docs/`**, **`scripts/`**, **`build/`**, **`.github/`**: standard project hygiene, no architectural meaning. Fine at root.

## How to start using this layout

For a new project, copy the structure, rename `customers/` and `billing/` to your domain components, and start with one fully-vertical use case (entity + port + use case + adapter + controller + Main wiring + unit test) before adding the second.

For an existing project being strangled toward this shape (see `workflow-strangle.md`), don't reorganize the whole project up-front. Add the structure for the first migrated slice (e.g., `customers/`) alongside the existing layout. Old code stays where it is. New slices appear in clean form. Eventually the old structure can be retired piece by piece.

## ARCHITECTURE.md — what to put in the doc

A single page describing:

- The Dependency Rule as it applies here.
- Which directories belong to which layer.
- The list of components and a one-line description of each.
- The ports each component exposes (just the interface names).
- How to add a new use case (the "happy path" for new contributors).
- How to add a new adapter (the "I'm wiring up a new external system" path).
- How the Dependency Rule is enforced (which tool fails the build on violation).

This doc is what new developers read in their first hour. Keep it short.
