import type { Dir, Vec2 } from './types';

export const TILE_W = 32;
export const TILE_H = 16;
export const WALL_H = 48;

/** Monde (tuiles) → écran (pixels). x descend vers la droite, y vers la gauche. */
export function toScreen(x: number, y: number): Vec2 {
  return { x: (x - y) * (TILE_W / 2), y: (x + y) * (TILE_H / 2) };
}

export function fromScreen(sx: number, sy: number): Vec2 {
  const a = sx / (TILE_W / 2);
  const b = sy / (TILE_H / 2);
  return { x: (a + b) / 2, y: (b - a) / 2 };
}

/** Axes d'entrée en espace écran (droite = +x, bas = +y) → vecteur unitaire monde. */
export function screenInputToWorld(mx: number, my: number): Vec2 {
  const wx = mx + my;
  const wy = my - mx;
  const len = Math.hypot(wx, wy);
  if (len < 1e-6) return { x: 0, y: 0 };
  // On normalise selon l'intensité de l'entrée (analogique pour le joystick).
  const mag = Math.min(1, Math.hypot(mx, my));
  return { x: (wx / len) * mag, y: (wy / len) * mag };
}

export function dirFromWorldVelocity(vx: number, vy: number, fallback: Dir = 'DR'): Dir {
  if (Math.abs(vx) < 1e-6 && Math.abs(vy) < 1e-6) return fallback;
  const sx = vx - vy;
  const sy = vx + vy;
  if (sy >= 0) return sx >= 0 ? 'DR' : 'DL';
  return sx >= 0 ? 'UR' : 'UL';
}

/** Profondeur de tri : plus x+y est grand, plus l'objet est proche de la caméra. */
export function depthOf(x: number, y: number): number {
  return (x + y) * 10;
}
