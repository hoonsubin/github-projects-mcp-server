# Comments (Ch. 4)

Source: *Clean Code*, Chapter 4 — Robert C. Martin

> *"Don't comment bad code — rewrite it."* — Kernighan & Plaugher

Comments are, at best, a **necessary evil**. They compensate for our failure to express
intent in code. They are not pure good. Comments lie over time; code does not.

---

## The Core Principle

Every time you want to write a comment, ask: **can I express this in code instead?**

```python
# Bad: comment compensates for bad name
# Check if employee is eligible for benefits
if employee.flags & HOURLY_FLAG and employee.age > 65:
    ...

# Good: code expresses intent directly
if employee.is_eligible_for_benefits():
    ...
```

---

## Good Comments (Use Sparingly)

### Legal Headers
Copyright notices required by corporate standards are acceptable.

### Intent Explanation
When code does something non-obvious, a comment can explain **why** (not what).

```python
# Comparing integers for speed; string comparison was 10x slower in profiling
result = id1 - id2
```

### Clarification of Opaque API
When using a library with obscure behavior:

```python
# assertRegex requires the pattern to be anchored with ^ when matching full string
self.assertRegex(output, r'^Success$')
```

### Warning of Consequences
```python
# Do NOT run this test concurrently — it modifies shared state in the database
def test_user_deletion(): ...
```

### TODO Comments
Acceptable for acknowledged technical debt:
```python
# TODO: replace with async version once we upgrade to Python 3.11
result = sync_fetch(url)
```

---

## Bad Comments (Always Avoid)

### Redundant Comments
The comment says exactly what the code says — adding no value:

```python
# Bad
# Set the name
self.name = name

# Bad
# Returns the day of month
def get_day_of_month(self):
    return self.day_of_month
```

### Misleading Comments
A comment that is slightly wrong is worse than no comment. It actively deceives.

### Mandated (Boilerplate) Comments
"Every function must have a Javadoc" policies produce noise, not documentation.

```java
// Bad: noise disguised as documentation
/**
 * @param title The title of the CD
 * @param author The author of the CD
 * @param tracks The number of tracks
 */
public void addCD(String title, String author, int tracks) { ... }
```

### Journal / Changelog Comments
Source control remembers history. Code does not need a change log.

```python
# Bad
# 2019-03-01 - Added null check (hk)
# 2020-06-15 - Refactored for performance (jl)
# 2023-11-02 - Fixed edge case on empty list (rb)
```

### Commented-Out Code
**Delete it.** Version control remembers it. Commented-out code rots, misleads, and clutters.

```python
# Bad
# old_result = calculate_old_way(data)
# if old_result:
#     process(old_result)
result = calculate_new_way(data)
```

### Position Markers / Section Banners
```python
# Bad
##########################################################################
## ACTION METHODS
##########################################################################
```
If you need banners to navigate a function, the function is too long.

### HTML in Comments
Source code comments are not documentation websites. HTML in comments is an abomination.

### Non-Local / Distant Comments
A comment explaining something far from where it is used becomes disconnected and misleading.

---

## Rule Summary

| Situation | Action |
|---|---|
| Want to explain *what* code does | Rename the variable or function instead |
| Want to explain *why* code does it | Write a brief intent comment |
| Found commented-out code | Delete it — check version control if needed |
| Mandated boilerplate | Push back; write only meaningful docs |
| Complex algorithm decision | Write a `why` comment, not a `what` comment |
