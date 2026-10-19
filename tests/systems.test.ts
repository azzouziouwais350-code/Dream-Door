import { describe, expect, it } from 'vitest';
import { World } from '../src/game/world';
import { Rng } from '../src/core/rng';
import { Inventory } from '../src/systems/inventory';
import {
  AnomalyPuzzle,
  FusePuzzle,
  SequencePuzzle,
  SwitchPuzzle,
  VALVE_DELTAS,
  ValvePuzzle,
  createPuzzle,
  resolvePuzzleDef,
} from '../src/systems/puzzles';
import {
  MemoryStore,
  SAVE_KEY,
  SAVE_VERSION,
  SaveManager,
  parseSave,
  type Migration,
} from '../src/systems/save';
import { defaultSettings, sanitizeSettings } from '../src/systems/settings';
import { dismissAllEntities, interactWith, run, walkTo } from './helpers/bot';
import { validateRoom } from '../src/systems/validate';
import { generateChapter } from '../src/systems/generator';

describe('inventaire', () => {
  it('empile, retire et sélectionne les objets', () => {
    const inv = new Inventory();
    inv.add('battery', 2);
    inv.add('lamp');
    expect(inv.count('battery')).toBe(2);
    expect(inv.remove('battery')).toBe(true);
    expect(inv.remove('battery', 5)).toBe(false);
    expect(inv.size()).toBe(2);
    inv.select(1);
    expect(inv.selectedId()).toBe('lamp');
    inv.select(-1);
    expect(inv.selectedId()).toBe('lamp');
  });

  it('refuse les données invalides au chargement', () => {
    const inv = new Inventory();
    inv.add('lamp');
    expect(inv.load([{ id: 'x', count: -2 }])).toBe(false);
    expect(inv.load('nope')).toBe(false);
    expect(inv.load([{ id: 'x', count: 1.5 }])).toBe(false);
    expect(inv.has('lamp')).toBe(true);
    expect(inv.load([{ id: 'key:003', count: 1 }])).toBe(true);
    expect(inv.has('key:003')).toBe(true);
  });
});

describe('énigmes', () => {
  it('séquence : bonne suite résout, mauvaise réinitialise avec retour clair', () => {
    const p = new SequencePuzzle('p', 'visual', ['sun', 'moon', 'star'], 'pt', 'normal');
    expect(p.press('sun').ok).toBe(true);
    const bad = p.press('eye');
    expect(bad.ok).toBe(false);
    expect(bad.message).toMatch(/Mauvaise séquence/);
    expect(p.entered).toHaveLength(0);
    p.press('sun');
    p.press('moon');
    const last = p.press('star');
    expect(last.solved).toBe(true);
    expect(p.solved).toBe(true);
  });

  it('séquence : l’indice de difficulté facile cite les symboles, la difficile les énigme', () => {
    const easy = new SequencePuzzle('p', 'visual', ['sun', 'moon', 'star'], 'pt', 'easy');
    const hard = new SequencePuzzle('p', 'visual', ['sun', 'moon', 'star'], 'pt', 'hard');
    expect(easy.clueLines().join(' ')).toContain('Soleil');
    expect(hard.clueLines().join(' ')).not.toContain('Soleil');
  });

  it('interrupteurs : ne démarre jamais résolu et se résout par la bonne combinaison', () => {
    for (const sol of [[true, false, true], [false, false, true], [true, true, true]]) {
      const p = new SwitchPuzzle('p', sol);
      expect(p.solved).toBe(false);
      expect(p.matches()).toBe(false);
      sol.forEach((v, i) => {
        if (p.state[i] !== v) p.toggle(i);
      });
      expect(p.solved).toBe(true);
    }
  });

  it('vannes : la cible générée est toujours atteignable', () => {
    const rng = new Rng(7);
    for (let i = 0; i < 100; i++) {
      const def = resolvePuzzleDef({ id: 'p', kind: 'valves', start: 2 }, rng, 'hard');
      expect(def.kind).toBe('valves');
      if (def.kind !== 'valves') return;
      const p = new ValvePuzzle('p', def.start ?? 2, def.target ?? 0);
      // Recherche en largeur sur les actions de vannes.
      const seen = new Set([p.level]);
      const q = [p.level];
      let ok = false;
      while (q.length) {
        const cur = q.shift() as number;
        if (cur === p.target) ok = true;
        for (const d of VALVE_DELTAS) {
          const n = (((cur + d) % 11) + 11) % 11;
          if (!seen.has(n)) {
            seen.add(n);
            q.push(n);
          }
        }
      }
      expect(ok).toBe(true);
      expect(p.target).not.toBe(p.level);
    }
  });

  it('fusible : exige l’outil puis le fusible, avec un retour précis', () => {
    const inv = new Inventory();
    const p = new FusePuzzle('p');
    expect(p.tryInsert(inv).message).toMatch(/outil/);
    inv.add('screwdriver');
    expect(p.tryInsert(inv).message).toMatch(/fusible manque/);
    inv.add('fuse');
    const r = p.tryInsert(inv);
    expect(r.solved).toBe(true);
    expect(inv.has('fuse')).toBe(false);
  });

  it('anomalie : signaler la bonne cible résout, une mauvaise est comptée', () => {
    const p = new AnomalyPuzzle('p', ['a', 'b', 'c'], 'b');
    expect(p.flag('a').ok).toBe(false);
    expect(p.wrong).toBe(1);
    expect(p.flag('b').solved).toBe(true);
  });

  it('les indices progressifs deviennent plus précis', () => {
    const p = new SequencePuzzle('p', 'visual', ['sun', 'moon', 'star'], 'pt', 'normal');
    expect(p.hint(0)).not.toBe(p.hint(2));
    expect(p.hint(2)).toContain('Soleil');
    void createPuzzle;
  });
});

