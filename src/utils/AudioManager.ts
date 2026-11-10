import Phaser from 'phaser';
import { SettingsStore } from '../systems/SettingsStore';
import { withBasePath } from './BuildEnv';
import { securePick } from './RandomManager';

export const AUDIO_KEYS = {
  menuMusic: 'menu-music',
  arenaMusic: 'arena-music',
  deuciferMusic: 'boss-music-deucifer',
  magicianMusic: 'boss-music-magician',
  leonMusic: 'boss-music-leon',
  basiliskMusic: 'boss-music-basilisk',
  silenceMusic: 'boss-music-silence',
  uiClick: 'ui-click',
  classUp: 'class-up',
  chestOpen: 'chest-open',
  diceAttack01: 'dice-attack-01',
  diceAttack02: 'dice-attack-02',
  diceAttack03: 'dice-attack-03',
  diceDie: 'dice-die',
  comboRoll: 'combo-roll',
  comboPair: 'combo_pair',
  comboTwoPair: 'combo_twoPair',
  comboTriple: 'combo_triple',
  comboStraight: 'combo_straight',
  comboFullHouse: 'combo_fullHouse',
  comboFourOfAKind: 'combo_fourOfAKind',
  comboFiveOfAKind: 'combo_fiveOfAKind',
  skillTrigger: 'skill-trigger',
  gameStart: 'game_start',
  gameCountdown: 'game_countdown',
  gameTimerTick: 'game_timer',
  uiRound: 'ui_round',
  deathInstakill: 'dice_death_instakill',
  leonMightyRoar: 'dice_leon_mighty_roar',
  leonFuriousClaw: 'dice_leon_furious_claw',
  soulHarvest: 'dice_soul_skill_01',
  deathWave: 'death_wave',
  bossBerserk: 'enhanced_death_wave'
} as const;

const MUSIC_KEYS = new Set<string>([
  AUDIO_KEYS.menuMusic,
  AUDIO_KEYS.arenaMusic,
  AUDIO_KEYS.deuciferMusic,
  AUDIO_KEYS.magicianMusic,
  AUDIO_KEYS.leonMusic,
  AUDIO_KEYS.basiliskMusic,
  AUDIO_KEYS.silenceMusic
]);

export class AudioManager {
  private static currentMusicKey: string | null = null;
  private static currentMusicRate = 1;
  private static currentMusicDetune = 0;
  private static currentMusicMuted = false;

