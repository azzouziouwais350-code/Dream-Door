import { CH1_TEMPLATES, ANNEX_TEMPLATES } from '../data/rooms/chapter1';
import { KEY_PLACEHOLDER, type RoomTemplate } from '../data/rooms/helpers';
import { CH1_FRAGMENT_IDS } from '../data/story';
import type { Difficulty, FurnitureDef, ItemStack, RoomDef } from '../core/types';
import { Rng, hashSeed } from '../core/rng';
import { resolvePuzzleDef } from './puzzles';

export interface ChapterPlan {
  chapter: number;
  seed: number;
  difficulty: Difficulty;
  /** Salles du parcours principal, dans l'ordre. */
  rooms: RoomDef[];
  /** Salles annexes (secrètes ou fausses portes), indexées par id. */
  annexes: Record<string, RoomDef>;
}

export const CH1_LENGTH = 20;

export function pad3(n: number): string {
  return String(n).padStart(3, '0');
}

export function keyIdFor(roomIndex: number): string {
  return `key:${pad3(roomIndex + 1)}`;
}

const MANDATORY = ['watcherRoom', 'archive', 'lodge', 'corridor', 'hall', 'storage', 'switches', 'boiler', 'music', 'gallery', 'anomaly'];
const FILLERS = ['bedroom', 'suite', 'service'];
const CAPS: Record<string, number> = {
  watcherRoom: 1,
  archive: 1,
  lodge: 2,
  corridor: 2,
  hall: 2,
  storage: 1,
  switches: 1,
  boiler: 1,
  music: 1,
  gallery: 1,
  anomaly: 1,
  bedroom: 4,
  suite: 3,
  service: 3,
};

function byTid(tid: string): RoomTemplate {
  const t = CH1_TEMPLATES.find((x) => x.tid === tid);
  if (!t) throw new Error(`Modèle de salle inconnu : ${tid}`);
  return t;
}

function validSequence(seq: string[]): boolean {
  let puzzles = 0;
  for (let i = 1; i < seq.length - 1; i++) {
    const cur = byTid(seq[i] as string);
    const prev = byTid(seq[i - 1] as string);
    if (cur.tid === prev.tid) return false;
    if (cur.category === 'danger' && prev.category === 'danger') return false;
    puzzles = cur.category === 'puzzle' ? puzzles + 1 : 0;
    if (puzzles >= 3) return false;
    if (i < cur.minIndex || i > cur.maxIndex) return false;
  }
  return true;
}

/** Choisit l'ordre des modèles : tous les modèles obligatoires apparaissent, avec un bon rythme. */
export function pickSequence(rng: Rng, length = CH1_LENGTH): string[] {
  const middle = length - 2; // indices 1..length-2
  for (let attempt = 0; attempt < 500; attempt++) {
    const seq: Array<string | null> = new Array<string | null>(length).fill(null);
    seq[0] = 'lobby';
    seq[length - 1] = 'elevator';
    seq[1] = 'waiting';
    const used: Record<string, number> = { waiting: 1 };

    // Placement des modèles obligatoires, du plus contraint au moins contraint.
    const order = [...MANDATORY].sort((a, b) => {
      const ta = byTid(a);
      const tb = byTid(b);
      return ta.maxIndex - ta.minIndex - (tb.maxIndex - tb.minIndex);
    });
    let ok = true;
    for (const tid of order) {
      const t = byTid(tid);
      const slots: number[] = [];
      for (let i = Math.max(2, t.minIndex); i <= Math.min(length - 2, t.maxIndex); i++) if (seq[i] === null) slots.push(i);
      if (slots.length === 0) {
        ok = false;
        break;
      }
      seq[rng.pick(slots)] = tid;
      used[tid] = (used[tid] ?? 0) + 1;
    }
    if (!ok) continue;

    // Remplissage.
    for (let i = 2; i <= middle; i++) {
      if (seq[i] !== null) continue;
      const pool = FILLERS.filter((tid) => {
        const t = byTid(tid);
        return i >= t.minIndex && i <= t.maxIndex && (used[tid] ?? 0) < (CAPS[tid] ?? 2) && seq[i - 1] !== tid;
      });
      if (pool.length === 0) {
        ok = false;
        break;
      }
      const tid = rng.pick(pool);
      seq[i] = tid;
      used[tid] = (used[tid] ?? 0) + 1;
    }
    if (!ok) continue;
    const full = seq as string[];
    if (validSequence(full)) return full;
  }
  throw new Error('Impossible de composer une séquence de salles valide.');
}

function clone<T>(v: T): T {
  return structuredClone(v);
}

function pickBonus(rng: Rng): ItemStack {
  const roll = rng.next();
  if (roll < 0.6) return { id: 'battery', count: 1 };
  if (roll < 0.85) return { id: 'glassToken', count: 1 };
  return { id: 'battery', count: 2 };
}

function addLoot(f: FurnitureDef, item: ItemStack): void {
  f.loot = [...(f.loot ?? []), item];
}

