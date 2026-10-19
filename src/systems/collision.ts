import type { Rect, Vec2 } from '../core/types';

export function closestPointOnRect(p: Vec2, r: Rect): Vec2 {
  return {
    x: Math.max(r.x, Math.min(p.x, r.x + r.w)),
    y: Math.max(r.y, Math.min(p.y, r.y + r.h)),
  };
}

export function distToRect(p: Vec2, r: Rect): number {
  const c = closestPointOnRect(p, r);
  return Math.hypot(p.x - c.x, p.y - c.y);
}

/** Un cercle (cx, cy, r) chevauche-t-il le rectangle ? */
export function circleRect(cx: number, cy: number, radius: number, r: Rect): boolean {
  const nx = Math.max(r.x, Math.min(cx, r.x + r.w));
  const ny = Math.max(r.y, Math.min(cy, r.y + r.h));
  const dx = cx - nx;
  const dy = cy - ny;
  return dx * dx + dy * dy < radius * radius;
}

export function blockedAt(x: number, y: number, radius: number, rects: readonly Rect[]): boolean {
  for (const r of rects) if (circleRect(x, y, radius, r)) return true;
  return false;
}

/**
 * Déplacement d'un cercle avec glissement : l'axe X puis l'axe Y sont résolus séparément.
 * Les bornes de la salle sont [0, w] × [0, h].
 */
export function moveWithCollision(
  pos: Vec2,
  dx: number,
  dy: number,
  radius: number,
  rects: readonly Rect[],
  bounds: { w: number; h: number },
): Vec2 {
  let x = pos.x;
  let y = pos.y;
  // Découpe en petits pas pour éviter de traverser un obstacle à grande vitesse.
  const dist = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(dist / 0.1));
  const sx = dx / steps;
  const sy = dy / steps;
  for (let i = 0; i < steps; i++) {
    const nx = Math.max(radius, Math.min(bounds.w - radius, x + sx));
    if (!blockedAt(nx, y, radius, rects)) x = nx;
    const ny = Math.max(radius, Math.min(bounds.h - radius, y + sy));
    if (!blockedAt(x, ny, radius, rects)) y = ny;
  }
  return { x, y };
}

/** Le segment [a, b] est-il coupé par l'un des rectangles ? (échantillonnage) */
export function segmentBlocked(a: Vec2, b: Vec2, rects: readonly Rect[]): boolean {
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  const steps = Math.max(1, Math.ceil(dist / 0.25));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const x = a.x + (b.x - a.x) * t;
    const y = a.y + (b.y - a.y) * t;
    for (const r of rects) {
      if (x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h) return true;
    }
  }
  return false;
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
