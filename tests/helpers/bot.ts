import type { FurnitureDef, Vec2 } from '../../src/core/types';
import { World } from '../../src/game/world';
import {
  AnomalyPuzzle,
  FusePuzzle,
  SequencePuzzle,
  SwitchPuzzle,
  VALVE_DELTAS,
  VALVE_RING,
  ValvePuzzle,
} from '../../src/systems/puzzles';
import { doorPointOf, furnitureAnchor, furnitureRect } from '../../src/systems/roomgeom';

export const DT = 1 / 30;

/** Convertit un vecteur monde en axes d'entrée écran. */
export function worldToInput(wx: number, wy: number): { mx: number; my: number } {
  const sx = wx - wy;
  const sy = wx + wy;
  const len = Math.hypot(sx, sy) || 1;
  return { mx: sx / len, my: sy / len };
}

export function run(world: World, seconds: number): void {
  const n = Math.ceil(seconds / DT);
  for (let i = 0; i < n; i++) world.update(DT);
}

/** Marche jusqu'au point par pathfinding. Retourne true à l'arrivée. */
export function walkTo(world: World, target: Vec2, tolerance = 0.5, maxSeconds = 40): boolean {
  let path = world.nav.findPath(world.player.pos, target) ?? [];
  let t = 0;
  let repath = 0;
  while (t < maxSeconds) {
    const p = world.player.pos;
    if (Math.hypot(target.x - p.x, target.y - p.y) <= tolerance) break;
    repath += DT;
    if (repath > 0.5) {
      path = world.nav.findPath(p, target) ?? [];
      repath = 0;
    }
    while (path.length > 0 && Math.hypot((path[0] as Vec2).x - p.x, (path[0] as Vec2).y - p.y) < 0.35) path.shift();
    const next = path[0] ?? target;
    const dx = next.x - p.x;
    const dy = next.y - p.y;
    const { mx, my } = worldToInput(dx, dy);
    world.setMove(mx, my);
    world.update(DT);
    t += DT;
  }
  world.setMove(0, 0);
  run(world, 0.15);
  return Math.hypot(target.x - world.player.pos.x, target.y - world.player.pos.y) <= tolerance + 0.1;
}

function waitBusy(world: World): void {
  let guard = 0;
  while (world.player.busy && guard++ < 200) world.update(DT);
}

/** Se place près d'un meuble jusqu'à ce qu'il devienne la cible d'interaction. */
export function approachFurniture(world: World, f: FurnitureDef): boolean {
  const anchor = furnitureAnchor(f, world.roomState.moved.includes(f.id));
  // On essaie plusieurs points d'approche autour du meuble.
  const candidates: Vec2[] = [];
  if (f.wall) {
    candidates.push(f.wall === 'N' ? { x: anchor.x, y: 1.1 } : { x: 1.1, y: anchor.y });
  } else {
    const rect = furnitureRect(f, world.roomState.moved.includes(f.id));
    for (const off of [0.65, 0.95]) {
      candidates.push(
        { x: rect.x + rect.w / 2, y: rect.y + rect.h + off },
        { x: rect.x + rect.w + off, y: rect.y + rect.h / 2 },
        { x: rect.x - off, y: rect.y + rect.h / 2 },
        { x: rect.x + rect.w / 2, y: rect.y - off },
        { x: rect.x + rect.w + off * 0.7, y: rect.y + rect.h + off * 0.7 },
        { x: rect.x - off * 0.7, y: rect.y + rect.h + off * 0.7 },
        { x: rect.x + rect.w + off * 0.7, y: rect.y - off * 0.7 },
        { x: rect.x - off * 0.7, y: rect.y - off * 0.7 },
      );
    }
  }
  for (const c of candidates) {
    if (c.x < 0.4 || c.y < 0.4 || c.x > world.room.w - 0.4 || c.y > world.room.h - 0.4) continue;
    if (!walkTo(world, c, 0.45)) continue;
    run(world, 0.1);
    if (world.target?.id === f.id) return true;
  }
  return false;
}

export function interactWith(world: World, f: FurnitureDef): boolean {
  if (!approachFurniture(world, f)) return false;
  world.interact();
  waitBusy(world);
  return true;
}

export function pickupFloorItems(world: World): void {
  for (const it of world.room.floorItems ?? []) {
    if (world.roomState.taken.includes(it.id)) continue;
    walkTo(world, { x: it.x, y: it.y }, 0.4);
    run(world, 0.1);
    if (world.target?.id === it.id) {
      world.interact();
      waitBusy(world);
    }
  }
}

