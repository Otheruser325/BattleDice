---
name: battle-dice-arena
description: Test Battle Dice Arena UI flows locally with deterministic browser state. Use when verifying login rewards, Shop offers, Arena flows, Chest opening mechanics, Dice scene interactions, or other Phaser UI changes. Covers daily challenges, casino tables, chest opening, dice progression, and arena PVP/PVE scenarios.
triggers:
- battle dice
- battle-dice-arena
- test dice game
- dice scene
- chest opening
- arena scene
- casino scene
- daily challenge
---

# Battle Dice Arena - UI Testing Skill

> **⚠️ Before committing changes**: Run the `build-validator` skill to catch import/export errors early!

This skill helps you test the Battle Dice game UI flows locally with deterministic browser state. It covers all major game scenes: Menu, Dice, Shop, Arena, Casino, and their interactions.

## Game Overview

**Battle Dice** is a strategic dice combat game where:
- Players collect and upgrade dice with different abilities
- Each die has Attack, Health, Range, and special Skills
- Combat takes place on a 5x5 grid with PvP or PvE battles
- Dice can be upgraded through Class levels (1-15)
- Rarities: Common, Uncommon, Rare, Epic, Legendary, Mythic

## Accessing the Game

### Local Development
```bash
cd /workspace/project/BattleDice
npm install
npm run dev
# Open http://localhost:5173 in browser
```

### Work Hosts (Production Testing)
- **Work Host 1**: https://work-1-anqscyauocxyxrdw.prod-runtime.all-hands.dev/ (port 12000)
- **Work Host 2**: https://work-2-anqscyauocxyxrdw.prod-runtime.all-hands.dev/ (port 12001)

## Testing Specific UI Flows

### 1. Dice Scene - Click Display
**Objective**: Verify dice detail modal displays correctly when clicking dice cards.

**Procedure**:
1. Navigate to the Dice scene
2. Click on any dice card (Fire, Ice, Poison, etc.)
3. Verify the modal shows:
   - Title with accent color
   - Class level (e.g., "CLASS 5/15")
   - Rarity with colored circle indicator
   - ATK/HP/RANGE stats
   - Skill description
   - Assign and Class Up buttons

**Expected Behavior**:
- Modal appears with dark overlay
- Rarity text uses colored text matching rarity (no squares/circles needed)
- Buttons work correctly (Assign adds to loadout, Class Up upgrades)

### 2. Chest Opening - Reward Display
**Objective**: Verify chest reward modal matches Dice scene UI style.

**Procedure**:
1. Navigate to Casino scene
2. Open a chest (Bronze, Silver, Gold, Diamond, or Master)
3. Click "Open" or "Open All"
4. View the rewards modal

**Expected Behavior**:
- Reward cards have colored borders matching rarity
- Header section with accent color
- Dice title displayed in rarity color
- Copies count displayed clearly
- "NEW" badge appears for newly unlocked dice
- Clicking a reward card shows detailed modal with:
  - Class level
  - Rarity (with colored circle)
  - Copies owned
  - Stats and skills

### 3. Daily Challenge - Loadout Mode
**Objective**: Verify daily challenge respects mirror vs random loadout selection.

**Procedure**:
1. Navigate to Arena scene
2. Select "Daily Challenge"
3. Observe the loadout generation

**Expected Behavior**:
- 50% of days use mirror loadout (your dice, different class-ups)
- 50% of days use random loadout (opponent gets different dice)
- Hard days (every 4th day) have:
  - Player max class capped at 11
  - Enemy gets +3 class levels above player's best die

### 4. Shop Scene - Rarity Display
**Objective**: Verify rarity highlighting in shop cards.

**Procedure**:
1. Navigate to Shop scene
2. Observe daily offers

**Expected Behavior**:
- Rarity text uses neutral color
- Card borders or accents use rarity color
- Stats and skill info use neutral text color

## Test State Management

