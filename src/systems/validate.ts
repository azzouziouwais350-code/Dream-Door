import type { FurnitureDef, RoomDef, Vec2 } from '../core/types';
import { VALVE_DELTAS, VALVE_RING } from './puzzles';
import type { ChapterPlan } from './generator';
import { rectsOverlap } from './collision';
import {
  DOOR_REACH,
  INTERACT_REACH,
  blockersOf,
  buildNav,
  canReachNear,
  doorPointOf,
  furnitureAnchor,
  furnitureRect,
} from './roomgeom';

function isInteractive(f: FurnitureDef): boolean {
  return Boolean(f.loot?.length || f.hide || f.puzzleId || f.movable || f.read || f.searchText || f.kind === 'elevatorPanel');
}

function valveSolvable(start: number, target: number): boolean {
  const seen = new Set<number>([start]);
  const queue = [start];
  while (queue.length) {
    const cur = queue.shift() as number;
    if (cur === target) return true;
    for (const d of VALVE_DELTAS) {
      const next = (((cur + d) % VALVE_RING) + VALVE_RING) % VALVE_RING;
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return false;
}

/** Longueur maximale d'un tronçon du chemin sans abri (zone sûre ou cachette) à moins de `radius`. */
export function maxExposedStretch(room: RoomDef, from: Vec2, to: Vec2, radius = 3.4): number {
  const nav = buildNav(room);
  const path = nav.findPath(from, to);
  if (!path) return Infinity;
  const refuges: Vec2[] = [
    ...(room.safeZones ?? []).map((z) => ({ x: z.x, y: z.y })),
    ...room.furniture.filter((f) => f.hide).map((f) => furnitureAnchor(f)),
  ];
  const pts = [from, ...path];
  let worst = 0;
  let cur = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1] as Vec2;
    const b = pts[i] as Vec2;
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    const covered = refuges.some((r) => Math.hypot(r.x - b.x, r.y - b.y) <= radius);
    if (covered) cur = 0;
    else cur += seg;
    worst = Math.max(worst, cur);
  }
  return worst;
}

