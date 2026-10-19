import type { Vec2 } from '../../core/types';
import { EntityBase, loudestHeard, seesPlayer } from './base';
import type { EntityContext } from './types';

const SPEEDS = {
  easy: { patrol: 0.9, chase: 2.2, range: 5.5 },
  normal: { patrol: 1.0, chase: 2.6, range: 6.0 },
  hard: { patrol: 1.1, chase: 3.0, range: 6.5 },
} as const;

/**
 * Le Concierge : patrouille, réagit au bruit, voit dans un cône, poursuit, puis fouille.
 * Il n'inspecte que les cachettes « inspectables », et seulement celles où il a vu entrer le joueur
 * ou qui sont proches de la dernière position connue.
 */
export class Concierge extends EntityBase {
  private waypoints: Vec2[];
  private wp = 0;
  private waitLeft = 0;
  private target: Vec2 | null = null;
  private path: Vec2[] = [];
  private pathAge = 0;
  private pathTarget: Vec2 = { x: 0, y: 0 };
  private lastSeen: Vec2 | null = null;
  private lostTimer = 0;
  private suspectSpot: string | null = null;
  private inspectId: string | null = null;
  private prevHideId: string | null = null;
  private alerted = false;

  constructor(
    id: string,
    pos: Vec2,
    patrol: Vec2[] | undefined,
    private readonly grace = 3,
  ) {
    super(id, 'concierge', pos, 'idle');
    this.waypoints = patrol && patrol.length > 0 ? patrol.map((p) => ({ ...p })) : [{ ...pos }];
  }

  update(dt: number, ctx: EntityContext): void {
    this.tick(dt);
    const cfg = SPEEDS[ctx.difficulty];
    const p = ctx.player;
    this.threatening = this.state === 'chase' || this.state === 'search' || this.state === 'inspect';

    if (this.state === 'idle') {
      this.cue(ctx, 'audio', 'concierge_steps', 'Des pas lents résonnent derrière la porte de la loge.', 30);
      if (this.clock >= this.grace) this.setState('patrol');
      this.prevHideId = p.hideId;
      return;
    }

    const sees = seesPlayer(this.pos, this.facing, cfg.range, (Math.PI * 100) / 180, ctx);

    if (sees) {
      this.lastSeen = { ...p.pos };
      this.lostTimer = 0;
      this.suspectSpot = null;
      if (this.state !== 'chase') {
        this.cue(ctx, 'audio', 'concierge_alert', 'Le Concierge vous a repéré !', 2);
        this.setState('chase');
        this.path = [];
      }
    } else if (this.state === 'patrol' || this.state === 'investigate' || this.state === 'return') {
      const heard = loudestHeard(this.pos, ctx);
      if (heard) {
        if (this.state !== 'investigate') {
          this.cue(ctx, 'audio', 'concierge_hears', 'Le Concierge a entendu quelque chose.', 3);
        }
        this.target = { ...heard.pos };
        this.waitLeft = 0;
        this.setState('investigate');
        this.path = [];
      }
    }

    // Le joueur vient de se cacher alors qu'il était poursuivi : on retient la cachette.
    if (this.state === 'chase' && !sees && p.hideId && !this.prevHideId && this.lostTimer < 1.2) {
      this.suspectSpot = p.hideId;
    }
    this.prevHideId = p.hideId;

    switch (this.state) {
      case 'patrol':
        this.doPatrol(dt, cfg.patrol, ctx);
        break;
      case 'return':
        this.doReturn(dt, cfg.patrol, ctx);
        break;
      case 'investigate':
        this.doInvestigate(dt, cfg.patrol * 1.5, ctx);
        break;
      case 'chase':
        this.doChase(dt, cfg.chase, ctx, sees);
        break;
      case 'search':
        this.doSearch(dt, cfg.patrol * 1.6, ctx);
        break;
      case 'inspect':
        this.doInspect(dt, cfg.patrol * 1.6, ctx);
        break;
      default:
        break;
    }
  }

  private doPatrol(dt: number, speed: number, ctx: EntityContext): void {
    if (this.waitLeft > 0) {
      this.waitLeft -= dt;
      this.facing += dt * 0.6;
      return;
    }
    const goal = this.waypoints[this.wp] as Vec2;
    if (this.moveToward(dt, speed, goal, ctx)) {
      this.wp = (this.wp + 1) % this.waypoints.length;
      this.waitLeft = 1.2;
    }
  }

  private doReturn(dt: number, speed: number, ctx: EntityContext): void {
    const goal = this.waypoints[this.wp] as Vec2;
    if (this.moveToward(dt, speed, goal, ctx)) this.setState('patrol');
  }

