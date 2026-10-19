import type Phaser from 'phaser';
import { TILE_H, TILE_W, WALL_H } from '../core/iso';
import { PAL, mix, shade } from '../core/palette';
import type { FloorStyle, WallStyle } from '../core/types';
import { drawGlyphs, glyphWidth, hash2, isoDiamond, makeCanvas, px, dot } from './pixel';

export function registerCanvas(textures: Phaser.Textures.TextureManager, key: string, canvas: HTMLCanvasElement): void {
  if (textures.exists(key)) textures.remove(key);
  textures.addCanvas(key, canvas);
}

/* -------------------------------------------------------------------------- */
/* Sols                                                                       */
/* -------------------------------------------------------------------------- */
interface FloorSpec {
  a: number;
  b: number;
  line: number;
}

const FLOORS: Record<FloorStyle, FloorSpec> = {
  carpet: { a: 0x5a4a8c, b: 0x54447f, line: 0x3b2f66 },
  checker: { a: 0xf1dfe9, b: 0xb8a3f5, line: 0x8a76c8 },
  wood: { a: 0x9a6f57, b: 0x8c6350, line: 0x5f4033 },
  tile: { a: 0x8fcfd0, b: 0x7fc0c4, line: 0x4f8f98 },
  marble: { a: 0xe6dcef, b: 0xd9cde8, line: 0x9d8cc0 },
  dream: { a: 0xc7e6ff, b: 0xf6d6ea, line: 0x9fc3ec },
};

export const FLOOR_STYLES = Object.keys(FLOORS) as FloorStyle[];

function drawFloor(style: FloorStyle, variant: number): HTMLCanvasElement {
  const spec = FLOORS[style];
  const { canvas, ctx } = makeCanvas(TILE_W, TILE_H);
  const base = variant === 0 ? spec.a : spec.b;
  isoDiamond(ctx, 0, 0, TILE_W, TILE_H, base);

  // Texture par pixel, masquée par le losange.
  const hw = TILE_W / 2;
  const hh = TILE_H / 2;
  const inside = (x: number, y: number): boolean => Math.abs(x + 0.5 - hw) / hw + Math.abs(y + 0.5 - hh) / hh <= 1;
  for (let y = 0; y < TILE_H; y++) {
    for (let x = 0; x < TILE_W; x++) {
      if (!inside(x, y)) continue;
      const n = hash2(x, y, variant + style.length);
      switch (style) {
        case 'carpet':
          if (n > 0.86) dot(ctx, x, y, shade(base, 0.12));
          else if (n < 0.1) dot(ctx, x, y, shade(base, -0.14));
          if ((x + y) % 8 === 0 && n > 0.4) dot(ctx, x, y, shade(base, 0.2));
          break;
        case 'wood':
          if (y % 4 === 0) dot(ctx, x, y, spec.line);
          else if (n > 0.9) dot(ctx, x, y, shade(base, 0.12));
          if ((x + Math.floor(y / 4) * 7) % 13 === 0 && y % 4 !== 0) dot(ctx, x, y, shade(base, -0.18));
          break;
        case 'tile':
          if (x % 8 === 0 || y % 4 === 0) dot(ctx, x, y, spec.line, 0.55);
          else if (n > 0.93) dot(ctx, x, y, shade(base, 0.25));
          break;
        case 'marble': {
          const vein = Math.abs(((x * 0.7 + y * 1.3 + variant * 5) % 11) - 5.5);
          if (vein < 0.35) dot(ctx, x, y, spec.line, 0.6);
          else if (n > 0.95) dot(ctx, x, y, 0xffffff, 0.6);
          break;
        }
        case 'checker':
          if (n > 0.94) dot(ctx, x, y, shade(base, -0.1));
          break;
        case 'dream': {
          const cloud = hash2(Math.floor(x / 3), Math.floor(y / 2), variant + 9);
          if (cloud > 0.82) dot(ctx, x, y, 0xffffff, 0.7);
          else if (cloud < 0.12) dot(ctx, x, y, shade(base, -0.08));
          break;
        }
      }
    }
  }
  // Fines arêtes pour séparer les tuiles.
  for (let row = 0; row < TILE_H; row++) {
    const dy = row < hh ? row : TILE_H - 1 - row;
    const half = Math.round(((dy + 0.5) / hh) * hw);
    if (style === 'checker' || style === 'tile' || style === 'marble') {
      dot(ctx, hw - half, row, spec.line, 0.5);
      dot(ctx, hw + half - 1, row, spec.line, 0.5);
    }
  }
  return canvas;
}

export function floorKey(style: FloorStyle, variant: number): string {
  return `floor_${style}_${variant}`;
}

/* -------------------------------------------------------------------------- */
/* Murs                                                                       */
/* -------------------------------------------------------------------------- */
interface WallSpec {
  base: number;
  accent: number;
  trim: number;
  dado: number;
}

