import { Emitter } from '../core/events';
import { Rng, hashSeed } from '../core/rng';
import { dirFromWorldVelocity, screenInputToWorld } from '../core/iso';
import type { Cue, Difficulty, Dir, DoorDef, FurnitureDef, HideProps, ItemStack, Rect, RoomDef, Vec2 } from '../core/types';
import { getItemDef, isKeyId } from '../data/items';
import { type EndingId, ENDINGS, NPC_DIALOGUES } from '../data/story';
import { moveWithCollision } from '../systems/collision';
import { type Entity, FalseThreshold, createEntity, type Noise } from '../systems/entities';
import { type ChapterPlan, findRoom, generateChapter, roomIndexOf } from '../systems/generator';
import { Inventory } from '../systems/inventory';
import type { NavGrid } from '../systems/nav';
import {
  type Feedback,
  type Puzzle,
  AnomalyPuzzle,
  FusePuzzle,
  SequencePuzzle,
  SwitchPuzzle,
  ValvePuzzle,
  anomalyTextFor,
  createPuzzle,
} from '../systems/puzzles';
import {
  DOOR_REACH,
  INTERACT_REACH,
  blockersOf,
  buildNav,
  doorPointOf,
  doorReturnSpawn,
  furnitureAnchor,
  furnitureRect,
} from '../systems/roomgeom';
import { type Checkpoint, type RoomState, type SaveData, SAVE_VERSION, emptyRoomState } from '../systems/save';

export const PLAYER_RADIUS = 0.28;
export const SPEED = { walk: 2.6, run: 4.4, crouch: 1.4 } as const;
export const NOISE = { walk: 2.6, run: 6.5, crouch: 1.0, hiddenRustle: 1.6 } as const;
export const LAMP_MAX = 180;
export const LAMP_BATTERY = 90;

export type WorldStatus = 'playing' | 'transition' | 'defeated' | 'ended';

export type TargetKind = 'door' | 'furniture' | 'item' | 'npc';
export interface Target {
  kind: TargetKind;
  id: string;
  label: string;
  /** Texte d'action affiché dans le HUD (« Fouiller », « Ouvrir »…). */
  verb: string;
}

export interface WorldEvents {
  toast: { text: string; tone: 'info' | 'good' | 'bad' };
  sfx: { name: string; x?: number; y?: number };
  sequence: { notes: string[] };
  roomLoaded: { room: RoomDef; fromId: string | null };
  transition: { toRoomId: string; spawn: Vec2; label: string };
  pickup: { itemId: string; count: number };
  dialogue: { name: string; lines: string[] };
  puzzle: { puzzleId: string; furnId: string };
  read: { title: string; lines: string[] };
  choice: { id: string; title: string; options: string[] };
  endingMenu: { options: Array<{ id: EndingId; title: string; requirement: string; available: boolean }> };
  ending: { id: EndingId };
  defeat: { by: string; text: string };
  cue: Cue;
  hide: { hidden: boolean; label: string };
  changed: Record<string, never>;
  save: SaveData;
  throwToken: { from: Vec2; to: Vec2 };
  mark: { x: number; y: number };
  puzzleSolved: { puzzleId: string };
  doorOpened: { doorId: string };
  furnitureMoved: { id: string };
}

interface Busy {
  kind: 'search' | 'push' | 'hide' | 'unhide' | 'pickup';
  t: number;
  dur: number;
  done: () => void;
}

const DEFEAT_TEXT: Record<string, string> = {
  concierge: 'Le Concierge vous a rattrapé. Ses clés tintent encore.',
  ceilingShadow: 'L’Ombre du Plafond vous a happé dans le noir.',
  swimmer: 'Le Nageur vous a entraîné sous la surface.',
  watcher: 'Le Veilleur vous a regardé trop longtemps.',
  falseThreshold: 'La fausse porte s’est refermée sur vous.',
};

const FURN_DEFAULT_TEXT: Record<string, string> = {
  bed: 'Un lit parfaitement fait.',
  wardrobe: 'Une armoire de chêne.',
  closet: 'Un placard à balais.',
  desk: 'Un bureau.',
  drawer: 'Un tiroir.',
  couch: 'Un divan.',
  table: 'Une petite table.',
  counter: 'Un comptoir.',
  crate: 'Une caisse.',
  shelf: 'Une étagère.',
  trolley: 'Un chariot de service.',
  console: 'Une console.',
};

const KIND_LABEL: Record<string, string> = {
  bed: 'le lit',
  wardrobe: 'l’armoire',
  closet: 'le placard',
  desk: 'le bureau',
  drawer: 'le tiroir',
  couch: 'le divan',
  table: 'la table',
  counter: 'le comptoir',
  crate: 'la caisse',
  shelf: 'l’étagère',
  trolley: 'le chariot',
  console: 'la console',
};

function cloneRoomStates(s: Record<string, RoomState>): Record<string, RoomState> {
  return structuredClone(s);
}

export class World {
  readonly events = new Emitter<WorldEvents>();
  plan: ChapterPlan;
  readonly seed: number;
  readonly difficulty: Difficulty;

  status: WorldStatus = 'playing';
  room!: RoomDef;
  roomIndex = 0;
  roomState!: RoomState;
  roomStates: Record<string, RoomState> = {};
  visited = new Set<string>();
  readonly inv = new Inventory();
  lampCharge = LAMP_MAX / 2;
  lampOn = false;
  playTime = 0;
  hintLevels: Record<string, number> = {};
  checkpoint!: Checkpoint;

  player = {
    pos: { x: 0, y: 0 } as Vec2,
    vel: { x: 0, y: 0 } as Vec2,
    dir: 'DR' as Dir,
    face: { x: 0.7071, y: 0.7071 } as Vec2,
    moving: false,
    running: false,
    crouched: false,
    hideId: null as string | null,
    preHide: { x: 0, y: 0 } as Vec2,
    busy: null as Busy | null,
  };

  puzzles = new Map<string, Puzzle>();
  entities: Entity[] = [];
  blockers: Rect[] = [];
  nav!: NavGrid;
  target: Target | null = null;
  recentCues: Array<{ cue: Cue; age: number }> = [];
  /** Pulsation visuelle (0..1) pour les bruits proches. */
  lastNoiseAge = 99;