export function validateRoom(room: RoomDef): string[] {
  const errors: string[] = [];
  const err = (m: string): number => errors.push(`[${room.id}] ${m}`);

  const variants: Array<{ label: string; moved: Set<string> }> = [{ label: 'initial', moved: new Set() }];
  const movable = room.furniture.filter((f) => f.movable).map((f) => f.id);
  if (movable.length > 0) variants.push({ label: 'meuble déplacé', moved: new Set(movable) });

  // Ids uniques.
  const ids = new Set<string>();
  for (const f of room.furniture) {
    if (ids.has(f.id)) err(`id de meuble dupliqué : ${f.id}`);
    ids.add(f.id);
  }

  // Limites et chevauchements.
  const solid = room.furniture.filter((f) => !f.wall && f.blocking !== false);
  for (const f of solid) {
    if (f.x < 0 || f.y < 0 || f.x + f.w > room.w || f.y + f.h > room.h) err(`meuble hors de la salle : ${f.id}`);
  }
  for (let i = 0; i < solid.length; i++) {
    for (let j = i + 1; j < solid.length; j++) {
      const a = solid[i] as FurnitureDef;
      const b = solid[j] as FurnitureDef;
      if (rectsOverlap(furnitureRect(a), furnitureRect(b))) err(`meubles qui se chevauchent : ${a.id} / ${b.id}`);
    }
  }
  for (const f of room.furniture) {
    if (f.movable) {
      const r = furnitureRect(f, true);
      if (r.x < 0 || r.y < 0 || r.x + r.w > room.w || r.y + r.h > room.h) err(`meuble déplaçable hors de la salle : ${f.id}`);
      for (const o of solid) {
        if (o.id !== f.id && rectsOverlap(r, furnitureRect(o))) err(`meuble déplaçable ${f.id} chevauche ${o.id}`);
      }
    }
  }

  for (const v of variants) {
    const label = v.label === 'initial' ? '' : ` (${v.label})`;
    const blockers = blockersOf(room, v.moved);
    const nav = buildNav(room, v.moved);
    const spawnCell = nav.cellOf(room.spawn);
    if (nav.isBlocked(spawnCell.cx, spawnCell.cy)) {
      err(`point d’apparition bloqué${label}`);
      continue;
    }
    const reach = nav.reachable(room.spawn);

    // Portes.
    for (const d of room.doors) {
      if (d.hidden && v.label === 'initial') continue;
      if (!canReachNear(nav, reach, doorPointOf(d), null, DOOR_REACH)) err(`porte inaccessible : ${d.id}${label}`);
    }
    // Meubles.
    for (const f of room.furniture) {
      if (!isInteractive(f) && !f.keySlot) continue;
      const rect = f.wall ? null : furnitureRect(f, v.moved.has(f.id));
      const target = f.wall ? furnitureAnchor(f) : { x: 0, y: 0 };
      if (!canReachNear(nav, reach, target, rect, f.wall ? 1.4 : INTERACT_REACH)) err(`meuble inaccessible : ${f.id}${label}`);
    }
    // Objets au sol, PNJ, entités.
    for (const it of room.floorItems ?? []) {
      const cell = nav.cellOf({ x: it.x, y: it.y });
      if (!reach.has(cell.cy * nav.w + cell.cx)) err(`objet au sol inaccessible : ${it.id}${label}`);
      if (blockers.some((b) => it.x > b.x && it.x < b.x + b.w && it.y > b.y && it.y < b.y + b.h)) err(`objet au sol dans un meuble : ${it.id}`);
    }
    if (room.npc && !canReachNear(nav, reach, { x: room.npc.x, y: room.npc.y }, null, INTERACT_REACH)) err(`PNJ inaccessible${label}`);
    for (const e of room.entities ?? []) {
      if (e.kind === 'swimmer') continue;
      if (e.kind === 'falseThreshold') continue;
      if (blockers.some((b) => e.x > b.x && e.x < b.x + b.w && e.y > b.y && e.y < b.y + b.h)) err(`entité ${e.kind} placée dans un meuble`);
      for (const w of e.patrol ?? []) {
        const c = nav.cellOf(w);
        if (!reach.has(c.cy * nav.w + c.cx)) err(`point de patrouille inaccessible (${w.x},${w.y})${label}`);
      }
    }
    // Cachettes.
    for (const f of room.furniture.filter((x) => x.hide)) {
      if (!canReachNear(nav, reach, { x: 0, y: 0 }, furnitureRect(f, v.moved.has(f.id)), INTERACT_REACH)) err(`cachette inaccessible : ${f.id}${label}`);
    }
  }

  // Encombrement des portes : devant une porte, aucun meuble interactif ne doit lui voler la cible.
  for (const d of room.doors) {
    if (d.lock?.type === 'sealed' || d.lock?.type === 'ending') continue;
    const pt = doorPointOf(d);
    const stand = d.wall === 'N' ? { x: pt.x, y: pt.y + 0.7 } : { x: pt.x + 0.7, y: pt.y };
    for (const f of room.furniture) {
      if (!isInteractive(f)) continue;
      if (f.wall) {
        const a = furnitureAnchor(f);
        if (Math.hypot(a.x - stand.x, a.y - stand.y) < 1.5) err(`meuble mural ${f.id} trop proche de la porte ${d.id}`);
        continue;
      }
      const r = furnitureRect(f, true);
      const r0 = furnitureRect(f, false);
      for (const rect of d.hidden ? [r] : [r, r0]) {
        const cx = Math.max(rect.x, Math.min(stand.x, rect.x + rect.w));
        const cy = Math.max(rect.y, Math.min(stand.y, rect.y + rect.h));
        if (Math.hypot(stand.x - cx, stand.y - cy) < 1.15) err(`meuble ${f.id} encombre la porte ${d.id}`);
      }
    }
  }

  for (const f of room.furniture) {
    if (f.hide && f.loot?.length) err(`objet rangé dans une cachette (inaccessible) : ${f.id}`);
  }

  // Verrous : la clé / les objets doivent exister dans la salle.
  const allLoot = room.furniture.flatMap((f) => f.loot ?? []).concat((room.floorItems ?? []).map((i) => i.item));
  for (const d of room.doors) {
    const lock = d.lock;
    if (!lock) continue;
    if (lock.type === 'key') {
      const n = allLoot.filter((l) => l.id === lock.keyId).length;
      if (n !== 1) err(`la clé ${lock.keyId} doit exister exactement une fois dans la salle (trouvé : ${n})`);
    }
    if (lock.type === 'puzzle') {
      const p = room.puzzles?.find((x) => x.id === lock.puzzleId);
      if (!p) err(`énigme manquante : ${lock.puzzleId}`);
    }
  }

  // Énigmes.
  for (const p of room.puzzles ?? []) {
    const operators = room.furniture.filter((f) => f.puzzleId === p.id && f.puzzleRole === 'operate');
    if (p.kind !== 'anomaly' && operators.length === 0) err(`énigme ${p.id} sans élément à manipuler`);
    if (p.kind === 'fuse') {
      const hasTool = allLoot.some((l) => l.id === 'screwdriver');
      const hasFuse = allLoot.some((l) => l.id === 'fuse');
      if (!hasTool || !hasFuse) err('énigme du fusible : outil ou fusible introuvable dans la salle');
    }
    if (p.kind === 'valves') {
      if (p.target === undefined || !valveSolvable(p.start ?? 2, p.target)) err('énigme des vannes insoluble');
    }
    if (p.kind === 'sequence') {
      if (!p.solution || p.solution.length < 3) err('séquence sans solution');
      const clue = room.furniture.find((f) => f.puzzleId === p.id && f.puzzleRole === 'clue');
      if (!clue) err('séquence sans indice dans le décor');
    }
    if (p.kind === 'switches') {
      if (!p.solution || p.solution.length < 3) err('interrupteurs sans solution');
      if (!room.furniture.some((f) => f.puzzleId === p.id && f.puzzleRole === 'clue')) err('interrupteurs sans schéma indice');
    }
    if (p.kind === 'anomaly') {
      if (!p.anomalous || !p.targets.includes(p.anomalous)) err('anomalie invalide');
      for (const t of p.targets) if (!room.furniture.some((f) => f.id === t)) err(`cible d’anomalie inconnue : ${t}`);
    }
  }

  // Portes secrètes : le meuble déclencheur doit exister.
  for (const d of room.doors) {
    if (d.hidden) {
      const trigger = room.furniture.find((f) => f.id === d.revealedBy);
      if (!trigger?.movable) err(`porte cachée ${d.id} sans meuble déplaçable`);
      if (!d.target || d.target.startsWith('@')) err(`porte cachée ${d.id} sans destination`);
    }
    if (d.role === 'false' && (!d.target || d.target.startsWith('@'))) err('fausse porte sans annexe');
  }

  // Salles à Ombre : un abri doit être présent le long du trajet principal.
  if (room.entities?.some((e) => e.kind === 'ceilingShadow')) {
    const out = room.doors.find((d) => d.role === 'exit' && !d.returns) ?? room.doors.find((d) => d.returns);
    if (!out) {
      err('salle à Ombre sans sortie');
    } else {
      const worst = maxExposedStretch(room, room.spawn, doorPointOf(out));
      if (worst > 8) err(`trajet trop exposé face à l’Ombre (${worst.toFixed(1)} tuiles sans abri)`);
    }
  }

  // Concierge : pas de capture au départ.
  for (const e of room.entities ?? []) {
    if (e.kind === 'concierge' && Math.hypot(e.x - room.spawn.x, e.y - room.spawn.y) < 5) err('le Concierge apparaît trop près du joueur');
    if (e.kind === 'ceilingShadow' && Math.hypot(e.x - room.spawn.x, e.y - room.spawn.y) < 4) err('l’Ombre apparaît trop près du joueur');
  }

  if (room.floorItems?.some((i) => i.x < 0 || i.y < 0 || i.x > room.w || i.y > room.h)) err('objet au sol hors de la salle');
  return errors;
}

