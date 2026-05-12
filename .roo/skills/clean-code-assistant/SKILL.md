---
name: clean-code-assistant
description: "Clean Code skill. Writing, reviewing, or refactoring code; naming variables/functions/classes; class design; error handling; tests; reducing duplication; code smells; SRP, OCP, DIP. Phrases: 'is this clean', 'clean this up', 'what's wrong with my function', 'how do I improve this', pasting code for feedback or rewrite. Apply proactively to any coding task."
---

# Clean Code Assistant

**Fundamental rule: code is read far more than it is written (> 10:1 ratio). Every decision optimizes for the reader.**

## Usage

**Reviewing code:** Identify smells by category (use `references/10-smells.md` for labeled G/N/F/T/C/E codes), explain *why* each is a problem, show the refactored version.

**Writing new code:** Apply the principles below before producing output. Prefer expressive names, short functions, and minimal coupling from the start.

**User stuck on naming or structure:** Ask *"What does this actually do? Can you say it in one sentence?"* — the answer is usually the name.

## Reference files

Load when relevant to the task:

- `references/01-naming.md` — Meaningful names, anti-patterns, searchability
- `references/02-functions.md` — Size, SRP, arguments, side effects, DRY
- `references/03-comments.md` — Good vs. bad comments; self-documenting code
- `references/04-formatting.md` — File size, vertical/horizontal layout
- `references/05-objects-data.md` — Abstraction, Law of Demeter, objects vs. data structures
- `references/06-error-handling.md` — Exceptions, null handling, error isolation
- `references/07-tests.md` — TDD, FIRST rules, clean test structure
- `references/08-classes.md` — SRP, OCP, cohesion, DIP
- `references/09-emergence.md` — Kent Beck's four rules of Simple Design
- `references/10-smells.md` — Master heuristics list (G, N, F, T, C, E codes)

## Core principles

### 1. Meaningful Names
- Names must **reveal intent**: `elapsed_time_in_days` not `d`
- Avoid disinformation: `account_list` must actually be a list type
- Use **searchable** names for constants: `WORK_DAYS_PER_WEEK` not `5`
- Pick **one word per concept**: don't mix `fetch`, `retrieve`, `get` for the same operation
- Name at the correct **abstraction level** — don't leak implementation details into the name

### 2. Functions
- **Do one thing** — if a meaningful sub-function can be extracted, it does more than one
- **Short** (ideally < 20 lines); `if`/`while` blocks should be one line = a function call
- **One level of abstraction per function** — don't mix high-level policy with low-level detail
- **Fewer arguments**: niladic > monadic > dyadic > triadic; never flag (boolean) arguments
- **No side effects** — `check_password` must not also initialize a session
- **Prefer exceptions over error codes**; put error handling in its own function

### 3. Comments
- The best comment is no comment — rewrite code to be self-explanatory; comments lie over time, code doesn't
- **Good comments**: legal headers, intent explanation (*why*, not *what*), opaque API clarification, TODO, warnings of consequences
- **Bad comments**: redundant, misleading, commented-out code (delete — use VCS), journal/changelog entries, section banners

### 4. Classes
- **SRP**: one reason to change — if the class can't be described without "and", split it
- **OCP**: open for extension, closed for modification — new behavior = new code, not edits to existing code
- **DIP**: depend on abstractions, not concretions — inject dependencies via constructor
- **High cohesion**: if a subset of methods only uses a subset of instance variables, the class wants to split

### 5. Four Rules of Simple Design (Kent Beck) — in priority order
1. **Runs all the tests** — untestable systems should never deploy; testability forces decoupling
2. **No duplication (DRY)** — duplication is the root of most software evil
3. **Expresses intent** — good names, small units, standard patterns
4. **Minimal classes and methods** — smallest design that satisfies rules 1–3; don't over-engineer

## Response format

**Reviewing:**
1. Brief overall assessment (1–2 sentences)
2. Issues grouped by category (Names / Functions / Comments / Classes / etc.)
3. Before/after code for each issue
4. Most impactful changes first

**Writing:** Clean from the start — never produce "working but messy" code. Briefly annotate surprising design decisions (class splits, naming choices).

**Refactoring:** Explain the smell, cite the principle, show the fix. For large refactors, break into incremental steps.