### Saving Test State
```javascript
// Export current state to JSON
const state = {
  diceProgress: localStorage.getItem('dice:progress'),
  loadout: localStorage.getItem('dice:loadout'),
  shop: localStorage.getItem('shop:state')
};
console.log(JSON.stringify(state, null, 2));
```

### Restoring Test State
```javascript
// Clear and restore state
localStorage.clear();
// Restore saved state
Object.entries(savedState).forEach(([key, value]) => {
  localStorage.setItem(key, value);
});
location.reload();
```

### Forcing Specific Test Scenarios

**Test Max Class 15 Dice**:
```javascript
const dice = JSON.parse(localStorage.getItem('dice:progress') || '{}');
Object.keys(dice).forEach(typeId => dice[typeId].classLevel = 15);
localStorage.setItem('dice:progress', JSON.stringify(dice));
location.reload();
```

**Test Daily Hard Mode**:
- Hard days occur when `new Date().getDate() % 4 === 0`
- Check by evaluating: `new Date().toISOString().slice(0, 10)` and checking if day number is divisible by 4

**Test Full Chests**:
```javascript
const casino = JSON.parse(localStorage.getItem('casino:state') || '{}');
casino.chests = { Bronze: 100, Silver: 50, Gold: 20, Diamond: 10, Master: 5 };
localStorage.setItem('casino:state', JSON.stringify(casino));
location.reload();
```

## Common Test Scenarios

### Scenario 1: Verify New Dice Unlocks
1. Clear localStorage to reset state
2. Open many Master chests with "Open All"
3. Check for "NEW" badges on unlocked dice
4. Verify chest-copy resolution distributes across rarities

### Scenario 2: Verify Class Progression Display
1. Navigate to Dice scene
2. Click each die in your loadout
3. Verify modal shows correct class level
4. Check Class Up button requires both tokens and copies
5. Verify preview shows ATK/HP/skill deltas

### Scenario 3: Verify Arena Loadout Display
1. Enter Arena with random loadout mode
2. Click on your dice in the hand area
3. Verify dice detail modal shows class level and rarity
4. Check enemy dice (when revealed) have different class distribution

### Scenario 4: Verify Chest Reward Distribution
1. Open 10 Diamond chests
2. Note the rarity distribution
3. Open 10 Master chests
4. Compare distributions (Master should have more Epic/Legendary)
5. Verify no single dice type gets overflow copies (cap respected)

## Debugging Tips

### Check Browser Console
- Press F12 or Cmd+Option+I to open DevTools
- Check Console tab for errors
- Check Network tab for failed asset loads

### Inspect localStorage
```javascript
// List all keys
Object.keys(localStorage).forEach(k => console.log(k));

// Get specific game state
JSON.parse(localStorage.getItem('dice:progress') || '{}')
JSON.parse(localStorage.getItem('shop:state') || '{}')
```

### Force Specific Scenes
```javascript
// Navigate to specific scene via console
scene.scene.start('Dice'); // or 'Arena', 'Shop', 'Casino'
```

## Expected UI Elements by Scene

### Menu Scene
- Play button → Arena scene
- Dice button → Dice scene  
- Shop button → Shop scene
- Casino button → Casino scene
- Settings button → Settings scene

### Dice Scene
- Loadout slots (5 dice positions)
- Deck selector (1-3 for separate loadouts)
- Dice cards grid (sorted by rarity)
- Modal: Class level, rarity circle, assign/class-up buttons

### Arena Scene
- Grid (5x5 for each player)
- Hand area (bottom for player dice)
- Enemy fog (revealed on match end)
- Mode selector (Daily, Dopamine, Deucifer challenges)

### Casino Scene
- Fives table (main dice game)
- Craps table (secondary game)
- Chest sidebar (Bronze, Silver, Gold, Diamond, Master)
- Rewards modal with detailed dice view

### Shop Scene
- Diamond balance display
- Daily offers grid (scrollable)
- Freebie offer (marked with star)
- Currency bundles (token/chip offers)

## File Locations for Reference