  private input = { mx: 0, my: 0, run: false, crouch: false };
  private noises: Array<Noise & { ttl: number }> = [];
  private entityRng = new Rng(1);
  private pendingTransition: { toRoomId: string; spawn: Vec2 } | null = null;
  private dirty = false;
  private sinceSave = 0;
  private roomEntryCount = 0;
  private musicBoxCooldown = 0;
  private lastCueSubtitle = '';
  private pendingChoice: { id: string; furnId: string } | null = null;

  constructor(seed: number, difficulty: Difficulty, plan?: ChapterPlan) {
    this.seed = seed;
    this.difficulty = difficulty;
    this.plan = plan ?? generateChapter(1, seed, difficulty);
  }

  /* ---------------------------------------------------------------------- */
  /* Création / restauration                                                */
  /* ---------------------------------------------------------------------- */
  static newGame(seed: number, difficulty: Difficulty): World {
    const w = new World(seed, difficulty);
    const first = w.plan.rooms[0] as RoomDef;
    w.loadRoom(first.id, first.spawn, null);
    return w;
  }

  static restore(save: SaveData): World {
    const w = new World(save.seed, save.difficulty);
    w.inv.load(save.inventory);
    w.lampCharge = save.lampCharge;
    w.roomStates = cloneRoomStates(save.roomStates);
    w.visited = new Set(save.visited);
    w.hintLevels = { ...save.hintLevels };
    w.playTime = save.playTime;
    w.checkpoint = {
      roomId: save.checkpoint.roomId,
      inventory: structuredClone(save.checkpoint.inventory),
      lampCharge: save.checkpoint.lampCharge,
      roomStates: cloneRoomStates(save.checkpoint.roomStates),
      visited: [...save.checkpoint.visited],
    };
    const room = findRoom(w.plan, save.roomId);
    if (!room) throw new Error(`Salle introuvable dans la sauvegarde : ${save.roomId}`);
    w.loadRoom(room.id, room.spawn, null, true);
    return w;
  }

  toSave(): SaveData {
    return {
      version: SAVE_VERSION,
      chapter: this.plan.chapter,
      seed: this.seed,
      difficulty: this.difficulty,
      roomId: this.room.id,
      inventory: this.inv.toJSON(),
      lampCharge: Math.round(this.lampCharge * 10) / 10,
      roomStates: cloneRoomStates(this.roomStates),
      visited: [...this.visited],
      checkpoint: {
        roomId: this.checkpoint.roomId,
        inventory: structuredClone(this.checkpoint.inventory),
        lampCharge: this.checkpoint.lampCharge,
        roomStates: cloneRoomStates(this.checkpoint.roomStates),
        visited: [...this.checkpoint.visited],
      },
      hintLevels: { ...this.hintLevels },
      playTime: Math.round(this.playTime),
      savedAt: Date.now(),
    };
  }

  /** Sauvegarder n'est sûr que hors transition, hors danger actif, hors cachette en cours de changement. */
  canSave(): boolean {
    if (this.status !== 'playing' || this.pendingTransition) return false;
    if (this.player.busy) return false;
    return !this.entities.some((e) => e.threatening && !e.gone);
  }

  private markDirty(): void {
    this.dirty = true;
  }

  saveNow(): void {
    if (!this.canSave()) return;
    this.dirty = false;
    this.sinceSave = 0;
    this.events.emit('save', this.toSave());
  }

  /* ---------------------------------------------------------------------- */
  /* Chargement d'une salle                                                 */
  /* ---------------------------------------------------------------------- */
  private stateOf(roomId: string): RoomState {
    let s = this.roomStates[roomId];
    if (!s) {
      s = emptyRoomState();
      this.roomStates[roomId] = s;
    }
    return s;
  }

  loadRoom(roomId: string, spawn: Vec2, fromId: string | null, restoring = false): void {
    const room = findRoom(this.plan, roomId);
    if (!room) throw new Error(`Salle inconnue : ${roomId}`);
    this.room = room;
    this.roomIndex = roomIndexOf(this.plan, roomId);
    this.roomState = this.stateOf(roomId);
    this.roomEntryCount++;
    if (!roomId.includes('_')) this.visited.add(roomId);

    this.player.pos = { ...spawn };
    this.player.vel = { x: 0, y: 0 };
    this.player.hideId = null;
    this.player.busy = null;
    this.player.dir = 'DR';
    this.status = 'playing';
    this.pendingTransition = null;
    this.noises = [];
    this.recentCues = [];
    this.target = null;
    this.rebuildGeometry();

    // Énigmes : recréées, puis marquées comme résolues si besoin.
    this.puzzles.clear();
    for (const def of room.puzzles ?? []) {
      const p = createPuzzle(def, this.difficulty);
      if (this.roomState.solved.includes(def.id)) this.markSolvedInstance(p);
      this.puzzles.set(def.id, p);
    }

    // Entités.
    this.entityRng = new Rng(hashSeed('entities', this.seed, roomId, this.roomEntryCount));
    const doorPoints: Record<string, Vec2> = {};
    for (const d of room.doors) doorPoints[d.id] = doorPointOf(d);
    this.entities = (room.entities ?? []).map((spawnDef, i) => createEntity(spawnDef, i, doorPoints));

    // Point de contrôle : instantané au moment d'entrer, avant toute interaction.
    if (room.checkpoint && !roomId.includes('_') && !restoring) {
      this.checkpoint = {
        roomId,
        inventory: structuredClone(this.inv.toJSON()),
        lampCharge: this.lampCharge,
        roomStates: cloneRoomStates(this.roomStates),
        visited: [...this.visited],
      };
    } else if (!this.checkpoint) {
      this.checkpoint = {
        roomId,
        inventory: structuredClone(this.inv.toJSON()),
        lampCharge: this.lampCharge,
        roomStates: cloneRoomStates(this.roomStates),
        visited: [...this.visited],
      };
    }
    if (this.lampOn && !this.inv.has('lamp')) this.lampOn = false;

    this.events.emit('roomLoaded', { room, fromId });
    if (!restoring && room.narration && this.roomState.npcTalks === 0 && !this.roomState.searched.includes('__intro')) {
      this.roomState.searched.push('__intro');
      this.toast(room.narration, 'info');
    }
    this.events.emit('changed', {});
    this.saveNow();
  }

  private markSolvedInstance(p: Puzzle): void {
    p.solved = true;
  }

  private rebuildGeometry(): void {
    const moved = new Set(this.roomState.moved);
    this.blockers = blockersOf(this.room, moved);
    this.nav = buildNav(this.room, moved);
  }