function solveValves(start: number, target: number): number[] {
  const prev = new Map<number, { from: number; valve: number } | null>();
  prev.set(start, null);
  const queue = [start];
  while (queue.length) {
    const cur = queue.shift() as number;
    if (cur === target) break;
    VALVE_DELTAS.forEach((d, valve) => {
      const n = (((cur + d) % VALVE_RING) + VALVE_RING) % VALVE_RING;
      if (!prev.has(n)) {
        prev.set(n, { from: cur, valve });
        queue.push(n);
      }
    });
  }
  const moves: number[] = [];
  let c: number | undefined = target;
  while (c !== undefined && prev.get(c)) {
    const p = prev.get(c) as { from: number; valve: number };
    moves.push(p.valve);
    c = p.from;
  }
  return moves.reverse();
}

export interface BotReport {
  rooms: number;
  log: string[];
}

/** Résout la salle courante par l'API publique du monde, puis franchit la porte de sortie. */
export function solveCurrentRoom(world: World): string | null {
  const room = world.room;
  pickupFloorItems(world);

  // 1. Récupère tous les objets rangés (clé, outils…).
  const wantsLoot = (f: FurnitureDef): boolean => Boolean(f.loot?.length) && !f.hide;
  for (const f of room.furniture.filter(wantsLoot)) {
    if (world.roomState.searched.includes(f.id)) continue;
    if (!interactWith(world, f)) return `meuble de fouille inaccessible : ${f.id}`;
  }

  // 2. Énigmes.
  for (const p of world.puzzles.values()) {
    if (p.solved) continue;
    const operator = room.furniture.find((f) => f.puzzleId === p.id && f.puzzleRole === 'operate');
    if (p instanceof FusePuzzle) {
      if (!operator || !interactWith(world, operator)) return 'boîte à fusibles inaccessible';
    } else if (p instanceof SequencePuzzle) {
      if (!operator || !approachFurniture(world, operator)) return 'pupitre inaccessible';
      if (room.light.dark >= 0.45 && p.mode === 'visual') world.toggleLamp();
      for (const s of p.solution) world.puzzleAction(p.id, { type: 'press', value: s });
    } else if (p instanceof SwitchPuzzle) {
      const clue = room.furniture.find((f) => f.puzzleId === p.id && f.puzzleRole === 'clue');
      if (!clue || !approachFurniture(world, clue)) return 'schéma inaccessible';
      if (room.light.dark >= 0.45 && !world.lampOn) world.toggleLamp();
      if (!operator || !approachFurniture(world, operator)) return 'tableau inaccessible';
      p.solution.forEach((v, i) => {
        if (p.state[i] !== v) world.puzzleAction(p.id, { type: 'toggle', index: i });
      });
    } else if (p instanceof ValvePuzzle) {
      if (!operator || !approachFurniture(world, operator)) return 'vannes inaccessibles';
      for (const valve of solveValves(p.level, p.target)) world.puzzleAction(p.id, { type: 'turn', valve });
    } else if (p instanceof AnomalyPuzzle) {
      const target = room.furniture.find((f) => f.id === p.anomalous);
      if (!target || !approachFurniture(world, target)) return 'objet anormal inaccessible';
      world.interact();
      run(world, 0.2);
      world.interact();
      run(world, 0.2);
      world.answerChoice(0);
    }
    if (!p.solved) return `énigme non résolue : ${p.id} (${p.kind})`;
  }

  // 3. Porte de sortie.
  const out = room.doors.find((d) => d.id === 'out');
  if (!out) return 'pas de porte de sortie';
  const pt = doorPointOf(out);
  const stand = out.wall === 'N' ? { x: pt.x, y: 1.2 } : { x: 1.2, y: pt.y };
  if (!walkTo(world, stand, 0.5)) return 'porte de sortie inaccessible';
  run(world, 0.1);
  if (world.target?.id !== 'out') return `la porte de sortie n’est pas la cible (cible : ${world.target?.id ?? 'aucune'})`;
  world.interact();
  // La porte vient d'être déverrouillée avec la clé : la même interaction l'ouvre dans la foulée.
  if ((world.status as string) === 'transition') world.commitTransition();
  return null;
}

export function dismissAllEntities(world: World): void {
  for (const e of world.entities) e.dismiss();
}
