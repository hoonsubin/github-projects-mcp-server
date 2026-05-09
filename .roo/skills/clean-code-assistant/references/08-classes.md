# Classes (Ch. 10)

Source: *Clean Code*, Chapter 10 — Robert C. Martin

---

## Classes Should Be Small

Smallness in classes is measured by **responsibilities**, not lines of code.

**The test:** Write a brief description of the class. If you use "and", "but", or "or"
— the class has too many responsibilities.

```python
# Bad: does too many things
class SuperDashboard:
    def get_last_focused_component(self): ...
    def set_edit_text_color(self, color): ...
    def get_mouse_select_state(self): ...
    def get_project(self): ...
    def update_status_bar(self): ...
    # ... 70 more methods
```

---

## Single Responsibility Principle (SRP)

> *"A class should have one, and only one, reason to change."*

Every class should encapsulate **one concern**. When requirements change in one area,
only one class should need to change.

```python
# Bad: Version and SQL generation in the same class
class Version:
    def get_major_version_number(self): ...
    def get_minor_version_number(self): ...
    def get_build(self): ...
    def generate_create_sql(self): ...   # ← separate concern

# Good: separated
class Version:
    def get_major(self): ...
    def get_minor(self): ...
    def get_build(self): ...

class VersionSqlGenerator:
    def generate_create_sql(self, version: Version): ...
```

**Smell:** If you find yourself saying "this class handles X and also manages Y", split it.

---

## Cohesion

A class is **cohesive** when most methods use most instance variables. High cohesion means
the class represents a single, well-defined concept.

When a subset of methods only uses a subset of instance variables, the class wants to split:

```python
# Smell: low cohesion — not all methods use all variables
class Stack:
    def __init__(self):
        self._top_of_stack: int = 0     # used by push/pop
        self._elements: list = []        # used by push/pop
        self._description: str = ""      # only used by describe()
        self._created_at: datetime = ... # only used by describe()

# Better: two cohesive classes
class Stack:
    def __init__(self):
        self._top: int = 0
        self._elements: list = []

class StackMetadata:
    def __init__(self):
        self._description: str = ""
        self._created_at: datetime = ...
```

---

## Open/Closed Principle (OCP)

> *"Classes should be open for extension but closed for modification."*

Design so that adding new behavior requires adding new code (subclasses, implementations)
rather than changing existing code.

```python
# Bad: adding a new SQL type requires modifying Sql (risky)
class Sql:
    def generate(self, sql_type: str) -> str:
        if sql_type == "CREATE": ...
        elif sql_type == "INSERT": ...
        elif sql_type == "SELECT": ...
        # Adding UPDATE means changing this class

# Good: adding UPDATE requires only a new class — no existing code changes
class Sql(ABC):
    @abstractmethod
    def generate(self) -> str: ...

class CreateSql(Sql):
    def generate(self) -> str: ...

class InsertSql(Sql):
    def generate(self) -> str: ...

class UpdateSql(Sql):  # ← new class, nothing else changed
    def generate(self) -> str: ...
```

---

## Dependency Inversion Principle (DIP)

> *"Depend on abstractions, not concretions."*

High-level modules should not depend on low-level modules. Both should depend on interfaces.

```python
# Bad: high-level UserService directly depends on low-level MySQLDatabase
class UserService:
    def __init__(self):
        self.db = MySQLDatabase(host="localhost")  # ← concrete dependency

    def get_user(self, id): return self.db.query(...)

# Good: depends on abstraction — can swap MySQL for Postgres, mock for tests
class UserRepository(ABC):
    @abstractmethod
    def find_by_id(self, id: int) -> User: ...

class UserService:
    def __init__(self, repo: UserRepository):
        self.repo = repo

    def get_user(self, id): return self.repo.find_by_id(id)
```

---

## Organizing for Change

When you find yourself having to "open up" a class to add new functionality, that's a
signal the design isn't right. Well-organized code makes new features additions, not modifications.

Ask: *"What will change? What will stay the same?"* Encapsulate what changes.

---

## Quick Checklist

- [ ] Can I describe this class in one sentence without "and"?
- [ ] Do most methods use most instance variables?
- [ ] If I add a new type/subtype, do I need to modify existing classes?
- [ ] Does this class depend on concrete implementations instead of interfaces?
- [ ] Is there a reason to split this class that I've been avoiding?
