# Paradigms — OOP, Functional, and Choosing Between Them

TypeScript is multi-paradigm on purpose. This file covers the decision framework, the OOP toolkit, and the functional toolkit. Load it when a task involves choosing a paradigm, designing types/classes, or applying a pattern.

## Contents
1. The decision framework
2. OOP toolkit (SOLID, GoF patterns in TS)
3. Functional toolkit (purity, composition, Option/Result, HOFs, ADTs)
4. Imperative shell, functional core
5. Over-application warnings
6. Testing strategy

---

## 1. The decision framework

The root question, per unit of code: **what is most likely to change?** This is the Objects-vs-Data-Structures dichotomy used as a decision rule.

- **New variants keep appearing** (new shapes, new payment methods, new node kinds) → polymorphism. Adding a variant should be adding code, not editing existing code. Use an `interface` + implementations, or a discriminated union with exhaustive handlers.
- **New operations keep appearing** on a stable set of shapes → functional. Adding an operation is a new function; the data types do not change. Use plain data (`type` / `readonly` records) + pure functions.
- **Modeling domain state and transitions** → algebraic data types regardless of paradigm: discriminated unions for states, value objects for constrained values, total functions for transitions.
- **Module boundaries, dependency wiring, swappable infrastructure** → OOP-leaning: interfaces as ports, dependency injection, a composition root.
- **Business logic inside a boundary** → functional-leaning: pure functions, immutable data, effects pushed outward.

Adding *both* variants and operations freely is the Expression Problem; no single paradigm makes both free. Pick for the axis that will move most, and accept friction on the other.

**Default shape for a non-trivial project:** OOP-style boundaries wrapping a functional core (§4). Do not adopt a paradigm as an identity — decide per unit.

---

## 2. OOP toolkit

### SOLID in TypeScript

- **SRP** — one reason to change. Describe the unit; if you need "and", split it.
- **OCP** — extend by adding code, not editing existing code. In TypeScript this is often a `Record`-keyed lookup or a registry, not necessarily an `abstract class`.
- **LSP** — a subtype must be substitutable for its base without surprising callers. The `Square extends Rectangle` trap: model `Shape` with separate `Rectangle` and `Square` implementations instead.
- **ISP** — many small interfaces over one fat one. Split `UserRepository` into `UserReader` and `UserWriter` so a read-only consumer does not depend on writes. TypeScript's structural typing makes a class satisfy several small interfaces at once for free.
- **DIP** — depend on abstractions; the interface lives with the consumer (see `architecture.md`).

### Encapsulation

Expose behavior, hide representation. Not this:

```typescript
class Account { private _balance = 0;
  get balance() { return this._balance; }
  set balance(v: number) { this._balance = v; } } // public field with ceremony
```

But meaningful operations that enforce invariants:

```typescript
class Account {
  private balance: number;
  constructor(initial: number) {
    if (initial < 0) throw new Error("initial must be >= 0");
    this.balance = initial;
  }
  deposit(amount: number): void {
    if (amount <= 0) throw new Error("amount must be positive");
    this.balance += amount;
  }
  getBalance(): number { return this.balance; } // observe, cannot mutate
}
```

### GoF patterns — the ones that earn their place in TS

**Factory** — a function (or a `Record<Key, () => T>` map), rarely an abstract-factory class.
**Builder** — a fluent `this`-returning class to replace a telescoping constructor; or just an options object if there is no multi-step construction.
**Strategy** — inject an interface implementation; the functional equivalent is injecting a function. Prefer this over subclassing to vary behavior (anti-pattern P10).
**Adapter** — wrap a third-party shape to satisfy your interface; the boundary mapper that keeps external types from leaking inward.
**Decorator** — wrap an object (or a function — see HOFs §3) to add behavior without modifying it.
**Observer** — a typed `EventEmitter<EventMap>` where the event-name → payload mapping is enforced by the type system (template-literal keys work well here).
**Command** — encapsulate a request as an object to enable undo/queue/log.

**Singleton** is usually unnecessary in TypeScript: a module is already a singleton. A `const` exported from a module gives one instance with no `getInstance()` ceremony. If the "singleton" holds mutable state or does I/O, do not make it a singleton at all — inject it (anti-pattern A7).

A registry replaces a growing `switch` for OCP:

```typescript
interface ExportStrategy { readonly format: string; export(r: Report): Promise<Buffer>; }

class ExportRegistry {
  private readonly strategies = new Map<string, ExportStrategy>();
  register(s: ExportStrategy): void { this.strategies.set(s.format, s); }
  get(format: string): ExportStrategy {
    const s = this.strategies.get(format);
    if (!s) throw new Error(`no strategy for ${format}`);
    return s;
  }
}
```

