# Anti-Pattern & Smell Catalog

The audit checklist. Each smell has a code: **T#** type-system, **P#** design/paradigm, **A#** architecture. When reviewing, cite the code, explain the cost, show the fix. When writing, treat these as things never to produce.

Severity guide: an architecture smell (A#) usually outranks a design smell (P#), which outranks a local type smell (T#) — fix in blast-radius order. But a single `any` (T1) on a core boundary can outrank everything, because it silently disables checking downstream. Judge by reach, not just category.

---

## T — Type-System Smells

### T1 — `any` as an escape hatch
`any` switches the checker off and propagates silently through every expression it touches; bugs surface at runtime exactly where types should have helped.
**Fix:** `unknown` + a type predicate or schema parse at the boundary. If `any` is truly unavoidable (some dynamic metaprogramming), confine it to one line with a comment justifying it. `any` in a public signature is never acceptable — it poisons every caller.

### T2 — Unjustified non-null assertion (`!`)
`x!` is a permanent unchecked promise that `x` is not null. It adds no runtime check; it only silences the compiler. `a!.b!.c!` means the contracts upstream are lying about nullability.
**Fix:** Narrow with a real guard (`if (!x) throw ...`), or use `?.` with a `??` fallback, or change the upstream signature so the value is genuinely non-nullable.

### T3 — Lying type assertion (`as`)
A widening or fabricating `as` (`json as User`, `{} as Config`) overrides inference and asserts something unproven. The runtime shape can differ from the asserted type with no error.

The most egregious form is the **double cast** `as unknown as T` — chaining two lies to defeat the checker's last objection. If `as T` alone won't compile because the types are incompatible, that incompatibility is the real signal. `as unknown as T` silences it without resolving it.

**Fix:** Validate instead of assert — a type predicate, an assertion function, or a schema parse (Zod, Valibot). `as const` and a genuinely-proven narrowing are fine; fabrication is not. If you find yourself writing `as unknown as T`, the real fix is almost always a type predicate at the boundary where the unknown data enters the system.

### T4 — Lying function signature (partial typed as total)
A signature claiming to return `T` that can actually return `undefined` (`arr[0]`, a `Map.get`, a `find`) corrupts every caller's assumptions.
**Fix:** Tell the truth: return `T | undefined`, or a `Result<T, E>`, or narrow the input so the absent case cannot occur. Enable `noUncheckedIndexedAccess` so the compiler enforces this for index access.

### T5 — Primitive obsession
`string` for email, URL, ID, currency, ISO date; `number` for money, percentage, milliseconds. Nothing stops arguments being swapped or invalid values flowing in. `transfer(toId, fromId, -50)` compiles fine.
**Fix:** Branded types for identity distinction (see `type-system.md` §8); value-object classes with validating constructors for things with rules or behavior (see `paradigms.md`).

### T6 — `enum` where a `const` union fits better
TS `enum` compiles to a runtime IIFE; numeric enums admit out-of-range values; enums are nominal in a structural language, causing friction.
**Fix:** A `const` object + derived union type — readable serialization, exhaustiveness checking, no runtime construct, tree-shakeable. (`const-assertions` pattern in `type-system.md` §2.) `const enum` is a partial fix but has its own build-tooling caveats; the `const` object is the safe default.

### T7 — Structural type where an intentional type is needed
Two conceptually different things with the same shape are silently interchangeable (two ID kinds, a raw vs validated string).
**Fix:** Brand them (T5/§8) so the compiler distinguishes intent, not just shape.

### T8 — `@ts-ignore` / unexplained `@ts-expect-error`
Suppressing an error hides a real defect or a real design flaw, and `@ts-ignore` will keep hiding *future* errors on that line too.
**Fix:** Fix the underlying cause. If suppression is genuinely required (a wrong third-party type), use `@ts-expect-error` (it fails if the error disappears) **with** a comment explaining why.

### T9 — Mindless getters/setters
`get x()/set x()` pairs that just read and write a private field are public fields with ceremony. They expose the storage format and provide no abstraction.
**Fix:** Expose meaningful operations (`deposit()`, `rename()`), not accessors. If callers only observe, a `readonly` field or a single named query method is enough. (See `paradigms.md` — encapsulation.)

### T10 — Untyped `Object.keys` / `entries` assumptions
`Object.keys(obj)` is typed `string[]`, not `(keyof T)[]`; `Object.entries` loses value types. Indexing back in then fails or needs a cast.
**Fix:** A typed helper (`typedKeys<T>(o): (keyof T)[]`), or iterate a known key list. Do not paper over it with `as`.

### T11 — Wrong `interface` vs `type` choice
Using `interface` for things it cannot express (unions, tuples, conditional/mapped/template types) forces awkward workarounds — often a needless class. Using `type` for a DI port loses declaration-merging extensibility where that is wanted.
**Fix:** `interface` for an implementable/extendable object contract (especially ports). `type` for unions, intersections, tuples, derived/computed shapes, primitive aliases. A discriminated union is always a `type`.

### T12 — Mutable parameter types where `readonly` fits
A function accepting `items: Item[]` when it never mutates the array makes an implicit promise it cannot enforce. Callers cannot tell whether their data will be modified; accidental mutations inside the function are not caught by the compiler.
**Fix:** Mark non-mutated parameters `readonly`: `items: readonly Item[]`, `config: Readonly<Config>`. This is a contract to the caller and a compiler guardrail inside the function — if a body accidentally calls `items.push(...)`, it now fails to compile. Apply consistently to all collection and object parameters that the function only reads.

```typescript
// ❌ Implicit contract — will you mutate my array or not?
function summarise(items: Item[]): Summary { /* ... */ }

// ✅ Explicit contract — compiler enforces it
function summarise(items: readonly Item[]): Summary { /* ... */ }
```

---

## P — Design & Paradigm Smells

### P1 — God class / god module
One unit doing user logic, validation, persistence, email, reporting. Described only with "and". Every feature touches it; merge conflicts cluster there.
**Fix:** Single Responsibility — one reason to change. Split by *actor* / concern into focused units.

### P2 — Anemic domain model
Domain types are bags of public fields with zero behavior; all logic sits in external `*Service` classes. The objects cannot enforce their own invariants.
**Fix:** Move behavior onto the type that owns the data. A `User` should answer `isPremium()` itself rather than having `UserService.isPremium(user)`. (Note: a pure-data DTO at a layer boundary is *correct* — see P3. The smell is a *domain* object with no behavior.)

### P3 — Object/data-structure hybrid
A type that is half data, half behavior — business logic bolted onto a DTO, or raw fields exposed on a domain object. Worst of both: callers cannot treat it as either.
**Fix:** Decide. A DTO is pure data (public `readonly` fields, no methods). A domain object is behavior (private data, meaningful methods). Never both in one type. Active-Record-style types are data structures — keep business rules out of them.

### P4 — Feature envy
A method that uses another type's data more than its own — `orderLine.total(product)` reaching into `product.price`, `product.taxRate`.
**Fix:** Move the method to the type whose data it uses (`product.priceFor(qty)`).

### P5 — Train wreck (Law of Demeter)
`ctx.getOptions().getDir().getPath()` — navigating an object graph. Each `.` couples the caller to a layer of internal structure.
**Fix:** Tell, don't ask — add a method to the object that returns what you need (`ctx.scratchPath()`). (Navigating a plain *data structure*'s fields is fine; the rule is about *objects*.)

