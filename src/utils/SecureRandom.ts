const UINT32_RANGE = 0x1_0000_0000;

function getCrypto(): Crypto | undefined {
  return typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
}

function randomUint32(): number {
  const crypto = getCrypto();
  if (crypto?.getRandomValues) {
    const buffer = new Uint32Array(1);
    crypto.getRandomValues(buffer);
    return buffer[0];
  }
  return randomUint32WithoutWebCrypto();
}

function randomUint32WithoutWebCrypto(): number {
  return Math.floor(Math.random() * UINT32_RANGE);
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