describe('cachettes (monde)', () => {
  it('permet d’entrer, rester, écouter et ressortir ; la lampe s’éteint', () => {
    const w = World.newGame(11, 'normal');
    dismissAllEntities(w);
    const wardrobe = w.room.furniture.find((f) => f.id === 'w1')!;
    w.inv.add('lamp');
    w.toggleLamp();
    expect(w.lampOn).toBe(true);
    expect(interactWith(w, wardrobe)).toBe(true);
    run(w, 0.6);
    expect(w.hiding).toBe(true);
    expect(w.lampOn).toBe(false);
    expect(w.playerNoiseRadius()).toBe(0); // armoire : étouffe le bruit
    // Le joueur caché ne bouge pas.
    const where = { ...w.player.pos };
    w.setMove(1, 0);
    run(w, 1);
    w.setMove(0, 0);
    expect(w.player.pos).toEqual(where);
    w.interact();
    run(w, 0.6);
    expect(w.hiding).toBe(false);
  });

  it('une cachette sans isolation sonore laisse un léger bruit', () => {
    const w = World.newGame(11, 'normal');
    dismissAllEntities(w);
    w.room.furniture.push({
      id: 'booth',
      kind: 'closet',
      x: 7,
      y: 8,
      w: 1,
      h: 1,
      blocking: true,
      hide: { vision: true, noise: false, inspectable: false, label: 'Isoloir' },
    });
    w.loadRoom(w.room.id, { x: 6, y: 6.5 }, null);
    const f = w.room.furniture.find((x) => x.id === 'booth')!;
    expect(interactWith(w, f)).toBe(true);
    run(w, 0.6);
    expect(w.hiding).toBe(true);
    expect(w.playerNoiseRadius()).toBeGreaterThan(0);
  });
});

