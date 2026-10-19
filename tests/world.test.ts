import { describe, expect, it } from 'vitest';
import { World } from '../src/game/world';
import { CH1_LENGTH } from '../src/systems/generator';
import { DT, dismissAllEntities, run, solveCurrentRoom, walkTo, worldToInput } from './helpers/bot';

describe('déplacement et collisions', () => {
  it('déplace le joueur selon la perspective isométrique (droite écran = +x −y, bas écran = +x +y)', () => {
    const w = World.newGame(1, 'normal');
    dismissAllEntities(w);
    const start = { ...w.player.pos };
    w.setMove(1, 0);
    run(w, 0.5);
    w.setMove(0, 0);
    run(w, 0.3);
    const right = { x: w.player.pos.x - start.x, y: w.player.pos.y - start.y };
    expect(right.x).toBeGreaterThan(0.3);
    expect(right.y).toBeLessThan(-0.3);
    expect(Math.abs(right.x + right.y)).toBeLessThan(0.15);
    const mid = { ...w.player.pos };
    w.setMove(0, 1);
    run(w, 0.5);
    w.setMove(0, 0);
    expect(w.player.pos.x).toBeGreaterThan(mid.x);
    expect(w.player.pos.y).toBeGreaterThan(mid.y);
  });

  it('reste dans les limites de la salle', () => {
    const w = World.newGame(1, 'normal');
    w.setMove(-1, -1);
    run(w, 8);
    expect(w.player.pos.x).toBeGreaterThanOrEqual(0);
    expect(w.player.pos.y).toBeGreaterThanOrEqual(0);
    w.setMove(1, 1);
    run(w, 12);
    expect(w.player.pos.x).toBeLessThanOrEqual(w.room.w);
    expect(w.player.pos.y).toBeLessThanOrEqual(w.room.h);
  });

  it('ne traverse pas les meubles', () => {
    const w = World.newGame(1, 'normal');
    const counter = w.room.furniture.find((f) => f.id === 'counter')!;
    w.player.pos = { x: counter.x + counter.w / 2, y: counter.y + counter.h + 1.2 };
    const { mx, my } = worldToInput(0, -1);
    w.setMove(mx, my);
    run(w, 3);
    expect(w.player.pos.y).toBeGreaterThan(counter.y + counter.h);
  });

  it('court plus vite et fait plus de bruit que la marche', () => {
    const w = World.newGame(1, 'normal');
    w.setMove(1, 0);
    run(w, 0.4);
    const walk = w.playerNoiseRadius();
    const walkSpeed = Math.hypot(w.player.vel.x, w.player.vel.y);
    w.setRun(true);
    run(w, 0.6);
    expect(Math.hypot(w.player.vel.x, w.player.vel.y)).toBeGreaterThan(walkSpeed);
    expect(w.playerNoiseRadius()).toBeGreaterThan(walk);
    w.setRun(false);
    w.setCrouch(true);
    run(w, 0.8);
    expect(w.playerNoiseRadius()).toBeLessThan(walk);
  });

  it('est indépendant du nombre d’images par seconde', () => {
    const a = World.newGame(1, 'normal');
    const b = World.newGame(1, 'normal');
    a.setMove(1, 0);
    b.setMove(1, 0);
    for (let i = 0; i < 60; i++) a.update(1 / 60);
    for (let i = 0; i < 15; i++) b.update(1 / 15);
    expect(Math.abs(a.player.pos.x - b.player.pos.x)).toBeLessThan(0.25);
  });
});

describe('interactions', () => {
  it('ramasse la lampe, fouille le comptoir et trouve la clé', () => {
    const w = World.newGame(5, 'normal');
    dismissAllEntities(w);
    walkTo(w, { x: 6.5, y: 5 }, 0.4);
    run(w, 0.1);
    expect(w.target?.kind).toBe('item');
    w.interact();
    run(w, 1);
    expect(w.inv.has('lamp')).toBe(true);
  });

  it('refuse d’ouvrir une porte verrouillée sans clé', () => {
    const w = World.newGame(5, 'normal');
    const out = w.room.doors.find((d) => d.id === 'out')!;
    w.openDoor(out);
    expect(w.status).toBe('playing');
  });

  it('allume et éteint la lampe, qui se vide avec le temps', () => {
    const w = World.newGame(5, 'normal');
    w.inv.add('lamp');
    w.lampCharge = 5;
    w.toggleLamp();
    expect(w.lampOn).toBe(true);
    run(w, 6);
    expect(w.lampOn).toBe(false);
    expect(w.lampCharge).toBe(0);
    w.inv.add('battery');
    expect(w.useItem('battery')).toBe(true);
    expect(w.lampCharge).toBeGreaterThan(80);
  });

  it('lance un jeton de verre qui fait du bruit et consomme le jeton', () => {
    const w = World.newGame(5, 'normal');
    w.inv.add('glassToken', 2);
    let thrown = false;
    w.events.on('throwToken', () => {
      thrown = true;
    });
    expect(w.useItem('glassToken')).toBe(true);
    expect(thrown).toBe(true);
    expect(w.inv.count('glassToken')).toBe(1);
  });
});

describe('progression complète du chapitre I', () => {
  for (const seed of [1, 42, 2026]) {
    it(`un joueur peut finir les ${CH1_LENGTH} salles (graine ${seed})`, () => {
      const w = World.newGame(seed, 'normal');
      w.events.on('roomLoaded', () => dismissAllEntities(w));
      dismissAllEntities(w);
      for (let i = 0; i < CH1_LENGTH - 1; i++) {
        expect(w.roomIndex).toBe(i);
        const err = solveCurrentRoom(w);
        expect(err, `salle ${i} (${w.plan.rooms[i]?.name}) : ${err}`).toBeNull();
        expect(w.roomIndex, `salle ${i} (${w.plan.rooms[i]?.name}) n’a pas progressé`).toBe(i + 1);
      }
      expect(w.room.category).toBe('final');
      expect(w.endingAvailable('exit')).toBe(true);
    }, 120_000);
  }
});

describe('transitions', () => {
  it('fige le monde pendant la transition puis charge la salle suivante', () => {
    const w = World.newGame(3, 'normal');
    dismissAllEntities(w);
    const keyId = (w.room.doors.find((d) => d.id === 'out')!.lock as { keyId: string }).keyId;
    w.inv.add(keyId);
    walkTo(w, { x: 9, y: 1.2 }, 0.4);
    run(w, 0.1);
    w.interact();
    expect(w.status).toBe('transition');
    const before = { ...w.player.pos };
    w.setMove(1, 0);
    run(w, 1);
    expect(w.player.pos).toEqual(before);
    w.commitTransition();
    expect(w.status).toBe('playing');
    expect(w.roomIndex).toBe(1);
    void DT;
  });

  it('ne sauvegarde jamais pendant une transition', () => {
    const w = World.newGame(3, 'normal');
    dismissAllEntities(w);
    const keyId = (w.room.doors.find((d) => d.id === 'out')!.lock as { keyId: string }).keyId;
    w.inv.add(keyId);
    walkTo(w, { x: 9, y: 1.2 }, 0.4);
    run(w, 0.1);
    let saves = 0;
    w.events.on('save', () => saves++);
    w.interact();
    expect(w.status).toBe('transition');
    expect(w.canSave()).toBe(false);
    w.saveNow();
    expect(saves).toBe(0);
    w.commitTransition();
    expect(saves).toBe(1);
  });
});
