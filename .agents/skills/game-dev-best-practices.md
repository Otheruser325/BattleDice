# Battle Dice - Game Development Best Practices

## Project Overview
Battle Dice is a Phaser 3 game built with TypeScript. The codebase prioritizes clean, professional code without comments where the code is self-explanatory.

## Code Style Guidelines

### Self-Documenting Code
- Write code that explains itself through clear naming and structure
- Avoid redundant comments that repeat what the code does
- Use descriptive variable and function names
- Complex logic should be refactored into well-named functions

### When to Add Comments
- Only add comments for non-obvious business logic or edge cases
- Document Phaser-specific quirks or workarounds
- Explain *why* something is done, not *what* the code does
- TODO comments are acceptable for tracking technical debt

### Naming Conventions
- Use camelCase for variables and functions
- Use PascalCase for class names and component types
- Prefix private class members with underscore (`_variable`)
- Use past/present tense appropriately (`createModal` vs `closeModal`)

### Phaser 3 Patterns
- Use `this.add.*` for creating game objects
- Use `this.make.*` for creating objects without adding to scene
- Prefer `setInteractive({ useHandCursor: true })` for clickable elements
- Use masks via `createGeometryMask()` on containers for scrolling
- Prefer local arrow functions over bound methods for callbacks

### Scene Management
- Always implement `shutdown()` method to clean up:
  - Destroy timers (`timer.destroy()`)
  - Remove input listeners (`this.input.off(...)`)
  - Clean up game objects (`modalElements.forEach(e => e.destroy())`)
- Use flags (`modalOpen`, `subModalOpen`) to track state
- Use `once()` for one-time event listeners, `on()` for persistent ones

### Error Prevention
- Always check `element && 'method' in element` before calling methods
- Avoid `instanceof` checks on Phaser objects (use duck typing instead)
- Use try-catch for async operations (especially fetch calls)
- Reset state flags in finally blocks or close handlers

### Modals and Sub-modals
- Parent modal controls lifecycle of sub-modals
- ESC key: close sub-modal first, then parent modal
- Close button: check sub-modal state before closing parent
- Disable parent modal elements when sub-modal is open
- Re-enable parent elements when sub-modal closes

### State Management
- Use `SettingsStore.get(this)` and `ProfileStore.get(this)` for persistent data
- Avoid direct state manipulation; use store methods
- Clean up stores in `shutdown()` to prevent memory leaks

## TypeScript Guidelines

### Type Safety
- Use specific types over `any` where possible
- Define interfaces for complex data structures
- Use type guards for runtime checks

### Null Safety
- Always check for null/undefined before accessing properties
- Use optional chaining (`?.`) for safe property access
- Use nullish coalescing (`??`) for default values

## Testing Guidelines
- Test UI flows with deterministic browser state
- Verify scroll mechanics work with various content lengths
- Test modal open/close sequences thoroughly
- Verify ESC key handling in all states

## Git Workflow
- Keep commits focused and atomic
- Use clear commit messages describing *why* changes were made
- PR titles should be concise but descriptive