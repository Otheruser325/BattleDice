import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = await mkdtemp(path.join(tmpdir(), 'battle-dice-pve-'));
const testBuild = path.join(outputDirectory, 'pve-regression.test.mjs');

try {
  await build({
    entryPoints: [path.join(repoRoot, 'test/pve-regression.test.ts')],
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    outfile: testBuild,
    logLevel: 'silent'
  });

  const exitCode = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--test', testBuild], { stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? 1));
  });
  process.exitCode = exitCode;
} finally {
  await rm(outputDirectory, { recursive: true, force: true });
}
