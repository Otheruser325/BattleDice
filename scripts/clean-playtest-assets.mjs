import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

for (const target of ['main.js', 'main.js.map', 'gamedata', 'assets']) {
  fs.rmSync(path.join(repoRoot, target), { recursive: true, force: true });
}

console.log('Removed generated Phaser Launcher playtest files.');