  private doInvestigate(dt: number, speed: number, ctx: EntityContext): void {
    if (!this.target) {
      this.setState('return');
      return;
    }
    if (this.waitLeft > 0) {
      this.waitLeft -= dt;
      this.facing += dt * 1.4;
      if (this.waitLeft <= 0) {
        this.target = null;
        this.setState('return');
      }
      return;
    }
    if (this.moveToward(dt, speed, this.target, ctx)) this.waitLeft = 2;
  }

  private doChase(dt: number, speed: number, ctx: EntityContext, sees: boolean): void {
    const p = ctx.player;
    if (sees) {
      this.moveToward(dt, speed, p.pos, ctx);
      if (this.distTo(p.pos) < 0.55 && !p.hide) {
        this.caught = true;
        this.cue(ctx, 'audio', 'concierge_catch', 'Le Concierge vous attrape.', 1);
      }
      return;
    }
    this.lostTimer += dt;
    if (this.lastSeen) this.moveToward(dt, speed, this.lastSeen, ctx);
    if (this.lostTimer > 2.2) this.setState('search');
  }

  private doSearch(dt: number, speed: number, ctx: EntityContext): void {
    const spot = this.pickSpot(ctx);
    if (this.lastSeen && this.distTo(this.lastSeen) > 0.8 && this.stateTime < 6) {
      this.moveToward(dt, speed, this.lastSeen, ctx);
      return;
    }
    if (spot && spot.props.inspectable) {
      this.inspectId = spot.id;
      this.setState('inspect');
      return;
    }
    if (this.stateTime > 4) {
      this.lastSeen = null;
      this.suspectSpot = null;
      this.setState('return');
    }
  }

  private doInspect(dt: number, speed: number, ctx: EntityContext): void {
    const spot = ctx.room.hideSpots.find((s) => s.id === this.inspectId);
    if (!spot) {
      this.setState('return');
      return;
    }
    if (this.distTo(spot.pos) > 1.0 && this.stateTime < 6) {
      this.moveToward(dt, speed, spot.pos, ctx);
      return;
    }
    this.faceToward(spot.pos);
    this.cue(ctx, 'audio', 'concierge_inspect', 'Une porte grince : il fouille une cachette.', 2);
    if (this.stateTime > 1.6) {
      if (ctx.player.hideId === spot.id) {
        this.caught = true;
        return;
      }
      this.inspectId = null;
      this.suspectSpot = null;
      this.lastSeen = null;
      this.setState('return');
    }
  }

  private pickSpot(ctx: EntityContext): { id: string; pos: Vec2; props: { inspectable: boolean } } | null {
    if (this.suspectSpot) {
      const s = ctx.room.hideSpots.find((h) => h.id === this.suspectSpot);
      if (s) return s;
    }
    if (!this.lastSeen) return null;
    let best: { id: string; pos: Vec2; props: { inspectable: boolean } } | null = null;
    let bestD = 2.5;
    for (const s of ctx.room.hideSpots) {
      const d = Math.hypot(s.pos.x - this.lastSeen.x, s.pos.y - this.lastSeen.y);
      if (d < bestD) {
        best = s;
        bestD = d;
      }
    }
    return best;
  }

  /** Suit un chemin vers `goal`. Retourne true à l'arrivée. */
  private moveToward(dt: number, speed: number, goal: Vec2, ctx: EntityContext): boolean {
    this.pathAge += dt;
    const goalMoved = Math.hypot(goal.x - this.pathTarget.x, goal.y - this.pathTarget.y) > 0.8;
    if (this.path.length === 0 || goalMoved || this.pathAge > 0.7) {
      const found = ctx.room.nav.findPath(this.pos, goal);
      this.path = found ?? [];
      this.pathTarget = { ...goal };
      this.pathAge = 0;
    }
    const direct = Math.hypot(goal.x - this.pos.x, goal.y - this.pos.y);
    const next = this.path[0];
    const dest = next && direct > 0.9 ? next : goal;
    const dx = dest.x - this.pos.x;
    const dy = dest.y - this.pos.y;
    const d = Math.hypot(dx, dy);
    if (d > 0.01) this.facing = Math.atan2(dy, dx);
    const step = speed * dt;
    if (d <= step) {
      this.pos = { x: dest.x, y: dest.y };
      if (next && dest === next) this.path.shift();
    } else {
      this.pos = { x: this.pos.x + (dx / d) * step, y: this.pos.y + (dy / d) * step };
    }
    return Math.hypot(goal.x - this.pos.x, goal.y - this.pos.y) < 0.35;
  }

  get hasAlerted(): boolean {
    return this.alerted;
  }
}
