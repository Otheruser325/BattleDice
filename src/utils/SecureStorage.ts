const ENVELOPE_VERSION = 'bd2';
const INSTALL_SECRET_KEY = 'battle-dice-autoroller:install-secret';
const INSTALL_RECORD_KEY = 'battle-dice-autoroller:install-record';

type Envelope = {
  v: string;
  d: unknown;
  s: string;
};

const COOKIE_PREFIX = 'bda_';
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 3650;

function toCookieName(key: string): string {
  return `${COOKIE_PREFIX}${key.replace(/[^A-Za-z0-9]/g, '_')}`;
}

function readCookie(name: string): string | null {
  try {
    if (typeof document === 'undefined' || !document.cookie) return null;
    const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
    return match ? decodeURIComponent(match[1]) : null;
  } catch {
    return null;
  }
}

function writeCookie(name: string, value: string): void {
  try {
    if (typeof document === 'undefined') return;
    document.cookie = `${name}=${encodeURIComponent(value)}; max-age=${COOKIE_MAX_AGE_SECONDS}; path=/; SameSite=Lax`;
  } catch {
    // Best effort.
  }
}

function clearCookie(name: string): void {
  try {
    if (typeof document === 'undefined') return;
    document.cookie = `${name}=; max-age=0; path=/; SameSite=Lax`;
  } catch {
    // Best effort.
  }
}

// Only the install identity is mirrored to a cookie. Everything else stays in localStorage so
// request headers stay small; a cleared gameplay key must not look like a brand new install.
const COOKIE_MIRRORED_KEYS = new Set<string>([INSTALL_SECRET_KEY, INSTALL_RECORD_KEY]);

function readStorage(key: string): string | null {
  try {
    const fromLocal = typeof localStorage === 'undefined' ? null : localStorage.getItem(key);
    if (fromLocal) return fromLocal;
  } catch {
    // Fall through to the cookie mirror.
  }
  return COOKIE_MIRRORED_KEYS.has(key) ? readCookie(toCookieName(key)) : null;
}

function writeStorage(key: string, value: string): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, value);
  } catch {
    // Persistence is best effort; the in-memory registry keeps the session consistent.
  }
  if (COOKIE_MIRRORED_KEYS.has(key)) writeCookie(toCookieName(key), value);
}

function removeStorage(key: string): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(key);
  } catch {
    // Best effort.
  }
  if (COOKIE_MIRRORED_KEYS.has(key)) clearCookie(toCookieName(key));
}

const utf8 = new TextEncoder();

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function randomBytes(byteLength: number): Uint8Array {
  const bytes = new Uint8Array(byteLength);
  const webCrypto = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
  if (webCrypto?.getRandomValues) {
    webCrypto.getRandomValues(bytes);
    return bytes;
  }
  // getRandomValues is available in non-secure browser contexts too; this is a last resort.
  for (let i = 0; i < byteLength; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  return bytes;
}

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]);

function sha256Bytes(bytes: Uint8Array): Uint8Array {
  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const bitLength = bytes.length * 8;
  const paddedLength = ((bytes.length + 8) >> 6 << 6) + 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 4, bitLength >>> 0, false);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x1_0000_0000), false);

  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => ((x >>> n) | (x << (32 - n))) >>> 0;

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(offset + i * 4, false);
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i += 1) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e;
      e = (d + temp1) >>> 0;
      d = c; c = b; b = a;
      a = (temp1 + temp2) >>> 0;
    }

    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
  }

  const digest = new Uint8Array(32);
  const digestView = new DataView(digest.buffer);
  for (let i = 0; i < 8; i += 1) digestView.setUint32(i * 4, H[i], false);
  return digest;
}

