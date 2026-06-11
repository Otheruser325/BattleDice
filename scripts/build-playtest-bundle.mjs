import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { loadViteEnv, summarizeBooleanEnv } from './env-utils.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.env.BATTLE_DICE_BUILD_MODE ?? 'launcher';
const env = loadViteEnv({
  mode,
  cwd: repoRoot,
  defaults: {
    BASE_URL: '/',
    VITE_ENABLE_DEV_MENU: 'true',
    VITE_DEBUG_LOGS: 'true'
  }
});

await build({
  entryPoints: [path.join(repoRoot, 'src/main.ts')],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  outfile: path.join(repoRoot, 'main.js'),
  sourcemap: true,
  define: {
    'import.meta.env': JSON.stringify(env)
  },
  logLevel: 'info'
});

console.log([
  `Built Phaser Launcher bundle with MODE=${env.MODE}`,
  `BASE_URL=${env.BASE_URL}`,
  summarizeBooleanEnv(env, 'VITE_ENABLE_DEV_MENU'),
  summarizeBooleanEnv(env, 'VITE_DEBUG_LOGS')
].join(' | '));
