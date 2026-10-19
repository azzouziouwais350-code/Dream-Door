import Phaser from 'phaser';
import { TILE_H, TILE_W, WALL_H, dirFromWorldVelocity, toScreen } from '../core/iso';
import { PAL } from '../core/palette';
import type { Dir, DoorDef, FurnitureDef, RoomDef, Surface, Vec2 } from '../core/types';
import type { World } from '../game/world';
import { type DoorVisual, drawDoorTexture, floorKey, wallKey } from '../gfx/environment';
import { FIGURES, FIG_FOOT, figureFrame, type Pose } from '../gfx/characters';
import { generateFurnitureTexture, generateWallDecor, wallDecorKey } from '../gfx/furniture';
import { getItemDef } from '../data/items';
import { doorPointOf, furnitureAnchor, furnitureRect } from '../systems/roomgeom';
import { Concierge, FalseThreshold, type Entity } from '../systems/entities';
import { AnomalyPuzzle, SwitchPuzzle, VALVE_RING, ValvePuzzle } from '../systems/puzzles';
import { Lighting, type LightSpot } from './lighting';

export interface SceneHooks {
  footstep(surface: Surface, running: boolean, crouched: boolean): void;
  frame(world: World, dt: number): void;
}

export interface SceneOptions {
  demo: boolean;
  reduceMotion: boolean;
  highContrast: boolean;
}

const DEPTH = {
  floor: -1_000_000,
  wall: -500_000,
  decor: -490_000,
  door: -495_000,
  water: -420_000,
  rug: -400_000,
  floorFx: -390_000,
  shadow: -350_000,
  cone: -340_000,
  top: 1_000_000,
};


function pad3(n: number): string {
  return String(n).padStart(3, '0');
}

/** Scène de jeu : traduit l'état d'un `World` (logique pure) en sprites isométriques. */
export class GameScene extends Phaser.Scene {
  hooks: SceneHooks = { footstep: () => undefined, frame: () => undefined };
  options: SceneOptions = { demo: false, reduceMotion: false, highContrast: false };
  paused = false;

  private world: World | null = null;
  private lighting!: Lighting;
  private zoomLevel = 3;
  private roomObjs: Phaser.GameObjects.GameObject[] = [];
  private dynObjs: Phaser.GameObjects.GameObject[] = [];
  private sig = '';
  private unsub: Array<() => void> = [];
  private playerSprite!: Phaser.GameObjects.Image;
  private playerShadow!: Phaser.GameObjects.Image;
  private eyes!: Phaser.GameObjects.Image;
  private chev!: Phaser.GameObjects.Image;
  private npcSprite: Phaser.GameObjects.Image | null = null;
  private npcShadow: Phaser.GameObjects.Image | null = null;
  private entSprites = new Map<string, { img: Phaser.GameObjects.Image; shadow: Phaser.GameObjects.Image; last: Vec2 }>();
  private cone!: Phaser.GameObjects.Graphics;
  private waterGfx!: Phaser.GameObjects.Graphics;
  private dust: Array<{ img: Phaser.GameObjects.Image; vx: number; vy: number; ph: number }> = [];
  private seamSprites = new Map<string, Phaser.GameObjects.Image>();
  private clock = 0;
  private stepClock = 0;
  private camCenter = { x: 0, y: 0 };
  private camInit = false;
  private fading = false;
  private lastPlayerPos: Vec2 = { x: 0, y: 0 };
  private furnSprites = new Map<string, Phaser.GameObjects.Image>();
  private furnRects: Array<{ id: string; x0: number; y0: number; x1: number; y1: number; depth: number }> = [];
  private lightSources: Array<{ x: number; y: number; r: number; s: number }> = [];
  private demoSpin = 0;

  constructor() {
    super('Game');
  }

  /* ---------------------------------------------------------------------- */
  create(): void {
    this.cameras.main.setBackgroundColor(0x11111f);
    const parent = this.game.canvas.parentElement ?? document.body;
    this.lighting = new Lighting(parent);
    this.lighting.canvas.style.zIndex = '1';
    this.lighting.setVisible(false);

    this.playerShadow = this.add.image(0, 0, 'shadow_blob').setOrigin(0.5, 0.5).setVisible(false);
    this.playerSprite = this.add.image(0, 0, 'fig_player_idle_F_0').setOrigin(FIG_FOOT.x / 28, FIG_FOOT.y / 40).setVisible(false);
    this.eyes = this.add.image(0, 0, 'eyes').setVisible(false);
    this.chev = this.add.image(0, 0, 'chev').setVisible(false).setDepth(DEPTH.top);
    this.cone = this.add.graphics().setDepth(DEPTH.cone);
    this.waterGfx = this.add.graphics().setDepth(DEPTH.water);
    for (let i = 0; i < 26; i++) {
      const img = this.add.image(0, 0, 'dust').setDepth(DEPTH.top - 10).setAlpha(0).setVisible(false);
      this.dust.push({ img, vx: (Math.random() - 0.5) * 3, vy: -1 - Math.random() * 2, ph: Math.random() * 6 });
    }

    this.scale.on('resize', this.layout, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.teardown());
    this.layout();
  }

