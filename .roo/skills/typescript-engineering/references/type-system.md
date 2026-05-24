# Advanced Type System — A Design Toolkit

The TypeScript type system is set-theoretic, structural, and erased at runtime. Use it to encode invariants so the compiler — not tests, not code review — catches violations. This file is the toolkit; load it when a task needs more than the SKILL.md core principles.

## Contents
1. The structural, set-theoretic model
2. Literal types and widening
3. Narrowing, type predicates, assertion functions
4. Mapped types
5. Conditional types and `infer`
6. Template literal types
7. `satisfies` vs `as` vs annotation
8. Branded / nominal types
9. Variance
10. Erasure: what types cannot do
11. Generic design
12. Excess property checking
13. Declaration merging and module augmentation

---

## 1. The structural, set-theoretic model

A type *is* a set of values. `string` = all strings. `"ok"` = a one-member set. `never` = the empty set. `unknown` = the universal set. This model explains everything else.

- `A | B` is set union — a value in A **or** B.
- `A & B` is set intersection — a value satisfying A **and** B. On object types this merges members; on disjoint primitives (`string & number`) it yields `never`, because no value is both.
- A type is **assignable** to another when its set is a subset. `"ok"` ⊆ `string`, so `"ok"` is assignable to `string`.
- Typing is **structural**: compatibility is by shape, not by declared name. A class instance satisfies an interface it never declared `implements`, if the shape matches. You do not pre-wire compatibility; you just match shapes. (For when you need to *block* this, see §8.)

`never` is the most useful "advanced" type: a function returning `never` never returns normally, and `never` in a union vanishes (`string | never` = `string`). Use it for exhaustiveness (§3).

---

## 2. Literal types and widening

Inference depends on mutability. `let x = "a"` infers `string` (widened — it could change). `const x = "a"` infers `"a"` (it cannot change). This routinely surprises people:

```typescript
function move(dir: "left" | "right") {}
let d = "left";        // widened to string
move(d);               // ❌ string not assignable to "left" | "right"
const d2 = "left";     // literal "left"
move(d2);              // ✅
```

`as const` forces literal inference recursively and adds `readonly` everywhere:

```typescript
const config = { retries: 3, mode: "fast" } as const;
// { readonly retries: 3; readonly mode: "fast" }
type Mode = typeof config.mode; // "fast"
```

Derive unions from `const` objects instead of declaring an `enum` (see anti-patterns T6):

```typescript
const Status = { Active: "active", Closed: "closed" } as const;
type Status = typeof Status[keyof typeof Status]; // "active" | "closed"
```

---

## 3. Narrowing, type predicates, assertion functions

The compiler tracks what control flow has *proven*. Use `typeof`, `instanceof`, `in`, equality, and truthiness checks to narrow. Discriminated unions narrow cleanly on their tag:

```typescript
type Shape =
  | { kind: "circle"; radius: number }
  | { kind: "square"; side: number };

function area(s: Shape): number {
  switch (s.kind) {
    case "circle": return Math.PI * s.radius ** 2;
    case "square": return s.side ** 2;
    default: return assertNever(s); // exhaustiveness — see below
  }
}
```

**Exhaustiveness check** — make "forgot a case" a compile error:

```typescript
function assertNever(x: never): never {
  throw new Error(`Unhandled variant: ${JSON.stringify(x)}`);
}
```

Add a new variant to `Shape` and every non-exhaustive `switch` fails to compile.

**Type predicate** — teach the compiler what a runtime check proves:

```typescript
function isUser(v: unknown): v is User {
  return typeof v === "object" && v !== null && "id" in v && "email" in v;
}
```

**Assertion function** — narrow for the rest of the scope, throwing otherwise:

```typescript
function assertIsString(v: unknown): asserts v is string {
  if (typeof v !== "string") throw new TypeError("expected string");
}
```

Predicates and assertions are the honest bridge from `unknown` to a real type at a boundary. They are how you avoid `as` (anti-pattern T3). For untrusted external input (HTTP bodies, parsed JSON), prefer a schema validator (Zod, Valibot) whose inferred type *is* the parsed type — one source of truth for runtime and compile time.

---

## 4. Mapped types

A type-level transform over the keys of another type. The built-ins are all defined this way:

```typescript
type Readonly<T> = { readonly [K in keyof T]: T[K] };
type Partial<T>  = { [K in keyof T]?: T[K] };
type Required<T> = { [K in keyof T]-?: T[K] }; // -? strips optional
```

Key remapping with `as` builds new key names:

```typescript
type Getters<T> = { [K in keyof T as `get${Capitalize<string & K>}`]: () => T[K] };
```

