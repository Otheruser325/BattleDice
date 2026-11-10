export type DungeonIntroKind = 'death-wave' | 'boss-berserk';

export interface DungeonIntroConfig {
  readonly kind: DungeonIntroKind;
  readonly wave: number;
  readonly title: string;
  readonly body: string;
  readonly accent: string;
  readonly accentColor: number;
  readonly stripeColor: number;
  readonly backdropColor: number;
  readonly panelColor: number;
  readonly signs: readonly string[];
  readonly sfxKey: string;
}

export const DUNGEON_INTRO_WAVES = {
  deathWave: 11,
  bossBerserk: 31
} as const;

export const DUNGEON_INTROS = {
  'death-wave': {
    kind: 'death-wave',
    wave: DUNGEON_INTRO_WAVES.deathWave,
    title: 'DEATH WAVE',
    body: 'All enemy dice have their critical chance amped up to 25%.\nBeware of your pathing depths below!',
    accent: '#ff4d4d',
    accentColor: 0xff3b30,
    stripeColor: 0xd32f2f,
    backdropColor: 0x180000,
    panelColor: 0x2a0808,
    signs: ['⚠', '⚠'],
    sfxKey: 'death_wave'
  },
  'boss-berserk': {
    kind: 'boss-berserk',
    wave: DUNGEON_INTRO_WAVES.bossBerserk,
    title: 'BOSS BERSERK',
    body: 'Bosses are significantly stronger and they go completely berserk.\nEnemy dice critical chance bumped to 50%.\nYour faint shall be revealed in your destiny!',
    accent: '#d8a7ff',
    accentColor: 0xc77dff,
    stripeColor: 0x8e24aa,
    backdropColor: 0x15001f,
    panelColor: 0x260833,
    signs: ['☣', '☣'],
    sfxKey: 'enhanced_death_wave'
  }
} as const satisfies Record<DungeonIntroKind, DungeonIntroConfig>;

export function getDungeonIntroForWave(wave: number): DungeonIntroConfig | null {
  const normalized = Math.floor(Number(wave));
  if (!Number.isFinite(normalized)) return null;
  if (normalized === DUNGEON_INTRO_WAVES.deathWave) return DUNGEON_INTROS['death-wave'];
  if (normalized === DUNGEON_INTRO_WAVES.bossBerserk) return DUNGEON_INTROS['boss-berserk'];
  return null;
}