  /* ---------------------------------------------------------------------- */
  /* Entrées                                                                */
  /* ---------------------------------------------------------------------- */
  setMove(mx: number, my: number): void {
    this.input.mx = Math.max(-1, Math.min(1, mx));
    this.input.my = Math.max(-1, Math.min(1, my));
  }

  setRun(v: boolean): void {
    this.input.run = v;
  }

  setCrouch(v: boolean): void {
    this.input.crouch = v;
  }

  /* ---------------------------------------------------------------------- */
  /* Boucle                                                                 */
  /* ---------------------------------------------------------------------- */
  update(dtRaw: number): void {
    const dt = Math.max(0, Math.min(dtRaw, 0.25));
    if (dt === 0) return;
    const steps = Math.max(1, Math.ceil(dt / (1 / 30)));
    for (let i = 0; i < steps; i++) this.step(dt / steps);
  }

  private step(dt: number): void {
    if (this.status === 'transition' || this.status === 'ended') return;
    this.playTime += dt;
    this.sinceSave += dt;
    this.lastNoiseAge += dt;
    this.musicBoxCooldown = Math.max(0, this.musicBoxCooldown - dt);

    if (this.status === 'playing') {
      this.updateBusy(dt);
      this.updatePlayer(dt);
      this.updateLamp(dt);
      this.updateNoises(dt);
      this.updateEntities(dt);
      this.updateTarget();
      for (const c of this.recentCues) c.age += dt;
      this.recentCues = this.recentCues.filter((c) => c.age < 8);
      if (this.dirty && this.sinceSave > 1.5 && this.canSave()) this.saveNow();
    }
  }

  private updateBusy(dt: number): void {
    const b = this.player.busy;
    if (!b) return;
    b.t += dt;
    if (b.t >= b.dur) {
      this.player.busy = null;
      b.done();
    }
  }

  private currentSpeed(): number {
    if (this.player.crouched) return SPEED.crouch;
    return this.player.running ? SPEED.run : SPEED.walk;
  }

  private updatePlayer(dt: number): void {
    const p = this.player;
    const locked = p.busy !== null || p.hideId !== null;
    p.crouched = !locked && this.input.crouch;
    const wantsMove = !locked && (Math.abs(this.input.mx) > 0.05 || Math.abs(this.input.my) > 0.05);
    p.running = wantsMove && this.input.run && !p.crouched;
    const dir = wantsMove ? screenInputToWorld(this.input.mx, this.input.my) : { x: 0, y: 0 };
    const speed = this.currentSpeed();
    const k = 1 - Math.exp(-dt * 16);
    p.vel = { x: p.vel.x + (dir.x * speed - p.vel.x) * k, y: p.vel.y + (dir.y * speed - p.vel.y) * k };
    if (!wantsMove && Math.hypot(p.vel.x, p.vel.y) < 0.05) p.vel = { x: 0, y: 0 };
    if (p.vel.x !== 0 || p.vel.y !== 0) {
      const before = p.pos;
      p.pos = moveWithCollision(p.pos, p.vel.x * dt, p.vel.y * dt, PLAYER_RADIUS, this.blockers, { w: this.room.w, h: this.room.h });
      p.moving = Math.hypot(p.pos.x - before.x, p.pos.y - before.y) > 1e-4;
      p.dir = dirFromWorldVelocity(p.vel.x, p.vel.y, p.dir);
      const vl = Math.hypot(p.vel.x, p.vel.y);
      if (vl > 0.3) p.face = { x: p.vel.x / vl, y: p.vel.y / vl };
    } else {
      p.moving = false;
    }
  }

  private updateLamp(dt: number): void {
    if (!this.lampOn) return;
    const before = this.lampCharge;
    this.lampCharge = Math.max(0, this.lampCharge - dt);
    if (before > 15 && this.lampCharge <= 15) this.toast('La lampe faiblit…', 'bad');
    if (this.lampCharge <= 0) {
      this.lampOn = false;
      this.toast('La lampe s’éteint : plus de charge. Utilisez une batterie.', 'bad');
      this.events.emit('changed', {});
    }
  }

  private playerHide(): HideProps | null {
    if (!this.player.hideId) return null;
    return this.room.furniture.find((f) => f.id === this.player.hideId)?.hide ?? null;
  }

  isInSafeZone(): boolean {
    return (this.room.safeZones ?? []).some((z) => Math.hypot(this.player.pos.x - z.x, this.player.pos.y - z.y) <= z.r);
  }

  playerNoiseRadius(): number {
    const h = this.playerHide();
    if (h) return h.noise ? 0 : NOISE.hiddenRustle;
    if (!this.player.moving) return 0;
    if (this.player.crouched) return NOISE.crouch;
    return this.player.running ? NOISE.run : NOISE.walk;
  }

  private addNoise(pos: Vec2, radius: number, kind: Noise['kind'], ttl = 0.6): void {
    this.noises.push({ pos: { ...pos }, radius, kind, ttl });
    this.lastNoiseAge = 0;
  }

  private updateNoises(dt: number): void {
    for (const n of this.noises) n.ttl -= dt;
    this.noises = this.noises.filter((n) => n.ttl > 0);
  }

  private updateEntities(dt: number): void {
    if (this.entities.length === 0) return;
    const hide = this.playerHide();
    const radius = this.playerNoiseRadius();
    const allNoises: Noise[] = this.noises.map((n) => ({ pos: n.pos, radius: n.radius, kind: n.kind }));
    if (radius > 0) allNoises.push({ pos: this.player.pos, radius, kind: 'player' });

    const hideSpots = this.room.furniture
      .filter((f) => f.hide)
      .map((f) => ({ id: f.id, pos: furnitureAnchor(f, this.roomState.moved.includes(f.id)), props: f.hide as HideProps }));
    const doorPoints: Record<string, Vec2> = {};
    for (const d of this.room.doors) doorPoints[d.id] = doorPointOf(d);

    const ctx = {
      player: {
        pos: this.player.pos,
        hide,
        hideId: this.player.hideId,
        noiseRadius: radius,
        lampOn: this.lampOn,
        crouched: this.player.crouched,
        running: this.player.running,
        inSafeZone: this.isInSafeZone(),
      },
      room: {
        w: this.room.w,
        h: this.room.h,
        blockers: this.blockers,
        nav: this.nav,
        hideSpots,
        safeZones: this.room.safeZones ?? [],
        water: this.room.water,
        doorPoints,
      },
      noises: allNoises,
      difficulty: this.difficulty,
      emit: (cue: Cue) => this.onCue(cue),
      rng: () => this.entityRng.next(),
    };

    for (const e of this.entities) {
      if (e.gone) continue;
      e.update(dt, ctx);
      if (e.caught && this.status === 'playing') {
        this.defeat(e.kind);
        return;
      }
    }
  }

