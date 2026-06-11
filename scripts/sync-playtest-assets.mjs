import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function rootPath(...segments) {
  return path.join(repoRoot, ...segments);
}

function resetDirectory(source, destination) {
  fs.rmSync(destination, { recursive: true, force: true });
  fs.cpSync(source, destination, { recursive: true });
}

resetDirectory(rootPath('public/gamedata'), rootPath('gamedata'));
resetDirectory(rootPath('public/assets'), rootPath('assets'));
console.log('Synced Phaser Launcher playtest assets: gamedata/, assets/.');
