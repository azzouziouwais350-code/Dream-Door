import { describe, expect, it } from 'vitest';
import { CH1_LENGTH, generateChapter } from '../src/systems/generator';
import { validateChapter } from '../src/systems/validate';

describe('génération du chapitre I', () => {
  it('est reproductible avec la même graine', () => {
    const a = generateChapter(1, 12345, 'normal');
    const b = generateChapter(1, 12345, 'normal');
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('produit des parcours différents selon la graine', () => {
    const a = generateChapter(1, 1, 'normal').rooms.map((r) => r.name).join('|');
    const b = generateChapter(1, 2, 'normal').rooms.map((r) => r.name).join('|');
    expect(a).not.toBe(b);
  });

  it('a la bonne longueur et commence/finit correctement', () => {
    const plan = generateChapter(1, 7, 'normal');
    expect(plan.rooms).toHaveLength(CH1_LENGTH);
    expect(plan.rooms[0]?.category).toBe('start');
    expect(plan.rooms[CH1_LENGTH - 1]?.category).toBe('final');
  });

  it('est valide pour 200 graines et les 3 difficultés', () => {
    const failures: string[] = [];
    for (const difficulty of ['easy', 'normal', 'hard'] as const) {
      for (let seed = 1; seed <= 200; seed++) {
        const errors = validateChapter(generateChapter(1, seed * 7919, difficulty));
        if (errors.length > 0) failures.push(`graine ${seed * 7919} (${difficulty}) : ${errors.slice(0, 3).join(' ; ')}`);
      }
    }
    expect(failures.slice(0, 12)).toEqual([]);
  });

  it('place la clé de chaque porte dans la salle correspondante', () => {
    const plan = generateChapter(1, 99, 'normal');
    for (let i = 0; i < plan.rooms.length - 1; i++) {
      const room = plan.rooms[i]!;
      const out = room.doors.find((d) => d.id === 'out')!;
      if (out.lock?.type === 'key') {
        const loot = room.furniture.flatMap((f) => f.loot ?? []).map((l) => l.id);
        expect(loot).toContain(out.lock.keyId);
      }
    }
  });
});
