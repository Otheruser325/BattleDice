import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { loadViteEnv, summarizeBooleanEnv } from './env-utils.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.env.BATTLE_DICE_BUILD_MODE ?? 'launcher';
const includeSourcemap = process.env.BATTLE_DICE_SOURCEMAP === '1';
const env = loadViteEnv({
  mode,
  cwd: repoRoot,
  defaults: {
    BASE_URL: '/'
  }
});

await build({
  entryPoints: [path.join(repoRoot, 'src/main.ts')],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  outfile: path.join(repoRoot, 'main.js'),
  sourcemap: includeSourcemap,
  minify: true,
  legalComments: 'none',
  define: {
    'import.meta.env': JSON.stringify(env)
  },
  logLevel: 'info'
});

const shippedDevFlags = ['VITE_ENABLE_DEV_MENU', 'VITE_DEBUG_LOGS']
  .filter((key) => summarizeBooleanEnv(env, key).endsWith('=true'));
if (shippedDevFlags.length > 0) {
  throw new Error(`Refusing to ship launcher bundle with dev-only flags enabled: ${shippedDevFlags.join(', ')}`);
}

console.log([
  `Built Phaser Launcher bundle with MODE=${env.MODE}`,
  `BASE_URL=${env.BASE_URL}`,
  summarizeBooleanEnv(env, 'VITE_ENABLE_DEV_MENU'),
  summarizeBooleanEnv(env, 'VITE_DEBUG_LOGS')
].join(' | '));
