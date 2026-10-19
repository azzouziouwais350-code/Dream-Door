import type Phaser from 'phaser';
import { TILE_H, TILE_W, WALL_H } from '../core/iso';
import { PAL, mix, shade } from '../core/palette';
import type { FurnKind } from '../core/types';
import { registerCanvas } from './environment';
import {
  type BoxGeo,
  type Ctx,
  boxGeo,
  boxPalette,
  boxPt,
  dot,
  drawBox,
  faceLeft,
  faceRight,
  hash2,
  isoDiamond,
  makeCanvas,
  part,
  px,
  topRect,
} from './pixel';

export interface FurnSprite {
  key: string;
  /** Hauteur du bloc en pixels (décalage vertical du sprite). */
  hp: number;
  /** Décalage horizontal du sprite par rapport au coin gauche de l'empreinte. */
  flat?: boolean;
}

export function furnKey(kind: FurnKind, w: number, h: number): string {
  return `furn_${kind}_${w}x${h}`;
}

type Painter = (ctx: Ctx, g: BoxGeo, w: number, h: number) => void;

interface Recipe {
  hp: number;
  paint: Painter;
  /** Sol plat (tapis) : dessiné sous tout le reste. */
  flat?: boolean;
}

const WOOD = 0x8a5a44;
const DARK_WOOD = 0x5e3d33;

function box(ctx: Ctx, parent: BoxGeo, u0: number, v0: number, w: number, h: number, z0: number, z1: number, base: number): ReturnType<typeof part> {
  const p = part(parent, u0, v0, w, h, z1);
  drawBox(ctx, p.g, boxPalette(base), z0, z1, p.ox, p.oy);
  return p;
}

