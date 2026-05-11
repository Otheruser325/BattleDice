import fs from 'node:fs';

function resetDirectory(source, destination) {
  fs.rmSync(destination, { recursive: true, force: true });
  fs.cpSync(source, destination, { recursive: true });
}

resetDirectory('public/gamedata', 'gamedata');
resetDirectory('public/assets', 'assets');
console.log('Synced Phaser Launcher playtest assets: gamedata/, assets/.');
