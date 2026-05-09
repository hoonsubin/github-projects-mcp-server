# Error Handling (Ch. 7)

Source: *Clean Code*, Chapter 7 — Robert C. Martin

Error handling is important, but it must not **obscure** the main logic. Clean error handling
reads separately from clean business logic — they don't tangle together.

---

## Use Exceptions, Not Error Codes

Error codes force the caller to handle the error immediately and create deeply nested
conditional logic. Exceptions allow the main path to remain clean.

```python
# Bad: error handling tangled with logic
result = delete_page(page)
if result == ErrorCode.OK:
    result = registry.delete_reference(page.name)
    if result == ErrorCode.OK:
        result = config_keys.delete_key(page.name.make_key())
        if result == ErrorCode.OK:
            logger.log("page deleted")
        else:
            logger.log("config key deletion failed")
    else:
        logger.log("reference deletion failed")
else:
    logger.log("delete failed")

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

---

## Write Your Try-Catch-Finally First

When writing code that can throw, **start with the try-catch-finally**. This ensures your
error handling defines the scope and contract clearly before you fill in the happy path.

Tests for error cases should come *before* tests for happy paths when practicing TDD.

---

## Error Handling Is One Thing

A function that handles errors should **do nothing else**. The `try` block and its `except`/`catch`
handler constitute the entire function body.

```python
# Good: error handling is the only job of this function
def delete(page):
    try:
        delete_page_and_all_references(page)
    except Exception as e:
        log_error(e)
```

---

## Provide Context with Exceptions

Don't throw bare exceptions. Add a message that includes:
- What operation was attempted
- What failed and why (if known)

```python
# Bad: no context
raise ValueError()

# Good: context included
raise ValueError(
    f"Cannot parse user ID from token '{token}': expected integer, got '{raw_id}'"
)
```

---

## Define Exception Classes Based on Caller Needs

Often a single exception type per subsystem is enough. Wrap third-party APIs so you can
translate their many exception types into one that makes sense for *your* callers.

```python
# Bad: caller must catch 10 different third-party exceptions
try:
    port.open()
except DeviceResponseException as e:
    ...
except ATM1212UnlockedException as e:
    ...
except GMXError as e:
    ...

# Good: wrap the third-party API
class PortDeviceFailure(Exception): ...

class LocalPort:
    def __init__(self, port_number):
        self._inner = ACMEPort(port_number)

    def open(self):
        try:
            self._inner.open()
        except (DeviceResponseException, ATM1212UnlockedException, GMXError) as e:
            raise PortDeviceFailure("Port device failure") from e
```

Wrapping third-party APIs also makes mocking in tests trivial.

---

## Don't Return None

Returning `None` forces every caller to check for it. One forgotten check = a runtime error.

```python
# Bad
def get_employee(name) -> Employee | None:
    ...

employee = get_employee(name)
if employee is not None:     # caller must remember this
    employee.do_something()

# Good option 1: raise if not found
def get_employee(name) -> Employee:
    employee = db.lookup(name)
    if employee is None:
        raise EmployeeNotFound(name)
    return employee

# Good option 2: return Null Object
class NullEmployee(Employee):
    def do_something(self): pass  # does nothing, safely

def get_employee(name) -> Employee:
    employee = db.lookup(name)
    return employee if employee else NullEmployee()
```

---

## Don't Pass None

Passing `None` to a function is as bad as returning it. It forces defensive `None` checks
inside the function. Design APIs so that `None` is not a valid argument.

---

## Quick Rules

| Situation | Action |
|---|---|
| Signaling failure | Throw an exception, not return an error code |
| Writing error-prone code | Write `try-catch` first, then fill in logic |
| Third-party library | Wrap it — translate their exceptions to yours |
| Returning "not found" | Raise, or return a Null Object |
| Optional arguments | Use keyword args with defaults, not `None` sentinel values |
| No context in exception | Add a descriptive message always |
