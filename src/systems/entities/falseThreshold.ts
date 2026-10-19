import type { Vec2 } from '../../core/types';
import { EntityBase } from './base';
import type { EntityContext } from './types';

export const FALSE_DOOR_TELLS = [
  'La plaque porte un chiffre qui n’existe pas dans la série : « 0I3 ».',
  'La poignée est du mauvais côté, comme dans un miroir.',
  'Un filet de lueur rose passe sous la porte (visible à la lampe).',
];

/**
 * Le Faux-Seuil : imite une porte ordinaire. Des détails permettent de le reconnaître.
 * Se tromper n'est jamais une sanction arbitraire : on est envoyé dans une salle annexe traversable.
 */
export class FalseThreshold extends EntityBase {
  revealed = false;
  triggered = false;
  private readonly point: Vec2;

  constructor(
    id: string,
    readonly doorId: string,
    point: Vec2,
  ) {
    super(id, 'falseThreshold', point, 'disguised');
    this.point = { ...point };
  }

  update(dt: number, ctx: EntityContext): void {
    this.tick(dt);
    if (this.state === 'sealed') return;
    const d = this.distTo(ctx.player.pos);
    if (ctx.player.lampOn && d < 4) {
      if (!this.revealed) this.revealed = true;
      this.cue(ctx, 'visual', 'false_seam', 'Un filet de lueur rose filtre sous une des portes.', 8);
    }
    if (d < 2.2) this.cue(ctx, 'audio', 'false_hum', 'Un bourdonnement étouffé, de l’autre côté d’une porte.', 8);
    this.pos = { ...this.point };
  }

  trigger(): void {
    this.triggered = true;
    this.setState('triggered');
  }

  seal(): void {
    this.setState('sealed');
  }
}