  static preload(scene: Phaser.Scene) {
    scene.load.audio(AUDIO_KEYS.menuMusic, withBasePath('assets/music/dice_league.mp3'));
    scene.load.audio(AUDIO_KEYS.arenaMusic, withBasePath('assets/music/arena_theme.mp3'));
    scene.load.audio(AUDIO_KEYS.deuciferMusic, withBasePath('assets/music/snake_theme.mp3'));
    scene.load.audio(AUDIO_KEYS.magicianMusic, withBasePath('assets/music/magician_theme.mp3'));
    scene.load.audio(AUDIO_KEYS.leonMusic, withBasePath('assets/music/leon_theme.mp3'));
    scene.load.audio(AUDIO_KEYS.basiliskMusic, withBasePath('assets/music/basilisk_theme.mp3'));
    scene.load.audio(AUDIO_KEYS.silenceMusic, withBasePath('assets/music/silence_theme.mp3'));
    scene.load.audio(AUDIO_KEYS.uiClick, withBasePath('assets/audio/button.mp3'));
    scene.load.audio(AUDIO_KEYS.classUp, withBasePath('assets/audio/combo_pair.mp3'));
    scene.load.audio(AUDIO_KEYS.chestOpen, withBasePath('assets/audio/dice.mp3'));
    scene.load.audio(AUDIO_KEYS.diceAttack01, withBasePath('assets/audio/dice/dice_attack_01.ogg'));
	scene.load.audio(AUDIO_KEYS.diceAttack02, withBasePath('assets/audio/dice/dice_attack_02.ogg'));
    scene.load.audio(AUDIO_KEYS.diceAttack03, withBasePath('assets/audio/dice/dice_attack_03.ogg'));
    scene.load.audio(AUDIO_KEYS.diceDie, withBasePath('assets/audio/dice/dice_die.ogg'));
    scene.load.audio(AUDIO_KEYS.comboRoll, withBasePath('assets/audio/combo_pair.mp3'));
    scene.load.audio(AUDIO_KEYS.comboPair, withBasePath('assets/audio/combo_pair.mp3'));
    scene.load.audio(AUDIO_KEYS.comboTwoPair, withBasePath('assets/audio/combo_pair.mp3'));
    scene.load.audio(AUDIO_KEYS.comboTriple, withBasePath('assets/audio/combo_triple.mp3'));
    scene.load.audio(AUDIO_KEYS.comboStraight, withBasePath('assets/audio/combo_straight.mp3'));
    scene.load.audio(AUDIO_KEYS.comboFullHouse, withBasePath('assets/audio/combo_fullHouse.mp3'));
    scene.load.audio(AUDIO_KEYS.comboFourOfAKind, withBasePath('assets/audio/combo_fourOfAKind.mp3'));
    scene.load.audio(AUDIO_KEYS.comboFiveOfAKind, withBasePath('assets/audio/combo_fiveOfAKind.mp3'));
    scene.load.audio(AUDIO_KEYS.skillTrigger, withBasePath('assets/audio/dice/dice_attack_02.ogg'));
    scene.load.audio(AUDIO_KEYS.gameStart, withBasePath('assets/audio/game_start.ogg'));
    scene.load.audio(AUDIO_KEYS.gameCountdown, withBasePath('assets/audio/game_countdown.ogg'));
    scene.load.audio(AUDIO_KEYS.gameTimerTick, withBasePath('assets/audio/game_timer.ogg'));
    scene.load.audio(AUDIO_KEYS.uiRound, withBasePath('assets/audio/ui_round.ogg'));
    scene.load.audio('dice_solitude_attack', withBasePath('assets/audio/dice/dice_solitude_attack.ogg'));
    scene.load.audio('dice_transcendence_attack', withBasePath('assets/audio/dice/dice_transcendence_attack.ogg'));
    scene.load.audio('dice_transcendence_t_attack', withBasePath('assets/audio/dice/dice_transcendence_t_attack.ogg'));
    scene.load.audio('dice_death_t_attack', withBasePath('assets/audio/dice/dice_death_t_attack.ogg'));
    scene.load.audio('dice_death_skill_01', withBasePath('assets/audio/dice/dice_death_skill_01.ogg'));
    scene.load.audio('dice_meteor_skill', withBasePath('assets/audio/dice/dice_meteor_skill.ogg'));
    scene.load.audio('dice_soul_skill_01', withBasePath('assets/audio/dice/dice_soul_skill_01.ogg'));
    scene.load.audio('dice_wind_skill', withBasePath('assets/audio/dice/dice_wind_skill.ogg'));
    scene.load.audio('dice_fire_skill', withBasePath('assets/audio/dice/dice_fire_skill.ogg'));
    scene.load.audio('dice_ice_skill', withBasePath('assets/audio/dice/dice_ice_skill.ogg'));
    scene.load.audio('dice_electric_skill', withBasePath('assets/audio/dice/dice_electric_skill.ogg'));
    scene.load.audio('dice_shield_skill', withBasePath('assets/audio/dice/dice_shield_skill.ogg'));
    scene.load.audio('dice_heal_skill', withBasePath('assets/audio/dice/dice_heal_skill.ogg'));
    scene.load.audio('dice_time_skill', withBasePath('assets/audio/dice/dice_time_skill.ogg'));
    scene.load.audio('dice_light_skill', withBasePath('assets/audio/dice/dice_light_skill.ogg'));
    scene.load.audio('dice_berserk_skill', withBasePath('assets/audio/dice/dice_berserk_skill.ogg'));
    scene.load.audio('dice_judgment_skill', withBasePath('assets/audio/dice/dice_judgment_skill.ogg'));
    scene.load.audio('dice_spear_skill', withBasePath('assets/audio/dice/dice_spear_skill.ogg'));
    scene.load.audio('dice_battery_skill', withBasePath('assets/audio/dice/dice_battery_skill.ogg'));
    scene.load.audio(AUDIO_KEYS.deathInstakill, withBasePath('assets/audio/dice/dice_death_instakill.ogg'));
	scene.load.audio('dice_poison_skill', withBasePath('assets/audio/dice/dice_poison_skill.ogg'));
	scene.load.audio('dice_crack_skill', withBasePath('assets/audio/dice/dice_crack_skill.ogg'));
	scene.load.audio('dice_armor_skill', withBasePath('assets/audio/dice/dice_armor_skill.ogg'));
	scene.load.audio('dice_drizzle_attack', withBasePath('assets/audio/dice/dice_drizzle_attack.ogg'));
	scene.load.audio('dice_drizzle_skill', withBasePath('assets/audio/dice/dice_drizzle_skill_01.ogg'));
    scene.load.audio(AUDIO_KEYS.deathWave, withBasePath('assets/audio/death_wave.mp3'));
    scene.load.audio(AUDIO_KEYS.bossBerserk, withBasePath('assets/audio/enhanced_death_wave.mp3'));
    scene.load.audio('dice_sword_attack_01', withBasePath('assets/audio/dice/dice_sword_attack_01.ogg'));
    scene.load.audio('dice_sword_attack_02', withBasePath('assets/audio/dice/dice_sword_attack_02.ogg'));
    scene.load.audio('dice_sword_attack_03', withBasePath('assets/audio/dice/dice_sword_attack_03.ogg'));
    scene.load.audio('dice_nuclear_skill', withBasePath('assets/audio/dice/dice_nuclear_skill.ogg'));
    scene.load.audio('dice_growth_success_01', withBasePath('assets/audio/dice/dice_growth_success_01.ogg'));
    scene.load.audio('dice_growth_success_02', withBasePath('assets/audio/dice/dice_growth_success_02.ogg'));
    scene.load.audio('dice_growth_failed', withBasePath('assets/audio/dice/dice_growth_failed.ogg'));
    scene.load.audio('dice_lock_skill', withBasePath('assets/audio/dice/dice_lock_skill.ogg'));
    scene.load.audio(AUDIO_KEYS.leonMightyRoar, withBasePath('assets/audio/dice/dice_leon_mighty_roar.ogg'));
    scene.load.audio(AUDIO_KEYS.leonFuriousClaw, withBasePath('assets/audio/dice/dice_leon_furious_claw.ogg'));
    scene.load.audio('dice_silence_lock', withBasePath('assets/audio/dice/dice_silence_lock.ogg'));
    scene.load.audio('dice_silence_grid_lock', withBasePath('assets/audio/dice/dice_silence_grid_lock.ogg'));
	scene.load.audio('dice_broken_skill', withBasePath('assets/audio/dice/dice_broken_skill.ogg'));
	scene.load.audio('dice_druid_bear_attack', withBasePath('assets/audio/dice/dice_druid_bear_attack.ogg'));
    for (let index = 1; index <= 7; index++) {
      const key = `dice_reverse_merge_0${index}`;
      scene.load.audio(key, withBasePath(`assets/audio/dice/${key}.ogg`));
    }
  }