### P6 — Flag / boolean arguments
`render(true)`, `save(user, false, true)` — the call site is unreadable and the function almost certainly does two things selected by the flag.
**Fix:** Split into two named functions, or pass a named options object / discriminated union so each call self-documents.

### P7 — Hidden mutation in "functional" code
`forEach` mutating an outer `let`, a "pure" pipeline step that splices its input array. Looks functional, behaves imperatively, breaks across async boundaries.
**Fix:** `reduce`/`map`/`filter` returning new values; never mutate inputs. Mark collection parameters `readonly` to let the compiler catch it.

### P8 — Impure function with hidden side effects
`calculateTax()` that also logs, writes a file, or mutates a cache. The name promises a computation; the body does I/O. Every call site becomes unpredictable.
**Fix:** Do exactly what the name says. Move side effects out to an explicit caller. Keep logic pure and effects at the edges (imperative shell / functional core — see `paradigms.md`).

### P9 — Temporal coupling
Methods that must be called in a specific order, with nothing enforcing it: `init()` then `use()`, where `use()` crashes if `init()` was skipped.
**Fix:** Make the order unrepresentable — a private constructor plus a static async factory that returns a fully-ready instance; or return the next valid state from each step so the wrong order will not type-check.

### P10 — Subclassing for extension (fragile base class)
Extending a base class and overriding `protected` hooks to vary behavior. Subclass and base are tightly coupled; a base change silently breaks subclasses; "remember to call `super`" is unenforceable.
**Fix:** Composition over inheritance — Strategy (inject the varying behavior), or a middleware/hook pipeline of plain functions. (Patterns in `paradigms.md`.)

### P11 — Unnecessary class
A class with one method and no state, or one never instantiated meaningfully (`new Helper().doIt()`), or a static-only "utility class".
**Fix:** A plain function. Reserve classes for encapsulated mutable state or for instances that satisfy a DI port.

