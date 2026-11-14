import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const serverRoot = fileURLToPath(new URL('../gamedata', import.meta.url));
const clientRoot = fileURLToPath(new URL('../../public/gamedata', import.meta.url));

function readJsonTree(root) {
  const files = new Map();
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(path);
        continue;
      }
      files.set(relative(root, path).replaceAll('\\', '/'), JSON.parse(readFileSync(path, 'utf8')));
    }
  };
  visit(root);
  return files;
}

test('client and server gamedata are semantically identical', () => {
  const client = readJsonTree(clientRoot);
  const server = readJsonTree(serverRoot);

  assert.deepEqual([...server.keys()].sort(), [...client.keys()].sort());
  for (const [path, clientValue] of client) {
    assert.deepEqual(server.get(path), clientValue, path);
  }
});
