# Objects and Data Structures (Ch. 6)

Understanding the tension between objects and data structures prevents major design mistakes.

## Data Abstraction

Keep variables **private**. Mindless getters/setters just make them public with extra steps, destroying abstraction. Expose _operations_, not storage format.

```python
# Bad: exposes implementation - callers know it's stored as x, y
class Point:
    def get_x(self): return self.x
    def get_y(self): return self.y

# Good: hides implementation - callers work with behavior
class Point:
    def get_distance_from_origin(self) -> float: ...
    def translate(self, delta: Vector) -> 'Point': ...
```

## Objects vs. Data Structures

- Exposes:
  - Behavior (hides data) in Objects
  - Data (no meaningful behavior) in Data Structures
- Easy to add:
  - New types (polymorphism) in Objects
  - New functions in Data Structures
- Hard to add:
  - New functions (all classes change) in Objects
  - New types (all functions change) in Data Structures
- Examples:
  - Domain objects, services in Objects
  - DTOs, records, structs in Data Structures

Choose based on what's likely to change: new _types_ → use objects; new _operations_ → use data structures.

## The Law of Demeter

> _"A method should only talk to its immediate friends, not strangers."_

A method may only call methods on: itself, objects it created, arguments passed to it, objects held in its instance variables.

```python
# Bad: train wreck - navigates through the object graph
output_dir = context.get_options().get_scratch_dir().get_absolute_path()

# Good: ask the object for what you need
output_dir = context.get_scratch_directory_path()
```

Note: the rule applies to _objects_. Plain data structures (no behavior) are fine to navigate directly.

## Data Transfer Objects (DTOs)

Pure data structures with public fields and no behavior - used to move data between layers. **Do not add business logic to DTOs.** Either it's a DTO (data) or a domain object (behavior) - never a hybrid.

Active Records (`save()` / `find()` on a DTO) are data structures - treat them as such and keep business rules in separate domain objects.

## Quick Rules

- Private variables + meaningful public methods = proper object
- Public variables + no behavior = proper data structure (DTO)
- Train wrecks (`a.b().c()`) → extract the navigation into the object itself
- Never create hybrids (half object, half data structure)
