# Agent-Side Sprint Computations

Load this file only when a request requires computing burndown, velocity, sprint risk counts, or
DoR readiness — i.e. "Recommendation / ceremony / planning" sessions, or coaching responses that
reference project metrics. Do not load for item lookups, single-field writes, or grooming sessions.

All sprint metrics are computed by the agent from item-level facts, not pulled pre-computed. Each
item in scope is described by: a story-point estimate (or none), a completion timestamp (if done),
whether it is currently blocked, and whether it has an assignee.

## Burndown series

1. Gather the active sprint's items with their story-point estimates and completion timestamps.
2. `totalPoints` = sum of story points across all items (treat unestimated as 0). This includes
   completed items — it represents the full sprint scope, not just remaining work.
3. Walk calendar days from the sprint's start date to `min(today, end date)`, one entry per day:
   - `endOfDay` = that date at 23:59:59 UTC
   - `completedByDay` = sum of story points for items completed at or before `endOfDay`
   - Series entry: `{ date, remaining_points: totalPoints - completedByDay, completed_points: completedByDay }`
4. Flatline signal: ≥3 consecutive days with zero change in `completed_points` → surface as burndown flatline risk.

## Ideal burndown line

For each day index `d` from 0 to the sprint's duration in days (inclusive):
- `date` = sprint start date + `d` days
- `remaining_points` = `totalPoints × (1 − d / duration_days)`, rounded to one decimal

## Velocity (agent-side)

1. Identify completed sprints, most recent first.
2. For each sprint in the lookback window (default: the project's configured velocity window,
   fallback 5): gather its items' story points and completion timestamps.
   - `sprintVelocity` = sum of story points for items that were actually completed
3. `avgVelocity` = mean of collected sprint velocities (exclude sprints with zero total points).
4. `daysRemaining` = days from today to the active sprint's end date (floor to 0 if past).

## Sprint risk counts

Derived directly from active-sprint item listings — no separate lookup needed. Exclude items in a
terminal ("done") status:

| Risk signal | Condition |
|---|---|
| Unestimated | no story-point estimate, or zero |
| Blocked | item is currently blocked |
| No assignee | item has no assignee |

Surface all three counts when loading sprint health for "Recommendation / ceremony / planning" sessions.

## DoR readiness assessment

Sprint item listings are typically summary-level and don't carry full item body text, so readiness
is assessed from what the listing does expose:

1. Gather the active sprint's item listings.
2. Load the project's configured DoR criteria.
3. For each item, evaluate each configured DoR criterion against the available fields (type set,
   estimate present, acceptance criteria visible in the listing summary, no open dependencies).
4. `readinessPct` = `readyCount / totalActiveCount × 100` (exclude Done items).
5. Flag sprints where `readinessPct < 70%` as at-risk for planning.
