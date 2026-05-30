# Meaningful Names (Ch. 2)

Names must answer: _why it exists, what it does, how it is used._ If a name requires a comment to explain it, the name is wrong.

## Intention-Revealing Names

```python
# Bad
d = 0          # elapsed time in days

# Good
elapsed_time_in_days = 0
```

## Avoid Disinformation

- Don't use `account_list` unless it is actually a `List`. Use `accounts`.
- Never use `l`, `O`, or `I` as variable names (look like `1` and `0`).

## Make Meaningful Distinctions

Noise words add no meaning: `ProductInfo` vs. `ProductData` - what's the difference? None.
Don't suffix with `a`, `an`, `the`, `1`, `2` to avoid naming conflicts.

## Use Pronounceable Names

```java
// Bad
private Date genymdhms;

// Good
private Date generationTimestamp;
```

## Use Searchable Names

Single letters and magic numbers can't be grepped. Name length should correspond to scope size.

```python
# Bad
for j in range(34):
    s += (t[j] * 4) / 5

# Good
REAL_DAYS_PER_IDEAL_DAY = 4
WORK_DAYS_PER_WEEK = 5
for j in range(NUMBER_OF_TASKS):
    real_task_weeks = (task_estimate[j] * REAL_DAYS_PER_IDEAL_DAY) / WORK_DAYS_PER_WEEK
    sum += real_task_weeks
```

## Avoid Encodings

No Hungarian notation: `m_description` → `description`. No interface prefixes: `IShapeFactory` → `ShapeFactory`.

## Pick One Word per Concept

Choose one word per abstract concept and stick with it: pick `get` or `fetch` or `retrieve` - never all three in the same codebase.

## Use Solution and Problem Domain Names

Use CS terms where appropriate (`JobQueue`, `AccountVisitor`). When no CS term fits, use the business domain name. Keep solution vocabulary and domain vocabulary in different places.

## Add Meaningful Context

```java
// Bad: ambiguous in isolation
String firstName, lastName, street, city, state, zip;

// Good: context from class
class Address {
    String firstName, lastName, street, city, state, zip;
}
```

Don't add _gratuitous_ context: if the app is "Gas Station Deluxe", `Address` is better than `GSDAddress`.

## Quick Reference: Name Anti-Patterns

- Avoid cryptic abbreviations:
  - Use meaningful names like `elapsed_days`, `response`, `hit_points` instead of `d`, `r`, `hp`.
- Remove unnecessary noise words:
  - Eliminate words like `ProductData`, `NameString` in favor of simpler names like `Product`, `Name`.
- Clarify data types:
  - Be specific with data types, e.g., use `accounts` instead of `account_list`.
- Provide descriptive names:
  - Instead of generic names like `Manager`, `Processor`, `Info`, give them names that reflect their specific responsibility.
- Use consistent naming conventions:
  - Stick to one naming convention throughout the codebase, e.g., always use `fetch` or `get` consistently.
- Avoid magic numbers:
  - Replace magic numbers like `if score > 7:` with named constants like `if score > PASSING_SCORE:`.
- Remove commented meanings:
  - Instead of using comments to explain what a variable does, use meaningful names that convey the information directly.
