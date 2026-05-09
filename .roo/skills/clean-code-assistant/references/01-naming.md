# Meaningful Names (Ch. 2)

Source: *Clean Code*, Chapter 2 — Tim Ottinger

Names are the primary communication tool in code. A name is a tiny act of documentation.

---

## The Rules

### Use Intention-Revealing Names
The name must answer: *why it exists, what it does, and how it is used.*

```python
# Bad
d = 0          # elapsed time in days

# Good
elapsed_time_in_days = 0
days_since_modification = 0
```

If a name requires a comment to explain it, the name is wrong.

---

### Avoid Disinformation
- Don't use `account_list` unless it is actually a `List` type. Use `account_group` or `accounts`.
- Don't use names that differ only in subtle ways: `XYZControllerForEfficientHandlingOfStrings` vs. `XYZControllerForEfficientStorageOfStrings` — readers will miss this.
- Never use `l` (lowercase L), `O` (uppercase oh), or `I` (uppercase i) as variable names.

---

### Make Meaningful Distinctions
Don't add noise words that add no meaning:
- `ProductInfo` vs. `ProductData` — what's the difference? There is none.
- Don't suffix with `a`, `an`, `the`, `1`, `2` just to avoid conflicts.
- Avoid `variable` in a variable name, `table` in a table name.

```java
// Bad: which one do I call?
getActiveAccount()
getActiveAccounts()
getActiveAccountInfo()

// Good: only one, named clearly
getActiveAccount()
```

---

### Use Pronounceable Names
You talk about code. You should be able to say the names.

```java
// Bad
private Date genymdhms;   // generation year month day hour minute second

// Good
private Date generationTimestamp;
```

---

### Use Searchable Names
Single letters and magic numbers are impossible to grep for.

```python
# Bad — what is 4? what is 5?
for j in range(34):
    s += (t[j] * 4) / 5

# Good
REAL_DAYS_PER_IDEAL_DAY = 4
WORK_DAYS_PER_WEEK = 5
for j in range(NUMBER_OF_TASKS):
    real_task_days = task_estimate[j] * REAL_DAYS_PER_IDEAL_DAY
    real_task_weeks = real_task_days / WORK_DAYS_PER_WEEK
    sum += real_task_weeks
```

**Rule:** The length of a name should correspond to the size of its scope. Short names are only OK for very small scopes (e.g., `i` in a 3-line loop).

---

### Avoid Encodings
Don't encode type or scope in names. IDEs handle this.
- No Hungarian notation: `m_description` → `description`
- No interface prefixes: `IShapeFactory` → `ShapeFactory`

---

### Pick One Word per Concept
Choose one word for one abstract concept — and stick with it across the codebase.

```
fetch / retrieve / get     ← pick ONE for "return a value"
controller / manager / driver  ← pick ONE for "coordinator"
```

---

### Use Solution and Problem Domain Names
- Use CS terms when appropriate: `JobQueue`, `AccountVisitor`, `NameParser`
- When no CS term exists, use the **problem domain** name (business language)
- Separate solution vocabulary from domain vocabulary by keeping them in different places

---

### Add Meaningful Context
Variables like `state` alone have no context. Put them in a class:

```java
// Bad: ambiguous
String firstName, lastName, street, city, state, zip;

// Good: context from class
class Address {
    String firstName, lastName, street, city, state, zip;
}
```

---

### Don't Add Gratuitous Context
If your application is called "Gas Station Deluxe", don't prefix every class with `GSD`.

```java
// Bad
GSDAccountAddress  // why?

// Good
Address
```

---

## Quick Reference: Name Anti-Patterns

| Anti-Pattern | Example | Fix |
|---|---|---|
| Cryptic abbreviation | `d`, `r`, `hp` | `elapsed_days`, `response`, `hit_points` |
| Noise word | `ProductData`, `NameString` | `Product`, `Name` |
| Wrong type implied | `account_list` (it's a set) | `accounts` |
| Vague/generic | `Manager`, `Processor`, `Info` | Name the specific responsibility |
| Inconsistent verbs | `fetch` here, `get` there | Pick one, use everywhere |
| Magic number | `if score > 7:` | `if score > PASSING_SCORE:` |
| Commented-out meaning | `d  # days elapsed` | `days_elapsed` |
