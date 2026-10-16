const ENVELOPE_VERSION = 'bd1';
const FALLBACK_SALT = 'battle-dice-autoroller';

const buildSalt = (() => {
  const env = (import.meta as unknown as { env?: Record<string, unknown> }).env;
  const candidate = env?.VITE_STORAGE_SALT;
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : FALLBACK_SALT;
})();

type Envelope = {
  v: string;
  d: unknown;
  s: string;
};

function checksum(payload: string): string {
  let hash = 0x811c9dc5;
  const input = `${buildSalt}:${payload}`;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function isEnvelope(value: unknown): value is Envelope {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<Envelope>;
  return candidate.v === ENVELOPE_VERSION && typeof candidate.s === 'string' && 'd' in candidate;
}

// Tamper-evidence only. The checksum is computed in-bundle, so an attacker who
// inspects the code can recompute it and craft a valid envelope. This raises the bar
// against casual edits, accidental corruption, and naive save editors, but it is NOT
// a substitute for server-authoritative economy state. See the multiplayer client for
// the authoritative path.
//
// Pre-integrity (plain JSON) saves are migrated on first read and re-signed so that
// later edits are detected; without this migration, every existing player would lose
// their progress.
export function readIntegrityChecked<T>(key: string, migrateLegacy = true): T | undefined {
  if (typeof localStorage === 'undefined') return undefined;
  let raw: string | null;
  try {
    raw = localStorage.getItem(key);
  } catch {
    return undefined;
  }
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (isEnvelope(parsed)) {
      const expected = checksum(JSON.stringify(parsed.d));
      return parsed.s === expected ? (parsed.d as T) : undefined;
    }
    if (!migrateLegacy) return undefined;
    writeIntegrityChecked(key, parsed as T);
    return parsed as T;
  } catch {
    return undefined;
  }
}

export function writeIntegrityChecked<T>(key: string, value: T): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const envelope: Envelope = {
      v: ENVELOPE_VERSION,
      d: value,
      s: checksum(JSON.stringify(value))
    };
    localStorage.setItem(key, JSON.stringify(envelope));
  } catch {
    // Persistence is best effort; the in-memory registry keeps the session consistent.
  }
}
