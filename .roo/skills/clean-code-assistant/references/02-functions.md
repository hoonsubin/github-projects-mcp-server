# Functions (Ch. 3)

Source: *Clean Code*, Chapter 3 — Robert C. Martin

Functions are the primary unit of organization. The rules below compound: follow all of them.

---

## Rule 1: Small

Functions should be **small** — rarely more than 20 lines. Blocks within `if`, `else`, `while`
should be **one line long** (usually a function call with a descriptive name).

```python
# Bad: long, nested, multiple concerns
def process_page(page_data, include_suite_setup):
    wiki_page = page_data.get_wiki_page()
    buffer = []
    if page_data.has_attribute("Test"):
        if include_suite_setup:
            suite_setup = PageCrawler.get_inherited_page(SUITE_SETUP_NAME, wiki_page)
            if suite_setup is not None:
                ...  # 30 more lines
    ...

# Good: each function tells a clear story
def render_page_with_setups_and_teardowns(page_data, is_suite):
    if is_test_page(page_data):
        include_setup_and_teardown_pages(page_data, is_suite)
    return page_data.get_html()
```

---

## Rule 2: Do One Thing

> *"Functions should do one thing. They should do it well. They should do it only."*

A function does more than one thing if you can extract a meaningful sub-function from it
that is not merely a restatement of the implementation. 

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

---

## Rule 3: One Level of Abstraction per Function

Don't mix high-level policy with low-level detail in the same function.

```python
# Bad: mixes high-level page rendering with low-level string parsing
def render(page):
    html = "<html>"
    for char in page.raw_bytes:  # low-level
        ...
    return html + generate_footer()  # high-level

# Good: each level is isolated
def render(page):
    content = parse_content(page.raw_bytes)   # low-level: isolated here
    return compose_html(content)              # high-level: isolated here
```

Use the **Stepdown Rule**: arrange functions so that reading top-to-bottom reads like a narrative,
each function calling the next level of abstraction.

---

## Rule 4: Fewer Arguments

| Arity | Name | Notes |
|---|---|---|
| 0 | niladic | Ideal |
| 1 | monadic | Good — clear transformation |
| 2 | dyadic | Acceptable — requires mental ordering |
| 3 | triadic | Use sparingly |
| 4+ | polyadic | Refactor into a Parameter Object |

**Avoid flag (boolean) arguments.** They announce the function does two things.

```python
# Bad
render(page, True)     # what does True mean?

# Good: two honest functions
render_for_suite(page)
render_for_test(page)
```

**When you need many args, use a Parameter Object:**

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

---

## Rule 5: Have No Side Effects

Side effects are **lies**. The function's name promises one thing; the side effect does another.
This creates hidden temporal coupling and order dependencies.

```python
# Bad: checkPassword secretly initializes the session
def check_password(username, password):
    ...
    session.initialize()  # ← this is a lie
    return True
```

If a side effect is unavoidable, name the function honestly: `check_password_and_initialize_session` — then ask yourself if SRP is violated.

---

## Rule 6: Command-Query Separation

A function should either **do something** (command) or **answer something** (query) — not both.

```python
# Bad: sets an attribute AND returns whether it was set
def set_attribute(name, value) -> bool:
    ...

# Good: separate concerns
def has_attribute(name) -> bool: ...
def set_attribute(name, value): ...
```

---

## Rule 7: Prefer Exceptions to Returning Error Codes

Returning error codes forces callers to handle errors immediately and creates deep nesting.
Exceptions let error handling be separated cleanly.

```python
# Bad: error handling tangled with business logic
result = delete_page(page)
if result == ErrorCode.OK:
    result = registry.delete_reference(page.name)
    if result == ErrorCode.OK:
        ...

# Good: clean separation
def delete(page):
    try:
        delete_page_and_all_references(page)
    except Exception as e:
        log_error(e)

def delete_page_and_all_references(page):
    delete_page(page)
    registry.delete_reference(page.name)
    config_keys.delete_key(page.name.make_key())
```

**Error handling is one thing.** A function that handles errors should do nothing else.

---

## Rule 8: Don't Repeat Yourself (DRY)

Duplication is the primary enemy of a well-designed system. Every time you copy-paste,
you've introduced a future bug (you'll fix it in one place but not the other).

Extract repeated logic into a named function. Name it after its *intent*, not its *implementation*.

---

## Quick Checklist

- [ ] Can I describe this function in one sentence without "and"?
- [ ] Is it under ~20 lines?
- [ ] Does it operate at a single level of abstraction?
- [ ] Do I have ≤ 2 arguments? (or a Parameter Object for more?)
- [ ] Does it have any side effects not reflected in its name?
- [ ] Does it return an error code instead of throwing an exception?
- [ ] Is there any duplicated logic I should extract?