const RECIPES: Record<FurnKind, (w: number, h: number) => Recipe> = {
  bed: () => ({
    hp: 16,
    paint: (ctx, g, w, h) => {
      box(ctx, g, 0, 0, w, h, 0, 8, DARK_WOOD);
      // Tête de lit.
      box(ctx, g, 0, 0, w, 0.25, 0, 16, WOOD);
      // Matelas et couverture.
      const m = box(ctx, g, 0.1, 0.3, w - 0.2, h - 0.4, 8, 12, 0xf3b5d8);
      topRect(ctx, m.g, 0.1, w - 0.3, 0.1, 0.9, 12, 0xfff4fb, m.ox, m.oy);
      topRect(ctx, m.g, 0.1, w - 0.3, 1.1, h - 0.5, 12, 0xd98fbd, m.ox, m.oy);
      // Oreiller.
      topRect(ctx, g, 0.3, w - 0.3, 0.45, 0.85, 12.5, 0xffffff);
    },
  }),
  wardrobe: (w, h) => ({
    hp: 36,
    paint: (ctx, g) => {
      box(ctx, g, 0, 0, w, h, 0, 36, 0x7b4f3d);
      box(ctx, g, -0.0, 0, w, h, 34, 36, 0x9a6a52);
      // Portes.
      faceLeft(ctx, g, 0.1, w / 2 - 0.02, 3, 31, shade(0x7b4f3d, -0.08));
      faceLeft(ctx, g, w / 2 + 0.02, w - 0.1, 3, 31, shade(0x7b4f3d, -0.04));
      faceLeft(ctx, g, w / 2 - 0.03, w / 2 + 0.03, 3, 31, DARK_WOOD);
      faceLeft(ctx, g, w / 2 - 0.2, w / 2 - 0.1, 16, 19, PAL.light);
      faceLeft(ctx, g, w / 2 + 0.1, w / 2 + 0.2, 16, 19, PAL.light);
      faceRight(ctx, g, 0.15, h - 0.15, 3, 31, shade(0x7b4f3d, -0.42));
    },
  }),
  closet: (w, h) => ({
    hp: 32,
    paint: (ctx, g) => {
      box(ctx, g, 0, 0, w, h, 0, 32, 0x6f7f8f);
      faceLeft(ctx, g, 0.15, w - 0.15, 4, 28, shade(0x6f7f8f, -0.2));
      for (let z = 20; z < 27; z += 2) faceLeft(ctx, g, 0.25, w - 0.25, z, z + 1, shade(0x6f7f8f, -0.45));
      faceLeft(ctx, g, w - 0.35, w - 0.25, 12, 15, PAL.light);
    },
  }),
  desk: (w, h) => ({
    hp: 16,
    paint: (ctx, g) => {
      box(ctx, g, 0.05, 0.05, 0.25, h - 0.1, 0, 14, DARK_WOOD);
      box(ctx, g, w - 0.3, 0.05, 0.25, h - 0.1, 0, 14, DARK_WOOD);
      box(ctx, g, 0, 0, w, h, 12, 16, WOOD);
      faceLeft(ctx, g, 0.2, 0.9, 5, 11, shade(WOOD, -0.2));
      faceLeft(ctx, g, 0.5, 0.6, 7, 9, PAL.light);
      topRect(ctx, g, w - 0.6, w - 0.2, 0.2, 0.5, 16, 0xf1dfe9);
    },
  }),
  drawer: (w, h) => ({
    hp: 18,
    paint: (ctx, g) => {
      box(ctx, g, 0, 0, w, h, 0, 18, WOOD);
      faceLeft(ctx, g, 0.12, w - 0.12, 10, 16, shade(WOOD, -0.18));
      faceLeft(ctx, g, 0.12, w - 0.12, 2, 8, shade(WOOD, -0.18));
      faceLeft(ctx, g, w / 2 - 0.05, w / 2 + 0.05, 12, 14, PAL.light);
      faceLeft(ctx, g, w / 2 - 0.05, w / 2 + 0.05, 4, 6, PAL.light);
    },
  }),
  couch: (w, h) => ({
    hp: 18,
    paint: (ctx, g) => {
      const c = 0xd68fb9;
      box(ctx, g, 0, 0, w, h, 0, 6, shade(c, -0.3));
      box(ctx, g, 0, 0, w, 0.35, 6, 18, c);
      box(ctx, g, 0, 0.35, 0.28, h - 0.35, 6, 13, shade(c, -0.1));
      box(ctx, g, w - 0.28, 0.35, 0.28, h - 0.35, 6, 13, shade(c, -0.1));
      topRect(ctx, g, 0.35, w - 0.35, 0.4, h - 0.1, 8, shade(c, 0.28));
      for (let i = 1; i < Math.round(w); i++) faceLeft(ctx, g, i - 0.03, i + 0.03, 7, 11, shade(c, -0.32));
    },
  }),
  table: (w, h) => ({
    hp: 18,
    paint: (ctx, g) => {
      box(ctx, g, w / 2 - 0.1, h / 2 - 0.1, 0.2, 0.2, 0, 14, DARK_WOOD);
      box(ctx, g, 0, 0, w, h, 14, 18, 0xb98568);
      topRect(ctx, g, w / 2 - 0.1, w / 2 + 0.1, h / 2 - 0.1, h / 2 + 0.1, 18, 0xffffff);
      dot(ctx, boxPt(g, w / 2, h / 2, 19).x, boxPt(g, w / 2, h / 2, 19).y, 0xb87a55);
    },
  }),
  plant: () => ({
    hp: 34,
    paint: (ctx, g) => {
      box(ctx, g, 0.25, 0.25, 0.5, 0.5, 0, 8, 0xc9795f);
      const base = boxPt(g, 0.5, 0.5, 10);
      const leaf = [0x5bb27a, 0x7fcf8d, 0x3e8f63];
      for (let i = 0; i < 60; i++) {
        const a = hash2(i, 1, 4) * Math.PI * 2;
        const r = 3 + hash2(i, 2, 4) * 9;
        const x = base.x + Math.cos(a) * r;
        const y = base.y - 4 - hash2(i, 3, 4) * 20 + Math.sin(a) * r * 0.5;
        px(ctx, x, y, 2, 2, leaf[i % 3] as number);
      }
    },
  }),
  floorlamp: () => ({
    hp: 40,
    paint: (ctx, g) => {
      box(ctx, g, 0.35, 0.35, 0.3, 0.3, 0, 3, 0x433a6b);
      const p = boxPt(g, 0.5, 0.5, 3);
      px(ctx, p.x - 1, p.y - 24, 2, 24, 0x5d5290);
      // Abat-jour.
      px(ctx, p.x - 5, p.y - 32, 10, 8, PAL.light);
      px(ctx, p.x - 6, p.y - 24, 12, 2, shade(PAL.light, -0.25));
      px(ctx, p.x - 5, p.y - 32, 10, 2, 0xffffff);
      px(ctx, p.x - 7, p.y - 34, 14, 12, PAL.light, 0.18);
    },
  }),
  counter: (w, h) => ({
    hp: 22,
    paint: (ctx, g) => {
      box(ctx, g, 0, 0, w, h, 0, 20, 0x6a4a63);
      box(ctx, g, -0.0, 0, w, h, 18, 22, 0xe6dcef);
      for (let i = 0; i < Math.round(w); i++) {
        faceLeft(ctx, g, i + 0.12, i + 0.88, 3, 16, shade(0x6a4a63, -0.14));
        faceLeft(ctx, g, i + 0.46, i + 0.54, 8, 11, PAL.light);
      }
      // Sonnette.
      const p = boxPt(g, w - 0.8, 0.5, 22);
      px(ctx, p.x - 2, p.y - 3, 4, 3, PAL.light);
      px(ctx, p.x - 1, p.y - 4, 2, 1, 0xffffff);
    },
  }),
  crate: (w, h) => ({
    hp: 16,
    paint: (ctx, g) => {
      box(ctx, g, 0, 0, w, h, 0, 16, 0xa9855f);
      for (let z = 4; z < 16; z += 5) {
        faceLeft(ctx, g, 0, w, z, z + 1, shade(0xa9855f, -0.35));
        faceRight(ctx, g, 0, h, z, z + 1, shade(0xa9855f, -0.55));
      }
      faceLeft(ctx, g, 0.05, 0.2, 0, 16, shade(0xa9855f, -0.35));
      faceLeft(ctx, g, w - 0.2, w - 0.05, 0, 16, shade(0xa9855f, -0.35));
    },
  }),
  shelf: (w, h) => ({
    hp: 38,
    paint: (ctx, g) => {
      box(ctx, g, 0, 0, w, h, 0, 38, 0x5f4a5e);
      const books = [0xf3b5d8, 0x72dcd4, 0xffe6b0, 0xb8a3f5, 0xa8d6a0];
      for (const z0 of [3, 15, 27]) {
        faceLeft(ctx, g, 0.08, w - 0.08, z0, z0 + 9, 0x2c2236);
        const n = Math.max(3, Math.round(w * 6));
        for (let i = 0; i < n; i++) {
          const u = 0.12 + ((w - 0.24) * i) / n;
          const bh = 5 + Math.floor(hash2(i, z0, 1) * 4);
          faceLeft(ctx, g, u, u + (w - 0.24) / n - 0.02, z0, z0 + bh, books[(i + z0) % books.length] as number);
        }
        faceRight(ctx, g, 0.08, h - 0.08, z0, z0 + 9, 0x2c2236);
      }
    },
  }),
  rug: (w, h) => ({
    hp: 1,
    flat: true,
    paint: (ctx, g) => {
      box(ctx, g, 0, 0, w, h, 0, 1, 0xd68fb9);
      topRect(ctx, g, 0.25, w - 0.25, 0.25, h - 0.25, 1, 0xf3b5d8);
      topRect(ctx, g, 0.55, w - 0.55, 0.55, h - 0.55, 1, 0xb8a3f5);
      topRect(ctx, g, 0.8, w - 0.8, 0.8, h - 0.8, 1, 0xffe6b0);
    },
  }),
  fusebox: () => ({ hp: 0, paint: () => undefined }),
  breaker: () => ({ hp: 0, paint: () => undefined }),
  valve: (w, h) => ({
    hp: 30,
    paint: (ctx, g) => {
      box(ctx, g, 0, 0, w, h, 0, 8, 0x4f6f7f);
      for (let i = 0; i < 3; i++) {
        const u = 0.3 + i * ((w - 0.6) / 2);
        box(ctx, g, u - 0.1, 0.35, 0.2, 0.3, 8, 24, 0x6fa7b4);
        const p = boxPt(g, u, 0.5, 26);
        px(ctx, p.x - 4, p.y - 2, 8, 2, 0xf36b7a);
        px(ctx, p.x - 1, p.y - 5, 2, 8, 0xf36b7a);
      }
    },
  }),
  gauge: () => ({ hp: 0, paint: () => undefined }),
  musicbox: () => ({
    hp: 14,
    paint: (ctx, g) => {
      box(ctx, g, 0.1, 0.1, 0.8, 0.8, 0, 6, DARK_WOOD);
      box(ctx, g, 0.15, 0.15, 0.7, 0.7, 6, 11, 0xd9a05a);
      topRect(ctx, g, 0.3, 0.7, 0.3, 0.7, 11, PAL.light);
      const p = boxPt(g, 0.85, 0.5, 8);
      px(ctx, p.x + 1, p.y - 2, 3, 1, 0xffffff);
    },
  }),
  piano: (w, h) => ({
    hp: 26,
    paint: (ctx, g) => {
      box(ctx, g, 0, 0, w, h, 0, 24, 0x2b2236);
      box(ctx, g, 0, h - 0.45, w, 0.45, 12, 15, 0xf6f0fa);
      for (let i = 0; i < Math.round(w * 7); i++) {
        const u = (i + 0.5) * (w / Math.round(w * 7));
        faceLeft(ctx, g, u - 0.01, u + 0.01, 7, 12, 0x000000, 0.6);
      }
      topRect(ctx, g, 0.1, w - 0.1, 0.1, 0.6, 24, shade(0x2b2236, 0.25));
    },
  }),
  console: (w, h) => ({
    hp: 20,
    paint: (ctx, g) => {
      box(ctx, g, 0, 0, w, h, 0, 18, 0x3d5a6a);
      box(ctx, g, 0, 0, w, h, 16, 20, 0x6fa7b4);
      for (let i = 0; i < Math.round(w * 3); i++) {
        const u = 0.15 + i * 0.3;
        faceLeft(ctx, g, u, u + 0.16, 5, 13, i % 2 ? 0xffe6b0 : 0x72dcd4);
      }
      topRect(ctx, g, 0.2, w - 0.2, 0.2, h - 0.2, 20, 0x9fd2dc);
    },
  }),
  trolley: (w, h) => ({
    hp: 26,
    paint: (ctx, g) => {
      box(ctx, g, 0, 0, w, h, 4, 8, 0xc3c9d6);
      box(ctx, g, 0.05, 0.05, 0.1, h - 0.1, 0, 26, 0x8a90a6);
      box(ctx, g, w - 0.15, 0.05, 0.1, h - 0.1, 0, 26, 0x8a90a6);
      topRect(ctx, g, 0.2, w - 0.2, 0.2, h - 0.2, 8, 0xf1dfe9);
      box(ctx, g, 0.2, 0.2, w - 0.5, h - 0.4, 8, 16, 0xf6f0fa);
      box(ctx, g, 0.2, 0.2, w - 0.5, h - 0.4, 16, 20, 0x72dcd4);
    },
  }),
  painting: () => ({ hp: 0, paint: () => undefined }),
  window: () => ({ hp: 0, paint: () => undefined }),
  clock: () => ({ hp: 0, paint: () => undefined }),
  elevatorPanel: () => ({ hp: 0, paint: () => undefined }),
  statue: () => ({
    hp: 40,
    paint: (ctx, g) => {
      box(ctx, g, 0.1, 0.1, 0.8, 0.8, 0, 10, 0xd9cde8);
      const p = boxPt(g, 0.5, 0.5, 10);
      const c = 0xece3f5;
      px(ctx, p.x - 3, p.y - 22, 6, 22, c);
      px(ctx, p.x - 5, p.y - 20, 2, 10, c);
      px(ctx, p.x + 3, p.y - 20, 2, 10, c);
      px(ctx, p.x - 3, p.y - 28, 6, 6, shade(c, 0.1));
      px(ctx, p.x + 3, p.y - 22, 3, 22, shade(c, -0.3));
    },
  }),
};

