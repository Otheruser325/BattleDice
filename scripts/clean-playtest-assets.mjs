import fs from 'node:fs';

for (const target of ['main.js', 'main.js.map', 'gamedata', 'assets']) {
  fs.rmSync(target, { recursive: true, force: true });
}

console.log('Removed generated Phaser Launcher playtest files.');
