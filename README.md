# Battle Dice Autoroller

## Local development

1. Install dependencies:

   ```sh
   npm install
   ```

2. Copy the documented dev flags and adjust them if needed:

   ```sh
   cp .env.example .env.local
   ```

3. Run the Vite dev server:

   ```sh
   npm run dev
   ```

Vite reads `.env.local` automatically. The default example enables the dev menu and debug console logging for local playtests.

## Phaser Launcher local playtests

Phaser Launcher can run this project from generated files in the repository root. Use the launcher scripts when you need the root-level `main.js`, `assets/`, and `gamedata/` files that mirror the public Vite assets.

```sh
npm run launcher:prepare
```

Then open the repository folder in Phaser Launcher and start the local playtest. The generated files are ignored by Git, so it is safe to regenerate them as often as needed.

Launcher builds use `launcher` mode and default these flags to `true`:

- `VITE_ENABLE_DEV_MENU` — includes the in-game **DEV BUILD MENU** tab.
- `VITE_DEBUG_LOGS` — prints Battle Dice debug logs to the browser console.

To override Launcher-only flags, copy `.env.launcher.example` to `.env.launcher.local` and edit it before running `npm run launcher:prepare` again.

### Useful scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start Vite for browser development. |
| `npm run dev:launcher` | Regenerate Launcher files, then start Vite. |
| `npm run launcher:prepare` | Build `main.js` and sync `assets/` plus `gamedata/` for Phaser Launcher. |
| `npm run launcher:clean` | Remove generated Launcher files from the repository root. |
| `npm run build` | Type-check, prepare Launcher files, build the Vite production bundle, then clean generated Launcher files. |