  private onCue(cue: Cue): void {
    this.recentCues.push({ cue, age: 0 });
    this.lastCueSubtitle = cue.text;
    this.events.emit('cue', cue);
  }

  /** 0 : calme, 1 : indices de présence, 2 : danger actif. */
  dangerLevel(): 0 | 1 | 2 {
    if (this.entities.some((e) => e.threatening && !e.gone)) return 2;
    return this.recentCues.length > 0 ? 1 : 0;
  }

  /** Une entité poursuit ou frappe : sert à la musique de poursuite. */
  isChased(): boolean {
    return this.entities.some((e) => !e.gone && (e.state === 'chase' || e.state === 'strike' || e.state === 'warning' || e.state === 'lunge'));
  }

  get lastCue(): string {
    return this.lastCueSubtitle;
  }

  /** Intensité de vacillement des lumières (Ombre du Plafond). */
  flicker(): number {
    let f = 0;
    for (const e of this.entities) {
      const v = (e as { flicker?: number }).flicker;
      if (typeof v === 'number') f = Math.max(f, v);
    }
    return f;
  }

  /* ---------------------------------------------------------------------- */
  /* Cible d'interaction                                                    */
  /* ---------------------------------------------------------------------- */
  furnitureLabel(f: FurnitureDef): string {
    return f.label ?? KIND_LABEL[f.kind]?.replace(/^(le|la|l’)\s?/, '').replace(/^./, (c) => c.toUpperCase()) ?? f.kind;
  }

  private isInteractive(f: FurnitureDef): boolean {
    return Boolean(f.loot?.length || f.hide || f.puzzleId || f.movable || f.read || f.searchText || f.kind === 'elevatorPanel');
  }

  private furnitureVerb(f: FurnitureDef): string {
    if (f.hide) return this.player.hideId === f.id ? 'Sortir' : 'Se cacher';
    if (f.movable && !this.roomState.moved.includes(f.id)) return 'Déplacer';
    if (f.kind === 'elevatorPanel') return 'Choisir une fin';
    if (f.puzzleId && f.puzzleRole === 'operate') return 'Manipuler';
    if (f.puzzleId) return f.kind === 'musicbox' ? 'Écouter' : 'Examiner';
    if (f.loot?.length && !this.roomState.searched.includes(f.id)) return 'Fouiller';
    if (f.read) return 'Lire';
    return 'Examiner';
  }

  private distToFurniture(f: FurnitureDef): number {
    const p = this.player.pos;
    if (f.wall) {
      const a = furnitureAnchor(f);
      return Math.hypot(p.x - a.x, p.y - a.y) - 0.3;
    }
    const r = furnitureRect(f, this.roomState.moved.includes(f.id));
    const cx = Math.max(r.x, Math.min(p.x, r.x + r.w));
    const cy = Math.max(r.y, Math.min(p.y, r.y + r.h));
    return Math.hypot(p.x - cx, p.y - cy);
  }

  private visibleDoors(): DoorDef[] {
    return this.room.doors.filter((d) => !d.hidden || this.roomState.revealed.includes(d.id));
  }

  private updateTarget(): void {
    if (this.player.busy) {
      this.target = null;
      return;
    }
    if (this.player.hideId) {
      const f = this.room.furniture.find((x) => x.id === this.player.hideId);
      this.target = f ? { kind: 'furniture', id: f.id, label: f.hide?.label ?? 'Cachette', verb: 'Sortir' } : null;
      return;
    }
    const p = this.player.pos;
    let best: { t: Target; score: number } | null = null;
    // Le score favorise ce que le joueur regarde : près d'une porte, le meuble voisin ne vole pas la cible.
    const consider = (t: Target, dist: number, reach: number, at: Vec2): void => {
      if (dist > reach) return;
      const dx = at.x - p.x;
      const dy = at.y - p.y;
      const dl = Math.hypot(dx, dy);
      const facing = dl > 0.05 ? Math.max(0, (dx * this.player.face.x + dy * this.player.face.y) / dl) : 0;
      const score = dist - 0.55 * facing;
      if (!best || score < best.score) best = { t, score };
    };

    for (const it of this.room.floorItems ?? []) {
      if (this.roomState.taken.includes(it.id)) continue;
      consider({ kind: 'item', id: it.id, label: getItemDef(it.item.id).name, verb: 'Ramasser' }, Math.hypot(p.x - it.x, p.y - it.y) - 0.3, 1.1, { x: it.x, y: it.y });
    }
    if (this.room.npc) {
      consider({ kind: 'npc', id: this.room.npc.id, label: this.room.npc.name, verb: 'Parler' }, Math.hypot(p.x - this.room.npc.x, p.y - this.room.npc.y) - 0.3, 1.5, { x: this.room.npc.x, y: this.room.npc.y });
    }
    for (const f of this.room.furniture) {
      if (!this.isInteractive(f)) continue;
      consider({ kind: 'furniture', id: f.id, label: this.furnitureLabel(f), verb: this.furnitureVerb(f) }, this.distToFurniture(f), f.wall ? 1.3 : INTERACT_REACH - 0.2, furnitureAnchor(f, this.roomState.moved.includes(f.id)));
    }
    for (const d of this.visibleDoors()) {
      const pt = doorPointOf(d);
      // Les portes passent après les meubles proches : on les favorise légèrement quand on est devant.
      consider({ kind: 'door', id: d.id, label: d.label ?? 'Porte', verb: this.doorVerb(d) }, Math.hypot(p.x - pt.x, p.y - pt.y) - 0.25, DOOR_REACH, pt);
    }
    this.target = best ? (best as { t: Target }).t : null;
  }

  private doorVerb(d: DoorDef): string {
    if (d.role === 'entry' || d.lock?.type === 'sealed') return 'Examiner';
    if (d.role === 'secret' || d.returns) return 'Passer';
    if (this.roomState.unlocked.includes(d.id) || !d.lock || d.lock.type === 'none') return 'Ouvrir';
    if (d.lock.type === 'key') return this.inv.has(d.lock.keyId) ? 'Déverrouiller' : 'Ouvrir';
    return 'Ouvrir';
  }

