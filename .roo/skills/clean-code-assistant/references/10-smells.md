# Smells and Heuristics (Ch. 17)

Each smell is labeled for precise citation during reviews (e.g., "G14: Feature Envy").

## C — Comments

| Code | Smell | What to do |
|---|---|---|
| C1 | Inappropriate information (changelog, author history) | Delete; use version control |
| C2 | Obsolete comment | Update or delete |
| C3 | Redundant comment | Delete; code says the same thing |
| C4 | Poorly written comment | Rewrite with correct grammar |
| C5 | Commented-out code | **Delete immediately** |

## E — Environment

| Code | Smell | What to do |
|---|---|---|
| E1 | Build requires more than one step | Automate with one command |
| E2 | Tests require more than one step | One command should run all tests |

## F — Functions

| Code | Smell | What to do |
|---|---|---|
| F1 | Too many arguments | Refactor to ≤ 2; use Parameter Object |
| F2 | Output arguments | Return the modified object instead |
| F3 | Flag arguments | Split into two functions |
| F4 | Dead function (never called) | Delete it |

## G — General

| Code | Smell | What to do |
|---|---|---|
| G1 | Multiple languages in one source file | Separate them |
| G2 | Obvious behavior not implemented | Implement what the name promises |
| G3 | Incorrect behavior at boundaries | Test every boundary; don't trust intuition |
| G4 | Overridden safeties | Don't disable tests or ignore warnings |
| G5 | Duplication (DRY violation) | Extract; use Template Method, Strategy, Polymorphism |
| G6 | Code at wrong level of abstraction | Move to the right layer |
| G7 | Base class depends on derivative | Decouple |
| G8 | Too much information | Narrow the interface; hide implementation details |
| G9 | Dead code | Delete it |
| G10 | Vertical separation | Move declarations closer to first use |
| G11 | Inconsistency | If you do X one way here, do it the same way everywhere |
| G12 | Clutter | Delete unused vars, empty constructors, no-info comments |
| G13 | Artificial coupling | Move to appropriate location |
| G14 | Feature envy | Move the method to the class whose data it uses |
| G15 | Selector arguments | Split into separate named functions |
| G16 | Obscured intent | Reveal intent; name constants |
| G17 | Misplaced responsibility | Put code where the reader expects it |
| G18 | Inappropriate static | Don't make static methods that should be polymorphic |
| G19 | Use explaining variables | Break complex expressions into named intermediates |
| G20 | Function name doesn't say what it does | Rename to match behavior |
| G21 | Understand the algorithm | Refactor until you fully understand it |
| G22 | Make logical dependencies physical | If A assumes B, make B provide it explicitly |
| G23 | Prefer polymorphism over if/else chains | Replace type-checking |
| G24 | Follow standard conventions | Use language idioms; agree on one style |
| G25 | Replace magic numbers with named constants | Every literal → named constant |
| G26 | Be precise | Define edge cases explicitly |
| G27 | Structure over convention | Enforce via types/interfaces, not naming rules |
| G28 | Encapsulate conditionals | `if should_delete(timer)` not `if timer.hasExpired && !timer.isRecurrent` |
| G29 | Avoid negative conditionals | `if buffer.should_compact()` not `if !buffer.should_not_compact()` |
| G30 | Functions should do one thing | Extract until each is atomic |
| G31 | Hidden temporal coupling | Make order dependencies explicit via return values |
| G32 | Don't be arbitrary | Every structural decision should have a reason |
| G33 | Encapsulate boundary conditions | Name `level + 1` as `next_level`; don't scatter literals |
| G34 | Functions should descend one level of abstraction | Don't mix levels |
| G35 | Keep configurable data at high levels | Pass constants down; don't bury in low-level code |
| G36 | Avoid transitive navigation (Law of Demeter) | `a.b().c()` → ask A directly |

## N — Names

| Code | Smell | What to do |
|---|---|---|
| N1 | Non-descriptive name | Rename to reveal intent |
| N2 | Name at wrong abstraction level | Don't leak implementation details |
| N3 | Non-standard nomenclature | Use patterns and idioms |
| N4 | Ambiguous name | Names must not mislead |
| N5 | Short name for long scope | Short names only for tiny scopes |
| N6 | Encodings (Hungarian notation, type prefixes) | Remove them |
| N7 | Name doesn't describe side effects | `createOrReturnRegistry()` not `getRegistry()` |

## T — Tests

| Code | Smell | What to do |
|---|---|---|
| T1 | Insufficient tests | Test every condition that could break |
| T2 | No coverage tool | Measure; aim for high coverage |
| T3 | Skipped trivial tests | Trivial tests are documentation |
| T4 | Ignored test | Clarify the ambiguity or delete |
| T5 | Untested boundary conditions | Always test at and around the edges |
| T6 | Bugs not exhaustively tested | Bugs cluster — look for more nearby |
| T7 | Failure patterns unexamined | Failed tests often reveal the root cause |
| T8 | Coverage gaps | Uncovered paths = untested assumptions |
| T9 | Slow tests | Slow tests don't get run |

## How to Use in Reviews

Tag each issue with its code for precise, learnable feedback:

> "Line 42: G5 (Duplication) — this date formatting logic appears again in `UserFormatter`. Extract to a shared `DateFormatter`."
