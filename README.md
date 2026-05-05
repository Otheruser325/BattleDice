# Battle Dice

## Local setup

Install dependencies once:

```bash
npm install
```

Run the local playtest/dev server:

```bash
npm run dev
```

`npm run dev` first builds the root `main.js` playtest bundle and copies runtime assets (`assets/` and `gamedata/`) so the existing local playtest entrypoint keeps working.

## Production-style frontend build

Build the Vite frontend output:

```bash
npm run build
```

Preview the built frontend:

```bash
npm run preview
```

The build step temporarily creates the playtest bundle needed by `index.html`, lets Vite consume it, and then removes generated root playtest files.

## Direct scene access

After the app boots and dice definitions load, you can open a scene directly with a scene key:

```text
/?scene=CasinoScene
/?scene=ArenaScene
/?scene=DiceScene
/?scene=ShopScene
/?scene=AchievementsScene
```

Hash form also works, e.g. `/#CasinoScene`. If no valid scene key is supplied, the game starts at `MenuScene`.

## Playtest bundle only

If you only need the standalone playtest bundle/assets:

```bash
npm run bundle:playtest
```

Clean generated playtest files with:

```bash
npm run clean:playtest-assets
```
