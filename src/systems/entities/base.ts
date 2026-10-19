import type { EntityKind, Vec2 } from '../../core/types';
import { segmentBlocked } from '../collision';
import type { Entity, EntityContext } from './types';

export function wrapAngle(a: number): number {
  let x = a;
  while (x > Math.PI) x -= Math.PI * 2;
  while (x < -Math.PI) x += Math.PI * 2;
  return x;
}

export abstract class EntityBase implements Entity {
  pos: Vec2;
  facing = 0;
  state: string;
  caught = false;
  gone = false;
  visible = true;
  threatening = false;
  protected stateTime = 0;
  protected clock = 0;
  private cueTimers = new Map<string, number>();

  constructor(
    readonly id: string,
    readonly kind: Entity['kind'] & EntityKind,
    pos: Vec2,
    initial: string,
  ) {
    this.pos = { ...pos };
    this.state = initial;
  }

  abstract update(dt: number, ctx: EntityContext): void;

  dismiss(): void {
    this.gone = true;
    this.visible = false;
    this.threatening = false;
  }

  protected setState(s: string): void {
    this.state = s;
    this.stateTime = 0;
  }

  protected tick(dt: number): void {
    this.clock += dt;
    this.stateTime += dt;
    for (const [k, v] of this.cueTimers) {
      const left = v - dt;
      if (left <= 0) this.cueTimers.delete(k);
      else this.cueTimers.set(k, left);
    }
  }

  /** Émet un indice (visuel ou sonore) avec un délai minimal entre deux émissions. */
  protected cue(ctx: EntityContext, kind: 'visual' | 'audio', id: string, text: string, cooldown = 4): void {
    if (this.cueTimers.has(id)) return;
    this.cueTimers.set(id, cooldown);
    ctx.emit({ entityId: this.id, kind, id, text });
  }

  protected distTo(p: Vec2): number {
    return Math.hypot(p.x - this.pos.x, p.y - this.pos.y);
  }

  protected faceToward(p: Vec2): void {
    this.facing = Math.atan2(p.y - this.pos.y, p.x - this.pos.x);
  }
}

/** Vision : portée, champ de vision, ligne de vue, protection des cachettes. */
export function seesPlayer(
  from: Vec2,
  facing: number,
  range: number,
  fovRad: number,
  ctx: EntityContext,
): boolean {
  const p = ctx.player;
  if (p.hide?.vision) return false;
  const dx = p.pos.x - from.x;
  const dy = p.pos.y - from.y;
  const d = Math.hypot(dx, dy);
  let r = range;
  if (p.lampOn) r *= 1.3;
  if (p.crouched) r *= 0.7;
  if (d > r) return false;
  if (d < 0.9) return true;
  const diff = Math.abs(wrapAngle(Math.atan2(dy, dx) - facing));
  if (diff > fovRad / 2) return false;
  return !segmentBlocked(from, p.pos, ctx.room.blockers);
}

/** Le bruit le plus proche audible depuis `from`, ou null. */
export function loudestHeard(from: Vec2, ctx: EntityContext): { pos: Vec2; kind: string } | null {
  let best: { pos: Vec2; kind: string; d: number } | null = null;
  for (const n of ctx.noises) {
    const d = Math.hypot(n.pos.x - from.x, n.pos.y - from.y);
    if (d <= n.radius && (!best || d < best.d)) best = { pos: n.pos, kind: n.kind, d };
  }
  return best ? { pos: best.pos, kind: best.kind } : null;
}
