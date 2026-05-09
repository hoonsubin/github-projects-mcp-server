# Emergence (Ch. 12)

Source: *Clean Code*, Chapter 12 — Jeff Langr / Kent Beck

> *"What if there were four simple rules that you could follow that would help you create
> good designs as you worked?"*

Kent Beck's **Four Rules of Simple Design** describe conditions that, when followed
consistently, cause good architecture to emerge naturally. Apply them in priority order.

---

## Rule 1: Runs All the Tests (Highest Priority)

A system that cannot be tested should never be deployed. Verifiability is not optional.

**Why it enables good design:**
Writing tests forces decoupling. Tightly coupled code is hard to test. The discipline of
making things testable pushes you toward SRP, DIP, and smaller classes automatically.

- Use dependency injection so collaborators can be mocked
- Keep classes small so tests remain focused
- A class that is hard to test is a design smell, not a testing problem

---

## Rule 2: No Duplication

> *"Duplication is the primary enemy of a well-designed system."*

Duplication is additional work, additional risk, and additional unnecessary complexity.
It exists in many forms:

**Identical code:**
```python
# Bad: same logic duplicated
def size(self): return len(self._items)
def is_empty(self): return len(self._items) == 0

# Good: eliminate duplication
def size(self): return len(self._items)
def is_empty(self): return self.size() == 0
```

**Similar code** (can be merged with a small refactor):
```python
# Bad: two methods with nearly identical structure
def scale(self, factor):
    self._image.dispose()
    gc.collect()
    self._image = ImageUtils.get_scaled_image(self._image, factor, factor)

def rotate(self, degrees):
    self._image.dispose()
    gc.collect()
    self._image = ImageUtils.get_rotated_image(self._image, degrees)

# Good: extract the common pattern
def _replace_image(self, new_image):
    self._image.dispose()
    gc.collect()
    self._image = new_image

def scale(self, factor):
    self._replace_image(ImageUtils.get_scaled_image(self._image, factor, factor))

def rotate(self, degrees):
    self._replace_image(ImageUtils.get_rotated_image(self._image, degrees))
```

**Template Method pattern** for structural duplication across subclasses:
```python
class VacationPolicy(ABC):
    def accrue_vacation(self):
        self._calculate_base_vacation_hours()
        self._alter_for_legal_minimums()   # ← varies by country
        self._apply_to_payroll()

    @abstractmethod
    def _alter_for_legal_minimums(self): ...

class USVacationPolicy(VacationPolicy):
    def _alter_for_legal_minimums(self):
        ...  # US-specific logic only

class EUVacationPolicy(VacationPolicy):
    def _alter_for_legal_minimums(self):
        ...  # EU-specific logic only
```

---

## Rule 3: Expressive

> *"It's easy to write code that we understand, because at the time we write it
> we're deep in the understanding of the problem. But maintainers may not have that depth."*

Code must clearly communicate the programmer's intent. You understand your code now;
your future self and teammates may not.

**How to be expressive:**
- Choose good names — the most powerful expressiveness tool
- Keep functions and classes small — small things are easier to name well
- Use standard patterns by name — a class called `Command` or `Visitor` communicates its intent to anyone who knows the pattern
- Write tests as documentation — well-named tests explain what the code is supposed to do

> *"The most important way to be expressive is to try. Spend a little time with each of your
> functions and classes. Care is a precious resource."*

---

## Rule 4: Minimal Classes and Methods (Lowest Priority)

Don't over-apply the other rules to the point of creating hundreds of tiny, trivial classes.

- Don't create an interface for every class
- Don't split every tiny function into its own class
- Don't generate methods just to have methods

This rule says: **satisfy rules 1–3 with the minimum amount of code necessary**.
Complexity created in the name of clean design is still complexity.

---

## Summary

| Rule | What it produces |
|---|---|
| Runs all tests | Decoupled, injectable, small classes |
| No duplication | DRY, reusable components, good abstractions |
| Expressive | Self-documenting code, meaningful patterns |
| Minimal | Right-sized design — not over-engineered |

Apply them together. The emergent result is clean, scalable, maintainable architecture
— without following an upfront grand design.
