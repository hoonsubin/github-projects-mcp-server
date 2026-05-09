# Objects and Data Structures (Ch. 6)

Source: *Clean Code*, Chapter 6 — Robert C. Martin

There is a fundamental tension between **objects** and **data structures** that shapes every
design decision. Understanding it prevents major architectural mistakes.

---

## Data Abstraction

Keep variables **private**. Don't expose them via mindless getters/setters — that just
makes them public with extra steps, destroying the abstraction.

```python
# Bad: exposes implementation — callers know it's stored as x, y
class Point:
    def get_x(self): return self.x
    def get_y(self): return self.y
    def set_x(self, x): self.x = x
    def set_y(self, y): self.y = y

# Good: hides implementation — callers work with abstraction
class Point:
    def get_distance_from_origin(self) -> float: ...
    def get_distance_to(self, other: 'Point') -> float: ...
    def translate(self, delta: Vector) -> 'Point': ...
```

**Don't blindly add getters and setters.** Ask: *What operations does this type support?*
Express those operations, not the storage format.

---

## The Objects vs. Data Structures Dichotomy

| | Objects | Data Structures |
|---|---|---|
| **Exposes** | Behavior (methods), hides data | Data, no meaningful behavior |
| **Easy to add** | New types (extend/implement) | New functions (all types change together) |
| **Hard to add** | New functions (all classes must change) | New data structures (all functions must change) |
| **Examples** | Domain objects, services | DTOs, records, structs, POJOs |
| **OOP style?** | Yes | No (procedural) |

**Neither is universally better.** Choose based on what is likely to change:
- Expect new *types* → use objects (OO polymorphism)
- Expect new *operations* → use data structures (procedural functions)

---

## The Law of Demeter

> *"A method should only talk to its immediate friends, not strangers."*

A method `f` of class `C` may only call methods on:
1. `C` itself
2. Objects created by `f`
3. Objects passed as arguments to `f`
4. Objects held in instance variables of `C`

```python
# Bad: train wreck — navigates through the object graph
output_dir = context.get_options().get_scratch_dir().get_absolute_path()

# Good: ask the object for what you need
output_dir = context.get_scratch_directory_path()
```

Train wrecks (`a.b().c().d()`) are a strong smell that your abstraction is leaking.

**Exception:** Data structures (with no behavior) don't violate Demeter when you navigate their
fields directly. The rule applies to *objects*.

---

## Data Transfer Objects (DTOs)

Pure data structures with public fields and no behavior. Used to move data between layers
(database ↔ service ↔ API):

```python
@dataclass
class UserRecord:
    id: int
    username: str
    email: str
    created_at: datetime
```

**Do not add business logic to DTOs.** If you find yourself doing that, you've created a hybrid —
the worst of both worlds. Either it's a DTO (data) or it's a domain object (behavior). Not both.

---

## Active Record Anti-Pattern

Active Records are DTOs with `save()` and `find()` methods. They are data structures —
treat them as such. Do **not** add business rule methods to them. Create separate domain
objects that contain business rules and use the Active Record for persistence only.

---

## Quick Rules

- Private variables + meaningful public methods = proper object
- Public variables + no behavior = proper data structure (DTO)
- Train wrecks (`a.b().c()`) → extract the navigation into the object itself
- Never create hybrids (half object, half data structure)
