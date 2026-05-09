# Workflow — Cleaning Up a Messy Codebase

Use this workflow when the codebase is **substantially in trouble** — what Brian Foote and Joseph Yoder named a *Big Ball of Mud*. The signs are unmistakable: a small change requires touching files all over the system; the build is fragile; tests either don't exist or take half an hour to run; nobody on the team can confidently say what depends on what; new developers take weeks to make their first useful commit; productivity has been visibly declining release over release.

This is a recovery operation. It will take months, not days. The goal is not to make the system "clean" — that's a fantasy. The goal is to **stop the bleeding, then incrementally restore the ability to change the system safely**.

If the codebase is fine but the *internals are dirty*, use `workflow-strangle.md` instead. That's a smaller intervention.

## Stage 0 — Set realistic expectations

Before any work begins, get explicit agreement on these points with whoever has authority over the engineering effort:

- **Cleanup competes with feature work.** It must be funded as actual capacity, not "do it on the side". Fifty percent of one engineer's time, or twenty percent of every engineer's time, is reasonable. Zero percent is not.
- **There will be no big-bang rewrite.** Rewrites of mature systems mostly fail; the new system inherits the old system's overconfidence and falls into the same mess. The plan is incremental.
- **Some areas will stay messy forever.** Code that works, never changes, and nobody touches doesn't need cleanup. Triage matters.
- **Velocity will *appear* to drop in the short term.** Cleanup work that produces no user-visible feature can look like idleness. It isn't, and stakeholders need to understand that productivity is going up — but the curve takes months to bend.

If the user can't get this agreement, cleanup will fail before it starts. Help them have the conversation, or recommend that they not start until they can.

## Stage 1 — Make the system observable

Before changing anything, make sure you can tell whether changes break things. This is the highest-value early investment.

1. **Add a build that runs on every commit.** If one doesn't exist, install it: GitHub Actions / GitLab CI / Jenkins / whatever the team will tolerate. A red build is a signal; the absence of a build is silence.
2. **Add the cheapest possible end-to-end smoke tests.** Even one test that boots the system, exercises the most important happy path, and confirms a non-error response is enormously better than zero.
3. **Add static analysis with a low bar.** Linter, type-checker (where applicable), basic security scanner. Don't try to fix everything — just establish the baseline so new violations are visible.
4. **Generate the dependency graph and commit it.** Re-generate weekly. The graph is the map of the swamp. You will use it constantly.

If these don't exist, do nothing else until they do.

## Stage 2 — Triage: where is the change pressure?

Not all parts of a messy system are equally bad — and not all of the bad parts matter. The parts worth cleaning are the ones the team **needs to change frequently**.

For each top-level component / module:

- **Change frequency**: how many commits in the last 6 months? (`git log --since="6 months ago" --pretty=format: --name-only | sort | uniq -c | sort -rn` is a reasonable proxy.)
- **Defect frequency**: how many bug fixes vs. features? (Tag from commit messages or issue tracker.)
- **Cross-contamination**: when this module changes, how many *other* modules also change in the same commits?
- **Onboarding cost**: how long does a new dev take to land a change here?

You're looking for **hot, fragile, contagious code**. That's the cleanup target. Cold, stable, well-isolated code (even if internally ugly) can wait — possibly forever.

Output: a ranked list of 3–5 areas. Cleanup focuses on these in order. Anything beyond the top 5 is out of scope until those are done.

## Stage 3 — Establish the seam

Pick the #1 hotspot. Now: **draw a line around it**. The line doesn't have to be perfectly placed — it has to be *somewhere*, so that you can start moving things across it deliberately.

The seam is a future architectural boundary. Inside the seam, the messy code lives. Outside, you're going to start building (or moving to) clean code. The seam itself is a *Facade* or *Strategy* — see `references/boundaries.md`.

Concretely:

1. Identify a *thing the messy module produces or consumes* — a use case, a query, a calculation.
2. Define an interface for that thing — small, expressed in domain language, with no framework or DB types.
3. Have the rest of the world go through the interface to get to the messy module.
4. Initially, the implementation is just the messy module dressed up with a thin adapter. That's fine. The point is the interface is now a real seam.

