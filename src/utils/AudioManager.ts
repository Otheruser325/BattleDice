import Phaser from 'phaser';
import { SettingsStore } from '../systems/SettingsStore';
import { withBasePath } from './BuildEnv';

export const AUDIO_KEYS = {
  menuMusic: 'menu-music',
  arenaMusic: 'arena-music',
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
  deathInstakill: 'dice_death_instakill'
} as const;

const MUSIC_KEYS = new Set<string>([AUDIO_KEYS.menuMusic, AUDIO_KEYS.arenaMusic]);

export class AudioManager {
  private static currentMusicKey: string | null = null;

  static preload(scene: Phaser.Scene) {
    scene.load.audio(AUDIO_KEYS.menuMusic, withBasePath('assets/music/dice_league.mp3'));
    scene.load.audio(AUDIO_KEYS.arenaMusic, withBasePath('assets/music/basilisk_theme.mp3'));
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
  }

  static playSfx(scene: Phaser.Scene, key: string, config: Phaser.Types.Sound.SoundConfig = {}) {
    if (!SettingsStore.get(scene).sfx || !scene.cache.audio.exists(key)) return;
    scene.sound.play(key, { volume: 0.45, ...config });
  }

  static playRandomSfx(scene: Phaser.Scene, keys: string[], config: Phaser.Types.Sound.SoundConfig = {}) {
    const available = keys.filter((key) => scene.cache.audio.exists(key));
    if (available.length === 0) return;
    const key = available[Math.floor(Math.random() * available.length)];
    this.playSfx(scene, key, config);
  }

  static playMusic(scene: Phaser.Scene, key: string) {
    this.currentMusicKey = key;
    if (!SettingsStore.get(scene).music || !scene.cache.audio.exists(key)) {
      this.stopAllMusic(scene);
      return;
    }
    this.stopAllMusic(scene, key);
    const existing = scene.sound.getAll(key).find((sound) => sound.isPlaying);
    if (existing) return;
    scene.sound.play(key, { volume: 0.28, loop: true });
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
