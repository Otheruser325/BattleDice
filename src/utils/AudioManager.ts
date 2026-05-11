import Phaser from 'phaser';
import { SettingsStore } from '../systems/SettingsStore';

export const AUDIO_KEYS = {
  menuMusic: 'menu-music',
  arenaMusic: 'arena-music',
  uiClick: 'ui-click',
  classUp: 'class-up',
  chestOpen: 'chest-open',
  diceAttack: 'dice-attack'
} as const;

const MUSIC_KEYS = new Set<string>([AUDIO_KEYS.menuMusic, AUDIO_KEYS.arenaMusic]);

export class AudioManager {
  static preload(scene: Phaser.Scene) {
    scene.load.audio(AUDIO_KEYS.menuMusic, '/assets/music/dice_league.mp3');
    scene.load.audio(AUDIO_KEYS.arenaMusic, '/assets/music/basilisk_theme.mp3');
    scene.load.audio(AUDIO_KEYS.uiClick, '/assets/audio/button.mp3');
    scene.load.audio(AUDIO_KEYS.classUp, '/assets/audio/combo_pair.mp3');
    scene.load.audio(AUDIO_KEYS.chestOpen, '/assets/audio/dice.mp3');
    scene.load.audio(AUDIO_KEYS.diceAttack, '/assets/audio/dice.mp3');
  }

  static playSfx(scene: Phaser.Scene, key: string, config: Phaser.Types.Sound.SoundConfig = {}) {
    if (!SettingsStore.get(scene).sfx || !scene.cache.audio.exists(key)) return;
    scene.sound.play(key, { volume: 0.45, ...config });
  }

  static playMusic(scene: Phaser.Scene, key: string) {
    if (!SettingsStore.get(scene).music || !scene.cache.audio.exists(key)) return;
    MUSIC_KEYS.forEach((musicKey) => {
      const sound = scene.sound.get(musicKey);
      if (musicKey !== key && sound?.isPlaying) sound.stop();
    });
    const existing = scene.sound.get(key);
    if (existing?.isPlaying) return;
    scene.sound.play(key, { volume: 0.28, loop: true });
  }
}