  private teardown(): void {
    this.unsubscribe();
    this.scale.off('resize', this.layout, this);
    this.lighting.destroy();
  }

  private unsubscribe(): void {
    for (const u of this.unsub) u();
    this.unsub = [];
  }

  /* ---------------------------------------------------------------------- */
  /* Liaison avec le monde                                                  */
  /* ---------------------------------------------------------------------- */
  attach(world: World | null, opts: SceneOptions): void {
    this.options = opts;
    this.unsubscribe();
    this.world = world;
    this.clearRoom();
    this.camInit = false;
    this.fading = false;
    this.cameras.main.resetFX();
    this.cameras.main.setAlpha(1);
    this.lighting.setVisible(world !== null);
    if (!world) {
      for (const o of [this.playerSprite, this.playerShadow, this.eyes, this.chev]) o.setVisible(false);
      return;
    }
    this.unsub.push(
      world.events.on('roomLoaded', () => {
        this.buildRoom();
        this.fadeIn();
      }),
      world.events.on('transition', () => this.fadeOutThenCommit()),
      world.events.on('throwToken', (e) => this.animateThrow(e.from, e.to)),
      world.events.on('mark', () => (this.sig = '')),
      world.events.on('changed', () => (this.sig = '')),
    );
    this.buildRoom();
    this.stepClock = 0;
  }

  setOptions(opts: Partial<SceneOptions>): void {
    this.options = { ...this.options, ...opts };
  }

