---
name: build-validator
description: Validate TypeScript imports and exports before committing code changes. Use this skill whenever making changes to source files that involve imports, exports, or new function usage to prevent build failures. Run before every commit or PR push to catch export/import mismatches early.
triggers:
- check imports
- validate exports
- build check
- syntax error
- import error
- missing export
- before commit
- before push
---

# Build Validator Skill

This skill validates TypeScript imports and exports to prevent build failures from leaking into CI/CD pipelines.

## When to Use

**Always run this before:**
- Creating a commit that modifies source files
- Pushing to a remote branch
- Opening a pull request
- Merging code

**Also run when:**
- Adding new functions that other files need to import
- Moving code between files
- Renaming functions or files
- Creating new utility functions that should be reusable

## Validation Checklist

### 1. Check Import Sources

When you add an import like:
```typescript
import { someFunction } from '../utils/Helper';
```

**ALWAYS verify:**
1. `someFunction` actually exists in `src/utils/Helper.ts`
2. `someFunction` is **exported** (not just defined locally)
3. The path is correct relative to the importing file

**Common mistake:**
```typescript
// ❌ WRONG - importing from wrong file
import { getRangeLabel } from '../systems/ClassProgression';

// ✅ CORRECT - importing from where it's actually exported
import { getRangeLabel } from '../data/dice';
```

### 2. Verify Function Exports

When you create a utility function that will be used elsewhere:

```typescript
// ❌ WRONG - function is private to this file
function formatSkillInfo(definition) { ... }

// ✅ CORRECT - function is exported for others to use
export function formatSkillInfo(definition) { ... }
```

### 3. Cross-File Function Usage

If you're using a function from another scene file:

```typescript
// ❌ WRONG - assuming function exists without checking
import { formatSkillInfo } from './DiceScene';

// ⚠️ ISSUE - DiceScene uses internal types that CasinoScene may not have
```

**Solutions when a function is only in one file:**
1. Move the function to a shared utility file (preferred)
2. Make it an export if cross-file import is necessary
3. Create a shared helper file for common utilities

## Quick Validation Commands

### Check if a function is exported from a file:
```bash
grep "^export function functionName\|^export const functionName" src/path/to/file.ts
```

### Check all exports from a file:
```bash
grep "^export " src/path/to/file.ts
```

### Check what's imported in a file:
```bash
grep "^import " src/path/to/file.ts
```

### Find where a function is defined:
```bash
grep -rn "^export function functionName\|^export const functionName" src/
```

## Common Error Patterns

### Pattern 1: Importing Non-Exported Function
```
ERROR: No matching export in "src/X.ts" for import "someFunction"
```
**Fix:** Either export the function from X.ts, or import from the correct file.

### Pattern 2: Function Not Defined
```
ERROR: Cannot find name 'someFunction'
```
**Fix:** Either import the function, or define it in the current file.

### Pattern 3: Circular Import
```
ERROR: Circular dependency detected
```
**Fix:** Refactor to break the cycle - move shared code to a third file.

### Pattern 4: Wrong Import Path
```
ERROR: Cannot find module '../utils/Helper'
```
**Fix:** Verify the path is correct relative to the importing file.

## Pre-Commit Validation Script

Run this before every commit:

```bash
cd /workspace/project/BattleDice

# Check for common issues
echo "=== Checking for unexported function usage ==="
grep -rn "formatSkillInfo\|getRangeLabel\|applyClassProgression" src/scenes/*.ts | grep -v "^src/scenes/.*:import\|^src/scenes/.*:export" | head -10

echo "=== Checking for missing exports ==="
grep -l "import.*formatSkillInfo" src/ | while read f; do
  if ! grep -q "export.*formatSkillInfo" "$f"; then
    echo "Warning: $f imports formatSkillInfo but may not export it"
  fi
done
```

## Decision Tree for Import Issues

```
Is the function defined in the same file?
├── YES → Is it used in another file?
│   ├── YES → Is it exported? 
│   │   ├── YES → Import should work ✓
│   │   └── NO → ADD 'export' keyword ❌
│   └── NO → No import needed ✓
└── NO → Is the function in another file?
    ├── YES → Is it exported from that file?
    │   ├── YES → Is the import path correct?
    │   │   ├── YES → Import should work ✓
    │   │   └── NO → Fix the import path ❌
    │   └── NO → Either:
    │       ├── Export it from the source file, OR
    │       ├── Move function to shared utility file
    └── NO → Function doesn't exist - create it ❌
```

## Best Practices

1. **Single Responsibility**: Each file should have a clear purpose
2. **Shared Utilities**: Put reusable functions in shared utility files
3. **Named Exports**: Use named exports for better tree-shaking
4. **Barrel Files**: Consider index.ts files for cleaner imports
5. **Type Imports**: Use `import type { X }` for type-only imports

## Example: Proper Export Flow

```typescript
// src/utils/gameHelpers.ts
export function formatSkillInfo(def) { ... }
export function getRangeLabel(range) { ... }
```

```typescript
// src/scenes/SceneA.ts
import { formatSkillInfo } from '../utils/gameHelpers';

// ✅ No issues - function is exported from shared location
```

## Rollback Procedure

If a build fails with import errors:

1. Identify the failing import from the error message
2. Check if the function exists: `grep -rn "export.*functionName" src/`
3. Check if the import path is correct
4. Fix the import or add the export
5. Test locally before pushing