### P12 — Premature abstraction / speculative generality
`IUserService`, `IUserRepository`, `AbstractUserFactory` with exactly one implementation each, "in case" a second appears. Indirection with no payoff; harder to read and navigate.
**Fix:** YAGNI for abstractions with no second case. Extract the interface when the second implementation arrives, or when a test needs a fake. (But: a genuine architectural *seam* is expensive to retrofit — note it. The smell is speculative *generality*, not deliberate seams.)

### P13 — Long function doing more than one thing
If you can extract a well-named function from a block, the original did more than one thing. Mixed levels of abstraction (high-level policy interleaved with low-level detail) in one body.
**Fix:** Extract until each function does one thing at one level of abstraction. Short, well-named functions read top-down as a narrative.

### P14 — Exceptions for expected control flow
`throw` for routine outcomes — validation failure, not-found, conflict. The type signature hides that the call can fail; callers forget to `catch`; the happy-path type is a lie.
**Fix:** Return `Result<T, E>` (or `Option<T>` for mere absence) so the failure is in the type and the caller must handle it. Reserve `throw` for programmer errors and genuinely exceptional conditions. (Pattern in `paradigms.md`.)

### P15 — Async anti-patterns
Async mistakes are the most common source of silent bugs in TypeScript. They form a cluster:

**Floating Promises** — calling an async function without `await` and without storing or handling the returned `Promise`. The rejection is silently swallowed; the operation may not complete before the caller moves on. ESLint's `@typescript-eslint/no-floating-promises` catches this.

```typescript
// ❌ fire-and-forget — errors vanish, ordering uncontrolled
sendWelcomeEmail(user);

// ✅ awaited — errors propagate, completion is guaranteed
await sendWelcomeEmail(user);
// or, if truly intentional background work:
void sendWelcomeEmail(user).catch(logger.error); // explicit, documented
```

**`async` without `await`** — a function marked `async` that never actually awaits. It wraps the return in a `Promise` unnecessarily, misleads readers, and adds a microtask boundary for no reason.
**Fix:** Remove `async` if no `await` is needed; or if the function must return `Promise<T>` for interface compatibility, return `Promise.resolve(value)` explicitly to document the intent.

**Sequential `await` for independent operations** — `const a = await opA(); const b = await opB()` when A and B are independent serialises two operations that could run concurrently.
**Fix:** `const [a, b] = await Promise.all([opA(), opB()])`. If one failing should not cancel the other, use `Promise.allSettled` and inspect each result.

**`Promise.all` when partial failure is acceptable** — `Promise.all` rejects on the first failure, discarding the rest. If you need results for whichever operations succeeded, `Promise.all` is wrong.
**Fix:** `Promise.allSettled` returns `{ status: "fulfilled" | "rejected"; ... }[]` — handle each outcome explicitly.

**Untyped `catch (e)` treated as `Error`** — under `useUnknownInCatchVariables` (on by default with `strict`), `e` is `unknown`. Casting it directly to `Error` without checking is a lying assertion (T3) that breaks for non-Error rejections.

```typescript
// ❌ assumes the rejection is always an Error
} catch (e) {
  console.error((e as Error).message);
}

// ✅ check first; use a helper for repeated cases
} catch (e) {
  const message = e instanceof Error ? e.message : String(e);
  console.error(message);
}
```

**Async constructors** — constructors cannot `await`, so async initialisation in a constructor either runs unawaited (floating Promise) or forces a separate `init()` call (temporal coupling, P9). The async factory pattern resolves both:

```typescript
// ❌ constructor with async init — temporal coupling
class DbClient {
  async init() { this.connection = await connect(); }
}

// ✅ static async factory — always fully ready on construction
class DbClient {
  private constructor(private connection: Connection) {}
  static async create(url: string): Promise<DbClient> {
    return new DbClient(await connect(url));
  }
}
```

---

## A — Architecture Smells

### A1 — Wrong dependency direction
A domain/business module imports an infrastructure module (DB client, HTTP framework, ORM type). Business rules now cannot change, compile, or be tested without infrastructure.
**Fix:** Invert it — the domain declares an interface (port); infrastructure implements it. Dependencies point inward toward policy. (DIP — `architecture.md`.)

### A2 — Organization by file type, not domain
Top-level `/controllers`, `/services`, `/models`, `/repositories`. One feature change edits five directories; the structure reveals the framework, not the product.
**Fix:** Feature/domain-sliced folders (`/users`, `/orders`, `/billing`), each self-contained. The top level should "scream" the domain.

### A3 — Barrel file leaking internals
`index.ts` doing `export *`, or exporting implementation classes and private helpers. The module has no real public/private boundary; anything can be reached and depended on.
**Fix:** A curated `index.ts` that names exactly the public API; everything else stays module-private. Enforce with an ESLint import-boundary rule.

