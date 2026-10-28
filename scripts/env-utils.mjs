import fs from 'node:fs';
import path from 'node:path';

const TRUTHY_VALUES = new Set(['1', 'true', 'yes', 'on']);
const FALSY_VALUES = new Set(['0', 'false', 'no', 'off']);

export const DEV_ONLY_FLAGS = ['VITE_ENABLE_DEV_MENU', 'VITE_DEBUG_LOGS'];

export function parseBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (TRUTHY_VALUES.has(normalized)) return true;
  if (FALSY_VALUES.has(normalized)) return false;
  return undefined;
}

export function collectEnabledDevOnlyFlags(env) {
  return DEV_ONLY_FLAGS.filter((key) => parseBoolean(env[key]) === true);
}

export function assertNoDevOnlyFlags(env, { isDevBuild, buildLabel }) {
  if (isDevBuild) return;
  const enabled = collectEnabledDevOnlyFlags(env);
  if (enabled.length > 0) {
    throw new Error(
      `Refusing to ship ${buildLabel} with dev-only flags enabled: ${enabled.join(', ')}. ` +
        'Use the development playtest build (npm run dev:launcher) to exercise these flags.'
    );
  }
}

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};

  const parsed = {};
  const contents = fs.readFileSync(filePath, 'utf8');
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const separatorIndex = line.indexOf('=');
    if (separatorIndex === -1) continue;

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();
    if (!key) continue;

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    parsed[key] = value;
  }

  return parsed;
}

export function loadViteEnv({ mode, cwd = process.cwd(), defaults = {} }) {
  const files = ['.env', '.env.local', `.env.${mode}`, `.env.${mode}.local`];
  const fileEnv = files.reduce((env, fileName) => ({
    ...env,
    ...parseEnvFile(path.join(cwd, fileName))
  }), {});

  const processEnv = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => key.startsWith('VITE_'))
  );

  return {
    MODE: mode,
    DEV: mode === 'development',
    PROD: mode !== 'development',
    ...defaults,
    ...fileEnv,
    ...processEnv
  };
}

export function summarizeBooleanEnv(env, key) {
  const parsed = parseBoolean(env[key]);
  if (parsed === undefined) return `${key}=<unset/invalid>`;
  return `${key}=${parsed ? 'true' : 'false'}`;
}
