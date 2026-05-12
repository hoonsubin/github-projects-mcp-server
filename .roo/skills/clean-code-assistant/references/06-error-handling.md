# Error Handling (Ch. 7)

Error handling must not **obscure** the main logic. Clean error handling reads separately from clean business logic — they don't tangle together.

## Use Exceptions, Not Error Codes

Error codes force the caller to handle errors immediately and create deeply nested logic. Exceptions let the main path remain clean.

```python
# Bad: error handling tangled with logic
result = delete_page(page)
if result == ErrorCode.OK:
    result = registry.delete_reference(page.name)
    if result == ErrorCode.OK:
        result = config_keys.delete_key(page.name.make_key())
        if result == ErrorCode.OK:
            logger.log("page deleted")

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

## Write Your Try-Catch-Finally First

When writing code that can throw, start with `try-catch-finally`. This defines the scope and contract before you fill in the happy path.

## Error Handling Is One Thing

A function that handles errors should **do nothing else**. The `try` block and its handler constitute the entire function body (see `delete()` above).

## Provide Context with Exceptions

Don't throw bare exceptions — include what operation was attempted and why it failed:

```python
# Bad
raise ValueError()

# Good
raise ValueError(
    f"Cannot parse user ID from token '{token}': expected integer, got '{raw_id}'"
)
```

## Define Exception Classes Based on Caller Needs

Wrap third-party APIs to translate their many exception types into one that makes sense for _your_ callers:

```python
# Bad: caller must handle multiple third-party exception types
try:
    port.open()
except DeviceResponseException as e: ...
except ATM1212UnlockedException as e: ...
except GMXError as e: ...

# Good: wrap the API — also makes mocking trivial
class PortDeviceFailure(Exception): ...

class LocalPort:
    def open(self):
        try:
            self._inner.open()
        except (DeviceResponseException, ATM1212UnlockedException, GMXError) as e:
            raise PortDeviceFailure("Port device failure") from e
```

## Don't Return Null

Returning `None` forces every caller to check for it. One forgotten check = a runtime error.

```python
# Bad
def get_employee(name) -> Employee | None: ...
employee = get_employee(name)
if employee is not None:     # caller must remember this
    employee.do_something()

# Good: raise if not found
def get_employee(name) -> Employee:
    employee = db.lookup(name)
    if employee is None:
        raise EmployeeNotFound(name)
    return employee
```

**Don't pass `None` either.** Design APIs so that `None` is not a valid argument.

## Quick Rules

- Signaling failure: Throw an exception, not an error code
- Writing error-prone code: Write try-catch first, then fill in logic
- Third-party library: Wrap it — translate their exceptions to yours
- Returning "not found": Raise an exception
- Optional arguments: Use keyword args with defaults, not None sentinels
- No context in exception: Always add a descriptive message
