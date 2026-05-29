# Battle Dice Autoroller

Turn-based strategy autochess with dice vs. dice combat!

## Local development

- `npm run dev` starts the normal Vite source app.
- `npm run dev:launcher` builds the Phaser Launcher-style `main.js` bundle, syncs `assets/` and `gamedata/`, and starts Vite for local playtesting. Open `http://127.0.0.1:5173/playtest.html` to exercise the generated bundle instead of the source entrypoint.
- `npm run dev:clean` removes generated launcher playtest files after local testing.

## Packaging safety

Launcher playtest artifacts are generated at the repository root for compatibility with the launcher shell, but they are ignored by Git and npm package dry-runs so local playtesting does not accidentally duplicate large generated assets in a package.