  private static getCurrentMusic(scene: Phaser.Scene): Phaser.Sound.BaseSound[] {
    if (!this.currentMusicKey) return [];
    return scene.sound.getAll(this.currentMusicKey);
  }

  private static applyMusicState(sound: Phaser.Sound.BaseSound) {
    const controllable = sound as Phaser.Sound.BaseSound & {
      setRate?: (value: number) => void;
      setDetune?: (value: number) => void;
      setMute?: (value: boolean) => void;
      rate?: number;
      detune?: number;
      mute?: boolean;
    };
    if (typeof controllable.setRate === 'function') controllable.setRate(this.currentMusicRate);
    else controllable.rate = this.currentMusicRate;
    if (typeof controllable.setDetune === 'function') controllable.setDetune(this.currentMusicDetune);
    else controllable.detune = this.currentMusicDetune;
    if (typeof controllable.setMute === 'function') controllable.setMute(this.currentMusicMuted);
    else controllable.mute = this.currentMusicMuted;
  }

  static playSfx(scene: Phaser.Scene, keys: string | readonly string[], config: Phaser.Types.Sound.SoundConfig = {}) {
    if (!SettingsStore.get(scene).sfx) return;
    const candidates = typeof keys === 'string' ? [keys] : keys;
    const available = candidates.filter((key) => scene.cache.audio.exists(key));
    if (available.length === 0) return;
    const key = available.length === 1 ? available[0] : securePick(available);
    if (!key) return;
    scene.sound.play(key, { volume: 0.45, ...config });
  }

