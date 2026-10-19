import type { Vec2 } from '../../core/types';
import { EntityBase } from './base';
import type { EntityContext } from './types';

/**
 * Le Veilleur : observe à distance, ne blesse jamais. Il peut désigner un secret ou annoncer un événement.
 * Il s'efface si on s'approche, ou après avoir transmis son message.
 */
export class Watcher extends EntityBase {
  /** 0..1 : opacité de la silhouette. */
  alpha = 0;
  private readonly home: Vec2;

  constructor(
    id: string,
    pos: Vec2,
    private readonly delay = 5,
    private readonly message?: string,
  ) {
    super(id, 'watcher', pos, 'dormant');
    this.home = { ...pos };
    this.visible = false;
  }

  update(dt: number, ctx: EntityContext): void {
    this.tick(dt);
    const p = ctx.player;
    switch (this.state) {
      case 'dormant':
        if (this.clock >= this.delay) {
          this.setState('watching');
          this.visible = true;
          this.cue(ctx, 'visual', 'watcher_glint', 'Deux reflets pâles brillent dans un recoin de la pièce.', 30);
        }
        break;
      case 'watching': {
        this.pos = { ...this.home };
        this.faceToward(p.pos);
        this.alpha = Math.min(1, this.alpha + dt * 0.5);
        if (this.distTo(p.pos) < 2.2) {
          this.setState('fading');
        } else if (this.stateTime > 12) {
          this.setState('pointing');
        }
        break;
      }
      case 'pointing': {
        this.cue(ctx, 'visual', 'watcher_point', this.message ?? 'Le Veilleur incline lentement la tête vers la porte.', 60);
        if (this.stateTime > 3) this.setState('fading');
        break;
      }
      case 'fading': {
        this.alpha = Math.max(0, this.alpha - dt * 0.8);
        if (this.alpha <= 0) this.dismiss();
        break;
      }
      default:
        break;
    }
  }
}
