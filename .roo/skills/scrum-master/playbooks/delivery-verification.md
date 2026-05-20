# Delivery Verification Playbook

> **Guard:** Never mark an item Done without verifying AC. "It looks done" is not verification.

---

## Steps

**1. Load the item. Extract each AC criterion from its body.**

**2. Classify each criterion by verification method.**
- *Static check:* verifiable by inspecting code or artifacts (file exists, function signature, config value)
- *Dynamic check:* requires a running environment (endpoint responds, UI renders, test passes)

Note the method for each criterion before delegating.

**3. Switch to a project-research or code subtask.**
Hand it the AC list with the verification method for each criterion. Ask it to return a **per-criterion pass/fail result with evidence** (file path and line reference, or test output) for each.

**4. Review the subtask results.**

**All criteria met →**
- Update item status to Done via `scrum_move_story`.
- Add a comment via `scrum_update_story` recording: AC was verified, method used, summary of evidence.

**One or more criteria NOT met →**
- Surface the specific failing criteria to the human with the evidence.
- Add a comment on the item recording the verification attempt, what passed, and what did not.
- Do not mark Done. Ask the human how to proceed.
