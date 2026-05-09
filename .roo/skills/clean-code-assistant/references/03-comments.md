# Comments (Ch. 4)

> *"Don't comment bad code — rewrite it."* — Kernighan & Plaugher

Comments compensate for our failure to express intent in code. Every time you want to write a comment, ask: **can I express this in code instead?**

```python
# Bad: comment compensates for bad name
if employee.flags & HOURLY_FLAG and employee.age > 65:
    ...  # Check if employee is eligible for benefits

# Good: code expresses intent directly
if employee.is_eligible_for_benefits():
    ...
```

## Good Comments (use sparingly)

**Legal headers** — required copyright notices are acceptable.

**Intent explanation** — *why* the code does something non-obvious, not *what*:
```python
# Comparing integers for speed; string comparison was 10x slower in profiling
result = id1 - id2
```

**Clarification of opaque API behavior:**
```python
# assertRegex requires ^ when matching the full string
self.assertRegex(output, r'^Success$')
```

**Warning of consequences:**
```python
# Do NOT run this test concurrently — it modifies shared database state
def test_user_deletion(): ...
```

**TODO comments** for acknowledged technical debt:
```python
# TODO: replace with async version once we upgrade to Python 3.11
result = sync_fetch(url)
```

## Bad Comments (always avoid)

**Redundant** — says exactly what the code already says:
```python
# Set the name
self.name = name
```

**Misleading** — slightly wrong is worse than no comment; it actively deceives.

**Mandated boilerplate** — "every function must have Javadoc" policies produce noise:
```java
/** @param title The title of the CD @param author The author of the CD */
public void addCD(String title, String author, int tracks) { ... }
```

**Changelog / journal comments** — version control remembers history; code does not need a change log.

**Commented-out code** — **delete it immediately.** Version control has it.

**Position markers / section banners** — if you need `### ACTION METHODS ###` to navigate a file, the file is too long.

**HTML in comments or non-local references** — source code is not a documentation website; distant comments become misleading as code moves.

## Rule Summary

| Situation | Action |
|---|---|
| Want to explain *what* code does | Rename the variable or function instead |
| Want to explain *why* | Write a brief intent comment |
| Found commented-out code | Delete it — version control has it |
| Mandated boilerplate | Push back; write only meaningful docs |
| Complex algorithm decision | Write a `why` comment, not a `what` |