  /* ---------------------------------------------------------------------- */
  /* Interaction                                                            */
  /* ---------------------------------------------------------------------- */
  interact(): void {
    if (this.status !== 'playing' || this.player.busy) return;
    const t = this.target;
    if (!t) return;
    switch (t.kind) {
      case 'item':
        return this.pickupFloorItem(t.id);
      case 'npc':
        return this.talkToNpc();
      case 'door': {
        const d = this.room.doors.find((x) => x.id === t.id);
        if (d) this.openDoor(d);
        return;
      }
      case 'furniture': {
        const f = this.room.furniture.find((x) => x.id === t.id);
        if (f) this.interactFurniture(f);
        return;
      }
    }
  }

  private pickupFloorItem(id: string): void {
    const it = (this.room.floorItems ?? []).find((x) => x.id === id);
    if (!it || this.roomState.taken.includes(id)) return;
    this.player.busy = {
      kind: 'pickup',
      t: 0,
      dur: 0.45,
      done: () => {
        this.roomState.taken.push(id);
        this.giveItem(it.item);
        this.markDirty();
        this.events.emit('changed', {});
      },
    };
  }

  giveItem(stack: ItemStack): void {
    this.inv.add(stack.id, stack.count);
    const def = getItemDef(stack.id);
    this.events.emit('pickup', { itemId: stack.id, count: stack.count });
    this.events.emit('sfx', { name: isKeyId(stack.id) ? 'key' : 'pickup' });
    this.toast(`${def.name}${stack.count > 1 ? ` ×${stack.count}` : ''} ajouté à l’inventaire.`, 'good');
    if (stack.id === 'lamp') this.toast('Appuyez sur [F] pour allumer la lampe.', 'info');
  }

  private talkToNpc(): void {
    const npc = this.room.npc;
    if (!npc) return;
    const sets = NPC_DIALOGUES[npc.id] ?? [['…']];
    const idx = Math.min(this.roomState.npcTalks, sets.length - 1);
    this.roomState.npcTalks++;
    this.events.emit('dialogue', { name: npc.name, lines: sets[idx] as string[] });
    this.markDirty();
  }

  private interactFurniture(f: FurnitureDef): void {
    // Cachette.
    if (f.hide) {
      if (this.player.hideId === f.id) this.leaveHide();
      else this.enterHide(f);
      return;
    }
    // Panneau de l'ascenseur.
    if (f.kind === 'elevatorPanel') {
      this.events.emit('endingMenu', { options: this.endingOptions() });
      return;
    }
    // Meuble déplaçable.
    if (f.movable && !this.roomState.moved.includes(f.id)) {
      this.pushFurniture(f);
      return;
    }
    // Énigme.
    if (f.puzzleId) {
      this.interactPuzzleFurniture(f);
      return;
    }
    // Fouille.
    if (f.loot?.length && !this.roomState.searched.includes(f.id)) {
      this.searchFurniture(f);
      return;
    }
    if (f.read) {
      this.events.emit('read', { title: this.furnitureLabel(f), lines: f.read });
      return;
    }
    if (f.loot?.length) {
      this.toast('Vous avez déjà fouillé ici.', 'info');
      return;
    }
    this.toast(f.searchText ?? FURN_DEFAULT_TEXT[f.kind] ?? 'Rien d’intéressant.', 'info');
  }

  private searchFurniture(f: FurnitureDef): void {
    const a = furnitureAnchor(f);
    this.addNoise(a, 2.2, 'object', 0.8);
    this.events.emit('sfx', { name: 'search', x: a.x, y: a.y });
    this.player.busy = {
      kind: 'search',
      t: 0,
      dur: 0.9,
      done: () => {
        this.roomState.searched.push(f.id);
        if (f.searchText) this.toast(f.searchText, 'info');
        for (const l of f.loot ?? []) this.giveItem(l);
        this.markDirty();
        this.events.emit('changed', {});
      },
    };
  }

  private pushFurniture(f: FurnitureDef): void {
    const m = f.movable;
    if (!m) return;
    const a = furnitureAnchor(f);
    this.addNoise(a, 5, 'object', 1.2);
    this.events.emit('sfx', { name: 'drag', x: a.x, y: a.y });
    this.player.busy = {
      kind: 'push',
      t: 0,
      dur: 0.9,
      done: () => {
        this.roomState.moved.push(f.id);
        if (m.reveals && !this.roomState.revealed.includes(m.reveals)) this.roomState.revealed.push(m.reveals);
        this.rebuildGeometry();
        // Évite de laisser le joueur coincé dans le meuble déplacé.
        this.player.pos = this.nudgeOutOfBlockers(this.player.pos);
        this.toast(m.text, 'good');
        this.events.emit('furnitureMoved', { id: f.id });
        this.markDirty();
        this.events.emit('changed', {});
      },
    };
  }

  private nudgeOutOfBlockers(pos: Vec2): Vec2 {
    let p = pos;
    for (let i = 0; i < 12; i++) {
      const c = this.nav.cellOf(p);
      if (!this.nav.isBlocked(c.cx, c.cy)) {
        const probe = moveWithCollision(p, 0, 0, PLAYER_RADIUS, this.blockers, { w: this.room.w, h: this.room.h });
        return probe;
      }
      p = { x: p.x + 0.4, y: p.y + 0.4 };
    }
    return p;
  }

  /* -- Cachettes -------------------------------------------------------- */
  private enterHide(f: FurnitureDef): void {
    if (this.entities.some((e) => !e.gone && e.state === 'chase') ) {
      // On peut se cacher en pleine poursuite, mais l'entité mémorise la cachette (voir Concierge).
    }
    this.player.preHide = { ...this.player.pos };
    this.lampOn = false;
    this.player.busy = {
      kind: 'hide',
      t: 0,
      dur: 0.4,
      done: () => {
        this.player.hideId = f.id;
        this.player.pos = furnitureAnchor(f, this.roomState.moved.includes(f.id));
        this.player.vel = { x: 0, y: 0 };
        this.events.emit('hide', { hidden: true, label: f.hide?.label ?? 'Cachette' });
        this.events.emit('sfx', { name: 'hide' });
        this.events.emit('changed', {});
      },
    };
  }

