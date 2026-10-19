import type Phaser from 'phaser';
import { PAL, shade } from '../core/palette';
import type { Dir } from '../core/types';
import { registerCanvas } from './environment';
import { type Ctx, hash2, makeCanvas, px } from './pixel';

export const FIG_W = 28;
export const FIG_H = 40;
/** Position des pieds dans le sprite (origine du rendu). */
export const FIG_FOOT = { x: 14, y: 36 };

export type Pose = 'idle' | 'walk' | 'run' | 'sneak' | 'interact' | 'pickup' | 'fear' | 'hurt' | 'cheer';

export const POSE_FRAMES: Record<Pose, number> = {
  idle: 2,
  walk: 4,
  run: 4,
  sneak: 4,
  interact: 2,
  pickup: 2,
  fear: 2,
  hurt: 3,
  cheer: 2,
};

export interface FigureSpec {
  id: string;
  skin: number;
  hair: number;
  hairStyle: 'short' | 'bun' | 'long' | 'none';
  coat: number;
  trim: number;
  pants: number;
  shoes: number;
  hat?: { type: 'top' | 'cap' | 'pill'; color: number; band: number };
  skirt?: boolean;
  /** Hauteur de silhouette en pixels (≈ 24..34). */
  height: number;
  eyes: number;
  /** Silhouette fantomatique (alpha, yeux lumineux, pas de bouche). */
  ghost?: boolean;
  mustache?: boolean;
  keys?: boolean;
  poses: Pose[];
}

export const FIGURES: Record<string, FigureSpec> = {
  player: {
    id: 'player',
    skin: 0xf5d0b5,
    hair: 0x2c2236,
    hairStyle: 'short',
    coat: PAL.lavender,
    trim: PAL.light,
    pants: 0x3b2f66,
    shoes: PAL.rose,
    height: 30,
    eyes: 0x2c2236,
    poses: ['idle', 'walk', 'run', 'sneak', 'interact', 'pickup', 'fear', 'hurt', 'cheer'],
  },
  orsolya: {
    id: 'orsolya',
    skin: 0xf0cfc0,
    hair: 0x6b3a52,
    hairStyle: 'bun',
    coat: 0x7d6bb3,
    trim: PAL.light,
    pants: 0x3a2d63,
    shoes: 0x2c2236,
    skirt: true,
    height: 30,
    eyes: 0x2c2236,
    poses: ['idle', 'interact'],
  },
  basile: {
    id: 'basile',
    skin: 0xf2d7c0,
    hair: 0x8a5a44,
    hairStyle: 'short',
    coat: 0xc2476b,
    trim: PAL.light,
    pants: 0x2c2236,
    shoes: 0x1a1530,
    hat: { type: 'pill', color: 0xc2476b, band: PAL.light },
    height: 22,
    eyes: 0x2c2236,
    poses: ['idle', 'interact'],
  },
  ilye: {
    id: 'ilye',
    skin: 0xd9b59c,
    hair: 0xe6dcef,
    hairStyle: 'short',
    coat: 0x3e8f9a,
    trim: 0xd6a85c,
    pants: 0x1f4a52,
    shoes: 0x1a1530,
    hat: { type: 'cap', color: 0x3e8f9a, band: 0xd6a85c },
    height: 32,
    eyes: 0x2c2236,
    poses: ['idle', 'interact'],
  },
  concierge: {
    id: 'concierge',
    skin: 0xe8e0e8,
    hair: 0x1a1530,
    hairStyle: 'short',
    coat: 0x2b2236,
    trim: 0xd6a85c,
    pants: 0x1a1530,
    shoes: 0x0e0a1c,
    hat: { type: 'top', color: 0x1a1530, band: 0xd6a85c },
    height: 36,
    eyes: 0xf36b7a,
    mustache: true,
    keys: true,
    poses: ['idle', 'walk', 'run'],
  },
  watcher: {
    id: 'watcher',
    skin: 0xece3f5,
    hair: 0xece3f5,
    hairStyle: 'long',
    coat: 0xd9cde8,
    trim: 0xffffff,
    pants: 0xd9cde8,
    shoes: 0xd9cde8,
    height: 36,
    eyes: PAL.rose,
    ghost: true,
    poses: ['idle'],
  },
};