const WALLS: Record<WallStyle, WallSpec> = {
  stripes: { base: 0x6b5a9e, accent: 0x7d6bb3, trim: 0xf3b5d8, dado: 0x3a2d63 },
  panel: { base: 0x4a3a7a, accent: 0x57468a, trim: 0xffe6b0, dado: 0x2c2150 },
  plain: { base: 0xb9aee0, accent: 0xc7bdea, trim: 0xf3eaff, dado: 0x8c7fc0 },
  service: { base: 0x6fa7b4, accent: 0x84bcc7, trim: 0xd6f1f2, dado: 0x3f6e7c },
  dream: { base: 0xa6d9ff, accent: 0xc5e7ff, trim: 0xffffff, dado: 0xf3b5d8 },
};

export const WALL_STYLES = Object.keys(WALLS) as WallStyle[];

/** Colonne d'un mur : y du haut (selon la pente), pour une pièce de largeur `width` px. */
function wallTop(side: 'N' | 'W', i: number, slope: number): number {
  return side === 'N' ? Math.floor(i / 2) : slope - 1 - Math.floor(i / 2);
}

function drawWallPiece(style: WallStyle, side: 'N' | 'W', tileIdx: number): HTMLCanvasElement {
  const spec = WALLS[style];
  const w = TILE_W / 2;
  const slope = TILE_H / 2;
  const { canvas, ctx } = makeCanvas(w, WALL_H + slope);
  const face = side === 'N' ? 1 : 0.8; // le mur ouest est dans l'ombre
  for (let i = 0; i < w; i++) {
    const top = wallTop(side, i, slope);
    const gx = tileIdx * w + i;
    for (let y = 0; y < WALL_H; y++) {
      let c = spec.base;
      const worldY = y; // 0 = haut, WALL_H = bas
      switch (style) {
        case 'stripes':
          c = Math.floor(gx / 4) % 2 === 0 ? spec.base : spec.accent;
          if (worldY > WALL_H - 14) c = spec.dado;
          break;
        case 'panel': {
          const inPanel = worldY > 8 && worldY < WALL_H - 18 && gx % 16 > 1 && gx % 16 < 14;
          c = inPanel ? spec.accent : spec.base;
          if (worldY > WALL_H - 14) c = spec.dado;
          break;
        }
        case 'plain':
          c = hash2(gx, y, 3) > 0.97 ? spec.accent : spec.base;
          if (worldY > WALL_H - 8) c = spec.dado;
          break;
        case 'service':
          c = worldY > 18 ? (gx % 8 === 0 || worldY % 8 === 0 ? spec.dado : spec.accent) : spec.base;
          if (worldY > 18 && hash2(gx, y, 5) > 0.95) c = shade(spec.accent, 0.2);
          break;
        case 'dream': {
          const t = worldY / WALL_H;
          c = mix(0xa6d9ff, 0xf6d6ea, t);
          if (hash2(Math.floor(gx / 4), Math.floor(y / 3), 7) > 0.9) c = 0xffffff;
          if (worldY > WALL_H - 6) c = spec.dado;
          break;
        }
      }
      // Moulure du haut et plinthe.
      if (worldY < 2) c = spec.trim;
      else if (worldY === 2) c = shade(spec.trim, -0.3);
      if (worldY === WALL_H - 1) c = shade(spec.dado, -0.3);
      px(ctx, i, top + y, 1, 1, shade(c, face === 1 ? 0 : -0.16));
    }
  }
  return canvas;
}

export function wallKey(style: WallStyle, side: 'N' | 'W', variant: number): string {
  return `wall_${style}_${side}_${variant}`;
}

/* -------------------------------------------------------------------------- */
/* Portes                                                                     */
/* -------------------------------------------------------------------------- */
export type DoorVisual = 'locked' | 'ready' | 'open' | 'sealed' | 'false' | 'secret' | 'return';

export interface DoorTextureOpts {
  side: 'N' | 'W';
  label: string;
  visual: DoorVisual;
  style: WallStyle;
}

const DOOR_WOOD = 0x7a4b3a;

