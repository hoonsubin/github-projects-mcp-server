# Formatting (Ch. 5)

Formatting is **communication**. Consistent formatting lets readers build a mental model quickly. Agree on one style per project and enforce it with a formatter (`black`, `prettier`, `gofmt`, `rustfmt`) — a consistent bad style beats an inconsistent mix.

## Vertical Formatting

**File size:** target < 200 lines; hard ceiling ~500. Significant systems can be built entirely from files under 200 lines.

**Newspaper metaphor:** top = high-level summary (public interface); middle = details; bottom = lowest-level utilities. Readers stop when they have enough context.

**Vertical openness:** blank lines separate distinct thoughts:

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

**Vertical distance rules:**

- Related concepts should be vertically close; caller above callee (Stepdown Rule).
- Variable declarations: as close to first use as possible.
- Instance variables: at the top of the class (they belong to all methods).

## Horizontal Formatting

**Line length:** ideal ≤ 80 chars; hard ceiling ≤ 120. Never scroll horizontally.

**Whitespace:** use spaces to associate related things and show precedence:

```python
return (-b + math.sqrt(b*b - 4*a*c)) / (2*a)  # tight multiply, spaced addition
result = calculate(x, y)  # no space between function name and paren
```

**Indentation:** always indent, even for short blocks:

```python
# Bad
if valid: return True

# Good
if valid:
    return True
```

## Quick Reference

- File length:
  - Target < 200 lines; max ~500
- Line length:
  - ≤ 80–120 chars
- Blank lines:
  - Separate distinct concepts
- Caller/callee:
  - Caller above callee (stepdown)
- Variable declaration:
  - As close to first use as possible
- Instance variables:
  - Top of class
- Team style:
  - Use an auto-formatter; never argue
