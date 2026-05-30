# Architecture - Module Boundaries & Clean Architecture in TypeScript

How to structure a TypeScript codebase so it stays cheap to change. Load this when the task is project structure, module design, dependency management, or an architecture audit. Clean Architecture's rules apply - but expressed in TypeScript's own mechanisms (modules, barrels, interfaces, structural typing) rather than generic layer diagrams.

## Contents
1. The one load-bearing rule
2. Project structure - feature slices
3. Module public APIs - barrels as encapsulation
4. Ports: interfaces belong to consumers
5. The composition root
6. Layer types and boundary mappers
7. Extension without modification
8. `tsconfig` and lint as architecture enforcement
9. Scaling the rules down
10. Cross-cutting concerns

---

## 1. The one load-bearing rule

**Source-code dependencies point inward, toward stable business policy, away from volatile detail.** Business/domain code must not import infrastructure (database client, HTTP framework, ORM, third-party SDK). A framework or database is a *detail* plugged in at the edge - not a foundation the domain rests on.

Everything else in this file is a technique for honoring that rule in TypeScript. When auditing, this is the first thing to check (anti-pattern A1): trace the imports of a core domain file - if any point at infrastructure, the architecture has a leak.

---

## 2. Project structure - feature slices

Organize the top level by **domain feature**, not by technical role. File-type folders (`/controllers`, `/services`, `/models`) scatter every feature across the tree and make the framework, not the product, the most visible thing (anti-pattern A2).

```
src/
  users/              ← a feature: self-contained
    user.ts                domain object / entity
    user.repository.ts     port (interface) - see §4
    user.service.ts        use-case orchestration
    user.controller.ts     delivery adapter (HTTP)
    user.mapper.ts         boundary mappers - see §6
    index.ts               curated public API - see §3
  orders/
    ...
  shared/             ← genuinely cross-cutting, dependency-free
    result.ts
    branded.ts
  infrastructure/     ← concrete adapters: DB, SMTP, etc.
    postgres/
      user.repository.impl.ts
  main.ts             ← composition root - see §5
```

The top-level listing should "scream" the domain. Within a feature, dependencies still point inward: `user.controller.ts` → `user.service.ts` → `user.ts`; `user.ts` imports none of them.

---

## 3. Module public APIs - barrels as encapsulation

TypeScript has no `package-private` keyword. A module's `index.ts` (barrel) substitutes for one: what it exports is public; what it does not is module-private.

```typescript
// users/index.ts - THE public API of the users feature
export type { User, CreateUserDto } from "./user";
export type { UserRepository } from "./user.repository"; // the port
export { UserService } from "./user.service";
// user.repository.impl is NOT exported - implementation detail
// user.mapper is NOT exported - internal
```

Other features import only from the barrel (`from "../users"`), never deep paths (`from "../users/user.repository.impl"`). `export *` defeats the purpose - it republishes everything, including internals (anti-pattern A3). A barrel is a *curated* surface. Enforce with ESLint `no-restricted-imports` or `import/no-internal-modules` (§8).

---

## 4. Ports: interfaces belong to consumers

The Dependency Inversion Principle in TypeScript terms: **the interface for a dependency is declared in the module that needs it, not the module that implements it.**

```typescript
// users/user.repository.ts  - declared in the DOMAIN feature (the consumer)
export interface UserRepository {
  findById(id: UserId): Promise<User | null>;
  save(user: User): Promise<User>;
}

// users/user.service.ts - depends only on its own port
export class UserService {
  constructor(private readonly users: UserRepository) {}   // injected
  async getUser(id: UserId): Promise<User> {
    const u = await this.users.findById(id);
    if (!u) throw new UserNotFoundError(id);
    return u;
  }
}

// infrastructure/postgres/user.repository.impl.ts - the IMPLEMENTER imports the port
import type { UserRepository } from "../../users/user.repository";
export class PostgresUserRepository implements UserRepository { /* ... */ }
```

The dependency arrow now runs `infrastructure → domain`. The domain never names Postgres. If the port were instead declared inside the Postgres module and imported up into the domain, the arrow would reverse and the rule would break (anti-pattern A5).

Structural typing helps: `PostgresUserRepository` satisfies `UserRepository` purely by shape - no nominal coupling, and a test fake satisfies it the same way with no inheritance.

---

## 5. The composition root

Exactly one place constructs concrete implementations and wires them together - typically `main.ts`. It is the only file permitted to import infrastructure classes.