export function figureKey(id: string, pose: Pose, front: boolean, n: number): string {
  return `fig_${id}_${pose}_${front ? 'F' : 'B'}_${n}`;
}

/** Retourne la clé de texture et le miroir horizontal pour une direction isométrique. */
export function figureFrame(id: string, pose: Pose, dir: Dir, n: number): { key: string; flip: boolean } {
  const front = dir === 'DR' || dir === 'DL';
  const flip = dir === 'DL' || dir === 'UL';
  return { key: figureKey(id, pose, front, n % POSE_FRAMES[pose]), flip };
}

function drawFigure(spec: FigureSpec, pose: Pose, front: boolean, n: number): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(FIG_W, FIG_H);
  const cx = FIG_FOOT.x;
  const foot = FIG_FOOT.y;
  const h = spec.height;
  const alpha = spec.ghost ? 0.85 : 1;
  const r = (x: number, y: number, w: number, hh: number, c: number, a = alpha): void => px(ctx, cx + x, y, w, hh, c, a);

  const stride = pose === 'run' ? 3 : pose === 'walk' || pose === 'sneak' ? 2 : 0;
  const phase = [0, 1, 0, -1][n % 4] as number;
  const bob = (pose === 'walk' || pose === 'run') && n % 2 === 1 ? 1 : 0;
  const crouch = pose === 'sneak' ? 4 : pose === 'pickup' ? 6 : 0;
  const lying = pose === 'hurt';

  if (lying) {
    drawLying(ctx, spec, n);
    return canvas;
  }

  const legH = Math.round(h * 0.3) - Math.floor(crouch / 2);
  const bodyH = Math.round(h * 0.34);
  const hipY = foot - legH;
  const shoulderY = hipY - bodyH + bob;
  const headY = shoulderY - 9 + (pose === 'idle' && n === 1 ? 1 : 0) + Math.floor(crouch / 3);

  // Jambes.
  const lx = -4;
  const rx = 1;
  if (spec.skirt) {
    r(-6, hipY - 2, 12, legH + 1, spec.coat);
    r(-6, hipY + legH - 2, 12, 1, shade(spec.coat, -0.3));
    r(-3, hipY + legH - 1, 2, 2, spec.skin);
    r(1, hipY + legH - 1, 2, 2, spec.skin);
    r(-3, foot - 1, 2, 1, spec.shoes);
    r(1, foot - 1, 2, 1, spec.shoes);
  } else {
    const offL = stride * phase;
    const offR = -stride * phase;
    r(lx, hipY, 3, legH - Math.max(0, offL), spec.pants);
    r(rx, hipY, 3, legH - Math.max(0, offR), spec.pants);
    r(lx + (front ? offL : -offL) / 2, foot - 2 - Math.max(0, offL), 4, 2, spec.shoes);
    r(rx + (front ? offR : -offR) / 2, foot - 2 - Math.max(0, offR), 4, 2, spec.shoes);
  }

  // Corps (manteau).
  r(-6, shoulderY, 12, bodyH, spec.coat);
  r(-6, shoulderY, 12, 1, shade(spec.coat, 0.25));
  r(-6, shoulderY + bodyH - 2, 12, 2, shade(spec.coat, -0.25));
  r(front ? 4 : -6, shoulderY + 1, 2, bodyH - 2, shade(spec.coat, -0.2));
  if (front) {
    r(-1, shoulderY + 1, 2, bodyH - 3, spec.trim);
    r(-5, shoulderY + Math.floor(bodyH / 2), 10, 1, shade(spec.coat, -0.35));
    if (spec.hat?.type === 'top' || spec.id === 'ilye') {
      r(-3, shoulderY + 3, 1, 1, spec.trim);
      r(2, shoulderY + 3, 1, 1, spec.trim);
      r(-3, shoulderY + 6, 1, 1, spec.trim);
      r(2, shoulderY + 6, 1, 1, spec.trim);
    }
  } else {
    r(-4, shoulderY + 2, 8, 2, shade(spec.coat, 0.12));
  }

  // Bras.
  const armSwing = pose === 'walk' || pose === 'run' || pose === 'sneak' ? phase * 2 : 0;
  const armH = bodyH - 3;
  const armY = shoulderY + 1;
  const sleeve = spec.coat;
  if (pose === 'cheer') {
    r(-9, armY - 8, 3, armH, sleeve);
    r(6, armY - 8, 3, armH, sleeve);
    r(-9, armY - 10, 3, 2, spec.skin);
    r(6, armY - 10, 3, 2, spec.skin);
  } else if (pose === 'fear') {
    r(-8, armY - 3 - n, 3, armH - 2, sleeve);
    r(5, armY - 3 - n, 3, armH - 2, sleeve);
    r(-7, armY - 5 - n, 3, 3, spec.skin);
    r(4, armY - 5 - n, 3, 3, spec.skin);
  } else if (pose === 'interact') {
    r(-9, armY + 1, 3, armH, sleeve);
    r(5 + n, armY - 1, 3, armH - 2, sleeve);
    r(5 + n + (front ? 1 : -1), armY - 2, 3, 3, spec.skin);
    r(-9, armY + armH, 3, 2, spec.skin);
  } else if (pose === 'pickup') {
    r(-9, armY + 3, 3, armH - 2, sleeve);
    r(6, armY + 3, 3, armH - 2, sleeve);
    r(n === 0 ? -9 : -8, armY + armH + 2, 3, 2, spec.skin);
    r(n === 0 ? 6 : 5, armY + armH + 2, 3, 2, spec.skin);
  } else {
    r(-9, armY + armSwing, 3, armH, sleeve);
    r(6, armY - armSwing, 3, armH, sleeve);
    r(-9, armY + armH + armSwing, 3, 2, spec.skin);
    r(6, armY + armH - armSwing, 3, 2, spec.skin);
  }
  if (spec.keys && front) {
    r(7, armY + armH - 1 - armSwing, 2, 4, 0xd6a85c);
    r(8, armY + armH + 2 - armSwing, 2, 2, 0xffe6b0);
  }

  // Tête.
  r(-4, headY, 8, 8, spec.skin);
  r(-4, headY + 7, 8, 1, shade(spec.skin, -0.12));
  if (front) {
    const ex = spec.ghost ? 0 : 1;
    if (spec.ghost) {
      r(-3 + ex, headY + 3, 2, 2, spec.eyes, 1);
      r(1 + ex, headY + 3, 2, 2, spec.eyes, 1);
      r(-4 + ex, headY + 2, 4, 4, spec.eyes, 0.25);
      r(0 + ex, headY + 2, 4, 4, spec.eyes, 0.25);
    } else {
      const wide = pose === 'fear' ? 2 : 1;
      r(-3 + ex, headY + 3, 1, wide, spec.eyes);
      r(1 + ex, headY + 3, 1, wide, spec.eyes);
      if (pose === 'fear') r(-1 + ex, headY + 6, 2, 1, shade(spec.skin, -0.45));
      else r(-1 + ex, headY + 6, 2, 1, shade(spec.skin, -0.25));
      if (spec.mustache) r(-2 + ex, headY + 5, 4, 1, spec.hair);
    }
  }
  // Cheveux.
  const hairTop = headY - 1;
  switch (spec.hairStyle) {
    case 'short':
      r(-5, hairTop, 10, 4, spec.hair);
      if (!front) r(-5, hairTop, 10, 8, spec.hair);
      else {
        r(-5, hairTop + 3, 2, 3, spec.hair);
        r(3, hairTop + 3, 2, 3, spec.hair);
      }
      break;
    case 'bun':
      r(-5, hairTop, 10, 4, spec.hair);
      r(-2, hairTop - 3, 5, 3, spec.hair);
      if (!front) r(-5, hairTop, 10, 8, spec.hair);
      break;
    case 'long':
      r(-5, hairTop, 10, 4, spec.hair);
      r(-5, hairTop + 3, 2, 14, spec.hair);
      r(3, hairTop + 3, 2, 14, spec.hair);
      if (!front) r(-5, hairTop, 10, 16, spec.hair);
      break;
    default:
      break;
  }
  // Chapeau.
  if (spec.hat) {
    const { type, color, band } = spec.hat;
    if (type === 'top') {
      r(-6, headY, 12, 2, color);
      r(-4, headY - 9, 8, 9, color);
      r(-4, headY - 2, 8, 2, band);
    } else if (type === 'cap') {
      r(-5, headY - 3, 10, 4, color);
      r(-6, headY, 12, 2, shade(color, -0.2));
      r(-1, headY - 2, 2, 1, band);
    } else {
      r(-4, headY - 4, 8, 4, color);
      r(-4, headY - 1, 8, 1, band);
    }
  }
  // Écharpe / col du joueur.
  if (spec.id === 'player') {
    r(-5, shoulderY - 1, 10, 2, PAL.rose);
    if (n % 2 === 0 && (pose === 'walk' || pose === 'run')) r(-6, shoulderY, 2, 4, PAL.rose);
  }
  return canvas;
}