  private leaveHide(): void {
    const f = this.room.furniture.find((x) => x.id === this.player.hideId);
    this.player.busy = {
      kind: 'unhide',
      t: 0,
      dur: 0.4,
      done: () => {
        this.player.hideId = null;
        const back = moveWithCollision(this.player.preHide, 0, 0, PLAYER_RADIUS, this.blockers, { w: this.room.w, h: this.room.h });
        this.player.pos = this.nudgeOutOfBlockers(back);
        this.events.emit('hide', { hidden: false, label: f?.hide?.label ?? 'Cachette' });
        this.events.emit('sfx', { name: 'unhide' });
        this.events.emit('changed', {});
      },
    };
  }

  /* -- Énigmes ---------------------------------------------------------- */
  private requiresLight(): boolean {
    return this.room.light.dark >= 0.45;
  }

  private interactPuzzleFurniture(f: FurnitureDef): void {
    const puzzle = f.puzzleId ? this.puzzles.get(f.puzzleId) : undefined;
    if (!puzzle) return;
    const operate = f.puzzleRole === 'operate';

    if (puzzle instanceof AnomalyPuzzle) {
      this.interactAnomaly(puzzle, f);
      return;
    }
    if (puzzle instanceof FusePuzzle) {
      const fb = puzzle.tryInsert(this.inv);
      this.toast(fb.message, fb.ok ? 'good' : 'bad');
      if (fb.solved) this.onPuzzleSolved(puzzle);
      else this.events.emit('sfx', { name: 'error' });
      this.events.emit('changed', {});
      return;
    }
    if (operate) {
      if (puzzle.solved) {
        this.toast('Déjà résolu.', 'info');
        return;
      }
      if (this.requiresLight() && !this.lampOn && !(puzzle instanceof SequencePuzzle && puzzle.mode === 'sound')) {
        this.toast('Il fait trop sombre pour manipuler cela. Allumez la lampe [F].', 'bad');
        return;
      }
      this.events.emit('puzzle', { puzzleId: puzzle.id, furnId: f.id });
      return;
    }
    // Indice.
    if (this.requiresLight() && !this.lampOn && !(puzzle instanceof SequencePuzzle && puzzle.mode === 'sound')) {
      this.toast('Trop sombre pour lire. Allumez la lampe [F].', 'bad');
      return;
    }
    if (puzzle instanceof SequencePuzzle) {
      if (puzzle.mode === 'sound') {
        if (this.musicBoxCooldown > 0) return;
        this.musicBoxCooldown = 0.6 * puzzle.solution.length + 1;
        const a = furnitureAnchor(f);
        this.addNoise(a, 3, 'object', 2);
        this.events.emit('sequence', { notes: [...puzzle.solution] });
        this.events.emit('read', { title: f.label ?? 'Boîte à musique', lines: puzzle.clueLines() });
      } else {
        this.events.emit('read', { title: f.label ?? 'Indice', lines: puzzle.clueLines() });
      }
      return;
    }
    if (puzzle instanceof SwitchPuzzle) {
      this.events.emit('read', { title: f.label ?? 'Schéma', lines: puzzle.clueLines() });
      return;
    }
    if (puzzle instanceof ValvePuzzle) {
      this.events.emit('read', { title: f.label ?? 'Manomètre', lines: [puzzle.gaugeText()] });
    }
  }

  private interactAnomaly(p: AnomalyPuzzle, f: FurnitureDef): void {
    if (p.solved) {
      this.toast('L’anomalie est déjà signalée.', 'info');
      return;
    }
    const first = !p.examined.has(f.id);
    p.examine(f.id);
    const isAnomaly = f.id === p.anomalous;
    const normal: Record<string, string> = {
      painting: 'Le tableau montre un couloir d’hôtel. Rien d’anormal.',
      clock: 'L’horloge tourne dans le bon sens et indique 3 h 17.',
      window: 'Par la fenêtre : un ciel pastel, un reflet qui vous imite fidèlement.',
    };
    const text = isAnomaly ? anomalyTextFor(f.kind) : (normal[f.kind] ?? 'Rien d’anormal.');
    if (first) {
      this.events.emit('read', { title: f.label ?? 'Objet', lines: [text, 'Interagissez à nouveau pour le signaler comme anormal.'] });
      return;
    }
    this.pendingChoice = { id: 'anomaly', furnId: f.id };
    this.events.emit('choice', { id: 'anomaly', title: `Signaler « ${f.label ?? f.kind} » comme anormal ?`, options: ['Signaler', 'Pas encore'] });
  }

  answerChoice(index: number): void {
    const c = this.pendingChoice;
    this.pendingChoice = null;
    if (!c) return;
    if (c.id === 'anomaly' && index === 0) {
      for (const p of this.puzzles.values()) {
        if (p instanceof AnomalyPuzzle) {
          const fb = p.flag(c.furnId);
          this.toast(fb.message, fb.ok ? 'good' : 'bad');
          if (fb.solved) this.onPuzzleSolved(p);
          else this.events.emit('sfx', { name: 'error' });
        }
      }
    }
  }

  puzzleAction(puzzleId: string, action: { type: 'press'; value: string } | { type: 'toggle'; index: number } | { type: 'turn'; valve: number } | { type: 'reset' }): Feedback {
    const p = this.puzzles.get(puzzleId);
    if (!p) return { ok: false, message: 'Rien ne se passe.' };
    let fb: Feedback = { ok: false, message: 'Rien ne se passe.' };
    if (p instanceof SequencePuzzle) {
      if (action.type === 'press') fb = p.press(action.value);
      else if (action.type === 'reset') {
        p.reset();
        fb = { ok: true, message: 'Séquence effacée.' };
      }
    } else if (p instanceof SwitchPuzzle && action.type === 'toggle') {
      fb = p.toggle(action.index);
    } else if (p instanceof ValvePuzzle && action.type === 'turn') {
      fb = p.turn(action.valve);
    }
    this.events.emit('sfx', { name: fb.solved ? 'solved' : fb.ok ? 'click' : 'error' });
    if (fb.solved) this.onPuzzleSolved(p);
    this.events.emit('changed', {});
    return fb;
  }

  private onPuzzleSolved(p: Puzzle): void {
    if (!this.roomState.solved.includes(p.id)) this.roomState.solved.push(p.id);
    this.events.emit('puzzleSolved', { puzzleId: p.id });
    this.events.emit('sfx', { name: 'solved' });
    this.markDirty();
    for (const d of this.room.doors) {
      if (d.lock?.type === 'puzzle' && d.lock.puzzleId === p.id) {
        if (!this.roomState.unlocked.includes(d.id)) this.roomState.unlocked.push(d.id);
        this.toast(`Un verrou cède : la ${d.label ?? 'porte'} est ouverte.`, 'good');
      }
    }
  }

