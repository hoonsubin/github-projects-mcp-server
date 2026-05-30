# Classes (Ch. 10)

Smallness in classes is measured by **responsibilities**, not lines of code.

**The test:** Write a brief description of the class. If you use "and", "but", or "or" - it has too many responsibilities.

## Single Responsibility Principle (SRP)

> *"A class should have one, and only one, reason to change."*

```python
# Bad: Version and SQL generation in the same class
class Version:
    def get_major(self): ...
    def get_build(self): ...
    def generate_create_sql(self): ...   # ← separate concern

# Good: separated
class Version:
    def get_major(self): ...
    def get_build(self): ...

class VersionSqlGenerator:
    def generate_create_sql(self, version: Version): ...
```

**Smell:** "This class handles X *and* also manages Y" → split it.

## Cohesion

A class is cohesive when most methods use most instance variables. When a subset of methods only uses a subset of variables, the class wants to split.

```python
# Smell: low cohesion - _description is unrelated to stack operations
class Stack:
    def __init__(self):
        self._top: int = 0
        self._elements: list = []
        self._description: str = ""    # only used by describe()

# Better: two cohesive classes
class Stack:
    def __init__(self):
        self._top: int = 0
        self._elements: list = []

class StackMetadata:
    def __init__(self):
        self._description: str = ""
```

## Open/Closed Principle (OCP)

> *"Classes should be open for extension but closed for modification."*

Adding new behavior should require adding new code, not changing existing code.

```python
# Bad: adding a new SQL type requires modifying Sql
class Sql:
    def generate(self, sql_type: str) -> str:
        if sql_type == "CREATE": ...
        elif sql_type == "INSERT": ...

# Good: adding UPDATE is a new class - nothing else changes
class Sql(ABC):
    @abstractmethod
    def generate(self) -> str: ...

class CreateSql(Sql):
    def generate(self) -> str: ...

class UpdateSql(Sql):  # ← new class, nothing modified
    def generate(self) -> str: ...
```

## Dependency Inversion Principle (DIP)

> *"Depend on abstractions, not concretions."*

```python
# Bad: UserService depends directly on MySQLDatabase
class UserService:
    def __init__(self):
        self.db = MySQLDatabase(host="localhost")

# Good: depends on abstraction - can swap MySQL for Postgres or a mock
class UserRepository(ABC):
    @abstractmethod
    def find_by_id(self, id: int) -> User: ...

class UserService:
    def __init__(self, repo: UserRepository):
        self.repo = repo
```

## Organizing for Change

When you find yourself "opening up" a class to add functionality, the design isn't right. Ask: *"What will change? What will stay the same?"* - encapsulate what changes.

## Quick Checklist

- [ ] One sentence description without "and"?
- [ ] Most methods use most instance variables (high cohesion)?
- [ ] Adding a new type only requires adding new code?
- [ ] Depends on abstractions, not concrete implementations?
- [ ] Any split you've been avoiding?