  private fadeOutThenCommit(): void {
    const w = this.world;
    if (!w) return;
    const cam = this.cameras.main;
    const d = this.options.reduceMotion ? 150 : 380;
    this.fading = true;
    cam.fadeOut(d, 17, 17, 31);
    cam.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      if (this.world === w) w.commitTransition();
    });
  }

  private fadeIn(): void {
    if (!this.fading) return;
    this.fading = false;
    this.cameras.main.fadeIn(this.options.reduceMotion ? 150 : 420, 17, 17, 31);
  }

  private animateThrow(from: Vec2, to: Vec2): void {
    const a = toScreen(from.x, from.y);
    const b = toScreen(to.x, to.y);
    const img = this.add.image(a.x, a.y - 10, 'item_token').setDepth(DEPTH.top - 5);
    const arc = { t: 0 };
    this.tweens.add({
      targets: arc,
      t: 1,
      duration: this.options.reduceMotion ? 120 : 420,
      ease: 'Sine.easeInOut',
      onUpdate: () => {
        img.x = a.x + (b.x - a.x) * arc.t;
        img.y = a.y + (b.y - a.y) * arc.t - 10 - Math.sin(arc.t * Math.PI) * 22;
      },
      onComplete: () => img.destroy(),
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Disposition                                                            */
  /* ---------------------------------------------------------------------- */
  private layout(): void {
    const w = this.scale.width;
    const h = this.scale.height;
    this.lighting.resize(w, h);
    this.zoomLevel = Math.max(2, Math.min(5, Math.floor(Math.min(h / 230, w / 190))));
    this.cameras.main.setZoom(this.zoomLevel);
    this.cameras.main.setSize(w, h);
  }

  /* ---------------------------------------------------------------------- */
  /* Construction d'une salle                                               */
  /* ---------------------------------------------------------------------- */
  private clearRoom(): void {
    for (const o of this.roomObjs) o.destroy();
    for (const o of this.dynObjs) o.destroy();
    this.roomObjs = [];
    this.dynObjs = [];
    this.furnSprites.clear();
    this.furnRects = [];
    this.seamSprites.clear();
    this.sig = '';
    for (const e of this.entSprites.values()) {
      e.img.destroy();
      e.shadow.destroy();
    }
    this.entSprites.clear();
    this.npcSprite?.destroy();
    this.npcShadow?.destroy();
    this.npcSprite = null;
    this.npcShadow = null;
    this.waterGfx.clear();
    this.cone.clear();
  }

  private add2<T extends Phaser.GameObjects.GameObject>(o: T, dyn = false): T {
    (dyn ? this.dynObjs : this.roomObjs).push(o);
    return o;
  }

  private buildRoom(): void {
    const w = this.world;
    if (!w) return;
    this.clearRoom();
    const room = w.room;

    // Sol.
    for (let y = 0; y < room.h; y++) {
      for (let x = 0; x < room.w; x++) {
        const p = toScreen(x, y);
        this.add2(this.add.image(p.x - TILE_W / 2, p.y, floorKey(room.floor, (x + y) % 2)).setOrigin(0, 0).setDepth(DEPTH.floor));
      }
    }
    // Eau.
    if (room.water) {
      const r = room.water;
      const pts = [toScreen(r.x, r.y), toScreen(r.x + r.w, r.y), toScreen(r.x + r.w, r.y + r.h), toScreen(r.x, r.y + r.h)];
      this.waterGfx.fillStyle(PAL.water, 0.5);
      this.waterGfx.fillPoints(pts, true);
      this.waterGfx.lineStyle(1, 0xd9efe9, 0.6);
      this.waterGfx.strokePoints(pts, true);
    }
    this.buildWalls(room);
    this.sig = '';
    this.refreshDynamic();
    this.createEntitySprites();
    this.camInit = false;
  }

  private doorVisible(d: DoorDef): boolean {
    const w = this.world as World;
    return !d.hidden || w.roomState.revealed.includes(d.id);
  }

  private buildWalls(room: RoomDef): void {
    const w = this.world as World;
    const doorTiles = new Set<string>();
    for (const d of room.doors) {
      if (!this.doorVisible(d)) continue;
      doorTiles.add(`${d.wall}${d.at}`);
      doorTiles.add(`${d.wall}${d.at + 1}`);
    }
    void w;
    for (let x = 0; x < room.w; x++) {
      if (doorTiles.has(`N${x}`)) continue;
      const p = toScreen(x, 0);
      this.add2(this.add.image(p.x, p.y - WALL_H, wallKey(room.wall, 'N', x % 4)).setOrigin(0, 0).setDepth(DEPTH.wall));
    }
    for (let y = 0; y < room.h; y++) {
      if (doorTiles.has(`W${y}`)) continue;
      const p = toScreen(0, y + 1);
      const q = toScreen(0, y);
      this.add2(this.add.image(p.x, q.y - WALL_H, wallKey(room.wall, 'W', y % 4)).setOrigin(0, 0).setDepth(DEPTH.wall));
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Éléments dépendant de l'état (meubles, portes, objets)                 */
  /* ---------------------------------------------------------------------- */
  private signature(w: World): string {
    const rs = w.roomState;
    let pz = '';
    for (const p of w.puzzles.values()) {
      if (p instanceof SwitchPuzzle) pz += p.state.map((b) => (b ? 1 : 0)).join('');
      else if (p instanceof ValvePuzzle) pz += `v${p.level}`;
      pz += p.solved ? 's' : 'u';
    }
    return `${w.room.id}|${rs.searched.length}|${rs.taken.join(',')}|${rs.moved.join(',')}|${rs.revealed.join(',')}|${rs.unlocked.join(',')}|${rs.marks.length}|${rs.solved.join(',')}|${pz}|${w.inv.has('lamp') ? 1 : 0}`;
  }

  private refreshDynamic(): void {
    const w = this.world;
    if (!w) return;
    for (const o of this.dynObjs) o.destroy();
    this.dynObjs = [];
    this.furnSprites.clear();
    this.furnRects = [];
    this.seamSprites.clear();
    this.lightSources = [];
    const room = w.room;
    const moved = new Set(w.roomState.moved);

    // Portes.
    for (const d of room.doors) {
      if (!this.doorVisible(d)) continue;
      const visual = this.doorVisual(w, d);
      const label = this.doorLabel(w, d);
      const key = `door_${room.id}_${d.id}_${visual}_${label}`;
      if (!this.textures.exists(key)) drawDoorTexture(this.textures, key, { side: d.wall, label, visual, style: room.wall });
      const origin =
        d.wall === 'N' ? { x: toScreen(d.at, 0).x, y: toScreen(d.at, 0).y - WALL_H } : { x: toScreen(0, d.at + 2).x, y: toScreen(0, d.at).y - WALL_H };
      this.add2(this.add.image(origin.x, origin.y, key).setOrigin(0, 0).setDepth(DEPTH.door), true);
      if (d.role === 'false' && w.entities.some((e) => e instanceof FalseThreshold && e.revealed)) {
        const base = d.wall === 'N' ? { x: toScreen(d.at, 0).x + 0, y: toScreen(d.at, 0).y + 14 } : { x: toScreen(0, d.at + 2).x, y: toScreen(0, d.at).y + 14 };
        const seam = this.add.image(base.x, base.y, 'door_seam').setOrigin(0, 0).setDepth(DEPTH.floorFx);
        this.add2(seam, true);
      }
    }

    // Meubles.
    for (const f of room.furniture) {
      const isMoved = moved.has(f.id);
      if (f.wall) this.placeWallDecor(w, f);
      else this.placeFurniture(w, f, isMoved);
      if (f.kind === 'floorlamp') {
        const a = furnitureAnchor(f, isMoved);
        this.lightSources.push({ x: a.x, y: a.y, r: 3.4, s: 0.85 });
      }
      if (f.kind === 'window') {
        const a = furnitureAnchor(f);
        this.lightSources.push({ x: a.x, y: a.y, r: 2.6, s: 0.5 });
      }
    }

    // Objets au sol.
    for (const it of room.floorItems ?? []) {
      if (w.roomState.taken.includes(it.id)) continue;
      const icon = getItemDef(it.item.id).icon;
      const p = toScreen(it.x, it.y);
      this.add2(this.add.image(p.x, p.y + 2, 'shadow_blob').setScale(0.5).setDepth(DEPTH.floorFx), true);
      this.add2(this.add.image(p.x, p.y - 2, `item_${icon}`).setOrigin(0.5, 1).setDepth((it.x + it.y) * 10 - 4), true);
      this.lightSources.push({ x: it.x, y: it.y, r: 0.9, s: 0.25 });
    }

    // Marques de craie.
    for (const m of w.roomState.marks) {
      const p = toScreen(m.x, m.y);
      this.add2(this.add.image(p.x, p.y, 'mark').setDepth(DEPTH.floorFx), true);
      this.lightSources.push({ x: m.x, y: m.y, r: 1.1, s: 0.45 });
    }

    for (const z of room.safeZones ?? []) this.lightSources.push({ x: z.x, y: z.y, r: z.r + 0.8, s: 0.7 });
    this.sig = this.signature(w);
  }

  private doorVisual(w: World, d: DoorDef): DoorVisual {
    const lock = d.lock ?? { type: 'none' as const };
    if (d.role === 'secret') return 'secret';
    if (d.returns) return 'return';
    if (d.role === 'entry' || lock.type === 'sealed') return 'sealed';
    if (d.role === 'false') return 'false';
    const unlocked = w.roomState.unlocked.includes(d.id);
    if (unlocked) return 'ready';
    switch (lock.type) {
      case 'none':
      case 'ending':
        return 'ready';
      case 'puzzle':
        return w.roomState.solved.includes(lock.puzzleId) ? 'ready' : 'locked';
      default:
        return 'locked';
    }
  }

  private doorLabel(w: World, d: DoorDef): string {
    if (d.role === 'secret' || d.returns) return '';
    if (d.role === 'entry') return pad3(Math.max(0, w.roomIndex));
    if (d.role === 'false') return `0I${(Math.max(0, w.roomIndex) + 1) % 10}`;
    if (d.id === 'out') return pad3(w.roomIndex + 1);
    return '';
  }

  private placeFurniture(w: World, f: FurnitureDef, moved: boolean): void {
    const rect = furnitureRect(f, moved);
    const spr = generateFurnitureTexture(this.textures, f.kind, f.w, f.h);
    const s = toScreen(rect.x, rect.y);
    const depth = spr.flat ? DEPTH.rug : (rect.x + rect.w + rect.y + rect.h) * 10;
    const img = this.add.image(s.x - f.h * (TILE_W / 2), s.y - spr.hp, spr.key).setOrigin(0, 0).setDepth(depth);
    this.add2(img, true);
    this.furnSprites.set(f.id, img);
    if (!spr.flat) this.furnRects.push({ id: f.id, x0: rect.x, y0: rect.y, x1: rect.x + rect.w, y1: rect.y + rect.h, depth });
    if (!spr.flat && f.hide === undefined) return;
    if (f.hide && w.player.hideId === f.id) img.setAlpha(1);
  }

  private placeWallDecor(w: World, f: FurnitureDef): void {
    const side = f.wall as 'N' | 'W';
    let variant = '';
    const opts: { switches?: boolean[]; needle?: number; anomalous?: boolean } = {};
    const pz = f.puzzleId ? w.puzzles.get(f.puzzleId) : undefined;
    if (f.kind === 'breaker' && pz instanceof SwitchPuzzle) {
      opts.switches = [...pz.state];
      variant = `_${pz.state.map((b) => (b ? 1 : 0)).join('')}`;
    } else if (f.kind === 'gauge' && pz instanceof ValvePuzzle) {
      opts.needle = pz.level / (VALVE_RING - 1);
      variant = `_${pz.level}`;
    } else if (f.kind === 'painting') {
      for (const p of w.puzzles.values()) {
        if (p instanceof AnomalyPuzzle && p.anomalous === f.id) {
          opts.anomalous = true;
          variant = '_a';
        }
      }
    }
    const key = this.textures.exists(wallDecorKey(f.kind, side, variant)) ? wallDecorKey(f.kind, side, variant) : generateWallDecor(this.textures, f.kind, side, opts, variant);
    const idx = side === 'N' ? f.x : f.x;
    const o =
      side === 'N' ? { x: toScreen(idx, 0).x, y: toScreen(idx, 0).y - WALL_H } : { x: toScreen(0, idx + 1).x, y: toScreen(0, idx).y - WALL_H };
    this.add2(this.add.image(o.x, o.y, key).setOrigin(0, 0).setDepth(DEPTH.decor), true);
  }

  /* ---------------------------------------------------------------------- */
  /* Acteurs                                                                */
  /* ---------------------------------------------------------------------- */
  private createEntitySprites(): void {
    const w = this.world;
    if (!w) return;
    for (const e of w.entities) {
      const shadow = this.add.image(0, 0, 'shadow_blob').setVisible(false);
      const img = this.add.image(0, 0, 'ent_shadow_0').setVisible(false);
      this.entSprites.set(e.id, { img, shadow, last: { ...e.pos } });
    }
    const npc = w.room.npc;
    if (npc && FIGURES[npc.id]) {
      this.npcShadow = this.add.image(0, 0, 'shadow_blob');
      this.npcSprite = this.add.image(0, 0, 'fig_player_idle_F_0').setOrigin(FIG_FOOT.x / 28, FIG_FOOT.y / 40);
    }
  }

  /** Profondeur d'un acteur : ordre isométrique correct par rapport aux meubles à empreinte étendue. */
  private actorDepth(p: Vec2): number {
    let d = (p.x + p.y) * 10;
    let lo = -Infinity;
    let hi = Infinity;
    for (const r of this.furnRects) {
      const front = p.x >= r.x1 - 0.02 || p.y >= r.y1 - 0.02;
      const behind = p.x <= r.x0 + 0.02 || p.y <= r.y0 + 0.02;
      if (front && !behind) lo = Math.max(lo, r.depth + 0.1);
      else if (behind && !front) hi = Math.min(hi, r.depth - 0.1);
      else if (front && behind) {
        // Coin : on se fie à la somme.
        if (d > r.depth) lo = Math.max(lo, r.depth + 0.1);
        else hi = Math.min(hi, r.depth - 0.1);
      }
    }
    if (d < lo) d = lo;
    if (d > hi) d = Math.max(hi, lo);
    return d;
  }

  private placeFigure(img: Phaser.GameObjects.Image, shadow: Phaser.GameObjects.Image, id: string, pose: Pose, dir: Dir, frame: number, pos: Vec2, alpha = 1): void {
    const f = figureFrame(id, pose, dir, frame);
    const s = toScreen(pos.x, pos.y);
    img.setTexture(f.key).setFlipX(f.flip).setPosition(Math.round(s.x), Math.round(s.y)).setDepth(this.actorDepth(pos)).setAlpha(alpha).setVisible(true);
    shadow.setPosition(Math.round(s.x), Math.round(s.y) - 1).setDepth(DEPTH.shadow).setAlpha(alpha).setVisible(true);
  }

  private dirTo(from: Vec2, to: Vec2, fallback: Dir): Dir {
    return dirFromWorldVelocity(to.x - from.x, to.y - from.y, fallback);
  }

  /* ---------------------------------------------------------------------- */
  /* Boucle                                                                 */
  /* ---------------------------------------------------------------------- */
  override update(_time: number, deltaMs: number): void {
    const w = this.world;
    const dt = Math.min(0.1, deltaMs / 1000);
    if (!w) return;
    this.clock += dt;
    const demo = this.options.demo;

    if (!demo && !this.paused) {
      w.update(dt);
      this.updateFootsteps(w, dt);
    }
    const sig = this.signature(w);
    if (sig !== this.sig) {
      // La salle a pu changer d'identité ; le sol et les murs ne se reconstruisent qu'au rechargement.
      this.refreshDynamic();
    }

    this.updatePlayer(w, demo);
    this.updateNpc(w);
    this.updateEntities(w);
    this.updateChevron(w, demo);
    this.updateWater(w);
    this.updateCamera(w, dt, demo);
    this.updateDust(dt);
    this.renderLighting(w);
    this.hooks.frame(w, dt);
  }

  private updateFootsteps(w: World, dt: number): void {
    const p = w.player;
    const moving = p.moving && !p.hideId && w.status === 'playing' && !p.busy;
    if (!moving) {
      this.stepClock = 0.15;
      return;
    }
    this.stepClock -= dt;
    if (this.stepClock <= 0) {
      this.stepClock = p.running ? 0.27 : p.crouched ? 0.62 : 0.43;
      this.hooks.footstep(w.room.surface, p.running, p.crouched);
    }
  }

  private updatePlayer(w: World, demo: boolean): void {
    const p = w.player;
    if (demo) {
      this.playerSprite.setVisible(false);
      this.playerShadow.setVisible(false);
      this.eyes.setVisible(false);
      return;
    }
    if (p.hideId) {
      const f = w.room.furniture.find((x) => x.id === p.hideId);
      this.playerSprite.setVisible(false);
      this.playerShadow.setVisible(false);
      if (f) {
        const a = furnitureAnchor(f, w.roomState.moved.includes(f.id));
        const s = toScreen(a.x, a.y);
        this.eyes.setPosition(Math.round(s.x), Math.round(s.y) - 12).setDepth(this.actorDepth(a) + 1).setVisible(true);
      }
      return;
    }
    this.eyes.setVisible(false);
    let pose: Pose = 'idle';
    if (w.status === 'defeated') pose = 'hurt';
    else if (p.busy) pose = p.busy.kind === 'pickup' ? 'pickup' : 'interact';
    else if (p.crouched) pose = 'sneak';
    else if (p.moving) pose = p.running ? 'run' : 'walk';
    const frame = Math.floor(this.clock * (pose === 'run' ? 11 : pose === 'walk' || pose === 'sneak' ? 7 : 2.2));
    this.placeFigure(this.playerSprite, this.playerShadow, 'player', pose, p.dir, frame, p.pos);
    this.lastPlayerPos = { ...p.pos };
  }

  private updateNpc(w: World): void {
    const npc = w.room.npc;
    if (!npc || !this.npcSprite || !this.npcShadow) return;
    const dir = this.dirTo(npc, w.player.pos, 'DR');
    this.placeFigure(this.npcSprite, this.npcShadow, npc.id, 'idle', dir, Math.floor(this.clock * 1.6), { x: npc.x, y: npc.y });
  }

  private updateEntities(w: World): void {
    const g = this.cone;
    g.clear();
    for (const e of w.entities) {
      const sp = this.entSprites.get(e.id);
      if (!sp) continue;
      const show = e.visible && !e.gone && !(e instanceof FalseThreshold);
      if (!show) {
        sp.img.setVisible(false);
        sp.shadow.setVisible(false);
        sp.last = { ...e.pos };
        continue;
      }
      this.drawEntity(w, e, sp);
      sp.last = { ...e.pos };
    }
  }

  private drawEntity(w: World, e: Entity, sp: { img: Phaser.GameObjects.Image; shadow: Phaser.GameObjects.Image; last: Vec2 }): void {
    const pos = e.pos;
    const s = toScreen(pos.x, pos.y);
    switch (e.kind) {
      case 'concierge': {
        const moved = Math.hypot(pos.x - sp.last.x, pos.y - sp.last.y) > 0.002;
        const pose: Pose = e.state === 'chase' ? 'run' : moved ? 'walk' : 'idle';
        const dir = dirFromWorldVelocity(Math.cos(e.facing), Math.sin(e.facing), 'DR');
        this.placeFigure(sp.img, sp.shadow, 'concierge', pose, dir, Math.floor(this.clock * (pose === 'run' ? 11 : 6)), pos);
        if (e instanceof Concierge && e.state !== 'idle') this.drawCone(w, e);
        break;
      }
      case 'watcher': {
        const alpha = (e as unknown as { alpha?: number }).alpha ?? 1;
        const dir = this.dirTo(pos, w.player.pos, 'DR');
        this.placeFigure(sp.img, sp.shadow, 'watcher', 'idle', dir, 0, pos, alpha);
        sp.shadow.setAlpha(alpha * 0.4);
        break;
      }
      case 'ceilingShadow': {
        const n = Math.floor(this.clock * 3) % 2;
        const warn = e.state === 'warning' || e.state === 'strike';
        const pulse = this.options.reduceMotion ? 1 : 1 + 0.08 * Math.sin(this.clock * 9);
        sp.img
          .setTexture(`ent_shadow_${n}`)
          .setOrigin(0.5, 0.5)
          .setPosition(Math.round(s.x), Math.round(s.y))
          .setScale((warn ? 1.5 : 1) * pulse)
          .setDepth(DEPTH.shadow + 1)
          .setAlpha(e.state === 'retreat' ? 0.5 : 0.92)
          .setVisible(true);
        sp.shadow.setVisible(false);
        break;
      }
      case 'swimmer': {
        if (e.state === 'lunge') {
          sp.img.setTexture(`ent_hand_${Math.floor(this.clock * 6) % 2}`).setOrigin(0.5, 1).setPosition(Math.round(s.x), Math.round(s.y)).setScale(1).setDepth(this.actorDepth(pos)).setAlpha(1).setVisible(true);
        } else {
          sp.img.setTexture(`ent_swimmer_${Math.floor(this.clock * 2) % 3}`).setOrigin(0.5, 0.7).setPosition(Math.round(s.x), Math.round(s.y)).setScale(1).setDepth(DEPTH.water + 1).setAlpha(0.9).setVisible(true);
        }
        sp.shadow.setVisible(false);
        break;
      }
      default:
        sp.img.setVisible(false);
        sp.shadow.setVisible(false);
    }
  }

  private drawCone(w: World, e: Entity): void {
    const base = w.difficulty === 'easy' ? 5.5 : w.difficulty === 'hard' ? 6.5 : 6;
    let range = base;
    if (w.lampOn) range *= 1.3;
    if (w.player.crouched) range *= 0.7;
    const half = (Math.PI * 100) / 180 / 2;
    const g = this.cone;
    const chase = e.state === 'chase';
    const color = chase ? 0xf36b7a : 0xf3b5d8;
    const alpha = this.options.highContrast ? 0.34 : 0.2;
    const pts: Phaser.Types.Math.Vector2Like[] = [toScreen(e.pos.x, e.pos.y)];
    const steps = 14;
    for (let i = 0; i <= steps; i++) {
      const a = e.facing - half + (i / steps) * half * 2;
      let r = range;
      // Les murs de la salle coupent le cône (approximation raisonnable).
      const dx = Math.cos(a);
      const dy = Math.sin(a);
      const lim = (v: number, d: number, max: number): number => (d > 1e-6 ? (max - v) / d : d < -1e-6 ? (0.2 - v) / d : Infinity);
      r = Math.min(r, lim(e.pos.x, dx, w.room.w), lim(e.pos.y, dy, w.room.h));
      pts.push(toScreen(e.pos.x + dx * Math.max(0, r), e.pos.y + dy * Math.max(0, r)));
    }
    g.fillStyle(color, alpha);
    g.fillPoints(pts, true);
    g.lineStyle(1, color, Math.min(1, alpha * 2.2));
    g.strokePoints(pts, true);
  }

  private updateChevron(w: World, demo: boolean): void {
    const t = w.target;
    if (!t || demo || w.status !== 'playing') {
      this.chev.setVisible(false);
      return;
    }
    let p: Vec2 | null = null;
    let up = 20;
    if (t.kind === 'door') {
      const d = w.room.doors.find((x) => x.id === t.id);
      if (d) {
        p = doorPointOf(d);
        up = 44;
      }
    } else if (t.kind === 'furniture') {
      const f = w.room.furniture.find((x) => x.id === t.id);
      if (f) {
        p = furnitureAnchor(f, w.roomState.moved.includes(f.id));
        up = f.wall ? 40 : 34;
      }
    } else if (t.kind === 'item') {
      const it = w.room.floorItems?.find((x) => x.id === t.id);
      if (it) p = { x: it.x, y: it.y };
      up = 22;
    } else if (t.kind === 'npc' && w.room.npc) {
      p = { x: w.room.npc.x, y: w.room.npc.y };
      up = 48;
    }
    if (!p) {
      this.chev.setVisible(false);
      return;
    }
    const s = toScreen(p.x, p.y);
    const bob = this.options.reduceMotion ? 0 : Math.sin(this.clock * 5) * 1.5;
    this.chev.setPosition(Math.round(s.x), Math.round(s.y - up + bob)).setVisible(true);
  }

  private updateWater(w: World): void {
    if (!w.room.water || this.options.reduceMotion) return;
    const r = w.room.water;
    const g = this.waterGfx;
    g.clear();
    const pts = [toScreen(r.x, r.y), toScreen(r.x + r.w, r.y), toScreen(r.x + r.w, r.y + r.h), toScreen(r.x, r.y + r.h)];
    g.fillStyle(PAL.water, 0.46 + 0.05 * Math.sin(this.clock * 1.6));
    g.fillPoints(pts, true);
    g.lineStyle(1, 0xd9efe9, 0.55);
    g.strokePoints(pts, true);
    g.lineStyle(1, 0xffffff, 0.22);
    for (let i = 0; i < 4; i++) {
      const u = r.x + ((i * 0.31 + this.clock * 0.12) % 1) * r.w;
      const v = r.y + (((i * 0.53 + 0.2) + this.clock * 0.07) % 1) * r.h;
      const a = toScreen(u, v);
      g.lineBetween(a.x - 5, a.y, a.x + 5, a.y);
    }
  }

  private updateCamera(w: World, dt: number, demo: boolean): void {
    const cam = this.cameras.main;
    const room = w.room;
    const zoom = this.zoomLevel;
    const viewW = cam.width / zoom;
    const viewH = cam.height / zoom;
    const minX = -room.h * (TILE_W / 2) - 16;
    const maxX = room.w * (TILE_W / 2) + 16;
    const minY = -WALL_H - 14;
    const maxY = (room.w + room.h) * (TILE_H / 2) + 18;
    const roomCx = (minX + maxX) / 2;
    const roomCy = (minY + maxY) / 2;

    let tx: number;
    let ty: number;
    if (demo) {
      this.demoSpin += dt * 0.35;
      tx = roomCx + (this.options.reduceMotion ? 0 : Math.sin(this.demoSpin) * 14);
      ty = roomCy + 8;
    } else {
      const p = toScreen(w.player.pos.x, w.player.pos.y);
      tx = p.x;
      ty = p.y - 18;
    }
    const clampAxis = (v: number, lo: number, hi: number, view: number, center: number): number => (hi - lo <= view ? center : Math.max(lo + view / 2, Math.min(hi - view / 2, v)));
    tx = clampAxis(tx, minX, maxX, viewW, roomCx);
    ty = clampAxis(ty, minY, maxY, viewH, roomCy);

    if (!this.camInit) {
      this.camCenter = { x: tx, y: ty };
      this.camInit = true;
    } else {
      const k = this.options.reduceMotion ? 1 : 1 - Math.pow(0.001, dt);
      this.camCenter.x += (tx - this.camCenter.x) * k;
      this.camCenter.y += (ty - this.camCenter.y) * k;
    }
    // Alignement sur la grille de pixels écran pour garder des pixels nets.
    // (avec zoom Phaser, scroll = centre - largeur/2, indépendamment du zoom)
    const sx = Math.round(this.camCenter.x * zoom) / zoom - cam.width / 2;
    const sy = Math.round(this.camCenter.y * zoom) / zoom - cam.height / 2;
    cam.setScroll(sx, sy);
  }

  private updateDust(dt: number): void {
    const w = this.world;
    const show = Boolean(w) && !this.options.reduceMotion && !this.options.demo;
    const cam = this.cameras.main;
    const vw = cam.width / this.zoomLevel;
    const vh = cam.height / this.zoomLevel;
    const left = cam.scrollX + cam.width / 2 - vw / 2;
    const top = cam.scrollY + cam.height / 2 - vh / 2;
    for (const d of this.dust) {
      if (!show) {
        d.img.setVisible(false);
        continue;
      }
      d.ph += dt;
      if (!d.img.visible || d.img.alpha <= 0.01) {
        d.img.setPosition(left + Math.random() * vw, top + Math.random() * vh);
        d.img.setVisible(true);
        d.img.setAlpha(0.01);
      }
      d.img.x += d.vx * dt;
      d.img.y += d.vy * dt * 0.5;
      const a = 0.35 * Math.max(0, Math.sin(d.ph * 0.9));
      d.img.setAlpha(a);
      if (d.img.y < top - 4 || d.img.y > top + vh + 4) d.img.setAlpha(0);
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Éclairage                                                              */
  /* ---------------------------------------------------------------------- */
  private worldToCanvas(x: number, y: number): Vec2 {
    const cam = this.cameras.main;
    const s = toScreen(x, y);
    const z = this.zoomLevel;
    return { x: (s.x - (cam.scrollX + cam.width / 2)) * z + cam.width / 2, y: (s.y - (cam.scrollY + cam.height / 2)) * z + cam.height / 2 };
  }

  private renderLighting(w: World): void {
    const z = this.zoomLevel;
    const lights: LightSpot[] = [];
    const unit = (TILE_W / 2) * 1.35 * z;
    const spot = (x: number, y: number, r: number, s: number): void => {
      const c = this.worldToCanvas(x, y);
      lights.push({ x: c.x, y: c.y - 8 * z, rx: r * unit, squash: 0.58, strength: s });
    };
    for (const l of this.lightSources) spot(l.x, l.y, l.r, l.s);
    const demo = this.options.demo;
    if (!demo) {
      const p = w.player.pos;
      const hidden = Boolean(w.player.hideId);
      if (!hidden) {
        spot(p.x, p.y, w.lampOn ? 5.2 : 1.8, w.lampOn ? 1 : 0.55);
        if (w.lampOn) spot(p.x, p.y, 2.2, 1);
      }
      // Les entités lumineuses (concierge portant une lanterne) éclairent un peu leur voisinage.
      for (const e of w.entities) if (e.kind === 'concierge' && !e.gone && e.state !== 'idle') spot(e.pos.x, e.pos.y, 2.2, 0.5);
    }
    const dark = demo ? Math.min(0.55, w.room.light.dark) : w.room.light.dark;
    this.lighting.render({
      dark,
      tint: w.room.light.tint,
      flicker: demo ? 0 : w.flicker(),
      reduceMotion: this.options.reduceMotion,
      highContrast: this.options.highContrast,
      time: this.clock,
      lights,
      chased: !demo && w.isChased(),
      hidden: !demo && Boolean(w.player.hideId),
    });
  }

  /** Position écran du joueur (pixels CSS) — utile aux tests visuels. */
  playerCanvasPos(): Vec2 {
    return this.worldToCanvas(this.lastPlayerPos.x, this.lastPlayerPos.y);
  }
}
