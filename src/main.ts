import Phaser from 'phaser';
import './ui/style.css';
import { App } from './app';
import { BootScene } from './scenes/boot';
import { GameScene } from './scenes/game';

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#11111F',
  pixelArt: true,
  antialias: false,
  roundPixels: true,
  scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
  scene: [BootScene, GameScene],
  audio: { noAudio: true },
  disableContextMenu: true,
  banner: false,
});

let started = false;
game.events.on(Phaser.Core.Events.READY, () => undefined);
const tryStart = (): void => {
  if (started) return;
  const scene = game.scene.getScene('Game') as GameScene | null;
  if (scene && scene.sys.isActive() && game.canvas) {
    started = true;
    new App(game, scene);
  }
};
const poll = window.setInterval(() => {
  tryStart();
  if (started) window.clearInterval(poll);
}, 30);
