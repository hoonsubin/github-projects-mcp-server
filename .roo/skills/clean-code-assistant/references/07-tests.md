# Unit Tests (Ch. 9)

Source: *Clean Code*, Chapter 9 — Robert C. Martin

> *"Tests are as important to the health of a project as the production code. Perhaps more
> important, because tests preserve and enhance the flexibility, maintainability, and reusability
> of the production code."*

---

## Test-Driven Development (TDD)

The three laws of TDD:

1. **You may not write production code until you have written a failing test.**
2. **You may not write more of a test than is sufficient to fail** (compilation failure counts).
3. **You may not write more production code than is sufficient to pass the current failing test.**

This creates a cycle measured in **seconds**, not hours. The effect is comprehensive test coverage
that evolves alongside the production code.

---

## The FIRST Rules

| Rule | Meaning |
|---|---|
| **Fast** | Tests must run quickly — slow tests don't get run |
| **Independent** | Tests must not depend on each other — any order, any subset |
| **Repeatable** | Tests must work in any environment — no network, no database required |
| **Self-Validating** | Tests must have a boolean output: pass or fail — no manual inspection |
| **Timely** | Write tests *just before* the production code they test |

---

## Clean Tests

The same standards that apply to production code apply to test code. Test code is
**not** second-class. Dirty tests rot faster than dirty production code.

### One Concept per Test

Each test should verify a single concept. Multiple `assert` statements are acceptable only
if they all verify different aspects of the **same** concept.

```python
# Bad: testing multiple unrelated behaviors in one test
def test_date_operations():
    date = Date(2024, 1, 1)
    assert date.day_of_week() == "Monday"     # one concept
    assert date.add_days(31) == Date(2024, 2, 1)  # different concept
    assert date.is_leap_year() == True         # yet another concept

# Good: separate tests, each with a clear name
def test_day_of_week_for_new_years_2024():
    assert Date(2024, 1, 1).day_of_week() == "Monday"

def test_adding_31_days_to_january_yields_february():
    assert Date(2024, 1, 1).add_days(31) == Date(2024, 2, 1)

def test_2024_is_a_leap_year():
    assert Date(2024, 1, 1).is_leap_year()
```

### Build-Operate-Check Pattern (Given-When-Then)

Structure each test in three parts:
1. **Build** (Given): Set up the test data
2. **Operate** (When): Execute the code under test
3. **Check** (Then): Assert the outcome

```python
def test_turn_on_cooler_when_too_hot():
    # Given
    controller = EnvironmentController(too_hot_settings)

    # When
    controller.tick()

    # Then
    assert controller.state == "COOLER_ON"
```

### Test-Specific Language (Domain-Specific Abstractions)

Build helper functions that make tests read like specifications:

```python
# Bad: low-level setup clutters every test
def test_page_renders_with_setup():
    crawler = PageCrawler()
    root = WikiPage()
    crawler.add_page(root, PathParser.parse("PageOne"))
    crawler.add_page(root, PathParser.parse("PageOne.ChildOne"))
    request = MockRequest()
    request.set_resource("root")
    ...

# Good: test-specific helper abstracts the noise
def test_page_renders_with_setup():
    given_pages("PageOne", "PageOne.ChildOne", "PageTwo")
    response = when_page_requested("root")
    then_response_contains(response, "PageOne", "PageTwo")
```

---

## Minimizing Asserts

Fewer asserts per test = clearer tests. Strive for **one logical assertion per test concept**.
Use helper methods that bundle multiple related assertions under a clear name.

---

## What Makes a Test Dirty

- Tests that depend on execution order
- Tests that require external systems (databases, network) without abstraction
- Tests that test too many things at once
- Tests with duplicated setup code that should be extracted
- Tests that no one runs because they're slow
- Tests that don't have clear names

---

## Test Names as Documentation

Test names are the first documentation a developer reads when something breaks. Make them
count:

```python
# Bad
def test1(): ...
def test_add(): ...

# Good
def test_adding_negative_amount_raises_value_error(): ...
def test_empty_cart_has_zero_total(): ...
def test_discount_applies_only_when_order_exceeds_minimum(): ...
```

The format `test_{situation}_{expected_outcome}` works well.
