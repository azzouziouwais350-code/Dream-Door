import type { Rect, Vec2 } from '../../core/types';
import { distToRect } from '../collision';
import { EntityBase } from './base';
import type { EntityContext } from './types';

/**
 * Le Nageur : patrouille dans l'eau. Remous, bulles et variations de lumière trahissent sa position.
 * Il ne peut attraper que quelqu'un dans l'eau ou sur la berge, et uniquement s'il fait du bruit.
 * (Implémenté et testé ; il sera placé dans les piscines du chapitre II.)
 */
export class Swimmer extends EntityBase {
  private goal: Vec2;
  private repick = 0;

  constructor(
    id: string,
    pos: Vec2,
    private readonly water: Rect,
    private readonly delay = 4,
  ) {
    super(id, 'swimmer', pos, 'submerged');
    this.goal = { ...pos };
    this.visible = false;
  }

  private clampToWater(p: Vec2): Vec2 {
    return {
      x: Math.max(this.water.x + 0.3, Math.min(this.water.x + this.water.w - 0.3, p.x)),
      y: Math.max(this.water.y + 0.3, Math.min(this.water.y + this.water.h - 0.3, p.y)),
    };
  }

  private moveTo(dt: number, speed: number, to: Vec2): number {
    const t = this.clampToWater(to);
    const dx = t.x - this.pos.x;
    const dy = t.y - this.pos.y;
    const d = Math.hypot(dx, dy);
    if (d > 0.01) this.facing = Math.atan2(dy, dx);
    const step = speed * dt;
    this.pos = d <= step ? { ...t } : { x: this.pos.x + (dx / d) * step, y: this.pos.y + (dy / d) * step };
    return d;
  }

  update(dt: number, ctx: EntityContext): void {
    this.tick(dt);
    const p = ctx.player;
    const dEdge = distToRect(p.pos, this.water);
    const nearWater = dEdge <= 1.6;
    const noisy = p.noiseRadius > 1.2;
    const dist = this.distTo(p.pos);

    if (this.clock < this.delay) return;

    if (dist < 6) this.cue(ctx, 'visual', 'swimmer_ripples', 'Des remous s’approchent à la surface.', 5);
    if (dist < 3.5) this.cue(ctx, 'visual', 'swimmer_bubbles', 'Des bulles montent près de vous ; la lumière se plisse.', 5);

    switch (this.state) {
      case 'submerged': {
        this.visible = false;
        this.threatening = false;
        this.repick -= dt;
        if (this.repick <= 0) {
          this.goal = {
            x: this.water.x + 0.5 + ctx.rng() * (this.water.w - 1),
            y: this.water.y + 0.5 + ctx.rng() * (this.water.h - 1),
          };
          this.repick = 3 + ctx.rng() * 3;
        }
        this.moveTo(dt, 0.9, this.goal);
        if (nearWater && noisy && dist < 5) {
          this.setState('stalking');
          this.cue(ctx, 'audio', 'swimmer_wake', 'Un clapotis net : quelque chose vous a entendu.', 4);
        }
        break;
      }
      case 'stalking': {
        this.threatening = true;
        this.visible = dist < 2.5;
        this.moveTo(dt, 1.8, p.pos);
        if (!nearWater || (!noisy && this.stateTime > 4)) {
          this.setState('submerged');
        } else if (dist < 1.6) {
          this.setState('lunge');
          this.cue(ctx, 'audio', 'swimmer_lunge', 'L’eau se creuse : reculez de la berge !', 1);
        }
        break;
      }
      case 'lunge': {
        this.visible = true;
        if (this.stateTime >= 1.0) {
          if (nearWater) this.caught = true;
          else this.setState('retreat');
        }
        break;
      }
      case 'retreat': {
        this.visible = false;
        this.threatening = false;
        this.moveTo(dt, 1.4, { x: this.water.x + this.water.w / 2, y: this.water.y + this.water.h / 2 });
        if (this.stateTime > 5) this.setState('submerged');
        break;
      }
      default:
        break;
    }
  }
}
