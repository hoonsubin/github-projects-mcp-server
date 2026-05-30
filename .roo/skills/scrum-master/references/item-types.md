# Item Types Reference

> Config templates always win. If `vocabulary.item_types` contains a `template` for a given type, use it. The formats below are fallbacks only.

## Item types

### `user_story`

**Purpose:** User-facing, outcome-oriented unit of work that delivers value to an end user.

**Mismatch signals (flag if present):**
- Body describes investigation, research, or a technical spike with no user-facing outcome
- No "as a… I want… so that…" structure or equivalent who/what/why framing
- AC is missing or describes technical steps rather than observable outcomes
- Title is phrased as a task ("Implement X") rather than a deliverable ("User can do X")

**Canonical fallback format:**

```markdown
## User Story
As a [type of user], I want [goal] so that [benefit].

## Acceptance Criteria
- [ ] [Observable, testable outcome 1]
- [ ] [Observable, testable outcome 2]

## Notes
[Dependencies, constraints, or open questions]
```

### `bug`

**Purpose:** Documents unintended behaviour in a shipped or in-development increment.

**Mismatch signals (flag if present):**
- No reproduction steps
- No distinction between expected and actual behaviour
- Describes a feature request or enhancement rather than broken behaviour
- Title frames the fix ("Fix login redirect") rather than the problem ("Login redirects to 404 after password reset")

**Canonical fallback format:**

```markdown
## Description
[Brief description of the unintended behaviour]

## Steps to Reproduce
1. [Step 1]
2. [Step 2]
3. [Step 3]

## Expected Behaviour
[What should happen]

## Actual Behaviour
[What actually happens]

## Environment
[Version, browser, OS, or other relevant context]

## Acceptance Criteria
- [ ] [The specific behaviour that confirms the bug is resolved]
```

### `spike`

**Purpose:** Time-boxed investigation to resolve an unknown or evaluate an option. Output is a finding, decision, or recommendation - not working code or a feature.

**Mismatch signals (flag if present):**
- AC describes a deliverable (code, feature, UI) rather than a decision or document
- No time-box defined (story points or calendar limit)
- Body reads as a user story ("As a user, I want…") - investigation has no user persona
- Title frames it as a delivery ("Build X") rather than an inquiry ("Evaluate X" / "Spike: Determine if X is feasible")

**Canonical fallback format:**

```markdown
## Objective
[The specific question this spike must answer or the uncertainty it must resolve]

## Time-box
[Maximum SP or calendar days allocated - must not exceed one sprint]

## Approach
[How the investigation will be conducted]

## Definition of Done
- [ ] The question above is answered with evidence
- [ ] A recommendation or decision is documented
- [ ] Any follow-on stories or tasks are created on the board

## Output
[Where the findings will be recorded - e.g., comment on this item, ADR, wiki page]
```

### `tech_debt`

**Purpose:** Captures an internal quality improvement that reduces future cost or risk. Does not deliver user-facing value directly.

**Mismatch signals (flag if present):**
- Describes a user-facing feature or behaviour change → likely a `user_story`
- No description of what the debt is (e.g., no mention of the current problematic state)
- No cost-of-deferral rationale - why does this matter now?
- AC describes outcomes observable by end users without technical context

**Canonical fallback format:**

```markdown
## Debt Description
[What is the current state that constitutes debt - be specific about the code,
 module, pattern, or practice involved]

## Cost of Deferral
[What gets harder, slower, or riskier the longer this is left unaddressed]

## Proposed Improvement
[What the improved state looks like]

## Acceptance Criteria
- [ ] [Specific technical outcome that confirms the debt is paid]
- [ ] [Tests updated or added to prevent regression]

## Notes
[Affected modules, files, or systems]
```

### `impediment`

**Purpose:** Tracks a blocking factor that prevents work from progressing. May be technical, organisational, or external.

**Mismatch signals (flag if present):**
- Describes work to be done rather than a factor blocking work → likely a `user_story` or `task`
- No indication of what item(s) or person(s) are being blocked
- No owner identified (someone must be responsible for resolution)
- Described as a permanent process or policy - impediments are temporary and resolvable

**Canonical fallback format:**

```markdown
## Blocker Description
[What is preventing progress - be specific]

## Blocked Item(s)
- [Link or ID of each item this impediment is blocking]

## Owner
[Who is responsible for resolving this impediment]

## Resolution Path
[What needs to happen for this impediment to be cleared]

## Escalation
[Who to escalate to if not resolved by Day 2 - per impediment_tracking protocol]

## Log
| Date | Update |
|------|--------|
| [date] | Impediment logged |
```

## §ac_quality - Acceptance criteria quality rules

### user_story

**Minimum count:** At least 3 criteria per story: 1+ happy path, 1+ error or edge case path, additional criteria for any other significant variation in behaviour.

**Observable behaviour only:** Each criterion must describe something a person or automated test can directly observe - not an internal system action.
- ✓ "The user sees an error message stating their session has expired."
- ✗ "The auth service returns a 401 status code." ← internal, not user-observable
- ✓ "The export file downloads as `report-2024-01.csv` with correct column headers."
- ✗ "The CSV serialiser formats the output correctly." ← describes implementation

**No compound conditions:** Each criterion is one assertion. If the word "and" joins two observable outcomes, split into two separate criteria.
- ✗ "The form resets and the user sees a success toast." → split into two criteria

**Testability gate:** If a criterion cannot be answered with a clear pass/fail by someone who has never seen the code, rewrite it. Vague words that fail this gate: "correctly", "properly", "appropriately", "as expected", "works", "handles".

If any of these rules are violated in a draft, surface the specific failing criteria and offer rewrites before proceeding to Phase 3. Do not advance to field confirmation while AC is not quality-compliant.

### bug

**Minimum count:** At least 1 criterion - the specific, observable behaviour that confirms the bug is resolved. Generic criteria ("the bug is fixed") do not qualify.

**Regression path:** When the bug has a known repro path, the AC should confirm that the exact reproduction steps from the bug description now produce the expected (not actual) behaviour.

### tech_debt

**Minimum count:** At least 2 criteria: 1 technical outcome criterion (the improved state is measurable or observable in code/tests) and 1 regression guard (existing behaviour is preserved - tests pass, no new failures).

**No user-facing scope creep:** AC should not describe new user-visible behaviour. If a criterion does, the item has drifted into `user_story` territory - surface a type mismatch flag.

### spike

Spikes do not use standard AC. Their "Definition of Done" section replaces AC. The done criteria must describe a deliverable artefact (document, ADR, prototype, decision record) - not code or a feature. If the spike output section describes working software, flag a type mismatch: this should be a `user_story` or `tech_debt`.

## Reclassification protocol

When a mismatch is detected:

1. Surface the flag with the specific signals that triggered it.
2. Ask: "Should I update my understanding of this item, or should we reclassify it?"
3. Wait for the human's decision before making any change.
4. On reclassification:
   - Update the item type field via `scrum_set_field`
   - Reformat the body to match the new type's template (config template first, fallback here)
   - Add an audit comment: old type → new type + reason, per `audit_logging_protocol`