export function generateFurnitureTexture(textures: Phaser.Textures.TextureManager, kind: FurnKind, w: number, h: number): FurnSprite {
  const key = furnKey(kind, w, h);
  const recipe = RECIPES[kind](w, h);
  if (textures.exists(key)) return { key, hp: recipe.hp, flat: recipe.flat };
  const g = boxGeo(w, h, recipe.hp);
  const { canvas, ctx } = makeCanvas(g.cw + 2, g.ch + 2);
  recipe.paint(ctx, g, w, h);
  registerCanvas(textures, key, canvas);
  return { key, hp: recipe.hp, flat: recipe.flat };
}

/* -------------------------------------------------------------------------- */
/* Objets muraux (même gabarit que les panneaux de mur)                        */
/* -------------------------------------------------------------------------- */
function wallTop(side: 'N' | 'W', i: number): number {
  const slope = TILE_H / 2;
  return side === 'N' ? Math.floor(i / 2) : slope - 1 - Math.floor(i / 2);
}

export function wallDecorKey(kind: FurnKind, side: 'N' | 'W', variant = ''): string {
  return `decor_${kind}_${side}${variant}`;
}

export interface WallDecorOpts {
  /** Interrupteurs : nombre et états (pour le tableau). */
  switches?: boolean[];
  /** Aiguille du manomètre (0..1). */
  needle?: number;
  anomalous?: boolean;
}

