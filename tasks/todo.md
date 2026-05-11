# Agent's TODO List

---

## Bug

The MCP tool only reads repository issues, but cannot process draft issues on the project board.
The backend should abstract draft and normal issues into a 'user story' that with differing level of readiness.

The difference between a draft issue and full issue:

**Draft Issue**

- Only lives in the github project board. No direct relations with a specific repository
- Cannot be attached to Milestones, does not have issue labels
- Only the project fields exist
- Can be converted to a full issue for a repository (uses default repo if none are provided)
- Cannot add comments
- Can be removed or archived

**Full Issue**

- Tied to a specific repository, can be linked with Milestones, PRs, and project boards
- Contains labels and relationships
- Also contains project fields if linked with a project board
- Can be closed or archived, but not fully deleted

Therefore, the default user story create mode should be opening a draft issue. When the agent requests the MCP to add certain fields or values that is not available for draft issues, it should automatically convert it to a full issue.
For the agent reading and writing, they are all the same user story just with certain fields being missing.

## Refactoring Status Assessment

I've reviewed [`tasks/REFACTORING.md`](tasks/REFACTORING.md:1) and assessed the current state of the codebase. Here's the summary:

### Overall Status: 95% Complete

**Completed:**

- ✅ All 5 phases (1, 2, 2.5, 3, 5) implemented
- ✅ Three-layer architecture with proper dependency inversion
- ✅ Scrum tool surface fully operational (13 schemas, 13 tools)
- ✅ 19 of 20 symbols migrated in the ledger
- ✅ P1 cleanup: 3 legacy tool files deleted

**Pending (Phase 4 - Dead Code Cleanup):**

- ⏸️ 13 files to delete (broken tests, superseded services, legacy schemas)
- ⏸️ 10 files to modify (remove dead types and exports)
- ⏸️ 1 file to refactor (backend code quality - 6 code smells identified)

### Key Findings

1. **Architecture:** Fully implemented with proper layer separation (tools → use-cases → adapters)
2. **Tool Surface:** Stable Scrum vocabulary with 7 read tools and 6 write tools
3. **Backend:** [`GitHubProjectBackend`](src/adapters/github/backend.ts:66) has accumulated technical debt (1,084 lines, 6 code smells, 20 string interpolations)
4. **Migration:** Systematic progress with 95% of symbols migrated

### Critical Path

**Immediate:** Execute Phase 4 P1 cleanup (delete 9 remaining files)
**Short-term:** Complete P2-P4 cleanup (remove dead types and exports)
**Medium-term:** Refactor backend code quality (P1-P3 tasks)

The refactoring is ready for Phase 4 cleanup to complete the migration.
