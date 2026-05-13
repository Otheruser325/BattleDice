import Phaser from 'phaser';
import { SettingsStore } from '../systems/SettingsStore';

export const AUDIO_KEYS = {
  menuMusic: 'menu-music',
  arenaMusic: 'arena-music',
  uiClick: 'ui-click',
  classUp: 'class-up',
  chestOpen: 'chest-open',
  diceAttack: 'dice-attack',
  comboRoll: 'combo-roll',
  skillTrigger: 'skill-trigger'
} as const;

const MUSIC_KEYS = new Set<string>([AUDIO_KEYS.menuMusic, AUDIO_KEYS.arenaMusic]);

export class AudioManager {
  private static currentMusicKey: string | null = null;

  static preload(scene: Phaser.Scene) {
    scene.load.audio(AUDIO_KEYS.menuMusic, '/assets/music/dice_league.mp3');
    scene.load.audio(AUDIO_KEYS.arenaMusic, '/assets/music/basilisk_theme.mp3');
    scene.load.audio(AUDIO_KEYS.uiClick, '/assets/audio/button.mp3');
    scene.load.audio(AUDIO_KEYS.classUp, '/assets/audio/combo_pair.mp3');
    scene.load.audio(AUDIO_KEYS.chestOpen, '/assets/audio/dice.mp3');
    scene.load.audio(AUDIO_KEYS.diceAttack, '/assets/audio/dice.mp3');
    scene.load.audio(AUDIO_KEYS.comboRoll, '/assets/audio/combo_pair.mp3');
    scene.load.audio(AUDIO_KEYS.skillTrigger, '/assets/audio/dice.mp3');
  }

  static playSfx(scene: Phaser.Scene, key: string, config: Phaser.Types.Sound.SoundConfig = {}) {
    if (!SettingsStore.get(scene).sfx || !scene.cache.audio.exists(key)) return;
    scene.sound.play(key, { volume: 0.45, ...config });
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