```typescript
// main.ts - the ONLY file that imports concretions
import { PostgresUserRepository } from "./infrastructure/postgres/user.repository.impl";
import { UserService } from "./users";

const db = new PostgresConnection(env.DB_URL);
const userService = new UserService(new PostgresUserRepository(db));
// ...wire the rest, then start the app
```

Everywhere else depends on interfaces and receives instances by constructor injection. A `new ConcreteInfraThing()` anywhere outside the composition root is the smell (anti-pattern A6) - it hides a dependency and blocks substitution. Tests have their own tiny composition root that injects in-memory fakes. Multiple roots (prod, dev, test, per-region) are fine - they are plugins to the application, not its core.

No DI *framework* is required: plain constructor injection wired by hand in `main.ts` is the idiomatic TypeScript approach and keeps the wiring explicit and greppable.

---

## 6. Layer types and boundary mappers

The same concept has different shapes at different layers. Give each its own type and convert explicitly at the boundary - do not let one type travel through all layers (anti-pattern A9).

```typescript
interface UserRow {          // persistence shape - snake_case, SQL strings
  user_id: string; email_address: string; created_at: string;
}
interface User {             // domain shape - branded ids, value objects, Date
  readonly id: UserId; readonly email: Email; readonly createdAt: Date;
}
interface UserResponse {     // transport shape - JSON-friendly
  id: string; email: string; createdAt: string;
}

const toDomain = (r: UserRow): User => ({
  id: UserId(r.user_id), email: Email(r.email_address), createdAt: new Date(r.created_at),
});
const toResponse = (u: User): UserResponse => ({
  id: u.id, email: u.email, createdAt: u.createdAt.toISOString(),
});
```

This is the Humble Object pattern: the hard-to-test edge (SQL, HTTP) is kept thin; the mappers and domain are pure and tested directly. The payoff is compile-time safety - rename a DB column and every mapper that touches it fails to compile, pointing at exactly what must change. One type spanning all layers means a storage rename silently reshapes your API.

---

## 7. Extension without modification

Make a system extensible without editing existing code (OCP):

- **Registry** - for "new kinds of X keep appearing" (export formats, payment processors, validators). A new kind is a new module + one `register` call at the composition root. (Pattern in `paradigms.md`.)
- **Middleware / hook pipeline** - for "behavior needs to wrap an operation" (logging, retry, auth, discounts). Each extension is a plain function `(input, next) => ...`; compose them in a list. Prefer this over a base class with overridable `protected` hooks (anti-pattern P10) - no inheritance coupling, each step independently testable.
- **Strategy injection** - for "this one decision varies". Inject an interface (or a function) rather than branching on a type tag inside the unit.

The test: adding the next variant should mean adding a file and one wiring line - not editing a `switch`, a base class, or the consumer.

---

## 8. `tsconfig` and lint as architecture enforcement

Architecture that is not enforced erodes. Make the tooling hold the line.

`tsconfig.json` - assume and require:

```jsonc
{
  "compilerOptions": {
    "strict": true,                       // the non-negotiable baseline
    "noUncheckedIndexedAccess": true,     // arr[i] is T | undefined - kills T4
    "noImplicitOverride": true,           // override must be explicit
    "noFallthroughCasesInSwitch": true,
    "exactOptionalPropertyTypes": true,   // { x?: T } is not { x: T | undefined }
    "verbatimModuleSyntax": true          // explicit type-only imports
  }
}
```

A project missing `strict` (or only partially strict) is itself an architecture finding - report it; retrofitting strictness later is far costlier than starting with it.

ESLint - rules that enforce the rules in this file:
- `@typescript-eslint/no-explicit-any`, `no-non-null-assertion` - type honesty (T1, T2).
- `import/no-cycle` - no circular dependencies (A4).
- `import/no-internal-modules` / `no-restricted-imports` - barrel boundaries (A3).
- An import-boundary rule (e.g. `eslint-plugin-boundaries`) - to forbid domain→infrastructure imports outright (A1, A5).
- `@typescript-eslint/explicit-module-boundary-types` - honest public signatures.

`madge --circular` in CI catches dependency cycles the linter misses.

---

## 9. Scaling the rules down

These techniques scale to project size. A 150-line script does not need feature folders, ports, mappers, and a formal composition root - imposing them is its own anti-pattern (P12, ceremony without payoff).