export function validateChapter(plan: ChapterPlan): string[] {
  const errors: string[] = [];
  const all = [...plan.rooms, ...Object.values(plan.annexes)];
  for (const r of all) errors.push(...validateRoom(r));

  // Chaîne de progression.
  const keys = new Set<string>();
  plan.rooms.forEach((r, i) => {
    const out = r.doors.find((d) => d.id === 'out');
    if (!out) errors.push(`[${r.id}] pas de porte de sortie`);
    if (i === plan.rooms.length - 1) return;
    if (out?.lock?.type === 'key') {
      if (keys.has(out.lock.keyId)) errors.push(`clé dupliquée : ${out.lock.keyId}`);
      keys.add(out.lock.keyId);
    }
    if (!r.doors.some((d) => d.role === 'entry') && i > 0) errors.push(`[${r.id}] pas de porte d’entrée`);
  });

  // Objets de fin.
  const lootIds = (rs: typeof all): string[] => rs.flatMap((r) => r.furniture.flatMap((f) => (f.loot ?? []).map((l) => l.id)));
  const mainLoot = lootIds(plan.rooms);
  const annexLoot = lootIds(Object.values(plan.annexes));
  const found = (id: string): boolean => mainLoot.includes(id) || annexLoot.includes(id);
  for (const needed of ['lamp', 'map', 'badge', 'stoppedWatch', 'chalk']) {
    const inFloor = all.some((r) => (r.floorItems ?? []).some((i) => i.item.id === needed));
    if (!found(needed) && !inFloor) errors.push(`objet de fin introuvable : ${needed}`);
  }
  const memories = mainLoot.filter((id) => id.startsWith('memory:'));
  if (memories.length < 5) errors.push(`pas assez de fragments sur le parcours principal (${memories.length})`);
  if (new Set(memories).size !== memories.length) errors.push('fragment de souvenir dupliqué');

  // Liens des annexes.
  for (const r of plan.rooms) {
    for (const d of r.doors) {
      if (d.target && !d.target.startsWith('@') && !plan.annexes[d.target]) errors.push(`[${r.id}] annexe introuvable : ${d.target}`);
    }
  }
  for (const a of Object.values(plan.annexes)) {
    const back = a.doors.find((d) => d.returns);
    if (!back?.target || !plan.rooms.some((r) => r.id === back.target)) errors.push(`[${a.id}] retour invalide`);
  }
  if (plan.rooms.length < 10) errors.push('chapitre trop court');
  return errors;
}