A new format is a new class plus one `register` call at the composition root — no existing code changes.

---

## 3. Functional toolkit

### The three constraints

- **Pure** — output depends only on inputs; no side effects. Same args, same result, nothing else happens.
- **Immutable** — never mutate inputs or shared state; return new values. `readonly` parameters let the compiler enforce it.
- **Total** — handle every input the signature admits. A function that throws or returns `undefined` for some inputs is *partial* — narrow the signature or change the return type to tell the truth (anti-pattern T4).

### Composition

Assemble behavior by piping data through transformations. Use a typed `pipe` (overloaded for each arity, or from a library like `fp-ts`/`Effect` / `remeda`):

```typescript
const result = pipe(
  rawInput,
  (s: string) => s.trim(),
  (s: string) => s.split(","),
  (xs: string[]) => xs.length,
); // number
```

Adopt a **data-last** convention for curried helpers — configuration first, data last — so they compose with `pipe`:

```typescript
const map = <A, B>(f: (a: A) => B) => (xs: readonly A[]): readonly B[] => xs.map(f);
const filter = <A>(p: (a: A) => boolean) => (xs: readonly A[]): readonly A[] => xs.filter(p);
```

### Option — typed absence

```typescript
type Option<T> = { _tag: "Some"; value: T } | { _tag: "None" };
```

Replaces `null`/`undefined` flowing silently through code. `map`/`flatMap`/`getOrElse` build pipelines that short-circuit on `None`. Use when absence is a normal, frequently-handled case and you want it explicit in the type. For a one-off, plain `T | undefined` with a guard is lighter — do not import a monad to avoid one `if`.

### Result — typed failure

```typescript
type Result<T, E> = { _tag: "Ok"; value: T } | { _tag: "Err"; error: E };
```

The answer to anti-pattern P14. Expected failures (validation, not-found, conflict) become part of the return type; the caller is forced to handle both branches. The error type `E` can itself be a discriminated union, so each failure mode is named and exhaustively handled. Reserve `throw` for programmer errors.

### Higher-order functions as patterns

A function taking or returning a function is the functional Strategy and Decorator — no class needed. `withRetry`, `memoize`, `debounce`, `withLogging` all wrap an existing function and return an enhanced one. They compose by nesting. This is usually lighter than the class-based Decorator and is the idiomatic TS choice for cross-cutting behavior around functions.

### Algebraic data types for domain modeling

Model states as a **sum type** (discriminated union) and transitions as total functions. Illegal states become unrepresentable:

```typescript
type Cart =
  | { _tag: "Empty" }
  | { _tag: "Active";   items: readonly Item[] }
  | { _tag: "Ordered";  orderId: OrderId; placedAt: Date };
```

An `Ordered` cart has no `items` to mutate because that field does not exist in that variant — the bug class is designed out. Pair with **smart constructors** (a factory returning `Result<Valid, Error>`) so a value of the type cannot exist without its invariants holding. This ADT approach is paradigm-neutral — it is the single highest-leverage modeling technique in TypeScript and belongs in OOP-leaning codebases too.

---

## 4. Imperative shell, functional core

The architecture that gets the best of both: a thin outer shell does all I/O (DB, network, clock, randomness, logging); a pure inner core does all logic.

```typescript
// pure core — no imports, no effects, trivially testable
function calculateTotal(items: readonly Item[]): number {
  const discount = items.length > 5 ? 0.1 : 0;
  return items.reduce((s, i) => s + i.price, 0) * (1 - discount);
}

// thin shell — only effects, almost no logic
async function processOrder(id: OrderId): Promise<Result<void, "NOT_FOUND">> {
  const order = await db.orders.findById(id);   // effect
  if (!order) return err("NOT_FOUND");
  const total = calculateTotal(order.items);    // pure
  await db.orders.update(id, { total });        // effect
  return ok(undefined);
}
```

The core is tested with plain function calls — no mocks, no setup. The shell is so thin it needs only light integration coverage. Push effects outward until the logic in the middle is pure; that boundary is also where dependency injection and the Humble Object pattern live (see `architecture.md`).

---

## 5. Over-application warnings

**Over-OOP** — class hierarchies for data that just needs transformation; a class per file as reflex; deep `extends` chains; `interface`/`abstract class` ceremony around a single implementation. Symptoms map to anti-patterns P10, P11, P12. If a class has no state and one method, it is a function.