function instantiate(tpl: RoomTemplate, id: string, index: number, difficulty: Difficulty, rng: Rng): RoomDef {
  const { tid: _tid, minIndex: _a, maxIndex: _b, weight: _w, secretAnnex: _s, falseDoor: _f, tags: _t, ...rest } = clone(tpl);
  void _tid;
  void _a;
  void _b;
  void _w;
  void _s;
  void _f;
  void _t;
  const room: RoomDef = { ...rest, id };
  const keyId = keyIdFor(index);
  const exitLabel = `Porte ${pad3(index + 1)}`;

  for (const d of room.doors) {
    if (d.lock?.type === 'key' && d.lock.keyId === KEY_PLACEHOLDER) d.lock = { type: 'key', keyId };
    if (d.role === 'exit' && !d.returns && !d.label) d.label = exitLabel;
    if (d.id === 'out') d.label = exitLabel;
  }
  if (room.puzzles) room.puzzles = room.puzzles.map((p) => resolvePuzzleDef(p, rng, difficulty));

  // Clé : placée dans un meuble prévu à cet effet.
  const needsKey = room.doors.some((d) => d.lock?.type === 'key');
  if (needsKey) {
    const slots = room.furniture.filter((f) => f.keySlot && !f.hide);
    if (slots.length > 0) addLoot(rng.pick(slots), { id: keyId, count: 1 });
  }

  // Objets bonus.
  const bonusSlots = room.furniture.filter((f) => f.bonus && !f.hide);
  for (const f of bonusSlots) if (rng.chance(0.55)) addLoot(f, pickBonus(rng));

  // Difficulté : retarde l'apparition des menaces en mode facile.
  if (room.entities) {
    for (const e of room.entities) {
      if (e.delay !== undefined) e.delay += difficulty === 'easy' ? 3 : difficulty === 'hard' ? -1 : 0;
      if (e.delay !== undefined && e.delay < 2) e.delay = 2;
    }
  }
  return room;
}

function placeFragments(rooms: RoomDef[], rng: Rng): void {
  const frags = [...CH1_FRAGMENT_IDS];
  const eligible = rooms
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => r.furniture.some((f) => f.fragmentSlot && !f.hide));
  // On répartit les fragments sur l'ensemble du chapitre.
  const buckets = frags.length;
  const span = Math.max(1, Math.floor(eligible.length / buckets));
  frags.forEach((fid, b) => {
    const from = Math.min(eligible.length - 1, b * span);
    const to = Math.min(eligible.length, b === buckets - 1 ? eligible.length : (b + 1) * span);
    const group = eligible.slice(from, Math.max(to, from + 1)).filter(({ r }) => !r.furniture.some((f) => f.loot?.some((l) => l.id === `memory:${fid}`)));
    const choice = group.length > 0 ? rng.pick(group) : rng.pick(eligible);
    const slots = choice.r.furniture.filter((f) => f.fragmentSlot && !f.hide);
    addLoot(rng.pick(slots), { id: `memory:${fid}`, count: 1 });
  });
}

export function generateChapter(chapter: number, seed: number, difficulty: Difficulty): ChapterPlan {
  if (chapter !== 1) throw new Error(`Le chapitre ${chapter} n’est pas encore disponible.`);
  const rng = new Rng(hashSeed('chapter', chapter, seed));
  const seq = pickSequence(rng);
  const rooms: RoomDef[] = [];
  const annexes: Record<string, RoomDef> = {};

  seq.forEach((tid, i) => {
    const tpl = byTid(tid);
    const id = `c${chapter}r${i}`;
    const roomRng = new Rng(hashSeed('room', chapter, seed, i));
    const room = instantiate(tpl, id, i, difficulty, roomRng);
    room.checkpoint = room.checkpoint || i % 5 === 0 || i === seq.length - 1;

    // Annexes : secrète et/ou fausse porte.
    if (tpl.secretAnnex) {
      const annexTpl = ANNEX_TEMPLATES[tpl.secretAnnex] as RoomTemplate;
      const aid = `${id}_s`;
      const annex = instantiate(annexTpl, aid, i, difficulty, roomRng);
      const back = annex.doors.find((d) => d.returns);
      if (back) back.target = id;
      const sec = room.doors.find((d) => d.role === 'secret');
      if (sec) sec.target = aid;
      annexes[aid] = annex;
    }
    if (tpl.falseDoor) {
      const annexTpl = ANNEX_TEMPLATES.false as RoomTemplate;
      const aid = `${id}_f`;
      const annex = instantiate(annexTpl, aid, i, difficulty, roomRng);
      const back = annex.doors.find((d) => d.returns);
      if (back) back.target = id;
      const fd = room.doors.find((d) => d.role === 'false');
      if (fd) fd.target = aid;
      annexes[aid] = annex;
    }
    rooms.push(room);
  });

  placeFragments(rooms, new Rng(hashSeed('frag', chapter, seed)));

  return { chapter, seed, difficulty, rooms, annexes };
}

export function findRoom(plan: ChapterPlan, id: string): RoomDef | undefined {
  return plan.rooms.find((r) => r.id === id) ?? plan.annexes[id];
}

export function roomIndexOf(plan: ChapterPlan, id: string): number {
  const base = id.replace(/_[sf]$/, '');
  return plan.rooms.findIndex((r) => r.id === base);
}