describe('défaite et reprise', () => {
  it('une capture déclenche la défaite, puis la reprise restaure le point de contrôle', () => {
    const w = World.newGame(21, 'normal');
    dismissAllEntities(w);
    w.inv.add('battery', 3);
    const cpRoom = w.checkpoint.roomId;
    let defeated = false;
    w.events.on('defeat', () => {
      defeated = true;
    });
    // Capture forcée par une entité factice.
    w.entities.push({
      id: 'x',
      kind: 'concierge',
      pos: { x: 0, y: 0 },
      facing: 0,
      state: 'chase',
      caught: true,
      gone: false,
      visible: true,
      threatening: true,
      update() {},
      dismiss() {},
    });
    run(w, 0.2);
    expect(defeated).toBe(true);
    expect(w.status).toBe('defeated');
    w.respawnAtCheckpoint();
    expect(w.status).toBe('playing');
    expect(w.room.id).toBe(cpRoom);
    expect(w.inv.count('battery')).toBe(0);
  });
});

describe('sauvegarde', () => {
  function sample(): World {
    const w = World.newGame(777, 'hard');
    dismissAllEntities(w);
    w.inv.add('lamp');
    w.inv.add('battery', 2);
    w.inv.add('memory:ch1_1');
    return w;
  }

  it('fait un aller-retour sans perte', () => {
    const w = sample();
    const store = new MemoryStore();
    const mgr = new SaveManager(store);
    expect(mgr.save(w.toSave())).toBe(true);
    const res = mgr.load();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const r = World.restore(res.data);
    expect(r.room.id).toBe(w.room.id);
    expect(r.seed).toBe(777);
    expect(r.difficulty).toBe('hard');
    expect(r.inv.count('battery')).toBe(2);
    expect(r.inv.has('memory:ch1_1')).toBe(true);
    expect(JSON.stringify(r.plan.rooms.map((x) => x.name))).toBe(JSON.stringify(w.plan.rooms.map((x) => x.name)));
  });

  it('reprend les objets déjà ramassés et les énigmes résolues après actualisation', () => {
    const w = World.newGame(5, 'normal');
    dismissAllEntities(w);
    walkTo(w, { x: 6.5, y: 5 }, 0.4);
    run(w, 0.1);
    w.interact();
    run(w, 1);
    expect(w.inv.has('lamp')).toBe(true);
    const save = w.toSave();
    const r = World.restore(JSON.parse(JSON.stringify(save)));
    expect(r.inv.has('lamp')).toBe(true);
    expect(r.roomState.taken).toContain('lampfloor');
    expect(r.target).toBeNull();
  });

  it('rejette une sauvegarde corrompue sans lever d’exception', () => {
    const store = new MemoryStore();
    const mgr = new SaveManager(store);
    store.setItem(SAVE_KEY, '{ pas du json');
    expect(mgr.load()).toEqual({ ok: false, reason: 'corrupted' });
    store.setItem(SAVE_KEY, JSON.stringify({ version: SAVE_VERSION, chapter: 99 }));
    expect(mgr.load()).toEqual({ ok: false, reason: 'corrupted' });
    store.setItem(SAVE_KEY, '[]');
    expect(mgr.load()).toEqual({ ok: false, reason: 'corrupted' });
    mgr.quarantineCorrupted();
    expect(store.getItem(SAVE_KEY)).toBeNull();
    expect(store.getItem(`${SAVE_KEY}:corrupted`)).toBe('[]');
    expect(mgr.load()).toEqual({ ok: false, reason: 'none' });
  });

  it('rejette des champs falsifiés (inventaire négatif, version future)', () => {
    const base = JSON.parse(JSON.stringify(sample().toSave()));
    expect(parseSave(JSON.stringify(base))).not.toBeNull();
    expect(parseSave(JSON.stringify({ ...base, inventory: [{ id: 'lamp', count: -1 }] }))).toBeNull();
    expect(parseSave(JSON.stringify({ ...base, lampCharge: 99999 }))).toBeNull();
    expect(parseSave(JSON.stringify({ ...base, version: SAVE_VERSION + 1 }))).toBeNull();
    expect(parseSave(JSON.stringify({ ...base, difficulty: 'impossible' }))).toBeNull();
    expect(parseSave(JSON.stringify({ ...base, roomStates: { r: { searched: 'x' } } }))).toBeNull();
  });

  it('migre une ancienne version via la table de migrations', () => {
    const base = JSON.parse(JSON.stringify(sample().toSave()));
    const legacy: Record<string, unknown> = { ...base, version: 0, inv: base.inventory };
    delete legacy.inventory;
    const migrations: Record<number, Migration> = {
      0: (raw) => {
        const { inv, ...rest } = raw as Record<string, unknown> & { inv: unknown };
        return { ...rest, inventory: inv, version: 1 };
      },
    };
    expect(parseSave(JSON.stringify(legacy))).toBeNull();
    const migrated = parseSave(JSON.stringify(legacy), migrations);
    expect(migrated).not.toBeNull();
    expect(migrated?.inventory).toEqual(base.inventory);
  });

  it('ne sauvegarde pas en plein danger', () => {
    const w = World.newGame(9, 'normal');
    w.entities.push({
      id: 'x',
      kind: 'concierge',
      pos: { x: 0, y: 0 },
      facing: 0,
      state: 'chase',
      caught: false,
      gone: false,
      visible: true,
      threatening: true,
      update() {},
      dismiss() {},
    });
    expect(w.canSave()).toBe(false);
  });

  it('sanitise les réglages invalides', () => {
    const s = sanitizeSettings({ audio: { master: 7, music: 'x' }, accessibility: { textScale: 3 }, difficulty: 'zzz', bindings: { up: [] } });
    expect(s.audio.master).toBe(1);
    expect(s.audio.music).toBe(defaultSettings().audio.music);
    expect(s.accessibility.textScale).toBe(1);
    expect(s.difficulty).toBe('normal');
    expect(s.bindings.up.length).toBeGreaterThan(0);
    expect(sanitizeSettings(null)).toEqual(defaultSettings());
  });

  it('persiste les réglages et la progression globale', () => {
    const mgr = new SaveManager(new MemoryStore());
    const s = defaultSettings();
    s.audio.master = 0.3;
    mgr.saveSettings(s);
    expect(mgr.loadSettings().audio.master).toBe(0.3);
    mgr.saveMeta({ endings: ['exit', 'exit', 'return'], chaptersUnlocked: 2, bestRooms: 5 });
    expect(mgr.loadMeta().endings).toEqual(['exit', 'return']);
  });
});