### A4 — Circular dependency
Module A imports B, B imports A. TypeScript often compiles it, but it can produce `undefined`-at-runtime initialization bugs, and it always signals a missing concept.
**Fix:** Extract the shared concept into a third module both depend on, or invert one edge with an interface. Detect with `madge` or `import/no-cycle`.

### A5 — Interface defined with its implementer
A repository/port interface declared inside the database module and imported *up* into the domain. The dependency arrow points outward — the domain now depends on infrastructure's file.
**Fix:** The interface belongs to its *consumer*. Define `UserRepository` in the domain module; the database module imports it and `implements` it.

### A6 — Concrete construction outside the composition root
`new PostgresClient()`, `new SmtpMailer()` scattered through services. Dependencies are hidden, untestable, and impossible to swap.
**Fix:** Inject dependencies via constructors against interfaces. All concrete construction happens in one place — the composition root (`main.ts`). If a file outside it imports a concrete infra class, that is the leak.

### A7 — Shared mutable global state / directly-accessed singleton
A module-level mutable object, or a `Singleton.getInstance()` reached for directly inside business logic. Tests interfere with each other; initialization order matters; coupling is invisible.
**Fix:** Inject the dependency (logger, config, clock) as an interface. Config that is genuinely immutable can be a module export; anything mutable or I/O-bound is injected.

### A8 — `utils.ts` junk drawer
A file accumulating unrelated functions. Every function in it is homeless — it belongs to a real domain or module.
**Fix:** Place each function where it conceptually belongs. A genuinely generic, dependency-free helper can live in a named `shared/` module — but `formatInvoiceTotal` belongs in `billing`, not `utils`.

### A9 — Layer leakage / missing boundary mappers
A database row type, or an ORM entity, used directly as the HTTP response; a domain object serialized straight to JSON. A storage or transport concern leaks across layers; renaming a DB column breaks the API.
**Fix:** Distinct types per layer — DB row, domain object, response DTO — with explicit mapper functions at each boundary. The compiler then flags every mapper that a change affects. (See `architecture.md`.)

---

## Audit Quick Pass

When reviewing a TypeScript file or module, sweep in this order:

1. **Type honesty** — any `any`, `!`, lying `as` (including `as unknown as T`), `@ts-ignore`, or signature that under-reports `undefined`/failure? (T1–T4, T8)
2. **Domain modeling** — primitives that should be branded/value objects; flag soup that should be a discriminated union; illegal states currently representable? (T5, T7, P2, P3)
3. **Function shape** — does each function do one thing, at one level, with no hidden effects, no flag args, honest about failure? Are async functions awaited? Any floating Promises, sequential awaits that could be parallel, untyped catches? (P6, P8, P13, P14, P15)
4. **Dependency direction** — does anything domain-side import infrastructure; is construction outside the composition root; any cycles? (A1, A4, A5, A6)
5. **Module boundary** — feature-sliced or file-type-sliced; does the barrel leak internals; do layer types leak? (A2, A3, A9)
6. **Paradigm fit** — class hierarchy where a union/function fits; monads where nothing needs them; abstraction with one implementation? (P10, P11, P12)

**Co-occurrence note — A9 + T1:** Layer leakage (A9) and `any` (T1) almost always appear together. When a DB row or HTTP payload crosses a layer boundary without a mapper, the receiving layer has no honest type for it and reaches for `any`. The combined fix is: add the boundary type + mapper, and the `any` need disappears. When you see T1 on a layer-crossing variable, check for A9; when you see A9, scan for downstream T1.

Report findings grouped, most reach first, each with code, cost, and before/after.

---

## Writing Checklist

The inverse of the audit — apply when writing fresh code before committing:

**Types**
- [ ] No `any`, `!`, fabricating `as`, or `as unknown as T` in the diff
- [ ] Every function signature is total — return type matches all possible returns including `undefined`/failure
- [ ] Collection and object parameters that aren't mutated are `readonly`
- [ ] Raw primitives that carry domain meaning are branded or value-object typed
- [ ] Async functions are awaited at every call site; no floating Promises

**Design**
- [ ] Each function does one thing at one level of abstraction
- [ ] State is modeled as a discriminated union, not flag fields
- [ ] Expected failures are `Result<T, E>`, not thrown exceptions
- [ ] No hidden side effects inside named computations
- [ ] No sequential `await` for independent async operations

**Architecture**
- [ ] No domain file imports an infrastructure file
- [ ] No `new ConcreteInfra()` outside `main.ts`
- [ ] The feature's `index.ts` exports only the intended public API
- [ ] Each layer has its own type; crossing a boundary uses an explicit mapper
- [ ] No additions to `utils.ts` — new helpers live in their domain module
