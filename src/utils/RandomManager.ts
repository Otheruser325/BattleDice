const UINT32_RANGE = 0x1_0000_0000;
const SECURE_RANDOM_UNAVAILABLE = 'Secure random generation is unavailable in this browser.';

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

export function secureRandomBytes(byteLength: number): Uint8Array {
  if (!Number.isInteger(byteLength) || byteLength <= 0) {
    throw new RangeError('Secure random byte length must be a positive integer.');
  }
  const crypto = getCrypto();
  if (typeof crypto?.getRandomValues !== 'function') {
    throw new Error(SECURE_RANDOM_UNAVAILABLE);
  }

  const bytes = new Uint8Array(byteLength);
  try {
    crypto.getRandomValues(bytes);
  } catch {
    throw new Error(SECURE_RANDOM_UNAVAILABLE);
  }
  return bytes;
}

function randomUint32(): number {
  const bytes = secureRandomBytes(4);
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, false);
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