/** Porte de 2 tuiles de large dans un mur, avec cadre, plaque numérotée et voyant d'état. */
export function drawDoorTexture(textures: Phaser.Textures.TextureManager, key: string, o: DoorTextureOpts): void {
  const width = TILE_W; // 2 tuiles de 16 px
  const slope = TILE_H;
  const { canvas, ctx } = makeCanvas(width, WALL_H + slope);
  const spec = WALLS[o.style];
  const secret = o.visual === 'secret' || o.visual === 'return';
  const woodBase = o.visual === 'false' ? 0x7a4b3a : secret ? 0x5b4a3a : DOOR_WOOD;
  const face = o.side === 'N' ? 0 : -0.16;

  for (let i = 0; i < width; i++) {
    const top = wallTop(o.side, i, slope);
    // Fond du mur.
    for (let y = 0; y < WALL_H; y++) {
      let c = spec.base;
      if (y > WALL_H - 14) c = spec.dado;
      if (y < 2) c = spec.trim;
      px(ctx, i, top + y, 1, 1, shade(c, face));
    }
    // Ouverture de porte (cadre puis battant).
    const inFrame = i >= 3 && i < width - 3;
    if (inFrame) {
      const doorTop = 10;
      for (let y = doorTop; y < WALL_H; y++) {
        let c = shade(woodBase, face);
        const inLeaf = i >= 5 && i < width - 5 && y > doorTop + 2;
        if (!inLeaf) c = shade(spec.trim, -0.25 + face);
        else {
          // Panneaux du battant.
          const col = i - 5;
          const px2 = (col % 11) - 5;
          const pan = Math.abs(px2) < 4 && y > doorTop + 5 && y < WALL_H - 5 && Math.abs(y - (doorTop + 5 + (WALL_H - 5 - (doorTop + 5)) / 2)) > 1.5;
          if (pan) c = shade(woodBase, -0.18 + face);
          if (hash2(i, y, 11) > 0.93) c = shade(c, 0.1);
        }
        if (o.visual === 'open') c = inLeaf ? mix(0x120f22, 0x2b2350, (y - doorTop) / WALL_H) : c;
        if (o.visual === 'secret' || o.visual === 'return') {
          if (inLeaf) c = shade(0x4c3d33, face + (hash2(i, y, 2) > 0.8 ? 0.1 : 0));
        }
        px(ctx, i, top + y, 1, 1, c);
      }
    }
  }

  // Poignée.
  if (o.visual !== 'open') {
    const hx = o.side === 'N' ? width - 9 : 8;
    const ht = wallTop(o.side, hx, slope);
    px(ctx, hx, ht + 31, 2, 3, PAL.light);
    px(ctx, hx, ht + 31, 1, 1, 0xffffff);
  }

  // Plaque numérotée (au-dessus du battant).
  if (o.label && o.visual !== 'open' && !secret) {
    const text = o.label;
    const tw = glyphWidth(text);
    const cx = Math.floor(width / 2 - tw / 2);
    const plateTop = wallTop(o.side, cx, slope) + 2;
    px(ctx, cx - 2, plateTop, tw + 4, 8, shade(spec.dado, -0.4));
    px(ctx, cx - 2, plateTop, tw + 4, 1, PAL.light);
    px(ctx, cx - 2, plateTop + 7, tw + 4, 1, shade(PAL.light, -0.4));
    drawGlyphs(ctx, text, cx, plateTop + 2, PAL.light);
  }

  // Voyant d'état.
  const lampColor =
    o.visual === 'ready' ? 0xa8d6a0 : o.visual === 'locked' ? 0xf36b7a : o.visual === 'sealed' ? 0x77708f : o.visual === 'false' ? 0xa8d6a0 : 0xffe6b0;
  if (!secret) {
    const lx = o.side === 'N' ? 5 : width - 7;
    const lt = wallTop(o.side, lx, slope) + 14;
    px(ctx, lx, lt, 2, 2, lampColor);
    px(ctx, lx - 1, lt - 1, 4, 4, lampColor, 0.25);
  }
  registerCanvas(textures, key, canvas);
}

/** Lueur rose sous la porte : l'indice visuel du Faux-Seuil (visible à la lampe). */
export function drawSeamTexture(textures: Phaser.Textures.TextureManager, key: string): void {
  const { canvas, ctx } = makeCanvas(TILE_W, 6);
  for (let i = 4; i < TILE_W - 4; i++) {
    px(ctx, i, 2, 1, 1, PAL.rose, 0.9);
    px(ctx, i, 3, 1, 1, PAL.rose, 0.4);
  }
  registerCanvas(textures, key, canvas);
}

/* -------------------------------------------------------------------------- */
/* Enregistrement global                                                      */
/* -------------------------------------------------------------------------- */
export function generateEnvironmentTextures(textures: Phaser.Textures.TextureManager): void {
  for (const style of FLOOR_STYLES) {
    for (const v of [0, 1]) registerCanvas(textures, floorKey(style, v), drawFloor(style, v));
  }
  for (const style of WALL_STYLES) {
    for (let t = 0; t < 4; t++) {
      registerCanvas(textures, wallKey(style, 'N', t), drawWallPiece(style, 'N', t));
      registerCanvas(textures, wallKey(style, 'W', t), drawWallPiece(style, 'W', t));
    }
  }
  drawSeamTexture(textures, 'door_seam');
}