Use mapped types to *derive* related types from one source of truth instead of hand-maintaining parallel definitions (a DTO, its partial-update variant, its getters). When the source type changes, the derived ones change with it.

---

## 5. Conditional types and `infer`

`T extends U ? X : Y` branches at the type level. `infer` captures a type from inside another type — impossible in nominally-typed languages:

```typescript
type ElementOf<T>  = T extends readonly (infer E)[] ? E : never;
type ReturnOf<T>   = T extends (...a: any[]) => infer R ? R : never;
type Unwrap<T>     = T extends Promise<infer R> ? Unwrap<R> : T; // recursive
```

Conditional types over a union **distribute** — applied to each member separately:

```typescript
type NonNullableOf<T> = T extends null | undefined ? never : T;
type X = NonNullableOf<string | null | undefined>; // string
```

Powerful, but a magnet for over-engineering. Reach for a custom conditional type when it removes real duplication or encodes a real invariant — not to show off. Deeply nested conditional types are hard to read and debug; a named intermediate type or a simpler model often beats cleverness.

---

## 6. Template literal types

Type-level string composition. Enables type-safe string APIs with no code generation:

```typescript
type Channel = "user" | "order";
type Action  = "created" | "deleted";
type Event   = `${Channel}:${Action}`; // "user:created" | "user:deleted" | ...

type CSSValue = `${number}${"px" | "rem" | "%"}`;
```

Common use: a typed event bus or i18n key map where keys are checked at compile time.

---

## 7. `satisfies` vs `as` vs annotation

Three ways to relate a value to a type — they are not interchangeable:

- **Annotation** (`const x: T = ...`) — checks the value, then *widens* the variable to `T`. You lose specific inferred literals.
- **`as`** (`const x = ... as T`) — a cast. Overrides inference. Use only for `as const`, or a narrowing you have genuinely proven. A widening or fabricating `as` is anti-pattern T3.
- **`satisfies`** (`const x = ... satisfies T`) — checks the value against `T` **without** widening. You keep the precise inferred type *and* get the constraint enforced.

```typescript
type Palette = Record<string, [number, number, number] | string>;
const colors = { red: [255,0,0], green: "#0f0" } satisfies Palette;
colors.green.toUpperCase(); // ✅ green is known to be string, not the union
```

**`satisfies` + `as const` together** — the most powerful form for typed config objects. `satisfies` validates the shape; `as const` preserves all literal types so derived union types stay specific. Use this for any config or lookup table that other types are derived from:

```typescript
const routes = {
  home:    { path: "/",        auth: false },
  profile: { path: "/profile", auth: true  },
} satisfies Record<string, { path: string; auth: boolean }> as const;
// Each path is a literal string type, not just string
// Renaming a key is caught everywhere it's used

type RouteName = keyof typeof routes; // "home" | "profile"
type AuthRoute = { [K in RouteName]: typeof routes[K]["auth"] extends true ? K : never }[RouteName];
// "profile"
```

Rule: `satisfies` to validate a value's shape while keeping its specifics; `as` only when you are narrowing something you have proven.

---

## 8. Branded / nominal types

Structural typing means `UserId` and `OrderId` (both `string`) are interchangeable — a real bug source. Brand a type to make it nominal:

```typescript
type Brand<T, B extends string> = T & { readonly __brand: B };
type UserId  = Brand<string, "UserId">;
type OrderId = Brand<string, "OrderId">;

const UserId  = (s: string): UserId  => s as UserId;   // smart constructor
const OrderId = (s: string): OrderId => s as OrderId;

declare function getOrder(id: OrderId): Promise<Order>;
getOrder(UserId("u1")); // ❌ compile error — exactly what you want
```

Brand entity IDs, validated values (`Email`, `PositiveInt`), and units (`Meters`, `Millis`). The brand exists only at compile time — zero runtime cost. For values with validation rules or behavior, prefer a full value-object class (see `paradigms.md`); a brand is the lightweight option when you only need identity distinction.

---

## 9. Variance

Function types are **covariant in return, contravariant in parameters** (with `strictFunctionTypes` on):

```typescript
type Animal = { name: string };
type Dog = Animal & { breed: string };

let getDog: () => Dog = () => ({ name: "Rex", breed: "Lab" });
let getAnimal: () => Animal = getDog; // ✅ returning a subtype is safe

let handleAnimal: (a: Animal) => void = a => {};
let handleDog: (d: Dog) => void = handleAnimal; // ✅ accepting a supertype is safe
```