What holds at *every* size: dependencies point inward (logic does not depend on I/O); types are honest; illegal states are unrepresentable. What scales *with* size: the number of named layers, the formality of ports and DI, the strictness of barrel boundaries.

Judge by change pressure, not dogma. Introduce a seam when something is about to vary or needs to be tested in isolation - and when stakeholders push a structural shortcut ("just put it in the controller", "we'll split it later"), name the concrete cost: the feature that will become expensive, the test that will need a real database.

---

## 10. Cross-cutting concerns

Logging, authentication, validation, and error handling span every feature. The architectural question is: where do they live, and how do they connect without coupling everything together?

### Logging

Inject a typed logger interface, never import a concrete logger inside domain or service code (anti-pattern A7). The interface is minimal - only what the domain actually needs:

```typescript
// shared/logger.ts - the port
interface Logger {
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, error?: Error, context?: Record<string, unknown>): void;
}

// Services receive it via constructor - never import the concrete logger
class OrderService {
  constructor(
    private readonly orders: OrderRepository,
    private readonly logger: Logger,
  ) {}
}

// Tests inject a no-op or capturing logger
class NoopLogger implements Logger {
  info() {} warn() {} error() {}
}
class CapturingLogger implements Logger {
  readonly entries: Array<{ level: string; message: string }> = [];
  info(msg: string) { this.entries.push({ level: "info", message: msg }); }
  // ...
}
```

The composition root injects the real structured logger (Pino, Winston) only there.

### Authentication and authorisation

Auth is a delivery concern - it belongs in the controller/adapter layer, not in services or domain. The service receives an already-authenticated identity, not a raw HTTP request:

```typescript
// ❌ Service knows about HTTP - couples domain to delivery
class OrderService {
  async placeOrder(req: Request): Promise<Order> {
    const userId = req.session.userId; // HTTP leaking into domain
    // ...
  }
}

// ✅ Controller resolves identity; service receives a typed value
type AuthenticatedUser = { userId: UserId; roles: Role[] };

class OrderService {
  async placeOrder(user: AuthenticatedUser, dto: PlaceOrderDto): Promise<Order> {
    // ...
  }
}

// Controller (delivery layer)
app.post("/orders", requireAuth, async (req, res) => {
  const user = req.user as AuthenticatedUser; // resolved by middleware
  const result = await orderService.placeOrder(user, req.body);
  res.json(toResponse(result));
});
```

Authorisation rules that are domain logic ("a user can only cancel their own orders") belong in the domain or service. Authorisation rules that are purely structural ("only admins can access this route") belong in middleware.

### Input validation

Validate at the system boundary - the HTTP controller or the queue consumer - not inside services or domain logic. The service should receive data that is already validated and typed:

```typescript
import { z } from "zod"; // or Valibot, ArkType

const PlaceOrderSchema = z.object({
  items: z.array(z.object({ sku: z.string(), quantity: z.number().int().positive() })),
  shippingAddress: AddressSchema,
});

app.post("/orders", requireAuth, async (req, res) => {
  const parsed = PlaceOrderSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());

  // From here down, the data is typed and trusted
  const result = await orderService.placeOrder(req.user, parsed.data);
  res.json(toResponse(result));
});
```

This keeps services free of HTTP-specific validation code and makes the boundary between "untrusted input" and "domain data" explicit and compiler-visible.

### Error handling at the boundary

Domain errors (`Result<T, E>`) are handled at the controller - translated to HTTP status codes. Unhandled exceptions (programmer errors) are caught by a global error handler:

```typescript
// Controller - translates domain errors to HTTP
app.post("/orders", requireAuth, async (req, res, next) => {
  try {
    const result = await orderService.placeOrder(req.user, dto);
    if (!result.success) {
      // typed domain error → HTTP status
      const status = result.error === "INSUFFICIENT_STOCK" ? 409 : 422;
      return res.status(status).json({ error: result.error });
    }
    res.status(201).json(toResponse(result.value));
  } catch (e) {
    next(e); // unhandled (programmer error) → global handler
  }
});

// Global handler - logs and responds generically
app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  const message = err instanceof Error ? err.message : String(err);
  logger.error("Unhandled error", err instanceof Error ? err : undefined);
  res.status(500).json({ error: "Internal server error" });
});
```

The global handler never leaks stack traces or internal error details. The controller-level handler is where typed domain errors become specific HTTP responses. Services and domain objects never `res.json()` - they return typed values.
