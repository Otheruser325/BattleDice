const UINT32_RANGE = 0x1_0000_0000;

function getCrypto(): Crypto | undefined {
  return typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
}

export function hasSecureRandom(): boolean {
  const crypto = getCrypto();
  if (typeof crypto?.getRandomValues !== 'function') return false;
  try {
    crypto.getRandomValues(new Uint8Array(1));
    return true;
  } catch {
    return false;
  }
}

let insecureFallbackWarned = false;

function warnInsecureFallback(): void {
  if (insecureFallbackWarned) return;
  insecureFallbackWarned = true;
  console.warn(
    '[RandomManager] Web Crypto (crypto.getRandomValues) is unavailable. Reward and combat rolls are ' +
    'falling back to a non-cryptographic generator, so outcomes may be predictable in this environment.'
  );
}

function avalanche(value: number): number {
  let mixed = value >>> 0;
  mixed ^= mixed >>> 16;
  mixed = Math.imul(mixed, 0x7feb352d) >>> 0;
  mixed ^= mixed >>> 15;
  mixed = Math.imul(mixed, 0x846ca68b) >>> 0;
  mixed ^= mixed >>> 16;
  return mixed >>> 0;
}

// Without Web Crypto there is no secure entropy source in the browser, so the best we can do
// is mix every cheap source available and avalanche the result. This keeps the output from
// being a single directly-observable Math.random() draw, but it is still not cryptographic.
function randomUint32WithoutWebCrypto(): number {
  let entropy = avalanche(Math.floor(Math.random() * UINT32_RANGE));
  entropy = avalanche(entropy ^ (Date.now() >>> 0));
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    entropy = avalanche(entropy ^ (Math.floor(performance.now() * 1000) >>> 0));
  }
  return entropy;
}

function randomUint32(): number {
  const crypto = getCrypto();
  if (typeof crypto?.getRandomValues === 'function') {
    try {
      const buffer = new Uint32Array(1);
      crypto.getRandomValues(buffer);
      return buffer[0];
    } catch {
      warnInsecureFallback();
      return randomUint32WithoutWebCrypto();
    }
  }
  warnInsecureFallback();
  return randomUint32WithoutWebCrypto();
}

export function secureRandom(): number {
  return randomUint32() / UINT32_RANGE;
}

export function secureRandomInt(maxExclusive: number): number {
  if (!Number.isFinite(maxExclusive) || maxExclusive <= 0) return 0;
  return Math.floor(secureRandom() * maxExclusive);
}

export function secureRandomBetween(min: number, max: number): number {
  if (max < min) return min;
  return min + secureRandomInt(max - min + 1);
}

export function securePick<T>(values: readonly T[]): T | undefined {
  if (values.length === 0) return undefined;
  return values[secureRandomInt(values.length)];
}

export function secureChance(probability: number): boolean {
  if (probability <= 0) return false;
  if (probability >= 1) return true;
  return secureRandom() < probability;
}

const LOBBY_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function secureLobbyCode(length = 6): string {
  return Array.from({ length }, () => LOBBY_CODE_ALPHABET[secureRandomInt(LOBBY_CODE_ALPHABET.length)] ?? 'A').join('');
}