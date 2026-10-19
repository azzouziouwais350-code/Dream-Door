import type { Rect, Vec2 } from '../core/types';
import { circleRect } from './collision';

/** Grille de navigation par tuile : sert aux entités et à la validation des salles. */
export class NavGrid {
  readonly w: number;
  readonly h: number;
  private readonly blocked: boolean[];

  constructor(w: number, h: number, rects: readonly Rect[], clearance = 0.3) {
    this.w = w;
    this.h = h;
    this.blocked = new Array<boolean>(w * h).fill(false);
    for (let cy = 0; cy < h; cy++) {
      for (let cx = 0; cx < w; cx++) {
        for (const r of rects) {
          if (circleRect(cx + 0.5, cy + 0.5, clearance, r)) {
            this.blocked[cy * w + cx] = true;
            break;
          }
        }
      }
    }
  }

  inBounds(cx: number, cy: number): boolean {
    return cx >= 0 && cy >= 0 && cx < this.w && cy < this.h;
  }

  isBlocked(cx: number, cy: number): boolean {
    return !this.inBounds(cx, cy) || this.blocked[cy * this.w + cx] === true;
  }

  cellOf(p: Vec2): { cx: number; cy: number } {
    return {
      cx: Math.max(0, Math.min(this.w - 1, Math.floor(p.x))),
      cy: Math.max(0, Math.min(this.h - 1, Math.floor(p.y))),
    };
  }

  /** Cellules atteignables depuis `from` (parcours en largeur, 8 voisins sans couper les coins). */
  reachable(from: Vec2): Set<number> {
    const seen = new Set<number>();
    const start = this.cellOf(from);
    const queue: Array<[number, number]> = [[start.cx, start.cy]];
    seen.add(start.cy * this.w + start.cx);
    while (queue.length > 0) {
      const [cx, cy] = queue.shift() as [number, number];
      for (const [nx, ny] of this.neighbours(cx, cy)) {
        const key = ny * this.w + nx;
        if (seen.has(key)) continue;
        seen.add(key);
        queue.push([nx, ny]);
      }
    }
    return seen;
  }

  private neighbours(cx: number, cy: number): Array<[number, number]> {
    const out: Array<[number, number]> = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (this.isBlocked(nx, ny)) continue;
        if (dx !== 0 && dy !== 0 && (this.isBlocked(cx + dx, cy) || this.isBlocked(cx, cy + dy))) continue;
        out.push([nx, ny]);
      }
    }
    return out;
  }

  /** Chemin le plus court (centres de cellules). Retourne null si inaccessible. */
  findPath(from: Vec2, to: Vec2): Vec2[] | null {
    const s = this.cellOf(from);
    let g = this.cellOf(to);
    if (this.isBlocked(g.cx, g.cy)) {
      const alt = this.nearestFree(g.cx, g.cy);
      if (!alt) return null;
      g = alt;
    }
    if (s.cx === g.cx && s.cy === g.cy) return [{ x: g.cx + 0.5, y: g.cy + 0.5 }];

    const prev = new Map<number, number>();
    const startKey = s.cy * this.w + s.cx;
    const goalKey = g.cy * this.w + g.cx;
    const queue: Array<[number, number]> = [[s.cx, s.cy]];
    prev.set(startKey, -1);
    let found = false;
    while (queue.length > 0 && !found) {
      const [cx, cy] = queue.shift() as [number, number];
      for (const [nx, ny] of this.neighbours(cx, cy)) {
        const key = ny * this.w + nx;
        if (prev.has(key)) continue;
        prev.set(key, cy * this.w + cx);
        if (key === goalKey) {
          found = true;
          break;
        }
        queue.push([nx, ny]);
      }
    }
    if (!found) return null;
    const path: Vec2[] = [];
    let cur = goalKey;
    while (cur !== -1 && cur !== startKey) {
      path.push({ x: (cur % this.w) + 0.5, y: Math.floor(cur / this.w) + 0.5 });
      cur = prev.get(cur) ?? -1;
    }
    return path.reverse();
  }

  private nearestFree(cx: number, cy: number): { cx: number; cy: number } | null {
    for (let r = 1; r < Math.max(this.w, this.h); r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          if (!this.isBlocked(cx + dx, cy + dy)) return { cx: cx + dx, cy: cy + dy };
        }
      }
    }
    return null;
  }
}