  static playRandomSfx(scene: Phaser.Scene, keys: readonly string[], config: Phaser.Types.Sound.SoundConfig = {}) {
    this.playSfx(scene, keys, config);
  }

  static playMusic(scene: Phaser.Scene, key: string) {
    this.currentMusicKey = key;
    this.currentMusicRate = 1;
    this.currentMusicDetune = 0;
    this.currentMusicMuted = false;
    if (!SettingsStore.get(scene).music || !scene.cache.audio.exists(key)) {
      this.stopAllMusic(scene);
      return;
    }
    this.stopAllMusic(scene, key);
    const existing = scene.sound.getAll(key).find((sound) => sound.isPlaying);
    if (existing) {
      this.applyMusicState(existing);
      return;
    }
    scene.sound.play(key, { volume: 0.28, loop: true });
    const sound = scene.sound.getAll(key).find((candidate) => candidate.isPlaying);
    if (sound) this.applyMusicState(sound);
  }

  static setMusicRate(scene: Phaser.Scene, rate: number) {
    const normalized = Number.isFinite(rate) ? Math.min(16, Math.max(0.25, rate)) : 1;
    if (normalized === this.currentMusicRate) return;
    this.currentMusicRate = normalized;
    this.getCurrentMusic(scene).forEach((sound) => this.applyMusicState(sound));
  }

  static setMusicPitch(scene: Phaser.Scene, semitones: number) {
    const normalized = Number.isFinite(semitones) ? Math.min(12, Math.max(-12, semitones)) : 0;
    const detune = Math.round(normalized * 100);
    if (detune === this.currentMusicDetune) return;
    this.currentMusicDetune = detune;
    this.getCurrentMusic(scene).forEach((sound) => this.applyMusicState(sound));
  }

  static setMusicMuted(scene: Phaser.Scene, muted: boolean) {
    if (muted === this.currentMusicMuted) return;
    this.currentMusicMuted = muted;
    this.getCurrentMusic(scene).forEach((sound) => this.applyMusicState(sound));
  }

  static resetMusicEffects(scene: Phaser.Scene) {
    this.currentMusicRate = 1;
    this.currentMusicDetune = 0;
    this.currentMusicMuted = false;
    this.getCurrentMusic(scene).forEach((sound) => this.applyMusicState(sound));
  }

  static stopAllMusic(scene: Phaser.Scene, exceptKey?: string) {
    MUSIC_KEYS.forEach((musicKey) => {
      if (musicKey === exceptKey) return;
      scene.sound.getAll(musicKey).forEach((sound) => sound.stop());
    });
  }

  static refreshMusicForSettings(scene: Phaser.Scene, preferredKey = this.currentMusicKey ?? AUDIO_KEYS.menuMusic) {
    if (!SettingsStore.get(scene).music) {
      this.stopAllMusic(scene);
      return;
    }
    this.playMusic(scene, preferredKey);
  }
}
