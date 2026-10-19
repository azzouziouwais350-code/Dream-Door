import type { DoorDef, FurnitureDef, Rect, RoomDef, Vec2 } from '../core/types';
import { NavGrid } from './nav';

export function doorPointOf(d: Pick<DoorDef, 'wall' | 'at'>): Vec2 {
  return d.wall === 'N' ? { x: d.at + 1, y: 0.5 } : { x: 0.5, y: d.at + 1 };
}

/** Position d'arrivée dans une salle quand on revient par cette porte. */
export function doorReturnSpawn(d: Pick<DoorDef, 'wall' | 'at'>): Vec2 {
  return d.wall === 'N' ? { x: d.at + 1, y: 1.7 } : { x: 1.7, y: d.at + 1 };
}

export function furnitureRect(f: FurnitureDef, moved = false): Rect {
  const dx = moved && f.movable ? f.movable.dx : 0;
  const dy = moved && f.movable ? f.movable.dy : 0;
  if (f.wall === 'N') return { x: f.x, y: 0, w: f.w, h: 0.3 };
  if (f.wall === 'W') return { x: 0, y: f.x, w: 0.3, h: f.w };
  return { x: f.x + dx, y: f.y + dy, w: f.w, h: f.h };
}

/** Point où le joueur doit se tenir pour interagir avec un meuble. */
export function furnitureAnchor(f: FurnitureDef, moved = false): Vec2 {
  if (f.wall === 'N') return { x: f.x + f.w / 2, y: 0.5 };
  if (f.wall === 'W') return { x: 0.5, y: f.x + f.w / 2 };
  const r = furnitureRect(f, moved);
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

export function blockersOf(room: RoomDef, movedIds: ReadonlySet<string> = new Set()): Rect[] {
  const out: Rect[] = [];
  for (const f of room.furniture) {
    if (f.wall || f.blocking === false) continue;
    out.push(furnitureRect(f, movedIds.has(f.id)));
  }
  return out;
}

export function buildNav(room: RoomDef, movedIds: ReadonlySet<string> = new Set()): NavGrid {
  return new NavGrid(room.w, room.h, blockersOf(room, movedIds), 0.3);
}

/** Existe-t-il une cellule atteignable à moins de `maxDist` de `target` ? */
export function canReachNear(nav: NavGrid, reach: Set<number>, target: Vec2, rect: Rect | null, maxDist: number): boolean {
  for (const key of reach) {
    const cx = (key % nav.w) + 0.5;
    const cy = Math.floor(key / nav.w) + 0.5;
    const d = rect
      ? Math.hypot(cx - Math.max(rect.x, Math.min(cx, rect.x + rect.w)), cy - Math.max(rect.y, Math.min(cy, rect.y + rect.h)))
      : Math.hypot(cx - target.x, cy - target.y);
    if (d <= maxDist) return true;
  }
  return false;
}

export const INTERACT_REACH = 1.35;
export const DOOR_REACH = 1.45;