function drawLying(ctx: Ctx, spec: FigureSpec, n: number): void {
  const y = FIG_FOOT.y - 8 + (n === 0 ? -4 : n === 1 ? -2 : 0);
  const x0 = 2;
  px(ctx, x0, y + 1, 7, 5, spec.skin);
  px(ctx, x0, y, 7, 2, spec.hair);
  px(ctx, x0 + 7, y, 11, 7, spec.coat);
  px(ctx, x0 + 18, y + 1, 7, 5, spec.pants);
  px(ctx, x0 + 24, y + 1, 2, 5, spec.shoes);
  px(ctx, x0 + 8, y - 2, 3, 3, spec.skin);
}

/* -------------------------------------------------------------------------- */
/* Entités non humanoïdes                                                     */
/* -------------------------------------------------------------------------- */
function drawCeilingShadow(n: number): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(48, 32);
  const cx = 24;
  const cy = 18;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + n * 0.3;
    for (let t = 4; t < 20; t++) {
      const wob = Math.sin(t * 0.5 + n + i) * 1.5;
      px(ctx, cx + Math.cos(a) * t + wob, cy + Math.sin(a) * t * 0.55, 2, 2, 0x0a0714);
    }
  }
  for (let y = -8; y <= 8; y++) {
    for (let x = -12; x <= 12; x++) {
      if ((x * x) / 144 + (y * y) / 64 <= 1) px(ctx, cx + x, cy + y, 1, 1, hash2(x, y, n) > 0.85 ? 0x1c1334 : 0x0a0714);
    }
  }
  px(ctx, cx - 6, cy - 2, 3, 4, 0xffffff);
  px(ctx, cx + 3, cy - 2, 3, 4, 0xffffff);
  px(ctx, cx - 5, cy - 1, 1, 2, 0x0a0714);
  px(ctx, cx + 4, cy - 1, 1, 2, 0x0a0714);
  return canvas;
}

