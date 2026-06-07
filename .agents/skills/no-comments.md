# No-Comments Code Style Guide

## Philosophy
Self-documenting code is professional code. Comments become stale, diverge from implementation, and clutter the codebase. Clean, well-named code is easier to maintain and review.

## Core Principles

### 1. Name Things Descriptively
```typescript
// Bad
const d = new Date();
const fn = () => { /* ... */ };

// Good
const currentDate = new Date();
const calculatePlayerDamage = () => { /* ... */ };
```

### 2. Extract Complex Logic into Functions
```typescript
// Bad - complex logic inline with comments
if (user && user.isActive && user.role === 'admin') { // check if user is active admin
  grantAccess();
}

// Good - named function explains intent
if (isActiveAdmin(user)) {
  grantAccess();
}

function isActiveAdmin(user: User): boolean {
  return user && user.isActive && user.role === 'admin';
}
```

### 3. Use Variables to Explain Steps
```typescript
// Bad - magic numbers with comments
const result = (value * 0.15) + 50; // apply 15% tax and base fee

// Good - named constants
const TAX_RATE = 0.15;
const BASE_FEE = 50;
const result = (value * TAX_RATE) + BASE_FEE;
```

### 4. Structure Code for Readability
```typescript
// Bad - everything on one line
const items = data.filter(x => x.active).map(x => x.name).slice(0, 10);

// Good - readable chain
const activeItems = data.filter(item => item.isActive);
const itemNames = activeItems.map(item => item.name);
const topItems = itemNames.slice(0, MAX_ITEMS);
```

### 5. Write Conditionals as Questions
```typescript
// Bad
if (user.role === 'admin' && user.isActive) { }

// Good
if (isAdmin(user) && isActive(user)) { }
```

## When Comments Are Acceptable

### Non-Obvious Workarounds
```typescript
// Phaser 3 quirk: mask must be created from graphics, not shapes
const maskShape = this.make.graphics({ x: 0, y: 0 }, false);
maskShape.fillStyle(0xffffff);
maskShape.fillRect(0, 0, width, height);
```

### Business Logic That Cannot Be Refactored
```typescript
// Magic number from legacy API - do not change
const LEGACY_MAGIC_NUMBER = 42;
```

### TODO Items
```typescript
// TODO: Refactor after Phaser upgrade (v3.95+)
// TODO: Add unit tests for scroll mechanics
```

## Anti-Patterns to Avoid

### Redundant Comments
```typescript
// Bad
const player = new Player(); // create a new player
player.setName('Alice'); // set player name

// Good
const player = new Player();
player.setName('Alice');
```

### Commented-Out Code
- Delete old code; use git history if needed

### Obvious Comments
```typescript
// Bad
if (count > 0) { // if count is greater than zero
  processItems();
}

// Good
if (count > 0) {
  processItems();
}
```

## Code Review Checklist
- [ ] Can I understand the code without reading comments?
- [ ] Are variable names descriptive enough?
- [ ] Should I extract this logic into a named function?
- [ ] Are there magic numbers that should be constants?
- [ ] Is the structure readable (not overly nested)?
- [ ] Can I remove any comments and still understand the code?

## Refactoring Process
1. Read the code to understand its purpose
2. Rename variables/functions for clarity
3. Extract complex logic into well-named functions
4. Remove redundant comments
5. Verify the code still works
6. Commit with clear message explaining improvements