- **Dice Definitions**: `/public/gamedata/DiceDefinitions/`
- **Scene Code**: `/src/scenes/` (DiceScene.ts, ArenaScene.ts, CasinoScene.ts, ShopScene.ts, SettingsScene.ts)
- **Data Management**: `/src/data/dice.ts`
- **Skills System**: `/src/systems/DiceSkills.ts`
- **Class Progression**: `/src/systems/ClassProgression.ts`

## Known Issues & Fixes

### 1. Changelog Scroll Mask (Fixed in #175)
**Problem**: White rectangle covered changelog text, making it unreadable.

**Root Cause**: Using `this.add.rectangle()` for the mask shape creates a visible white rectangle. Phaser masks work on the geometry shape, not the fill.

**Fix Pattern** (in SettingsScene.ts):
```typescript
// ❌ WRONG - creates visible white rectangle
const maskShape = this.add.rectangle(width / 2, height / 2, contentWidth, contentHeight, 0xffffff, 1);

// ✅ CORRECT - invisible graphics mask
const maskShape = this.make.graphics({ x: 0, y: 0 }, false);
maskShape.fillStyle(0xffffff);
maskShape.fillRect(width / 2 - contentWidth / 2, height / 2 - contentHeight / 2, contentWidth, contentHeight);
```

### 2. Settings Button Visibility After Match End (Fixed in #175)
**Problem**: Settings button stayed hidden after finishing/exiting an arena match.

**Root Cause**: `isMatchInProgress()` checked `turnLimit` which wasn't being reset properly, or checked `gameState.turn > 0` which could be true even after match ends.

**Fix**: Check `gamePhase.stage` directly:
```typescript
private isMatchInProgress(): boolean {
  const arenaScene = this.scene.get(SCENE_KEYS.Arena);
  if (!arenaScene || !arenaScene.sys.isActive()) return false;
  const arenaState = arenaScene as unknown as { gamePhase?: { stage: string } };
  if (arenaState.gamePhase) {
    const { stage } = arenaState.gamePhase;
    // Match in progress only during placement or combat
    return stage === 'placement' || stage === 'combat';
  }
  return false;
}
```

### 3. fireSupportByOwner Undefined (Fixed in #175)
**Problem**: "can't access property 'player', this.fireSupportByOwner is undefined" error.

**Root Cause**: Property was used but never declared.

**Fix**: Add property declaration in ArenaScene.ts:
```typescript
private fireSupportByOwner: Record<'player' | 'enemy', number> = { player: 0, enemy: 0 };
// And reset in resetRuntimeState():
this.fireSupportByOwner = { player: 0, enemy: 0 };
```

### 4. crowdAttackByOwner Undefined (Fixed in #176)
**Problem**: "can't access property 'player', this.crowdAttackByOwner is undefined" error.

**Root Cause**: Same pattern as fireSupportByOwner - property was used but never declared.

**Fix**: Add property declaration in ArenaScene.ts:
```typescript
private crowdAttackByOwner: Record<'player' | 'enemy', { damage: number; reduction: number }> = { player: { damage: 0, reduction: 0 }, enemy: { damage: 0, reduction: 0 } };
// And reset in resetRuntimeState():
this.crowdAttackByOwner = { player: { damage: 0, reduction: 0 }, enemy: { damage: 0, reduction: 0 } };
```

### 5. Changelog Text Centering (Fixed in #176)
**Problem**: Changelog text not properly centered within the scroll mask.

**Root Cause**: Container and body position calculations were misaligned with the mask.

**Fix**: Position container at mask center and use (0,0) for body inside container:
```typescript
const contentContainer = this.add.container(width / 2, contentStartY).setDepth(72);
const maskShape = this.make.graphics({ x: 0, y: 0 }, false);
maskShape.fillStyle(0xffffff);
maskShape.fillRect(0, 0, contentWidth, contentHeight);
contentContainer.setMask(maskShape.createGeometryMask());
// Body positioned at 0,0 inside container
```