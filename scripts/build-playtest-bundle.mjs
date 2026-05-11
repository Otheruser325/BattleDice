import { build } from 'esbuild';
import { loadViteEnv, summarizeBooleanEnv } from './env-utils.mjs';

const mode = process.env.BATTLE_DICE_BUILD_MODE ?? 'launcher';
const env = loadViteEnv({
  mode,
  defaults: {
    VITE_ENABLE_DEV_MENU: 'true',
    VITE_DEBUG_LOGS: 'true'
  }
});

await build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  outfile: 'main.js',
  sourcemap: true,
  define: {
    'import.meta.env': JSON.stringify(env)
  },
  logLevel: 'info'
});

console.log([
  `Built Phaser Launcher bundle with MODE=${env.MODE}`,
  summarizeBooleanEnv(env, 'VITE_ENABLE_DEV_MENU'),
  summarizeBooleanEnv(env, 'VITE_DEBUG_LOGS')
].join(' | '));
