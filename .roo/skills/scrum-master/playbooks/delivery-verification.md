# Delivery Verification Playbook

Guard: never mark Done without verifying AC.

## Steps

1. Load the item. Extract each AC criterion from its body.

2. Classify each criterion by verification method:
   - Static: verifiable by inspecting code or artifacts (file exists, function signature, config value)
   - Dynamic: requires a running environment (endpoint responds, UI renders, test passes)

3. Switch to a research or code subtask. Hand it the AC list with verification method per criterion.
   Ask for a per-criterion pass/fail result with evidence (file path + line, or test output).

4. Review subtask results:
   - All criteria met → update status to Done via `scrum_move_story`; add comment recording
     AC was verified, method used, evidence summary.
   - Any criteria not met → surface the specific failures with evidence; add comment recording
     the attempt, what passed, and what did not. Do not mark Done. Ask human how to proceed.
