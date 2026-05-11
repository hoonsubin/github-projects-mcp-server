# Agile Game Development with Scrum

Cross-discipline guidance for game studios applying Scrum to multi-disciplinary teams (programmers, artists, designers, audio, QA, producers).

Use this reference whenever a query involves: video games, game studios, game jam projects, art pipelines, asset production, designers/artists/audio on a Scrum team, producers, publishers, milestones, alpha/beta/gold, hardening sprints, or any "we're not just programmers" team configuration.

## TOC

1. [Stages and how Scrum adapts](#1-stages)
2. [Cross-discipline team patterns](#2-team-patterns)
3. [Production stage: lean + kanban](#3-production)
4. [Discipline notes (art/audio/design/QA/production)](#4-disciplines)
5. [Role mapping (designer/producer ↔ PO/SM)](#5-role-mapping)
6. [Scaling: Scrum of Scrums, PO hierarchy, communities of practice](#6-scaling)
7. [Game-specific dysfunctions](#7-dysfunctions)
8. [Working with publishers / milestones](#8-publishers)
9. [Adoption sequence for studios](#9-adoption)

---

## 1. Stages

Game projects retain stages even when agile. Each stage adapts Scrum practices to its uncertainty profile.

| Stage               | Purpose                                        | Sprint shape                         | Backlog character                              |
| ------------------- | ---------------------------------------------- | ------------------------------------ | ---------------------------------------------- |
| **Concept**         | Build knowledge for green-light approval       | Short (1 wk), mostly **spikes**      | Tiny; throwaway prototypes, concept treatments |
| **Pre-production**  | Find the fun + learn production cost           | Full Scrum, 2 wk                     | Feature-driven; vertical slices; mechanics     |
| **Production**      | Build 8–12 hr of content from locked mechanics | Scrum + **kanban** for asset streams | Asset-driven; pipeline timeboxed               |
| **Post-production** | Polish, tune, fix; submit to platform cert     | Bug-burndown; daily-prioritized      | Bug database may replace product backlog       |

**Rule of thumb:** never enter production with mechanics still iterating — production wastes effort retrofitting assets to changed metrics (e.g. jump height changes invalidate hundreds of ledges). Pre-production ends when core mechanics + production cost are _known_, not when the schedule says so.

**Stages overlap.** Don't pick a "production start date" — production work ramps up as pre-production ramps down. Different asset classes transition at different times.

**Releases as the unit of stage management.** A 2-year game ≈ 6–8 releases of 2–3 months. Each release groups sprints toward a milestone (vertical slice, alpha, content-complete, beta, gold). Release goals shift by stage: concept treatments → mechanics → asset volume → polish.

---

## 2. Team patterns

Cross-discipline ("feature") teams are the default. Use other patterns only for specific needs.

| Pattern                        | Composition                                                 | Use when                                                    |
| ------------------------------ | ----------------------------------------------------------- | ----------------------------------------------------------- |
| **Feature team**               | 5–9 cross-disciplinary; everyone needed for a mechanic      | Default; building game-facing features                      |
| **Functional team**            | Mostly one discipline (e.g. all PS5 platform programmers)   | Foundational/infrastructure work only                       |
| **Production team**            | Cross-disciplinary tilted to content creators               | Production stage; uses kanban                               |
| **Tool team**                  | Programmers + tech artists + QA, internal customers         | Editor, exporters, build pipeline                           |
| **Shared Infrastructure (SI)** | Engine, audio middleware, cinematics — own backlog + own PO | Multiple games depend on the same tech                      |
| **Pool team**                  | Single discipline, no sprint goal; lends members            | Resource leveling (animators, FX artists) during production |
| **Integration team**           | Cross-disciplinary; owns whole-game feel                    | Large projects (40+) where mechanics have drifted           |

**Cross-discipline is non-negotiable for feature teams.** Discipline silos delay integration: programmers architect for design assumptions that change, artists make assets that won't fit the engine, designers spec features no one can build. Daily synchronization across disciplines is the whole point.

**Team size 7±2.** Coverage challenge: a level pre-prod team can need 11+ disciplines (level/prop/texture artist, animator, sound, concept, level designer, gameplay designer, graphics/gameplay/AI programmer). Solutions: share specialists across teams (FX artist 25%-time on 4 teams), trade members between sprints, or accept one over-size team rather than splitting and adding dependencies.

**Self-organization includes membership.** Teams negotiate composition between releases. Mature studios let teams "self-organize people off" — eject chronic non-performers; another team accepts them, or eventually management releases them. This is rare but it's the backstop that makes self-management real.

**Federal vs state laws.** Define studio-wide non-negotiables (engine, build pipeline, source control conventions) explicitly so teams know what they _do_ control (membership, sprint selection, working agreements, DoD additions).

---

## 3. Production: lean + kanban

In production, asset pipelines (concept → model → rig → animate → texture → audio → integrate) don't fit cleanly into sprints. Sprints empty the assembly line; assembly lines need to stay full. Many teams abandon Scrum here — don't. Layer kanban on top.

### Kanban for asset streams

Each pipeline step is a column on the board with a **WIP limit**. Cards (assets) flow left to right. The board makes flow rate visible — a Scrum task board can't.

```
Backlog → Concept(1) → Model(2) → Rig(1) → Animate(2) → Audio(1) → Integrate(1) → Done
```

The number in parens is the WIP limit. Pile-ups signal bottlenecks; empty columns signal starvation.

### Takt time vs cycle time

- **Takt time** = rate external demand requires assets (e.g. "1 finished level every 5 days")
- **Cycle time** = how long an asset spends start-to-finish in the pipeline (or in one step)

Goal: cycle time of each step ≤ takt time. If a step exceeds takt, either parallelize (3 high-res artists on 3 levels) or improve the pipeline. If a step's cycle time is less, that person picks up other work or rotates to another team.

### Levers for shorter cycle time

| Lever            | What it means                                                                 |
| ---------------- | ----------------------------------------------------------------------------- |
| Smaller assets   | Break levels into "zones"; gives faster gameplay/production/velocity feedback |
| Smaller batches  | Don't pre-build 12 character models before rigging starts                     |
| Reduce waste     | Eliminate handoff delays (move concept artist next to level designer)         |
| Empower the team | Crew of relay racers — watch the baton, not the runners                       |

### Hybrid Scrum + kanban board

Mixed teams (e.g. content team with a few programmers adding effects/AI) run the board with a **swim lane**: production work flows kanban-style; programmer work runs as a sprint inside the lane.

```
┌────────────────────────────────────────────────┐
│ Sprint lane (programmers): To Do | WIP | Done  │
├────────────────────────────────────────────────┤
│ Kanban (content): Concept→Model→Rig→...→Done   │
└────────────────────────────────────────────────┘
```

Sprint reviews and retrospectives still happen; the production side demos finished assets rather than committing to sprint goals.

### Outsourcing

Outsource pipeline _components_ (props, environment sets, modular geometry), not whole streams. Studio retains the iteration-heavy work (key characters, level layout). Use proxy assets (blue boxes for doors) so studio work continues while outsourced parts arrive.

---

## 4. Disciplines

### Art and audio

- **Stand-in assets are good.** Make them obviously temporary (candy-stripe textures, crash-test-dummy characters) so reviewers don't critique placeholders.
- **"95-mph art."** Detail the player won't see at gameplay speed is waste. A high-poly fire hydrant on a racing game's sidewalk can stop cars and ruin gameplay.
- **Approval is a bottleneck risk.** Art directors aren't on a single team, but their sign-off is often DoD. Add a `Pending Approval` column before `Done`; maintain a visible approval backlog; SM treats lingering approvals as impediments.
- **Build art knowledge in pre-production.** Refine asset budgets (poly counts, texture resolution, animation states) before production starts. Build a "vocabulary" of small rooms or asset variants before committing to a full level.
- **Art QA tooling.** Physics geometry view, texel density view, wireframe view, sound min/max view, asset selection/highlight — let artists verify their own work in-game on the target platform.
- **Creative tension is fuel, not friction.** Constraints produce richer ideas than total freedom (T.S. Eliot principle). Scrum's sprint cadence forces this tension productively.

### Design

- **Designs don't create knowledge — playable mechanics do.** Design docs are for sharing vision and identifying unknowns, not pre-resolving them. A 200-page design doc speculating on every weapon's clip size is technical debt.
- **Designer per cross-discipline team.** Senior designers on hard mechanics; usability-strong designers on HUD/UI teams.
- **"Parts on the garage floor" anti-pattern.** Building infrastructure for an unproven mechanic across many sprints (lock-picking sounds, animations, HUD timer — all before checking whether locked doors are even fun). Each sprint must integrate to a _playable_ increment, not just stockpile parts.
- **Set-based design > point-based design.** When a key decision (e.g. "stream entire levels off disc") is uncertain, prototype 2–3 alternatives in parallel until one is clearly best. Cheaper than committing early and rebuilding.
- **Designer as PO.** Often a fit (vision, player advocacy, cross-discipline communication). Pair with senior producer to cover the gaps designers typically lack: ROI, schedule discipline, project management, non-design constraints.

### QA

- **Embedded > pooled (for most of the project).** A tester on the team gives same-sprint feedback, helps with platform builds, tracks regressions. One tester per team is usually enough until late in development.
- **QA in sprint planning.** QA helps define Conditions of Satisfaction (CoS / acceptance criteria) for each story before tasks are estimated. Stories aren't done until QA-verified.
- **Bug discovery curve flips.** Traditional projects find most bugs after alpha. Agile projects find them throughout. The post-alpha curve is shallow because nothing major has been deferred.
- **Pre-alpha:** bugs go through the product backlog; PO prioritizes. **Post-alpha:** product backlog clears (un-shipped stories defer to next title); the bug database becomes the work source. Daily triage with PO + QA lead.
- **Play-testing.** Recruit demographically diverse testers, including non-developers. Run sessions with developers watching. Don't expect breakthrough ideas — expect to discover usability and pacing problems your team has gone blind to.

### Production (the role)

Producer responsibilities shift in agile from "make sure everything gets done" to bigger-picture work that teams can't do for themselves:

- External dependencies (outsourced cinematics, licensed assets, publisher deliverables)
- First-party / platform certification scheduling and requirements
- Outsourcing and insourcing coordination
- Licensing and franchise approval workflows
- Critical-chain resource scheduling for production

Tasks that fall away: building/maintaining detailed schedules, tracking individual tasks, managing intra-team dependencies — the team owns these.

---

## 5. Role mapping

Game studios usually map existing roles to Scrum roles rather than hire new ones:

| Existing role                                  | Maps to                                     | Notes                                                                |
| ---------------------------------------------- | ------------------------------------------- | -------------------------------------------------------------------- |
| Lead designer                                  | Product Owner                               | Common; pair with senior producer for ROI/schedule discipline        |
| Senior producer                                | PO support, or PO if vision-strong          | Provides project-management muscle                                   |
| Producer                                       | ScrumMaster                                 | Speaks all disciplines fluently; few sprint commitments of their own |
| Discipline lead (lead artist, lead programmer) | Mentor + Community of Practice lead, NOT SM | Their job becomes "go and see," 1:1 mentoring, asset/code review     |
| Art director / technical director              | Director-level approvers                    | Use approval columns to manage their throughput                      |

**Producer-as-SM caution:** producers from waterfall backgrounds revert to task assignment under stress. That kills self-management. Coach them on facilitation/coaching stances, not status-tracking.

---

## 6. Scaling

### Scrum of Scrums (game variant)

Holds 2–3× weekly (not daily) for 30–60 min. Reps from each team answer:

1. What did the team do since we last met?
2. What will the team do next?
3. What is blocking the team?
4. **What is the team about to throw in another team's way?** (e.g. "we're committing an animation engine change Tuesday — characters may walk strangely for a day")

Maintains a small impediment backlog; not the same as any team's product backlog.

### Hierarchy of Product Owners

For 40+ developer projects: a **lead PO** owns whole-game vision; **feature POs** own individual mechanics. Lead PO meets weekly with feature POs to keep vision aligned. Feature POs are "pigs" with their teams (daily availability); lead PO is the integrator.

### Communities of Practice

Cross-team groups of same-discipline members (all AI programmers, all character artists, all SMs) meet to share knowledge, prevent duplication of effort, propose engine/tool improvements. Communities don't have sprint goals — only knowledge-sharing.

### Aligned vs staggered sprints

**Align them.** Same start/end dates across teams enables (a) inter-team trades between sprints, (b) integrated game build for review, (c) one PO time-window. Cost: PO is hammered during planning week. Worth it.

### Lookahead planning

Mid-sprint, teams + leads spend 1–2 hrs scanning the next 2–3 sprints' likely goals to surface specialist conflicts (two teams need the FX artist same sprint) and resolve via priority shifts before sprint planning.

### Distributed teams

- Each Scrum team should be **colocated** even if the project is distributed.
- Each location gets a **local PO** under the lead PO.
- Scrum of Scrums via video, with rotating call times so no location always takes the bad slot.
- One in-person release planning meeting is worth the airfare; vision drift between locations is the highest cost.
- Build pipeline robustness matters 10× more — a bad export commit at 6pm in Stockholm wastes a full day in Vancouver.

---

## 7. Game-specific dysfunctions

| Anti-pattern                                        | Symptom                                                        | Fix                                                                                           |
| --------------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| **Production starts on schedule, not on readiness** | Mechanics still changing; assets need rework                   | Tie production start to mechanics + production-cost knowledge gates, not calendar             |
| **Parts on the garage floor**                       | Sprints stockpile infrastructure for unproven mechanics        | Every sprint must produce a playable increment of the mechanic, however thin                  |
| **Approval bottleneck**                             | Art/design director sign-off blocks "Done" for days            | Approval column on board; approval as visible impediment; director batch-reviews 2× daily     |
| **Discipline silos masquerading as teams**          | "Programming team," "Art team" with handoffs between           | Rebuild around feature teams; functional teams only for infrastructure                        |
| **Pool team becomes a queue**                       | Animators always behind; mechanic teams blocked                | Add capacity, embed animators into feature teams, or shift to kanban with explicit WIP limits |
| **Mini-waterfall sprints**                          | Designer disappears for week 1 of sprint to "write the design" | Sprint Planning is the design conversation; remaining design happens daily with team          |
| **Engine team ignores game teams**                  | Tool changes break game team's day, no warning                 | Engine team uses Scrum of Scrums to flag pending changes; treat as SI team with own PO        |
| **DoD downgraded for milestone**                    | "It compiles, ship it for the publisher demo"                  | Hardening sprint scheduled before milestone; never lower DoD                                  |
| **Producer-as-SM keeps assigning tasks**            | Team waits to be told what to pull; no self-management         | Coach producer through stance shift; track talk-time in standups                              |

---

## 8. Publishers and milestones

Publisher contracts and platform certification create real fixed dates Scrum can't dissolve. Adapt rather than fight:

- **Concept treatment** (publisher green-light): produce in concept stage as a release goal; spike-driven sprints feed the deliverable.
- **Vertical slice / first playable**: pre-production release goal; prove the fun for 1 level/mechanic.
- **Alpha (content complete)**: late pre-production / production release goal; backlog stops accepting new features.
- **Beta (feature complete + bugs)**: production release goal; bug database becomes work source.
- **Gold master / submission**: post-production; hardening + cert response cycles.

**Hardening sprints** before alpha and gold: timebox 1–2 sprints with no new feature work; backlog = bugs + polish + cert prep. Don't make it open-ended; hardening that runs forever is a planning failure.

**Client-side Product Owner.** When a publisher funds the project, give them a single PO contact (the studio's lead PO usually) who is the only voice changing scope. Avoids the "every exec has a feature request" dysfunction.

**Stage gates as release reviews.** Each milestone review is a Sprint Review at scale: demo what's done, capture publisher feedback, refine the backlog. Publishers stay closer to the game and less surprised at the end.

---

## 9. Adoption

Studios don't go agile in one sprint. Sequence:

1. **Pilot one team.** Pick a feature with clear value and a manageable scope. Mix volunteers across disciplines. SM should be the most coachable person available, not necessarily the most senior.
2. **Beachhead pattern.** Pilot team's results spread by example, not mandate. Other teams ask to convert when the pilot ships things working and on time.
3. **Split and seed.** Once 2–3 teams are running, split the experienced team in half across two new teams to seed the practices.
4. **Address the org.** Studio-wide rollout exposes manager → developer task-assignment habits, performance reviews based on individual output, and "federal vs state laws" ambiguity. These are the real adoption challenges, not the ceremonies.
5. **Accept regression.** Crunch periods, late publisher changes, key person departures all surface old habits. Use retrospectives to name them — don't pretend the team has graduated past them.

**Cargo Cult Scrum** warning: studios that adopt the ceremonies (standups, sprint planning) without the principles (transparency, self-organization, working game every sprint) get the meeting overhead with none of the benefit and conclude "Scrum doesn't work for games." It's not Scrum that didn't work.