This is the **anti-corruption layer** pattern (DDD's name for it). It localizes the mess so that the rest of the system can evolve cleanly while the mess stays sealed off until you can replace it.

## Stage 4 — Add tests at the seam

With the interface in place, you can now write **characterization tests**: tests that pin down the current behavior of the messy module — the good, the bad, the bug-compatible — at the level of the seam.

These tests aren't asking "is this the right behavior?" They're asking "is this the *current* behavior?" Their job is to keep the mess from getting worse during cleanup.

Aim for tests that exercise:
- The most common happy paths.
- Each known bug (yes, including ones you'll fix later — the test will document what you fixed and when).
- Each branch in the calling code that the seam serves.

Don't aim for full coverage. Aim for *enough coverage that you can refactor with confidence*.

When the seam-level tests pass reliably, you have a safety net. Now actual cleanup can begin.

## Stage 5 — Refactor inside the seam, one knot at a time

The strategy now is **internal refactoring of the messy module, with the seam preventing collateral damage**. Pick the smallest knot that hurts the most:

1. **Extract pure functions.** Find calculation code wrapped in I/O or framework code. Pull the calculation out as a pure function. Test it in isolation.
2. **Push side effects to the edges.** Database calls, network calls, file I/O — move them to thin adapter classes that the now-pure inner code can call through interfaces.
3. **Turn data clumps into types.** When five parameters always travel together, they're an entity in disguise. Give them a name and move related rules onto them.
4. **Replace conditionals over a "type" field with polymorphism** — when justified by repeated change. (Don't do this for one-off conditionals.)
5. **Move file by file from the framework's structure to the domain's structure.** Files about *customers* go into `customers/` regardless of whether they're controllers, services, or repositories.

Each refactor follows the same micro-loop:

1. **Tests pass** (run them).
2. **Make a small structural change** — usually a few minutes' work.
3. **Tests pass** (run them again).
4. **Commit.** Tiny commit. Single intent.

If a refactor takes more than an hour without committing, the refactor is too big. Back up, find a smaller step.

## Stage 6 — Promote the seam to a proper boundary

Once the inside of the seam has been cleaned up enough to be recognizable, the seam itself is no longer a Facade hiding a swamp; it's a real architectural boundary. At that point:

- The interface becomes the official contract.
- The implementation behind it can now follow Clean Architecture internally — with its own use cases, entities, adapters.
- Other parts of the system that have been calling the seam continue to work, unaware that the implementation behind the line has been transformed.

This is the moment when one cleaned-up component starts to *teach* the rest of the system what the new shape looks like. New code in other components, written by developers who've seen this one work, tends to follow the same pattern.

## Stage 7 — Repeat from Stage 3 on the next hotspot

Move to the #2 area, then #3. Each cleaned-up component:

- Reduces the size of the remaining mess.
- Reduces the number of files affected by typical changes.
- Provides a worked example for the team.

After 3–5 components, the trajectory of the codebase reverses: bug rate drops, change cycle time drops, onboarding gets faster, the team starts asking "can we do this for X next?"

That's the win condition. You don't have to (and shouldn't) clean up everything. You only have to clean up enough that the bleeding stops and the team has the **option** to maintain quality going forward.

## What to *not* do during cleanup

These are the failure modes most likely to derail the effort:

- **Big-bang rewrite.** "Let's start from scratch." Almost always wrong. The new system inherits the same overconfidence that produced the mess and reaches the same place a year later. (See Joel Spolsky's classic essay "Things You Should Never Do, Part I".)
- **Ad-hoc cleanup with no seam.** "I'll just refactor this method, then this one..." Without a seam, the refactor's blast radius is the whole codebase, and any commit may break ten distant places. Productivity collapses.
- **Cleanup as background work.** "Whenever I have a free hour..." Cleanup needs scheduled, defended capacity. Otherwise it loses to feature work every time.
- **Adding architecture discipline without a worked example.** "We'll start writing clean code from now on." Clean code in a Big Ball of Mud gets dirty within weeks because the surrounding codebase keeps pulling it down. You need an example component first, contained behind a real seam.
- **Trying to clean up cold code.** Code that works and nobody touches doesn't need to be clean. Touching it just to make it pretty introduces risk for no benefit.
- **Skipping the test net.** Refactoring without tests is gambling. The cost of one wrong refactor in production after a year of cleanup is enough to discredit the entire effort.
- **Reporting cleanup progress in lines refactored.** Lines is a meaningless metric. Report in **deflected defects**, **change cycle time**, **time-to-first-commit for new hires**, or **percentage of changes contained to one component**.

## Communicating with stakeholders during cleanup

Cleanup looks like nothing is happening, from outside engineering. Communicate consistently:

- **Weekly**: report on the test net (coverage at the seam, characterization tests passing).
- **Per cleaned-up component**: a short note: "We removed the `<X>` knot. New developers can now change `<X>`-related code without breaking `<Y>` or `<Z>`. Average change time on `<X>` features dropped from N hours to M."
- **Quarterly**: revisit the change-frequency / cross-contamination metrics. The trend is the story.

Stakeholders mostly care about *outcomes* — defect rate, feature velocity, onboarding speed. Frame cleanup work in those terms, not in terms of design purity.

## See also

- `references/boundaries.md` — for picking the right seam strength.
- `references/workflow-strangle.md` — for the next, lighter level of refactoring once the worst knots are gone.
- `references/clean-architecture-layers.md` — for the target shape each component is heading toward.