function concatBytes(...chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

function hmacSha256(key: string, message: string): Uint8Array {
  const blockSize = 64;
  const keyBytes = utf8.encode(key);
  const block = new Uint8Array(blockSize);
  block.set(keyBytes.length > blockSize ? sha256Bytes(keyBytes) : keyBytes);

  const innerPad = new Uint8Array(blockSize);
  const outerPad = new Uint8Array(blockSize);
  for (let i = 0; i < blockSize; i += 1) {
    innerPad[i] = block[i] ^ 0x36;
    outerPad[i] = block[i] ^ 0x5c;
  }

  const inner = sha256Bytes(concatBytes(innerPad, utf8.encode(message)));
  return sha256Bytes(concatBytes(outerPad, inner));
}

// Per-install secret held outside the game bundle. A local attacker can still read it from the
// same origin, so this is not a trust boundary against a determined attacker; it does stop
// forged envelopes and constant-key signing. Authoritative economy state belongs on the server.
function loadInstallSecret(): string {
  const stored = readStorage(INSTALL_SECRET_KEY);
  if (stored) return stored;
  const secret = toHex(randomBytes(32));
  writeStorage(INSTALL_SECRET_KEY, secret);
  return secret;
}

const installSecret = loadInstallSecret();

function signPayload(payload: string): string {
  return toHex(hmacSha256(installSecret, `${ENVELOPE_VERSION}:${payload}`));
}

// Legacy (bd1) envelopes were signed with an FNV-1a checksum over a shipped constant salt, so
// they are attacker-forgeable and are rejected outright. Only the keyed MAC is trusted.
function isEnvelope(value: unknown): value is Envelope {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<Envelope>;
  return candidate.v === ENVELOPE_VERSION && typeof candidate.s === 'string' && 'd' in candidate;
}

// Timing-safe comparison: signatures are attacker-influenced, so compare without early exit.
function signaturesMatch(expected: string, actual: string): boolean {
  if (expected.length !== actual.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) diff |= expected.charCodeAt(i) ^ actual.charCodeAt(i);
  return diff === 0;
}

// Unreadable bytes (legacy envelopes, plain JSON, or a failed signature) are untrusted, but they
// may hold real player progress. Keep a copy under `<key>:recovery` before the slot is dropped or
// overwritten so a save is never silently destroyed.
function backupUnreadable(key: string, raw: string): void {
  try {
    if (typeof localStorage === 'undefined') return;
    const recoveryKey = `${key}:recovery`;
    if (!localStorage.getItem(recoveryKey)) localStorage.setItem(recoveryKey, raw);
  } catch {
    // Best effort.
  }
}

function readVerified<T>(raw: string): T | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!isEnvelope(parsed)) return undefined;
  const payload = JSON.stringify(parsed.d);
  return signaturesMatch(signPayload(payload), parsed.s) ? (parsed.d as T) : undefined;
}

export function readIntegrityChecked<T>(key: string): T | undefined {
  const raw = readStorage(key);
  if (!raw) return undefined;

  const value = readVerified<T>(raw);
  if (value === undefined) {
    backupUnreadable(key, raw);
    removeStorage(key);
  }
  return value;
}

export function writeIntegrityChecked<T>(key: string, value: T): void {
  const existing = readStorage(key);
  if (existing && readVerified(existing) === undefined) backupUnreadable(key, existing);

  const payload = JSON.stringify(value);
  const envelope: Envelope = { v: ENVELOPE_VERSION, d: value, s: signPayload(payload) };
  writeStorage(key, JSON.stringify(envelope));
}

export interface InstallRecord {
  installId: string;
  createdAt: string;
  starterTokens: boolean;
  starterDiamonds: boolean;
  starterChips: boolean;
}

function readInstallRecord(): InstallRecord | undefined {
  const raw = readStorage(INSTALL_RECORD_KEY);
  if (!raw) return undefined;
  const value = readVerified<InstallRecord>(raw);
  if (!value || typeof value !== 'object') return undefined;
  if (typeof value.installId !== 'string' || value.installId.length === 0) return undefined;
  return {
    installId: value.installId,
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : new Date(0).toISOString(),
    starterTokens: value.starterTokens === true,
    starterDiamonds: value.starterDiamonds === true,
    starterChips: value.starterChips === true
  };
}

function writeInstallRecord(record: InstallRecord): void {
  const payload = JSON.stringify(record);
  const envelope: Envelope = { v: ENVELOPE_VERSION, d: record, s: signPayload(payload) };
  writeStorage(INSTALL_RECORD_KEY, JSON.stringify(envelope));
}

// The starter economy grants live here rather than beside the gameplay state they describe, so
// clearing a gameplay key cannot make the game believe the install is brand new and re-issue
// them. The record is mirrored to a cookie, which survives a localStorage wipe, and the install
// secret is mirrored alongside it so the copy still verifies.
export function getInstallRecord(): InstallRecord | undefined {
  return readInstallRecord();
}

export function updateInstallRecord(patch: Partial<InstallRecord>): InstallRecord {
  const current = getInstallRecord();
  const next: InstallRecord = {
    installId: current?.installId ?? toHex(randomBytes(16)),
    createdAt: current?.createdAt ?? new Date().toISOString(),
    starterTokens: patch.starterTokens ?? current?.starterTokens ?? false,
    starterDiamonds: patch.starterDiamonds ?? current?.starterDiamonds ?? false,
    starterChips: patch.starterChips ?? current?.starterChips ?? false
  };
  writeInstallRecord(next);
  return next;
}
