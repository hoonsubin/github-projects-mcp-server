# Workflow - Cleaning Up a Messy Codebase

Use when the codebase is **substantially in trouble** - a Big Ball of Mud. Signs: small changes touch files all over; fragile build; nobody can say what depends on what; productivity visibly declining release over release.

This is a recovery operation measured in months. Goal: stop the bleeding, then incrementally restore the ability to change the system safely.

## Stage 0 - Set realistic expectations

Get explicit agreement before starting:

- Cleanup must be funded as real capacity - not "do it on the side" (50% of one engineer, or 20% of every engineer).
- No big-bang rewrite. The plan is incremental.
- Some areas will stay messy forever - code that works and never changes doesn't need cleanup.
- Velocity will _appear_ to drop short-term before bending back up.

If you can't get this agreement, cleanup will fail before it starts.

## Stage 1 - Make the system observable

Before changing anything, establish a safety net:

1. Add CI that runs on every commit.
2. Add at least one end-to-end smoke test of the most important happy path.
3. Add static analysis with a low bar - just establish a baseline so new violations are visible.
4. Generate the dependency graph and commit it. Re-generate weekly - it's the map of the swamp.

**Do nothing else until these exist.**

## Stage 2 - Triage: where is the change pressure?

Target the parts the team **needs to change frequently**. For each top-level module measure:

- Change frequency: `git log --since="6 months ago" --pretty=format: --name-only | sort | uniq -c | sort -rn`
- Defect frequency from issue tracker
- Cross-contamination: when this module changes, how many others also change?

**Output:** a ranked list of 3–5 hotspots. Cleanup focuses on these in order.

## Stage 3 - Establish the seam

Draw a line around the #1 hotspot. The seam is a future architectural boundary - initially a Facade or Strategy (see `references/boundaries.md`):

1. Identify what the messy module produces or consumes.
2. Define an interface for it - small, in domain language, no framework or DB types.
3. Have the rest of the world go through the interface.
4. Initially, the implementation is just the messy module behind a thin adapter.

This is the **anti-corruption layer** - it localizes the mess so the rest of the system can evolve cleanly while the mess stays sealed off.

## Stage 4 - Add tests at the seam

Write **characterization tests** that pin down the current behavior at the seam - not "is this right?", but "is this the _current_ behavior?" Their job is to prevent the mess from getting worse during cleanup.

Cover the most common happy paths, each known bug, and each branch in calling code. Don't aim for full coverage - aim for _enough to refactor with confidence_.

## Stage 5 - Refactor inside the seam

Pick the smallest knot that hurts the most. Apply the micro-loop: tests pass → small structural change → tests pass → commit. Each commit has single intent.

Techniques: extract pure functions; push side effects to edges; turn data clumps into types; replace type-field conditionals with polymorphism; move files from framework structure to domain structure.

**If a refactor takes more than an hour without committing, it's too big. Back up and find a smaller step.**

## Stage 6 - Promote the seam to a proper boundary

Once the inside is recognizable, the seam becomes a real architectural boundary - the interface is the official contract, and the implementation behind it follows Clean Architecture internally. Other components continue calling the seam unaware of the transformation.

## Stage 7 - Repeat from Stage 3 on the next hotspot

After 3–5 components: bug rate drops, change cycle time drops, onboarding gets faster. You don't have to clean everything - just enough that the team has the option to maintain quality going forward.

## What not to do

- **Big-bang rewrite** - new system inherits the same overconfidence; reaches the same mess a year later.
- **Ad-hoc cleanup without a seam** - blast radius is the whole codebase; any commit may break ten distant places.
- **Cleanup as background work** - it loses to feature work every time without defended capacity.
- **Cleaning cold code** - code that works and nobody touches doesn't need to be clean.
- **Skipping the test net** - refactoring without tests is gambling; one wrong refactor can discredit the entire effort.
- **Reporting in lines refactored** - report in deflected defects, change cycle time, time-to-first-commit for new hires.
