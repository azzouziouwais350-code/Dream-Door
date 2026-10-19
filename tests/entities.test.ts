import { describe, expect, it } from 'vitest';
import type { Cue, HideProps, Rect, Vec2 } from '../src/core/types';
import { Concierge, FalseThreshold, Swimmer, Watcher, CeilingShadow } from '../src/systems/entities';
import type { EntityContext, Noise, PlayerView } from '../src/systems/entities';
import { NavGrid } from '../src/systems/nav';

const WARDROBE: HideProps = { vision: true, noise: true, inspectable: true, label: 'Armoire' };
const CLOSET: HideProps = { vision: true, noise: true, inspectable: false, label: 'Placard' };

function player(over: Partial<PlayerView> = {}): PlayerView {
  return {
    pos: { x: 6, y: 6 },
    hide: null,
    hideId: null,
    noiseRadius: 0,
    lampOn: false,
    crouched: false,
    running: false,
    inSafeZone: false,
    ...over,
  };
}

function makeCtx(
  p: PlayerView,
  opts: { blockers?: Rect[]; spots?: Array<{ id: string; pos: Vec2; props: HideProps }>; noises?: Noise[]; safe?: Array<{ x: number; y: number; r: number }>; w?: number; h?: number } = {},
): { ctx: EntityContext; cues: Cue[] } {
  const w = opts.w ?? 14;
  const h = opts.h ?? 10;
  const blockers = opts.blockers ?? [];
  const cues: Cue[] = [];
  const ctx: EntityContext = {
    player: p,
    room: {
      w,
      h,
      blockers,
      nav: new NavGrid(w, h, blockers),
      hideSpots: opts.spots ?? [],
      safeZones: opts.safe ?? [],
      doorPoints: {},
    },
    noises: opts.noises ?? [],
    difficulty: 'normal',
    emit: (c) => cues.push(c),
    rng: () => 0.5,
  };
  return { ctx, cues };
}

function simulate(seconds: number, fn: (dt: number) => void): void {
  const dt = 1 / 30;
  for (let t = 0; t < seconds; t += dt) fn(dt);
}

