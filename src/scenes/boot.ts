import Phaser from 'phaser';
import { PAL } from '../core/palette';
import { ITEM_ICON_IDS } from '../data/items';
import { generateCharacterTextures } from '../gfx/characters';
import { generateEnvironmentTextures, registerCanvas } from '../gfx/environment';
import { drawShadowBlob } from '../gfx/furniture';
import { iconCanvas } from '../gfx/icons';
import { makeCanvas, px } from '../gfx/pixel';

/** Génère toutes les textures de base (aucun fichier image : tout est dessiné par code). */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create(): void {
    const t = this.textures;
    generateEnvironmentTextures(t);
    generateCharacterTextures(t);
    drawShadowBlob(t);
    for (const id of ITEM_ICON_IDS) registerCanvas(t, `item_${id}`, iconCanvas(id));

    {
      const { canvas, ctx } = makeCanvas(9, 6);
      for (let i = 0; i < 5; i++) px(ctx, i, i, 1, 1, PAL.light);
      for (let i = 0; i < 5; i++) px(ctx, 8 - i, i, 1, 1, PAL.light);
      px(ctx, 4, 4, 1, 1, 0xffffff);
      registerCanvas(t, 'chev', canvas);
    }
    {
      const { canvas, ctx } = makeCanvas(2, 2);
      px(ctx, 0, 0, 2, 2, 0xfff0c8, 0.8);
      registerCanvas(t, 'dust', canvas);
    }
    {
      const { canvas, ctx } = makeCanvas(10, 4);
      px(ctx, 1, 1, 3, 2, 0xffffff);
      px(ctx, 6, 1, 3, 2, 0xffffff);
      px(ctx, 2, 1, 1, 2, 0x11111f);
      px(ctx, 7, 1, 1, 2, 0x11111f);
      registerCanvas(t, 'eyes', canvas);
    }
    {
      // Marque de craie lumineuse (croix).
      const { canvas, ctx } = makeCanvas(9, 5);
      for (let i = 0; i < 5; i++) {
        px(ctx, 2 + i, i, 1, 1, PAL.water);
        px(ctx, 6 - i, i, 1, 1, PAL.water);
      }
      registerCanvas(t, 'mark', canvas);
    }
    this.scene.start('Game');
  }
}
