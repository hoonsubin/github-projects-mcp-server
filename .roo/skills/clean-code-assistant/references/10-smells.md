# Smells and Heuristics (Ch. 17)

Source: *Clean Code*, Chapter 17 — Robert C. Martin (drawing on Fowler's *Refactoring*)

This is the master reference. Each code smell is labeled with its category code for easy citation
during reviews. When you identify a smell, cite it (e.g., "G14: Feature Envy").

---

## C — Comments

| Code | Smell | What to do |
|---|---|---|
| C1 | Inappropriate information (changelog, author history) | Delete it; use version control |
| C2 | Obsolete comment | Update it or delete it |
| C3 | Redundant comment | Delete it; code says the same thing |
| C4 | Poorly written comment | Rewrite it with correct grammar and conciseness |
| C5 | Commented-out code | **Delete it immediately** |

---

## E — Environment

| Code | Smell | What to do |
|---|---|---|
| E1 | Build requires more than one step | Automate the full build with one command |
| E2 | Tests require more than one step | One command should run all tests |

---

## F — Functions

| Code | Smell | What to do |
|---|---|---|
| F1 | Too many arguments | Refactor to ≤ 2 args; use Parameter Object |
| F2 | Output arguments | Return the modified object instead |
| F3 | Flag arguments | Split into two functions |
| F4 | Dead function (never called) | Delete it |

---

## G — General

| Code | Smell | What to do |
|---|---|---|
| G1 | Multiple languages in one source file | Separate them |
| G2 | Obvious behavior not implemented | Implement what the name promises |
| G3 | Incorrect behavior at boundaries | Test every boundary condition; don't trust intuition |
| G4 | Overridden safeties | Don't disable tests or ignore warnings |
| G5 | Duplication (DRY violation) | Extract; use Template Method, Strategy, or Polymorphism |
| G6 | Code at wrong level of abstraction | Move it to the right layer |
| G7 | Base class depends on derivative | Decouple — base classes should not know their subclasses |
| G8 | Too much information | Narrow the interface; hide implementation details |
| G9 | Dead code (unreachable/unused) | Delete it |
| G10 | Vertical separation (definition far from use) | Move declarations closer to their first use |
| G11 | Inconsistency | If you do X one way here, do it the same way everywhere |
| G12 | Clutter (unused vars, empty constructors, no-info comments) | Delete it |
| G13 | Artificial coupling (enums inside unrelated classes) | Move to appropriate location |
| G14 | Feature envy (method uses another class's data more than its own) | Move the method to that class |
| G15 | Selector arguments (flag/enum passed to pick behavior) | Split into separate named functions |
| G16 | Obscured intent (magic numbers, Hungarian notation) | Reveal intent; name constants |
| G17 | Misplaced responsibility | Put code where the reader expects to find it |
| G18 | Inappropriate static | Don't make static methods that should be polymorphic |
| G19 | Use Explaining Variables | Break complex expressions into named intermediates |
| G20 | Function names should say what they do | Rename to match behavior |
| G21 | Understand the algorithm | Refactor until you fully understand it — then it becomes clean |
| G22 | Make logical dependencies physical | If A assumes something about B, make B provide it explicitly |
| G23 | Prefer polymorphism over if/else chains | Replace type-checking with polymorphism when types vary |
| G24 | Follow standard conventions | Use your language's idioms; agree on one style |
| G25 | Replace magic numbers with named constants | Every literal should be a named constant |
| G26 | Be precise | Don't leave ambiguous contracts; define edge cases explicitly |
| G27 | Structure over convention | Enforce structure (types, interfaces) rather than naming conventions |
| G28 | Encapsulate conditionals | `if should_delete(timer)` vs. `if timer.hasExpired && !timer.isRecurrent` |
| G29 | Avoid negative conditionals | `if buffer.should_compact()` not `if !buffer.should_not_compact()` |
| G30 | Functions should do one thing | Extract until each function is atomic |
| G31 | Hidden temporal coupling | Make order dependencies explicit via return values |
| G32 | Don't be arbitrary | Every structural decision should have a reason |
| G33 | Encapsulate boundary conditions | `int next_level = level + 1;` not `doSomething(level + 1)` everywhere |
| G34 | Functions should descend one level of abstraction | Don't mix levels in one function |
| G35 | Keep configurable data at high levels | Pass constants/config down; don't bury them in low-level code |
| G36 | Avoid transitive navigation (Law of Demeter) | `a.b().c().d()` → ask A directly |

---

## N — Names

| Code | Smell | What to do |
|---|---|---|
| N1 | Choose descriptive names | Rename until it reveals intent |
| N2 | Choose names at the appropriate abstraction level | Don't leak implementation details |
| N3 | Use standard nomenclature where possible | Use patterns and idioms in names |
| N4 | Unambiguous names | Names must not be misleading |
| N5 | Use long names for long scopes | Short names only for tiny scopes |
| N6 | Avoid encodings (Hungarian notation, type prefixes) | Remove type/scope prefixes |
| N7 | Names should describe side effects | If it creates too, `createOrReturnRegistry()` not `getRegistry()` |

---

## T — Tests

| Code | Smell | What to do |
|---|---|---|
| T1 | Insufficient tests | Test every condition that could break |
| T2 | Use a coverage tool | Measure; aim for high coverage |
| T3 | Don't skip trivial tests | Trivial tests are documentation |
| T4 | An ignored test is a question about an ambiguity | Either clarify or delete |
| T5 | Test boundary conditions | Always test at and around the edges |
| T6 | Exhaustively test near bugs | Bugs cluster — where you find one, look for more |
| T7 | Patterns of failure are revealing | Failed tests often reveal the root cause |
| T8 | Coverage patterns can be revealing | Uncovered code paths = untested assumptions |
| T9 | Tests should be fast | Slow tests don't get run |

---

## How to Use This in Reviews

When reviewing code, tag each issue with its code:

> "Line 42: G5 (Duplication) — this date formatting logic appears again in `UserFormatter`. Extract to a shared `DateFormatter` utility."

> "Lines 15–30: G15 (Selector Argument) — `render(page, True)` is unclear. Split into `render_for_suite(page)` and `render_for_test(page)`."

This creates precise, learnable feedback and builds the team's shared vocabulary.
