import type { Vec2 } from '../../core/types';
import { EntityBase } from './base';
import type { EntityContext } from './types';

const WARN_TIME = { easy: 3.0, normal: 2.5, hard: 1.8 } as const;
const MAX_AVOIDED = { easy: 2, normal: 3, hard: 4 } as const;

/**
 * L'Ombre du Plafond : rampe au-dessus des pièces. Les lumières vacillent quand elle approche.
 * Elle ne frappe que si le joueur n'est ni dans une zone éclairée sûre ni dans une cachette.
 * Après plusieurs attaques évitées, elle se retire définitivement.
 */
export class CeilingShadow extends EntityBase {
  /** 0..1 : intensité du vacillement des lumières. */
  flicker = 0;
  avoided = 0;
  private strikeAt: Vec2 = { x: 0, y: 0 };

  constructor(
    id: string,
    pos: Vec2,
    private readonly delay = 8,
  ) {
    super(id, 'ceilingShadow', pos, 'dormant');
    this.visible = false;
  }

  private isProtected(ctx: EntityContext): boolean {
    return ctx.player.hide !== null || ctx.player.inSafeZone;
  }

  update(dt: number, ctx: EntityContext): void {
    this.tick(dt);
    const p = ctx.player;
    const dist = this.distTo(p.pos);

    switch (this.state) {
      case 'dormant': {
        this.flicker = 0;
        this.visible = false;
        if (this.clock >= this.delay) {
          this.setState('stalking');
          this.cue(ctx, 'audio', 'ceiling_creak', 'Un craquement lent traverse le plafond.', 10);
        }
        break;
      }
      case 'stalking': {
        this.visible = true;
        this.threatening = true;
        this.flicker = Math.max(0, Math.min(1, 1 - dist / 7));
        if (this.flicker > 0.25) this.cue(ctx, 'visual', 'lights_flicker', 'Les lumières vacillent : l’Ombre est proche.', 4);
        this.faceToward(p.pos);
        // Elle se rapproche, mais s'arrête à distance respectueuse d'une zone sûre.
        const stopAt = this.isProtected(ctx) ? 2.6 : 1.2;
        const speed = 1.0 + (ctx.difficulty === 'hard' ? 0.3 : ctx.difficulty === 'easy' ? -0.2 : 0);
        if (dist > stopAt) {
          const dx = p.pos.x - this.pos.x;
          const dy = p.pos.y - this.pos.y;
          this.pos = { x: this.pos.x + (dx / dist) * speed * dt, y: this.pos.y + (dy / dist) * speed * dt };
        }
        if (dist <= 1.6 && !this.isProtected(ctx)) {
          this.setState('warning');
          this.cue(ctx, 'audio', 'ceiling_warning', 'Le plafond se creuse au-dessus de vous : rejoignez la lumière !', 1);
        }
        break;
      }
      case 'warning': {
        this.flicker = 1;
        this.threatening = true;
        this.strikeAt = { ...p.pos };
        if (this.stateTime >= WARN_TIME[ctx.difficulty]) this.setState('strike');
        break;
      }
      case 'strike': {
        const hit = !this.isProtected(ctx) && Math.hypot(p.pos.x - this.pos.x, p.pos.y - this.pos.y) < 2.4;
        if (hit) {
          this.caught = true;
        } else {
          this.avoided++;
          this.cue(ctx, 'audio', 'ceiling_miss', 'L’Ombre retombe dans le vide, furieuse.', 1);
          this.setState('retreat');
        }
        break;
      }
      case 'retreat': {
        this.flicker = Math.max(0, this.flicker - dt * 0.5);
        this.threatening = false;
        // Elle remonte vers un coin éloigné du joueur.
        const corner: Vec2 = {
          x: p.pos.x < ctx.room.w / 2 ? ctx.room.w - 0.5 : 0.5,
          y: p.pos.y < ctx.room.h / 2 ? ctx.room.h - 0.5 : 0.5,
        };
        const dx = corner.x - this.pos.x;
        const dy = corner.y - this.pos.y;
        const d = Math.hypot(dx, dy);
        if (d > 0.1) this.pos = { x: this.pos.x + (dx / d) * 2.2 * dt, y: this.pos.y + (dy / d) * 2.2 * dt };
        if (this.stateTime >= 6) {
          if (this.avoided >= MAX_AVOIDED[ctx.difficulty]) {
            this.dismiss();
            this.flicker = 0;
          } else {
            this.setState('stalking');
          }
        }
        break;
      }
      default:
        break;
    }
  }

  get lastStrike(): Vec2 {
    return this.strikeAt;
  }
}
