export interface DailyProfileDiceEntry {
  typeId: string;
  classLevel: number;
  unlocked: boolean;
}

export function getSeededDailyIndex(dateKey: string, label: string, length: number): number {
  const size = Number.isFinite(length) ? Math.floor(length) : 0;
  if (size <= 0) return 0;
  const key = dateKey || new Date().toISOString().slice(0, 10);
  const seed = [...`${key}:${label}:v2`].reduce((acc, ch) => ((acc * 33) ^ ch.charCodeAt(0)) >>> 0, 5381);
  return seed % size;
}

export function getSeededDailyRange(dateKey: string, label: string, min: number, max: number): number {
  const low = Math.min(min, max);
  const high = Math.max(min, max);
  return low + getSeededDailyIndex(dateKey, label, high - low + 1);
}

export function getTopProfileDice(entries: readonly DailyProfileDiceEntry[], count = 5): DailyProfileDiceEntry[] {
  const wanted = Number.isFinite(count) ? Math.max(1, Math.floor(count)) : 5;
  return [...entries]
    .filter((entry) => entry.unlocked && Number.isFinite(entry.classLevel) && entry.classLevel > 0)
    .sort((a, b) => b.classLevel - a.classLevel || (a.typeId < b.typeId ? -1 : a.typeId > b.typeId ? 1 : 0))
    .slice(0, wanted)
    .map((entry) => ({ ...entry, classLevel: Math.max(1, Math.floor(entry.classLevel)) }));
}

export function getHardDailyEnemyClassLevel(profileClassLevel: number, bonus = 4, maxClass = 15): number {
  const base = Number.isFinite(profileClassLevel) ? Math.max(1, Math.floor(profileClassLevel)) : 1;
  const extra = Number.isFinite(bonus) ? Math.max(0, Math.floor(bonus)) : 0;
  const cap = Number.isFinite(maxClass) ? Math.max(1, Math.floor(maxClass)) : 15;
  return Math.max(1, Math.min(cap, base + extra));
}