describe('Concierge', () => {
  it('reste inactif pendant le délai de grâce puis patrouille', () => {
    const c = new Concierge('c', { x: 2, y: 2 }, [{ x: 2, y: 2 }, { x: 10, y: 2 }], 3);
    const { ctx } = makeCtx(player({ pos: { x: 12, y: 9 } }));
    simulate(2, (dt) => c.update(dt, ctx));
    expect(c.state).toBe('idle');
    simulate(2, (dt) => c.update(dt, ctx));
    expect(c.state).not.toBe('idle');
  });

  it('repère le joueur dans son champ de vision et le poursuit', () => {
    const c = new Concierge('c', { x: 2, y: 5 }, [{ x: 2, y: 5 }], 0);
    c.facing = 0; // regarde vers +x
    const p = player({ pos: { x: 6, y: 5 } });
    const { ctx, cues } = makeCtx(p);
    simulate(0.5, (dt) => c.update(dt, ctx));
    expect(c.state).toBe('chase');
    expect(cues.some((q) => q.id === 'concierge_alert')).toBe(true);
  });

  it('ne voit pas le joueur derrière lui, ni à travers un mur', () => {
    const behind = new Concierge('c', { x: 8, y: 5 }, [{ x: 8, y: 5 }], 0);
    behind.facing = 0; // regarde vers +x, joueur en x=4 : derrière
    const { ctx } = makeCtx(player({ pos: { x: 4, y: 5 } }));
    simulate(0.4, (dt) => behind.update(dt, ctx));
    expect(behind.state).not.toBe('chase');

    const wall: Rect = { x: 4, y: 0, w: 0.5, h: 10 };
    const blocked = new Concierge('c2', { x: 2, y: 5 }, [{ x: 2, y: 5 }], 0);
    blocked.facing = 0;
    const { ctx: ctx2 } = makeCtx(player({ pos: { x: 6, y: 5 } }), { blockers: [wall] });
    simulate(0.4, (dt) => blocked.update(dt, ctx2));
    expect(blocked.state).not.toBe('chase');
  });

  it('attrape le joueur à découvert', () => {
    const c = new Concierge('c', { x: 3, y: 5 }, [{ x: 3, y: 5 }], 0);
    c.facing = 0;
    const p = player({ pos: { x: 6, y: 5 } });
    const { ctx } = makeCtx(p);
    simulate(6, (dt) => c.update(dt, ctx));
    expect(c.caught).toBe(true);
  });

  it('ne voit pas un joueur caché (vision) et réagit seulement au bruit', () => {
    const c = new Concierge('c', { x: 3, y: 5 }, [{ x: 3, y: 5 }], 0);
    c.facing = 0;
    const p = player({ pos: { x: 6, y: 5 }, hide: WARDROBE, hideId: 'w1' });
    const { ctx } = makeCtx(p, { spots: [{ id: 'w1', pos: { x: 6, y: 5 }, props: WARDROBE }] });
    simulate(5, (dt) => c.update(dt, ctx));
    expect(c.caught).toBe(false);
    expect(c.state).not.toBe('chase');
  });

  it('enquête sur un bruit', () => {
    const c = new Concierge('c', { x: 2, y: 2 }, [{ x: 2, y: 2 }], 0);
    c.facing = Math.PI; // dos au bruit
    const { ctx } = makeCtx(player({ pos: { x: 13, y: 9 } }), { noises: [{ pos: { x: 6, y: 2 }, radius: 6, kind: 'throw' }] });
    simulate(0.3, (dt) => c.update(dt, ctx));
    expect(c.state).toBe('investigate');
    simulate(6, (dt) => c.update(dt, ctx));
    expect(Math.hypot(c.pos.x - 6, c.pos.y - 2)).toBeLessThan(1.5);
  });

  it('fouille la cachette où il a vu entrer le joueur (armoire) et le trouve', () => {
    const c = new Concierge('c', { x: 3, y: 5 }, [{ x: 3, y: 5 }], 0);
    c.facing = 0;
    const spot = { id: 'w1', pos: { x: 7, y: 5 }, props: WARDROBE };
    const p = player({ pos: { x: 6, y: 5 } });
    const { ctx } = makeCtx(p, { spots: [spot] });
    simulate(0.5, (dt) => c.update(dt, ctx));
    expect(c.state).toBe('chase');
    // Le joueur se cache dans l'armoire pendant la poursuite.
    p.pos = { ...spot.pos };
    p.hide = WARDROBE;
    p.hideId = 'w1';
    simulate(14, (dt) => c.update(dt, ctx));
    expect(c.caught).toBe(true);
  });

  it('ne fouille pas un placard non inspectable : le joueur survit', () => {
    const c = new Concierge('c', { x: 3, y: 5 }, [{ x: 3, y: 5 }], 0);
    c.facing = 0;
    const spot = { id: 'cl', pos: { x: 7, y: 5 }, props: CLOSET };
    const p = player({ pos: { x: 6, y: 5 } });
    const { ctx } = makeCtx(p, { spots: [spot] });
    simulate(0.5, (dt) => c.update(dt, ctx));
    p.pos = { ...spot.pos };
    p.hide = CLOSET;
    p.hideId = 'cl';
    simulate(20, (dt) => c.update(dt, ctx));
    expect(c.caught).toBe(false);
    expect(['patrol', 'return', 'investigate']).toContain(c.state);
  });
});

describe('Ombre du Plafond', () => {
  it('prévient (lumières qui vacillent) avant de frapper', () => {
    const s = new CeilingShadow('s', { x: 6, y: 6 }, 0);
    const { ctx, cues } = makeCtx(player({ pos: { x: 6.5, y: 6 } }));
    simulate(5, (dt) => s.update(dt, ctx));
    expect(cues.some((c) => c.id === 'lights_flicker' || c.id === 'ceiling_warning')).toBe(true);
    expect(['warning', 'strike', 'stalking']).toContain(s.state);
  });

  it('frappe un joueur exposé', () => {
    const s = new CeilingShadow('s', { x: 6, y: 6 }, 0);
    const p = player({ pos: { x: 6.5, y: 6 } });
    const { ctx } = makeCtx(p);
    simulate(10, (dt) => s.update(dt, ctx));
    expect(s.caught).toBe(true);
  });

  it('ne peut pas toucher un joueur dans une zone sûre', () => {
    const s = new CeilingShadow('s', { x: 6, y: 6 }, 0);
    const p = player({ pos: { x: 6.5, y: 6 }, inSafeZone: true });
    const { ctx } = makeCtx(p);
    simulate(30, (dt) => s.update(dt, ctx));
    expect(s.caught).toBe(false);
  });

  it('épargne un joueur qui rejoint l’abri pendant l’avertissement, puis se retire après plusieurs échecs', () => {
    const s = new CeilingShadow('s', { x: 6, y: 6 }, 0);
    const p = player({ pos: { x: 6.5, y: 6 } });
    const { ctx } = makeCtx(p);
    simulate(120, (dt) => {
      s.update(dt, ctx);
      // Le joueur rejoint la lumière dès l'avertissement, et la quitte quand l'Ombre se retire.
      if (s.state === 'warning' || s.state === 'strike') p.inSafeZone = true;
      if (s.state === 'retreat') p.inSafeZone = false;
    });
    expect(s.caught).toBe(false);
    expect(s.avoided).toBeGreaterThanOrEqual(3);
    expect(s.gone).toBe(true);
  });
});