/** Dessine un objet mural sur une pièce de 16 px. `px0..px1` : colonnes utiles. */
export function generateWallDecor(textures: Phaser.Textures.TextureManager, kind: FurnKind, side: 'N' | 'W', opts: WallDecorOpts = {}, variant = ''): string {
  const key = wallDecorKey(kind, side, variant);
  const w = TILE_W / 2;
  const slope = TILE_H / 2;
  const { canvas, ctx } = makeCanvas(w, WALL_H + slope);
  const put = (i: number, zTop: number, color: number, a = 1): void => {
    px(ctx, i, wallTop(side, i) + zTop, 1, 1, color, a);
  };
  const rect = (i0: number, i1: number, z0: number, z1: number, color: number): void => {
    for (let i = i0; i < i1; i++) for (let z = z0; z < z1; z++) put(i, z, color);
  };
  const shadeFace = side === 'N' ? 0 : -0.16;
  const c = (v: number): number => shade(v, shadeFace);

  switch (kind) {
    case 'painting': {
      rect(2, 14, 8, 30, c(PAL.light));
      rect(3, 13, 9, 29, c(0x2c2236));
      // Paysage onirique : ciel, soleil, eau, silhouette.
      rect(3, 13, 9, 20, c(PAL.sky));
      rect(3, 13, 20, 29, c(PAL.water));
      rect(8, 11, 11, 14, c(0xfff1c9));
      rect(5, 7, 17, 22, c(0x1a1530));
      rect(4, 6, 13, 15, c(0xffffff));
      if (opts.anomalous) rect(6, 7, 24, 28, c(0xf36b7a));
      break;
    }
    case 'window': {
      rect(1, 15, 6, 36, c(0xe6dcef));
      rect(2, 14, 8, 34, c(PAL.sky));
      rect(2, 14, 8, 16, c(0xe8f5ff));
      rect(7, 9, 8, 34, c(0xe6dcef));
      rect(2, 14, 20, 21, c(0xe6dcef));
      // Nuages et rideaux.
      rect(3, 6, 12, 14, c(0xffffff));
      rect(9, 13, 25, 27, c(0xffffff));
      rect(1, 3, 6, 36, c(PAL.rose));
      rect(13, 15, 6, 36, c(PAL.rose));
      if (opts.anomalous) rect(10, 12, 15, 18, c(0x1a1530));
      break;
    }
    case 'clock': {
      const cx = 8;
      const cy = 16;
      for (let i = 0; i < w; i++) {
        for (let z = 6; z < 28; z++) {
          const d = Math.hypot(i - cx, z - cy);
          if (d < 8) put(i, z, d > 6.2 ? c(PAL.light) : c(0xfff6e0));
        }
      }
      rect(8, 9, 11, 17, c(0x2c2236));
      rect(8, 12, 16, 17, c(0x2c2236));
      rect(7, 9, 15, 17, c(0x2c2236));
      break;
    }
    case 'fusebox': {
      rect(2, 14, 6, 30, c(0x6b7388));
      rect(3, 13, 8, 28, c(0x8d95ab));
      rect(4, 12, 10, 14, c(0x2c2236));
      rect(5, 7, 10, 14, c(0xffe6b0));
      rect(9, 11, 10, 14, c(0xffe6b0));
      rect(7, 9, 17, 25, c(0x4a4f63));
      rect(5, 11, 25, 27, c(0xf36b7a));
      rect(3, 5, 8, 10, c(0x4a4f63));
      rect(11, 13, 8, 10, c(0x4a4f63));
      break;
    }
    case 'breaker': {
      rect(1, 15, 5, 32, c(0x4a4f63));
      rect(2, 14, 7, 30, c(0x2c2236));
      const sw = opts.switches ?? [false, false, false];
      sw.forEach((on, idx) => {
        const x0 = 3 + idx * Math.floor(10 / Math.max(1, sw.length));
        rect(x0, x0 + 2, 9, 28, c(0x3b3550));
        rect(x0, x0 + 2, on ? 9 : 20, on ? 17 : 28, on ? c(0x72dcd4) : c(0xf36b7a));
      });
      break;
    }
    case 'gauge': {
      const cx = 8;
      const cy = 17;
      for (let i = 0; i < w; i++) {
        for (let z = 7; z < 29; z++) {
          const d = Math.hypot(i - cx, z - cy);
          if (d < 8) put(i, z, d > 6.2 ? c(0x8d95ab) : c(0xf6f0fa));
        }
      }
      const a = Math.PI * (1.15 + (opts.needle ?? 0.4) * 0.7);
      for (let t = 0; t < 6; t++) put(Math.round(cx + Math.cos(a) * t), Math.round(cy + Math.sin(a) * t), c(0xf36b7a));
      rect(2, 4, 17, 19, c(0x2c2236));
      rect(12, 14, 17, 19, c(0x2c2236));
      break;
    }
    case 'elevatorPanel': {
      rect(1, 15, 4, 34, c(0xd6a85c));
      rect(2, 14, 6, 32, c(0x3b2f4a));
      for (let r = 0; r < 4; r++) for (let q = 0; q < 2; q++) rect(4 + q * 5, 7 + q * 5, 9 + r * 5, 12 + r * 5, r === 3 ? c(PAL.rose) : c(PAL.light));
      rect(6, 10, 7, 8, c(0x72dcd4));
      break;
    }
    default:
      break;
  }
  registerCanvas(textures, key, canvas);
  return key;
}

export function drawShadowBlob(textures: Phaser.Textures.TextureManager): void {
  if (textures.exists('shadow_blob')) return;
  const { canvas, ctx } = makeCanvas(24, 12);
  isoDiamond(ctx, 0, 0, 24, 12, 0x000000);
  ctx.globalCompositeOperation = 'destination-in';
  const grad = ctx.createRadialGradient(12, 6, 1, 12, 6, 12);
  grad.addColorStop(0, 'rgba(0,0,0,0.55)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 24, 12);
  registerCanvas(textures, 'shadow_blob', canvas);
}

export function mixColor(a: number, b: number, t: number): number {
  return mix(a, b, t);
}