  /* -- Indices ---------------------------------------------------------- */
  requestHint(): string {
    let text: string | null = null;
    for (const p of this.puzzles.values()) {
      if (p.solved) continue;
      const key = `${this.room.id}:${p.id}`;
      const lvl = Math.min(2, this.hintLevels[key] ?? 0);
      text = p.hint(lvl);
      this.hintLevels[key] = Math.min(9, lvl + 1);
      break;
    }
    if (!text) {
      const keyLock = this.room.doors.find((d) => d.lock?.type === 'key');
      if (keyLock && keyLock.lock?.type === 'key' && !this.inv.has(keyLock.lock.keyId) && !this.roomState.unlocked.includes(keyLock.id)) {
        const key = `${this.room.id}:key`;
        const lvl = Math.min(2, this.hintLevels[key] ?? 0);
        this.hintLevels[key] = Math.min(9, lvl + 1);
        const holder = this.room.furniture.find((f) => f.loot?.some((l) => l.id === (keyLock.lock as { keyId: string }).keyId));
        if (lvl <= 0) text = 'Fouillez les meubles avec [E] : tiroirs, bureaux, comptoirs et chariots cachent souvent la clé.';
        else if (lvl === 1 && holder) text = `La clé est rangée dans ${KIND_LABEL[holder.kind] ?? 'un meuble'}.`;
        else if (holder) text = `Cherchez près de ${KIND_LABEL[holder.kind] ?? 'un meuble'}${holder.wall ? ' sur le mur' : ''}.`;
        else text = 'Fouillez les meubles avec [E].';
      } else {
        text = 'Rien à résoudre ici : la porte est prête. Poursuivez.';
      }
    }
    this.toast(`Indice : ${text}`, 'info');
    this.markDirty();
    return text;
  }

  /* ---------------------------------------------------------------------- */
  /* Portes                                                                 */
  /* ---------------------------------------------------------------------- */
  openDoor(d: DoorDef): void {
    const lock = d.lock ?? { type: 'none' as const };
    const doorPt = doorPointOf(d);
    if (lock.type === 'sealed') {
      this.toast(lock.reason, 'info');
      this.events.emit('sfx', { name: 'locked' });
      return;
    }
    if (lock.type === 'ending') {
      this.events.emit('endingMenu', { options: this.endingOptions() });
      return;
    }
    const unlocked = this.roomState.unlocked.includes(d.id);
    if (!unlocked) {
      if (lock.type === 'key') {
        if (!this.inv.has(lock.keyId)) {
          this.toast(`Verrouillée. Il faut la ${getItemDef(lock.keyId).name.toLowerCase()}.`, 'bad');
          this.events.emit('sfx', { name: 'locked' });
          this.addNoise(doorPt, 2, 'door', 0.5);
          return;
        }
        this.inv.remove(lock.keyId);
        this.roomState.unlocked.push(d.id);
        this.toast('Un déclic : la porte est déverrouillée.', 'good');
        this.events.emit('sfx', { name: 'unlock' });
      } else if (lock.type === 'puzzle') {
        this.toast('La porte est verrouillée par un mécanisme. Cherchez comment l’ouvrir dans la pièce.', 'bad');
        this.events.emit('sfx', { name: 'locked' });
        return;
      } else if (lock.type === 'item') {
        if (!this.inv.has(lock.item, lock.count)) {
          this.toast('Il vous manque quelque chose pour ouvrir cette porte.', 'bad');
          return;
        }
        this.inv.remove(lock.item, lock.count);
        this.roomState.unlocked.push(d.id);
      }
    }

    this.addNoise(doorPt, 4, 'door', 0.8);
    this.events.emit('doorOpened', { doorId: d.id });
    this.events.emit('sfx', { name: 'door', x: doorPt.x, y: doorPt.y });

    // Destination.
    if (d.role === 'false') {
      for (const e of this.entities) if (e instanceof FalseThreshold) e.trigger();
      this.toast('Ce n’était pas une porte ordinaire…', 'bad');
    }
    if (d.target && !d.target.startsWith('@')) {
      const dest = findRoom(this.plan, d.target);
      if (!dest) return;
      let spawn = dest.spawn;
      if (d.returns) {
        const back = dest.doors.find((x) => x.target === this.room.id);
        spawn = back ? doorReturnSpawn(back) : dest.spawn;
      }
      this.beginTransition(dest.id, spawn, dest.name);
      return;
    }
    if (d.id === 'out' && this.roomIndex >= 0 && this.roomIndex < this.plan.rooms.length - 1) {
      const next = this.plan.rooms[this.roomIndex + 1] as RoomDef;
      this.beginTransition(next.id, next.spawn, `Porte ${String(this.roomIndex + 1).padStart(3, '0')}`);
    }
  }

  private beginTransition(toRoomId: string, spawn: Vec2, label: string): void {
    this.status = 'transition';
    this.pendingTransition = { toRoomId, spawn };
    this.lampOn = this.lampOn && this.inv.has('lamp');
    this.events.emit('transition', { toRoomId, spawn, label });
  }

  /** Appelé par la scène une fois le fondu au noir terminé. */
  commitTransition(): void {
    const t = this.pendingTransition;
    if (!t) return;
    const from = this.room.id;
    this.pendingTransition = null;
    this.loadRoom(t.toRoomId, t.spawn, from);
  }

  /* ---------------------------------------------------------------------- */
  /* Objets                                                                 */
  /* ---------------------------------------------------------------------- */
  toggleLamp(): void {
    if (this.status !== 'playing' || this.player.hideId) return;
    if (!this.inv.has('lamp')) {
      this.toast('Vous n’avez pas de lampe.', 'bad');
      return;
    }
    if (!this.lampOn && this.lampCharge <= 0) {
      this.toast('La lampe est à plat. Utilisez une batterie.', 'bad');
      return;
    }
    this.lampOn = !this.lampOn;
    this.events.emit('sfx', { name: 'lamp' });
    this.events.emit('changed', {});
  }

