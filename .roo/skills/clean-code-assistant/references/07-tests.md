# Unit Tests (Ch. 9)

> _"Tests preserve and enhance the flexibility, maintainability, and reusability of the production code."_

Test code is **not** second-class. The same standards that apply to production code apply to test code. Dirty tests rot faster than dirty production code.

## Test-Driven Development (TDD)

The three laws:

1. **No production code until you have a failing test.**
2. **No more test than is sufficient to fail** (compilation failure counts).
3. **No more production code than is sufficient to pass the failing test.**

This creates a cycle measured in seconds with comprehensive coverage that evolves alongside production code.

## The FIRST Rules

- Fast: Must run quickly — slow tests don't get run
- Independent: Must not depend on each other — any order, any subset
- Repeatable: Must work in any environment — no network, no database required
- Self-Validating: Boolean output: pass or fail — no manual inspection
- Timely: Write just _before_ the production code they test

## Clean Tests

### One Concept per Test

Each test verifies a single concept. Multiple asserts are acceptable only if they all verify aspects of the _same_ concept.

```python
# Bad: three unrelated concepts in one test
def test_date_operations():
    date = Date(2024, 1, 1)
    assert date.day_of_week() == "Monday"
    assert date.add_days(31) == Date(2024, 2, 1)
    assert date.is_leap_year() == True

# Good: one concept per test, with a descriptive name
def test_day_of_week_for_new_years_2024():
    assert Date(2024, 1, 1).day_of_week() == "Monday"

def test_adding_31_days_to_january_yields_february():
    assert Date(2024, 1, 1).add_days(31) == Date(2024, 2, 1)
```

### Build-Operate-Check (Given-When-Then)

Structure each test in three parts:

```python
def test_turn_on_cooler_when_too_hot():
    # Given
    controller = EnvironmentController(too_hot_settings)
    # When
    controller.tick()
    # Then
    assert controller.state == "COOLER_ON"
```

### Test-Specific Abstractions

Build helper functions that make tests read like specifications. Low-level setup noise duplicated across every test is a smell — extract it.

```python
# Bad: setup noise drowns the intent
def test_page_renders_with_setup():
    crawler = PageCrawler()
    root = WikiPage()
    crawler.add_page(root, PathParser.parse("PageOne"))
    request = MockRequest()
    request.set_resource("root")
    ...

# Good: helpers express the specification
def test_page_renders_with_setup():
    given_pages("PageOne", "PageOne.ChildOne", "PageTwo")
    response = when_page_requested("root")
    then_response_contains(response, "PageOne", "PageTwo")
```

## What Makes a Test Dirty

- Depends on execution order
- Requires external systems (DB, network) without abstraction
- Tests too many concepts at once
- Duplicated setup code that should be extracted
- So slow nobody runs it
- Name doesn't describe what's being tested

## Test Names as Documentation

The name is the first thing a developer reads when something breaks — make it count:

```python
# Bad
def test1(): ...
def test_add(): ...

# Good
def test_adding_negative_amount_raises_value_error(): ...
def test_empty_cart_has_zero_total(): ...
```

Format: `test_{situation}_{expected_outcome}` works well.