**Over-FP** — `Option`/`Result`/`Task` threaded through code that gains nothing; aggressive point-free style that obscures intent (`compose(map(prop("x")), filter(propEq("active", true)))` reads worse than two named lines); a `pipe` of ten steps allocating ten intermediate arrays in a hot path. Monads earn their place where absence/failure is pervasive and must be explicit — not as a uniform: a single nullable handled with `?.`/`??` does not need `Option`.

Match the tool to the unit. The strongest TypeScript codebases are not "OOP codebases" or "FP codebases" — they use OOP for boundaries and dependency management, a functional core for logic, and ADTs everywhere for domain modeling.

---

## 6. Testing strategy

Testing in TypeScript is an extension of the design: good architecture makes tests cheap; bad architecture makes them expensive. The patterns here follow from the imperative shell / functional core split.

### Test the pure core with plain function calls

The functional core has no dependencies to mock. Tests are just function calls with assertions — no setup, no teardown, no `beforeEach`, no database:

```typescript
// The core function
function applyDiscount(items: readonly Item[], code: DiscountCode): LineItem[] { /* ... */ }

// The test — a plain function call, no infrastructure
it("applies 10% for code SAVE10", () => {
  const items = [{ sku: "A", price: 100 }];
  const result = applyDiscount(items, DiscountCode("SAVE10"));
  expect(result[0].total).toBe(90);
});
```

If a "unit" test requires mocking three things to run, the unit is not actually a unit — it has leaked effects into what should be pure logic. Refactor, don't mock harder.

### Type in-memory fakes with the port interface

A fake is a simple, in-memory implementation of a port interface — not a mock framework's `jest.fn()` spray. Fakes satisfy the structural type without any adapter:

```typescript
// The port (defined in the domain module)
interface UserRepository {
  findById(id: UserId): Promise<User | null>;
  save(user: User): Promise<User>;
}

// The fake — plain class, in-memory, used in tests
class InMemoryUserRepository implements UserRepository {
  private store = new Map<string, User>();

  async findById(id: UserId): Promise<User | null> {
    return this.store.get(id.toString()) ?? null;
  }

  async save(user: User): Promise<User> {
    this.store.set(user.id.toString(), user);
    return user;
  }
}

// The test — real domain logic, fake infrastructure
const repo = new InMemoryUserRepository();
const service = new UserService(repo, new NoopMailer());
```

Fakes are more maintainable than mocks: they implement the interface, so if the interface changes, the fake fails to compile. A `jest.fn()` setup can silently become stale.

### Test factories for domain objects

Use a `Partial<T>` spread factory to build test data without repeating every field. The factory provides safe defaults; the test overrides only what it cares about:

```typescript
function buildUser(overrides: Partial<User> = {}): User {
  return {
    id: UserId("test-id"),
    email: Email("user@example.com"),
    status: "active",
    createdAt: new Date("2024-01-01"),
    ...overrides,
  };
}

// Each test states only what matters
const suspendedUser = buildUser({ status: "suspended" });
const newUser = buildUser({ createdAt: new Date() });
```

### Typing `jest.fn()` / `vi.fn()` correctly

When a mock function is necessary (for a callback or a simple collaborator), type it explicitly rather than relying on inference, which often falls back to `jest.Mock` (effectively `any`):

```typescript
// ❌ Typed as jest.Mock — any parameters, any return
const sendEmail = jest.fn();

// ✅ Typed to the exact function signature it replaces
const sendEmail = jest.fn<Promise<void>, [Email, string, string]>();
// or with typeof:
const sendEmail = jest.fn<ReturnType<Mailer["send"]>, Parameters<Mailer["send"]>>();
```

### Integration tests for the shell

The imperative shell — the thin layer that calls I/O — gets integration tests that run against real (or containerised) infrastructure, not mocks. These tests are fewer, slower, and only care about the wiring: does the real DB adapter satisfy the port? Does the real email service handle the right payload? They do not re-test business logic; that's the core's job.

### What good coverage looks like

- **Many fast unit tests** on the pure core — pure functions, ADT transitions, value object validation.
- **A handful of fake-based tests** on services/use-cases — real domain logic, fake infrastructure.
- **A small suite of integration tests** on infrastructure adapters — real DB, real HTTP, checking only the wiring.
- **End-to-end tests** sparingly — for critical user journeys only; expensive to run and maintain.

The ratio is deliberate: fast tests at the bottom, slow tests at the top. If the ratio is inverted (many integration tests, few unit tests), the design is probably wrong — effects have leaked into the domain layer.