describe('Veilleur', () => {
  it('apparaît, ne menace jamais, désigne un indice puis disparaît', () => {
    const w = new Watcher('w', { x: 12, y: 8 }, 1, 'Il montre l’armoire.');
    const { ctx, cues } = makeCtx(player({ pos: { x: 2, y: 2 } }));
    let threatened = false;
    simulate(25, (dt) => {
      w.update(dt, ctx);
      if (w.threatening) threatened = true;
    });
    expect(threatened).toBe(false);
    expect(cues.some((c) => c.id === 'watcher_glint')).toBe(true);
    expect(cues.some((c) => c.id === 'watcher_point')).toBe(true);
    expect(w.gone).toBe(true);
  });

  it('s’efface si le joueur s’approche', () => {
    const w = new Watcher('w', { x: 12, y: 8 }, 0);
    const p = player({ pos: { x: 2, y: 2 } });
    const { ctx } = makeCtx(p);
    simulate(2, (dt) => w.update(dt, ctx));
    expect(w.state).toBe('watching');
    p.pos = { x: 11, y: 8 };
    simulate(3, (dt) => w.update(dt, ctx));
    expect(w.gone).toBe(true);
  });
});

describe('Nageur', () => {
  const water: Rect = { x: 3, y: 3, w: 6, h: 4 };

  it('ignore un joueur silencieux', () => {
    const n = new Swimmer('n', { x: 5, y: 5 }, water, 0);
    const { ctx } = makeCtx(player({ pos: { x: 3.5, y: 2.2 }, noiseRadius: 0 }));
    simulate(30, (dt) => n.update(dt, ctx));
    expect(n.caught).toBe(false);
  });

  it('traque et attrape un joueur bruyant au bord de l’eau', () => {
    const n = new Swimmer('n', { x: 4, y: 4 }, water, 0);
    const { ctx, cues } = makeCtx(player({ pos: { x: 4, y: 2.4 }, noiseRadius: 6.5, running: true }));
    simulate(15, (dt) => n.update(dt, ctx));
    expect(cues.some((c) => c.id === 'swimmer_ripples')).toBe(true);
    expect(n.caught).toBe(true);
  });

  it('reste dans l’eau', () => {
    const n = new Swimmer('n', { x: 4, y: 4 }, water, 0);
    const { ctx } = makeCtx(player({ pos: { x: 12, y: 9 } }));
    simulate(30, (dt) => {
      n.update(dt, ctx);
      expect(n.pos.x).toBeGreaterThanOrEqual(water.x);
      expect(n.pos.x).toBeLessThanOrEqual(water.x + water.w);
      expect(n.pos.y).toBeGreaterThanOrEqual(water.y);
      expect(n.pos.y).toBeLessThanOrEqual(water.y + water.h);
    });
  });
});

describe('Faux-Seuil', () => {
  it('se révèle à la lampe, de près, avec un indice visuel', () => {
    const f = new FalseThreshold('f', 'false', { x: 9, y: 0.5 });
    const p = player({ pos: { x: 9, y: 2.5 } });
    const { ctx, cues } = makeCtx(p);
    simulate(1, (dt) => f.update(dt, ctx));
    expect(f.revealed).toBe(false);
    p.lampOn = true;
    simulate(1, (dt) => f.update(dt, ctx));
    expect(f.revealed).toBe(true);
    expect(cues.some((c) => c.id === 'false_seam')).toBe(true);
  });

  it('peut être déclenché puis scellé', () => {
    const f = new FalseThreshold('f', 'false', { x: 9, y: 0.5 });
    f.trigger();
    expect(f.triggered).toBe(true);
    f.seal();
    expect(f.state).toBe('sealed');
  });
});
