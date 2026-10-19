import { TILE_H, TILE_W } from '../core/iso';
import { shade } from '../core/palette';

export type Ctx = CanvasRenderingContext2D;

export function css(c: number): string {
  return `#${c.toString(16).padStart(6, '0')}`;
}

export function makeCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: Ctx } {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(w));
  canvas.height = Math.max(1, Math.ceil(h));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D indisponible');
  ctx.imageSmoothingEnabled = false;
  return { canvas, ctx };
}

export function px(ctx: Ctx, x: number, y: number, w: number, h: number, color: number, alpha = 1): void {
  ctx.globalAlpha = alpha;
  ctx.fillStyle = css(color);
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  ctx.globalAlpha = 1;
}

export function dot(ctx: Ctx, x: number, y: number, color: number, alpha = 1): void {
  px(ctx, x, y, 1, 1, color, alpha);
}

/** Bruit déterministe pour les textures (pas de Math.random : rendu reproductible). */
export function hash2(x: number, y: number, seed = 0): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  h = h ^ (h >>> 16);
  return ((h >>> 0) % 1000) / 1000;
}

/** Losange iso rempli (32×16 pour une tuile), avec bords optionnels. */
export function isoDiamond(ctx: Ctx, ox: number, oy: number, tw: number, th: number, fill: number, edge?: number): void {
  const hw = tw / 2;
  const hh = th / 2;
  for (let row = 0; row < th; row++) {
    const dy = row < hh ? row : th - 1 - row;
    const half = Math.round(((dy + 0.5) / hh) * hw);
    px(ctx, ox + hw - half, oy + row, half * 2, 1, fill);
    if (edge !== undefined) {
      px(ctx, ox + hw - half, oy + row, 1, 1, edge);
      px(ctx, ox + hw + half - 1, oy + row, 1, 1, edge);
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Boîtes isométriques                                                        */
/* -------------------------------------------------------------------------- */
export interface BoxPalette {
  top: number;
  left: number;
  right: number;
  edge?: number;
}

export function boxPalette(base: number): BoxPalette {
  return { top: shade(base, 0.22), left: shade(base, -0.12), right: shade(base, -0.34), edge: shade(base, -0.55) };
}

export interface BoxGeo {
  /** Taille de l'empreinte au sol en tuiles. */
  w: number;
  h: number;
  /** Hauteur en pixels. */
  hp: number;
  /** Largeur et hauteur du canevas. */
  cw: number;
  ch: number;
}

export function boxGeo(w: number, h: number, hp: number): BoxGeo {
  return { w, h, hp, cw: Math.ceil((w + h) * (TILE_W / 2)), ch: Math.ceil((w + h) * (TILE_H / 2) + hp) };
}

/** Coordonnée écran (dans le canevas de la boîte) d'un point du sol (u, v) en tuiles, à la hauteur z (px). */
export function boxPt(g: BoxGeo, u: number, v: number, z = 0): { x: number; y: number } {
  return {
    x: (u - v + g.h) * (TILE_W / 2),
    y: (u + v) * (TILE_H / 2) + g.hp - z,
  };
}

/** Dessine la boîte pleine : dessus + deux faces visibles. */
export function drawBox(ctx: Ctx, g: BoxGeo, pal: BoxPalette, z0 = 0, z1 = g.hp, ox = 0, oy = 0): void {
  const { w, h } = g;
  // Face gauche (y = h) : va du sommet gauche au sommet bas.
  for (let i = 0; i < Math.ceil(h * 0 + w * (TILE_W / 2)); i++) {
    const u = i / (TILE_W / 2);
    const a = boxPt(g, u, h, z1);
    const b = boxPt(g, u, h, z0);
    px(ctx, ox + a.x, oy + a.y, 1, b.y - a.y, pal.left);
  }
  // Face droite (x = w).
  for (let i = 0; i < Math.ceil(h * (TILE_W / 2)); i++) {
    const v = h - i / (TILE_W / 2);
    const a = boxPt(g, w, v, z1);
    const b = boxPt(g, w, v, z0);
    px(ctx, ox + a.x, oy + a.y, 1, b.y - a.y, pal.right);
  }
  // Dessus : balayage par lignes.
  topFace(ctx, g, pal.top, z1, ox, oy);
  if (pal.edge !== undefined) {
    // Arêtes verticales et du dessus.
    const bl = boxPt(g, 0, h, z1);
    const bl0 = boxPt(g, 0, h, z0);
    px(ctx, ox + bl.x, oy + bl.y, 1, bl0.y - bl.y, pal.edge);
    const bc = boxPt(g, w, h, z1);
    const bc0 = boxPt(g, w, h, z0);
    px(ctx, ox + bc.x, oy + bc.y, 1, bc0.y - bc.y, pal.edge);
    const br = boxPt(g, w, 0, z1);
    const br0 = boxPt(g, w, 0, z0);
    px(ctx, ox + br.x - 1, oy + br.y, 1, br0.y - br.y, pal.edge);
  }
}

export function topFace(ctx: Ctx, g: BoxGeo, color: number, z: number, ox = 0, oy = 0): void {
  const top = boxPt(g, 0, 0, z);
  const total = Math.round((g.w + g.h) * (TILE_H / 2));
  for (let row = 0; row < total; row++) {
    // Le losange du dessus : largeur en fonction de la ligne.
    const t = (row + 0.5) / (TILE_H / 2); // en « unités u+v »
    const s = t; // u+v
    const uvMin = Math.max(s - g.h, 0);
    const uvMax = Math.min(s, g.w);
    if (uvMax < uvMin) continue;
    // x = (u - v + h) * 16 ; avec u+v = s : x va de (uMin-(s-uMin)) à (uMax-(s-uMax))
    const xl = (uvMin - (s - uvMin) + g.h) * (TILE_W / 2);
    const xr = (uvMax - (s - uvMax) + g.h) * (TILE_W / 2);
    px(ctx, ox + xl, oy + top.y + row, Math.max(1, xr - xl), 1, color);
  }
}

/** Rectangle sur la face gauche (y = h) : u0..u1 le long de x (tuiles), z0..z1 en pixels. */
export function faceLeft(ctx: Ctx, g: BoxGeo, u0: number, u1: number, z0: number, z1: number, color: number, alpha = 1, ox = 0, oy = 0): void {
  const n = Math.max(1, Math.round((u1 - u0) * (TILE_W / 2)));
  for (let i = 0; i < n; i++) {
    const u = u0 + (i / (TILE_W / 2));
    const a = boxPt(g, u, g.h, z1);
    const b = boxPt(g, u, g.h, z0);
    px(ctx, ox + a.x, oy + a.y, 1, Math.max(1, b.y - a.y), color, alpha);
  }
}

/** Rectangle sur la face droite (x = w) : v0..v1 le long de y. */
export function faceRight(ctx: Ctx, g: BoxGeo, v0: number, v1: number, z0: number, z1: number, color: number, alpha = 1, ox = 0, oy = 0): void {
  const n = Math.max(1, Math.round((v1 - v0) * (TILE_W / 2)));
  for (let i = 0; i < n; i++) {
    const v = g.h - (v0 + i / (TILE_W / 2));
    const a = boxPt(g, g.w, v, z1);
    const b = boxPt(g, g.w, v, z0);
    px(ctx, ox + a.x, oy + a.y, 1, Math.max(1, b.y - a.y), color, alpha);
  }
}

/** Petit rectangle posé sur le dessus (u0..u1, v0..v1) à la hauteur z. */
export function topRect(ctx: Ctx, g: BoxGeo, u0: number, u1: number, v0: number, v1: number, z: number, color: number, ox = 0, oy = 0): void {
  const steps = 24;
  for (let i = 0; i <= steps; i++) {
    for (let j = 0; j <= steps; j++) {
      const u = u0 + ((u1 - u0) * i) / steps;
      const v = v0 + ((v1 - v0) * j) / steps;
      const p = boxPt(g, u, v, z);
      px(ctx, ox + p.x, oy + p.y, 1, 1, color);
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Police 3×5 (plaques de porte, indices)                                     */
/* -------------------------------------------------------------------------- */
const GLYPHS: Record<string, string[]> = {
  '0': ['111', '101', '101', '101', '111'],
  '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'],
  '3': ['111', '001', '111', '001', '111'],
  '4': ['101', '101', '111', '001', '001'],
  '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'],
  '7': ['111', '001', '010', '010', '010'],
  '8': ['111', '101', '111', '101', '111'],
  '9': ['111', '101', '111', '001', '111'],
  I: ['111', '010', '010', '010', '111'],
  '?': ['111', '001', '011', '000', '010'],
  '-': ['000', '000', '111', '000', '000'],
};

export function drawGlyphs(ctx: Ctx, text: string, x: number, y: number, color: number, scale = 1): void {
  let cx = x;
  for (const ch of text) {
    const g = GLYPHS[ch];
    if (g) {
      g.forEach((row, ry) => {
        [...row].forEach((bit, rx) => {
          if (bit === '1') px(ctx, cx + rx * scale, y + ry * scale, scale, scale, color);
        });
      });
    }
    cx += 4 * scale;
  }
}

export function glyphWidth(text: string, scale = 1): number {
  return text.length * 4 * scale - scale;
}


/** Une sous-boîte placée dans une boîte parente : renvoie sa géométrie et son décalage de dessin. */
export interface Part {
  g: BoxGeo;
  ox: number;
  oy: number;
}

export function part(parent: BoxGeo, u0: number, v0: number, w: number, h: number, hp: number): Part {
  const g = boxGeo(w, h, hp);
  const ox = (u0 - v0 + parent.h) * (TILE_W / 2) - g.h * (TILE_W / 2);
  const oy = (u0 + v0) * (TILE_H / 2) + parent.hp - g.hp;
  return { g, ox, oy };
}
