# Comments (Ch. 4)

> _"Don't comment bad code - rewrite it."_ - Kernighan & Plaugher

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

**Legal headers** - required copyright notices are acceptable.

**Intent explanation** - _why_ the code does something non-obvious, not _what_:

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
# Do NOT run this test concurrently - it modifies shared database state
def test_user_deletion(): ...
```

**TODO comments** for acknowledged technical debt:

```python
# TODO: replace with async version once we upgrade to Python 3.11
result = sync_fetch(url)
```

## Bad Comments (always avoid)

**Redundant** - says exactly what the code already says:

```python
# Set the name
self.name = name
```

**Misleading** - slightly wrong is worse than no comment; it actively deceives.

**Mandated boilerplate** - "every function must have Javadoc" policies produce noise:

```java
/** @param title The title of the CD @param author The author of the CD */
public void addCD(String title, String author, int tracks) { ... }
```

**Changelog / journal comments** - version control remembers history; code does not need a change log.

**Commented-out code** - **delete it immediately.** Version control has it.

**Position markers / section banners** - if you need `### ACTION METHODS ###` to navigate a file, the file is too long.

**HTML in comments or non-local references** - source code is not a documentation website; distant comments become misleading as code moves.

## Rule Summary

- Rename for clarity on what code does:
  - If the code's purpose is unclear, consider renaming the variable or function to better explain its role.
- Write intent comments for explanations of why:
  - When the reason behind a specific code implementation is important, add a brief comment describing the intent.
- Delete commented-out code:
  - If the commented-out code is no longer needed, remove it entirely as version control keeps track of changes.
- Push back on mandated boilerplate:
  - When required to include boilerplate code that doesn't serve a meaningful purpose, advocate for writing only purposeful and relevant documentation.
- Write `why` comments for complex algorithm decisions:
  - In cases where the reasoning behind a complex algorithm decision is crucial, use a `why` comment instead of a `what` comment to provide context and understanding.
