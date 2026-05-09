# Formatting (Ch. 5)

Source: *Clean Code*, Chapter 5 — Robert C. Martin

Formatting is about **communication**. It is not an optional nicety — it is a professional
obligation. Consistent formatting enables readers to build a mental model of the code quickly.

---

## Vertical Formatting

### File Size
- Target: **< 200 lines** per file
- Hard ceiling: **< 500 lines** (rare exceptions only)
- Significant systems (FitNesse: 50,000 lines) can be built entirely from files under 200 lines

Small files are easier to understand, navigate, and reason about.

### The Newspaper Metaphor
Organize a file like a newspaper article:
- **Top**: High-level summary (class name, public interface)
- **Middle**: Details (private methods)
- **Bottom**: Lowest-level utilities

Readers should be able to stop reading when they have enough context.

### Vertical Openness Between Concepts
Use blank lines to separate **distinct thoughts**:

```python
# Bad: crammed together
def process(data):
    result = parse(data)
    validate(result)
    save(result)
    notify(result)

# Good: blank lines group related steps
def process(data):
    result = parse(data)
    validate(result)

    save(result)
    notify(result)
```

### Vertical Density (Related Code Stays Together)
Lines of code that are **tightly related** should appear **together** without blank lines between them:

```python
# Bad: blank line interrupts a tight group
class ReporterConfig:
    m_className: str

    m_properties: list[Property]  # ← blank line breaks cohesion

# Good: tight group
class ReporterConfig:
    m_className: str
    m_properties: list[Property]
```

### Vertical Distance
- **Related concepts** should be **vertically close**
- **Caller and callee** should be close — ideally the caller above the callee (Stepdown Rule)
- **Variable declarations**: declare as close to first use as possible
- **Instance variables**: declared at the top of the class (they belong to all methods)
- **Dependent functions**: if A calls B, A should appear above B in the file

---

## Horizontal Formatting

### Line Length
- Ideal: **≤ 80 characters**
- Hard ceiling: **≤ 120 characters**
- Never scroll horizontally to understand code

### Horizontal Whitespace
Use spaces to associate related things and disassociate unrelated things:

```python
# Around operators to show precedence
return (-b + math.sqrt(b*b - 4*a*c)) / (2*a)

# No space between function name and opening paren
result = calculate(x, y)

# Spaces after commas in argument lists
make_circle(center, radius, color)
```

### Indentation
Indentation is the visual grammar of scope. Never break it, even for short blocks:

```python
# Bad: no indentation on short if
if valid: return True

# Good: always indent
if valid:
    return True
```

### Team Conventions Override Personal Preferences
Agree on a single style for the whole codebase. A consistent bad style is better than
an inconsistent mixture of individual "correct" styles.

Use a linter/formatter (`black`, `prettier`, `gofmt`, `rustfmt`) to enforce consistency
automatically, so the team doesn't argue about it.

---

## Quick Reference

| Concern | Guideline |
|---|---|
| File length | Target < 200 lines; max ~500 |
| Line length | ≤ 80–120 chars |
| Blank lines | Use to separate distinct concepts |
| Caller/callee order | Caller above callee (stepdown) |
| Variable declaration | As close to use as possible |
| Instance variables | Top of class |
| Team style | Use an auto-formatter; never argue |