function drawSwimmer(n: number): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(40, 24);
  const cx = 20;
  const cy = 14;
  for (const rad of [4 + n * 2, 9 + n * 2]) {
    for (let a = 0; a < 40; a++) {
      const t = (a / 40) * Math.PI * 2;
      px(ctx, cx + Math.cos(t) * rad * 1.8, cy + Math.sin(t) * rad * 0.8, 1, 1, PAL.water, 0.5);
    }
  }
  // Aileron dorsal.
  for (let i = 0; i < 9; i++) px(ctx, cx - 1 + i * 0.3, cy - 9 + i, 4 - Math.floor(i / 3), 1, 0x2a5360);
  px(ctx, cx + 1, cy - 8, 1, 7, 0x7fd0d4);
  return canvas;
}

function drawLungingHand(n: number): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(28, 34);
  px(ctx, 11, 12 - n * 2, 6, 22 + n * 2, 0xd9efe9, 0.9);
  for (let f = 0; f < 4; f++) px(ctx, 10 + f * 2, 8 - n * 2, 1, 6, 0xd9efe9, 0.9);
  px(ctx, 6, 30, 16, 3, PAL.water, 0.6);
  return canvas;
}

export function generateCharacterTextures(textures: Phaser.Textures.TextureManager): void {
  for (const spec of Object.values(FIGURES)) {
    for (const pose of spec.poses) {
      for (const front of [true, false]) {
        for (let n = 0; n < POSE_FRAMES[pose]; n++) {
          registerCanvas(textures, figureKey(spec.id, pose, front, n), drawFigure(spec, pose, front, n));
        }
      }
    }
  }
  for (let n = 0; n < 2; n++) registerCanvas(textures, `ent_shadow_${n}`, drawCeilingShadow(n));
  for (let n = 0; n < 3; n++) registerCanvas(textures, `ent_swimmer_${n}`, drawSwimmer(n));
  for (let n = 0; n < 2; n++) registerCanvas(textures, `ent_hand_${n}`, drawLungingHand(n));
}