  useItem(id: string): boolean {
    if (this.status !== 'playing' || !this.inv.has(id)) return false;
    switch (id) {
      case 'battery':
        if (!this.inv.has('lamp')) {
          this.toast('Il vous faut une lampe pour utiliser une batterie.', 'bad');
          return false;
        }
        if (this.lampCharge >= LAMP_MAX - 1) {
          this.toast('La lampe est déjà pleine.', 'info');
          return false;
        }
        this.inv.remove('battery');
        this.lampCharge = Math.min(LAMP_MAX, this.lampCharge + LAMP_BATTERY);
        this.toast('Lampe rechargée.', 'good');
        this.events.emit('sfx', { name: 'battery' });
        break;
      case 'glassToken':
        return this.throwToken();
      case 'chalk':
        return this.chalkMark();
      case 'lamp':
        this.toggleLamp();
        return true;
      case 'map':
        this.events.emit('read', { title: 'Carte partielle', lines: this.mapLines() });
        return true;
      default:
        return false;
    }
    this.markDirty();
    this.events.emit('changed', {});
    return true;
  }

  private throwToken(): boolean {
    if (this.player.hideId) {
      this.toast('Impossible de lancer depuis une cachette.', 'bad');
      return false;
    }
    const dirVec: Record<Dir, Vec2> = {
      DR: { x: 0.7071, y: 0.7071 },
      DL: { x: -0.7071, y: 0.7071 },
      UR: { x: 0.7071, y: -0.7071 },
      UL: { x: -0.7071, y: -0.7071 },
    };
    // Direction de lancer : sens du dernier mouvement, converti en axes monde.
    const v = this.player.vel;
    const len = Math.hypot(v.x, v.y);
    const d = len > 0.1 ? { x: v.x / len, y: v.y / len } : dirVec[this.player.dir];
    let end = { ...this.player.pos };
    for (let i = 1; i <= 24; i++) {
      const nx = this.player.pos.x + d.x * 0.25 * i;
      const ny = this.player.pos.y + d.y * 0.25 * i;
      if (nx < 0.3 || ny < 0.3 || nx > this.room.w - 0.3 || ny > this.room.h - 0.3) break;
      if (this.blockers.some((b) => nx > b.x && nx < b.x + b.w && ny > b.y && ny < b.y + b.h)) break;
      end = { x: nx, y: ny };
    }
    this.inv.remove('glassToken');
    this.addNoise(end, 7.5, 'throw', 1.4);
    this.events.emit('throwToken', { from: { ...this.player.pos }, to: end });
    this.events.emit('sfx', { name: 'glass', x: end.x, y: end.y });
    this.toast('Le jeton se brise au loin : un tintement résonne.', 'info');
    this.events.emit('changed', {});
    return true;
  }

  private chalkMark(): boolean {
    if (this.roomState.marks.length >= 6) {
      this.toast('Assez de marques dans cette pièce.', 'info');
      return false;
    }
    const m = { x: Math.round(this.player.pos.x * 10) / 10, y: Math.round(this.player.pos.y * 10) / 10 };
    this.roomState.marks.push(m);
    this.events.emit('mark', m);
    this.events.emit('sfx', { name: 'chalk' });
    this.toast('Vous tracez une marque lumineuse au sol.', 'good');
    this.markDirty();
    return true;
  }

  mapLines(): string[] {
    const lines: string[] = [];
    const total = this.plan.rooms.length;
    lines.push(`Vous êtes ici : ${this.room.name}.`);
    const cur = Math.max(0, this.roomIndex);
    for (let i = 0; i < total; i++) {
      const r = this.plan.rooms[i] as RoomDef;
      const visited = this.visited.has(r.id);
      const mark = i === cur ? '►' : visited ? '■' : i === cur + 1 ? '?' : '□';
      lines.push(`${mark} Porte ${String(i).padStart(3, '0')} — ${visited ? r.name : i === cur + 1 ? 'prochaine porte' : '???'}`);
    }
    return lines;
  }

  /* ---------------------------------------------------------------------- */
  /* Fins                                                                   */
  /* ---------------------------------------------------------------------- */
  endingOptions(): Array<{ id: EndingId; title: string; requirement: string; available: boolean }> {
    return ENDINGS.map((e) => ({
      id: e.id,
      title: e.title,
      requirement: e.requirement,
      available: this.endingAvailable(e.id),
    }));
  }

  endingAvailable(id: EndingId): boolean {
    switch (id) {
      case 'exit':
        return true;
      case 'return':
        return this.inv.has('stoppedWatch');
      case 'guardian':
        return this.inv.has('badge');
      case 'invisible':
        return this.inv.has('chalk') && this.inv.memoryCount() >= 4;
    }
  }

  chooseEnding(id: EndingId): boolean {
    if (!this.endingAvailable(id)) return false;
    this.status = 'ended';
    this.events.emit('ending', { id });
    return true;
  }

  /* ---------------------------------------------------------------------- */
  /* Défaite / reprise                                                      */
  /* ---------------------------------------------------------------------- */
  private defeat(by: string): void {
    this.status = 'defeated';
    this.lampOn = false;
    this.events.emit('sfx', { name: 'defeat' });
    this.events.emit('defeat', { by, text: DEFEAT_TEXT[by] ?? 'Vous avez été attrapé.' });
  }

  respawnAtCheckpoint(): void {
    const cp = this.checkpoint;
    this.inv.load(cp.inventory);
    this.lampCharge = cp.lampCharge;
    this.roomStates = cloneRoomStates(cp.roomStates);
    this.visited = new Set(cp.visited);
    this.lampOn = false;
    const room = findRoom(this.plan, cp.roomId);
    if (!room) throw new Error(`Point de contrôle invalide : ${cp.roomId}`);
    this.status = 'playing';
    this.loadRoom(room.id, room.spawn, null);
  }

  /* ---------------------------------------------------------------------- */
  /* Utilitaires                                                            */
  /* ---------------------------------------------------------------------- */
  private toast(text: string, tone: 'info' | 'good' | 'bad'): void {
    this.events.emit('toast', { text, tone });
  }

  get currentDoorNumber(): string {
    return `Porte ${String(Math.max(0, this.roomIndex)).padStart(3, '0')}`;
  }

  get objective(): string {
    return this.room.objective;
  }

  /** Centre de la cachette occupée, pour l'affichage. */
  get hiding(): boolean {
    return this.player.hideId !== null;
  }

  throwNoise(pos: Vec2, radius: number): void {
    this.addNoise(pos, radius, 'object', 1);
  }
}