Mutable arrays are **invariant** in practice: `Dog[]` is not safely a `readonly Animal[]`'s mutable cousin, because you could `push` a non-Dog. Prefer `readonly T[]` in parameter positions — it is covariant and communicates "I will not mutate this". Developers from Java/C# expect generic covariance and get this wrong; the rule follows directly from "what would be unsafe to do".

---

## 10. Erasure: what types cannot do

Types vanish at runtime. There is no reflection over generic parameters, no `instanceof` for an interface, no runtime guard generated from a type. Anything you need enforced at runtime must be written as actual JavaScript: type predicates, assertion functions, or schema validation at the system boundary.

The flip side: because types cost nothing at runtime, the type system can afford to be extraordinarily expressive. Use it generously for compile-time correctness — just never assume a type is checking anything once the program runs.

---

## 11. Generic design

Generics encode the relationship between types. The design decisions are: what to constrain, what to leave open, and how inference flows.

**Constrain to the minimum required.** Over-constraining destroys reusability; under-constraining loses safety. Ask what the function actually needs from `T`:

```typescript
// ❌ Over-constrained — forces callers to pass full objects
function getField<T extends { id: string; name: string; email: string }>(
  obj: T, key: keyof T
): T[typeof key] { return obj[key]; }

// ✅ Constrained to only what's needed — works on any object
function getField<T extends object, K extends keyof T>(obj: T, key: K): T[K] {
  return obj[key];
}
```

**`const` type parameters (TS 5.0+)** — preserve literal types at the call site without requiring `as const` from the caller. Use when a function should capture the precise shape it receives:

```typescript
// Without const — T is inferred as string[], losing literal types
function makeRoute<T extends string[]>(paths: T): T { return paths; }
makeRoute(["home", "profile"]); // string[]

// With const — T is inferred as ["home", "profile"]
function makeRoute<const T extends string[]>(paths: T): T { return paths; }
makeRoute(["home", "profile"]); // ["home", "profile"] — literals preserved
```

**Phantom type parameters** — a type parameter that appears in the type signature but not in the value. Encodes state or intent without runtime cost; a lightweight alternative to full branded types when the distinction is about lifecycle or capability rather than identity:

```typescript
type Validated<T, Brand extends string> = T & { readonly __validated: Brand };

function validateEmail(raw: string): Validated<string, "Email"> {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) throw new Error("Invalid email");
  return raw as Validated<string, "Email">;
}

function sendEmail(to: Validated<string, "Email">, subject: string): void { /* ... */ }

sendEmail("raw@string.com", "Hi");            // ❌ compile error
sendEmail(validateEmail("ok@example.com"), "Hi"); // ✅
```

**Generic inference failures.** When TypeScript can't infer a type parameter, the fallback is `unknown` or `{}`, which may compile but lose safety. Common causes:
- The parameter only appears in a return type (inference is input-driven).
- Conditional types block inference — add a `NoInfer<T>` helper or split the function.
- Two parameters forced to the same `T` when they should be independent `T` and `U`.

When inference breaks, don't reach for `as` — restructure the signature so inference has enough information.

---

## 12. Excess property checking

TypeScript checks for extra properties *only on fresh object literals*, not on variables. This is structural typing in action — a variable might legitimately be a more specific subtype — but it surprises people:

```typescript
interface Point { x: number; y: number; }
function plot(p: Point): void {}

plot({ x: 1, y: 2, z: 3 }); // ❌ fresh literal — excess 'z' caught

const p3d = { x: 1, y: 2, z: 3 };
plot(p3d);                   // ✅ variable — structurally compatible, no excess check
```

This is intentional: a fresh literal at a call site with extra keys is almost certainly a mistake. A variable might genuinely be a richer type being passed somewhere that uses a subset. Understanding this distinction prevents two common mistakes: adding `as Point` to suppress the error (hiding the mistake), and being confused when the error doesn't fire for a variable.

When you *want* to block extra properties on variables (strict domain boundaries), use branded types or a validating constructor instead.

---

## 13. Declaration merging and module augmentation

TypeScript merges multiple declarations of the same `interface` name. This is how you extend third-party types without forking them — the only legitimate use of declaration merging in application code.

**Augmenting a library type** (e.g. adding fields to Express `Request`):

```typescript
// src/types/express.d.ts
declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
      requestId: string;
    }
  }
}
// Now req.user is typed everywhere without casting
```

**Augmenting a module's exported interface:**

```typescript
// src/types/some-lib.d.ts
import "some-lib";
declare module "some-lib" {
  interface SomeLibOptions {
    customField: string;
  }
}
```

Keep augmentation files in a `src/types/` folder, named after the library they augment. A `types/index.ts` that re-exports everything else is an anti-pattern (A3 / A8) — `types/` should contain only `.d.ts` augmentation files, not domain types.