describe('validateur (tests négatifs)', () => {
  it('détecte une porte bloquée par un meuble', () => {
    const plan = generateChapter(1, 4, 'normal');
    const room = structuredClone(plan.rooms[2]!);
    const out = room.doors.find((d) => d.id === 'out')!;
    room.furniture.push({ id: 'mur', kind: 'crate', x: out.at - 1, y: 0, w: 5, h: 2.5, blocking: true });
    const errors = validateRoom(room);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('détecte une clé manquante', () => {
    const plan = generateChapter(1, 4, 'normal');
    const room = structuredClone(plan.rooms[0]!);
    for (const f of room.furniture) f.loot = f.loot?.filter((l) => !l.id.startsWith('key:'));
    expect(validateRoom(room).some((e) => e.includes('clé'))).toBe(true);
  });

  it('détecte une énigme de vannes insoluble', () => {
    const plan = generateChapter(1, 4, 'normal');
    const room = structuredClone(plan.rooms.find((r) => r.puzzles?.some((p) => p.kind === 'valves')) ?? plan.rooms[1]!);
    const p = room.puzzles?.find((x) => x.kind === 'valves');
    if (!p || p.kind !== 'valves') return; // ce parcours n'a pas de chaufferie : rien à saboter
    p.target = 99;
    expect(validateRoom(room).some((e) => e.includes('insoluble'))).toBe(true);
  });

  it('détecte une salle à Ombre sans abri', () => {
    const plan = generateChapter(1, 4, 'normal');
    const room = structuredClone(plan.rooms.find((r) => r.entities?.some((e) => e.kind === 'ceilingShadow')) ?? plan.rooms[0]!);
    if (!room.entities?.some((e) => e.kind === 'ceilingShadow')) return;
    room.safeZones = [];
    room.furniture = room.furniture.filter((f) => !f.hide);
    expect(validateRoom(room).some((e) => e.includes('exposé'))).toBe(true);
  });
});
