# Emergence (Ch. 12)

Kent Beck's **Four Rules of Simple Design** - when followed consistently, good architecture emerges naturally. Apply in priority order.

## Rule 1: Runs All the Tests (Highest Priority)

A system that cannot be tested should never be deployed. The discipline of testability pushes you toward SRP, DIP, and smaller classes automatically - tightly coupled code is hard to test, so making things testable forces good design.

## Rule 2: No Duplication

> _"Duplication is the primary enemy of a well-designed system."_

**Identical code** → extract:

```python
# Bad
def size(self): return len(self._items)
def is_empty(self): return len(self._items) == 0

# Good: eliminate duplication
def size(self): return len(self._items)
def is_empty(self): return self.size() == 0
```

**Structural duplication** across subclasses → Template Method:

```python
class VacationPolicy(ABC):
    def accrue_vacation(self):
        self._calculate_base_vacation_hours()
        self._alter_for_legal_minimums()   # varies by subclass
        self._apply_to_payroll()

    @abstractmethod
    def _alter_for_legal_minimums(self): ...

class USVacationPolicy(VacationPolicy):
    def _alter_for_legal_minimums(self): ...  # US rules only

class EUVacationPolicy(VacationPolicy):
    def _alter_for_legal_minimums(self): ...  # EU rules only
```

## Rule 3: Expressive

Code must clearly communicate intent - you understand your code now, but maintainers may not have that depth.

- Choose good names - the most powerful expressiveness tool
- Keep functions and classes small - small things are easier to name well
- Use standard patterns by name - a class called `Command` communicates its intent to anyone who knows the pattern
- Write tests as documentation - well-named tests explain what the code is supposed to do

## Rule 4: Minimal Classes and Methods (Lowest Priority)

Don't over-apply rules 1–3 to the point of creating hundreds of trivial classes or interfaces. Satisfy rules 1–3 with the _minimum amount of code necessary_. Complexity created in the name of clean design is still complexity.

## Summary

- **Runs all tests**
  - Implement decoupled, injectable, and small classes to facilitate comprehensive testing.
- **No duplication**
  - Apply the DRY (Don't Repeat Yourself) principle to eliminate code duplication.
  - Create reusable components to promote code reuse and maintainability.
  - Design good abstractions to simplify complex systems and enhance modularity.
- **Expressive**
  - Write self-documenting code by using meaningful names and clear structure.
  - Employ meaningful design patterns that convey the intent and purpose of the code.
- **Minimal**
  - Design the system to be right-sized, avoiding over-engineering.
  - Strive for minimalism by only including necessary components and features.
  - Focus on essential functionality to keep the design clean and efficient.

Apply all four together. The emergent result is clean, maintainable architecture - without an upfront grand design.
