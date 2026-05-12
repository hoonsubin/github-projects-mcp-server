# Functions (Ch. 3)

Functions are the primary unit of organization. The rules below compound: follow all of them.

## Rule 1: Small

Functions should be **small** — rarely more than 20 lines. Blocks within `if`, `else`, `while` should be **one line** (usually a descriptive function call).

```python
# Bad: long, nested, multiple concerns
def process_page(page_data, include_suite_setup):
    wiki_page = page_data.get_wiki_page()
    if page_data.has_attribute("Test"):
        if include_suite_setup:
            ...  # 30 more lines

# Good: each function tells a clear story
def render_page_with_setups_and_teardowns(page_data, is_suite):
    if is_test_page(page_data):
        include_setup_and_teardown_pages(page_data, is_suite)
    return page_data.get_html()
```

## Rule 2: Do One Thing

> _"Functions should do one thing. They should do it well. They should do it only."_

**Test:** Can you describe the function in one sentence with no "and"?

```python
# Bad: validates AND initializes session — two things
def check_password(username, password):
    user = find_user(username)
    if user.password_hash == hash(password):
        session.initialize()   # ← side effect!
        return True
    return False

# Good: each function does exactly one thing
def is_valid_password(username, password):
    user = find_user(username)
    return user.password_hash == hash(password)

def login(username, password):
    if is_valid_password(username, password):
        session.initialize()
```

## Rule 3: One Level of Abstraction per Function

Don't mix high-level policy with low-level detail in the same function.

```python
# Bad: mixes page rendering (high) with byte parsing (low)
def render(page):
    html = "<html>"
    for char in page.raw_bytes: ...
    return html + generate_footer()

# Good: each level isolated
def render(page):
    content = parse_content(page.raw_bytes)
    return compose_html(content)
```

Use the **Stepdown Rule**: arrange functions top-to-bottom as a narrative, each calling the next level of abstraction.

## Rule 4: Fewer Arguments

- Follow the ideal arity:
  - Aim for a niladic function (0 arguments) when possible for simplicity and clarity.
- Prefer monadic functions:
  - Functions with a single argument (monadic) are preferred as they provide clear transformation and are easier to understand.
- Acceptable use of dyadic functions:
  - Functions with two arguments (dyadic) are acceptable but use them sparingly.
- Limit the use of triadic functions:
  - Functions with three arguments (triadic) should be used sparingly as they can make the code harder to understand and maintain.
- Refactor polyadic functions:
  - For functions with four or more arguments (polyadic), consider refactoring them into a Parameter Object to improve readability and maintainability.

**Avoid flag (boolean) arguments** — they announce the function does two things:

```python
# Bad
render(page, True)     # what does True mean?

# Good: two honest functions
render_for_suite(page)
render_for_test(page)
```

When you need many args, use a Parameter Object:

```python
# Bad
make_circle(x, y, radius, color, stroke_width)

# Good
@dataclass
class CircleSpec:
    center: Point
    radius: float
    style: DrawStyle

make_circle(spec)
```

## Rule 5: Have No Side Effects

Side effects are **lies** — the name promises one thing, the side effect does another (see `check_password` in Rule 2). If a side effect is unavoidable, name the function honestly — then ask if SRP is violated.

## Rule 6: Command-Query Separation

A function should either **do something** (command) or **answer something** (query) — never both.

```python
# Bad: sets an attribute AND returns whether it was set
def set_attribute(name, value) -> bool: ...

# Good: separate concerns
def has_attribute(name) -> bool: ...
def set_attribute(name, value): ...
```

## Rule 7: Prefer Exceptions to Returning Error Codes

Error codes force immediate handling and create deep nesting. **Error handling is one thing** — a function that handles errors should do nothing else.

```python
# Bad: error handling tangled with logic
result = delete_page(page)
if result == ErrorCode.OK:
    result = registry.delete_reference(page.name)
    if result == ErrorCode.OK: ...

# Good: clean separation
def delete(page):
    try:
        delete_page_and_all_references(page)
    except Exception as e:
        log_error(e)
```

## Rule 8: Don't Repeat Yourself (DRY)

Every copy-paste is a future bug — you'll fix it in one place, not the other. Extract repeated logic into a named function named after its _intent_, not its _implementation_.

## Quick Checklist

- [ ] One sentence, no "and"?
- [ ] Under ~20 lines?
- [ ] Single level of abstraction?
- [ ] ≤ 2 arguments (or a Parameter Object)?
- [ ] Side effects reflected in the name?
- [ ] Exceptions instead of error codes?
- [ ] Any duplicated logic to extract?
