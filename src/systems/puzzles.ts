import type { Difficulty, PuzzleDef } from '../core/types';
import type { Rng } from '../core/rng';
import type { Inventory } from './inventory';

export interface Feedback {
  ok: boolean;
  message: string;
  solved?: boolean;
}

export const SYMBOLS = ['sun', 'moon', 'star', 'eye', 'wave'] as const;
export const SYMBOL_NAMES: Record<string, string> = {
  sun: 'Soleil',
  moon: 'Lune',
  star: 'Étoile',
  eye: 'Œil',
  wave: 'Vague',
};
const SYMBOL_RIDDLES: Record<string, string> = {
  sun: 'ce qui chasse la nuit',
  moon: 'la veilleuse du ciel',
  star: 'ce qui brille dans le noir',
  eye: 'ce qui vous regarde en retour',
  wave: 'ce qui revient toujours',
};
export const NOTES = ['grave', 'medium', 'aigu'] as const;
export const NOTE_NAMES: Record<string, string> = { grave: 'Grave', medium: 'Médium', aigu: 'Aigu' };

export const VALVE_RING = 11;
export const VALVE_DELTAS = [3, 5, -2];

/* -------------------------------------------------------------------------- */
/* Séquence de symboles / de notes                                            */
/* -------------------------------------------------------------------------- */
export class SequencePuzzle {
  readonly kind = 'sequence' as const;
  entered: string[] = [];
  solved = false;
  errors = 0;

  constructor(
    readonly id: string,
    readonly mode: 'visual' | 'sound',
    readonly solution: string[],
    readonly clueFurn: string,
    readonly difficulty: Difficulty,
  ) {}

  get alphabet(): readonly string[] {
    return this.mode === 'sound' ? NOTES : SYMBOLS;
  }

  press(symbol: string): Feedback {
    if (this.solved) return { ok: true, message: 'Le mécanisme est déjà ouvert.', solved: true };
    this.entered.push(symbol);
    const i = this.entered.length - 1;
    if (this.entered[i] !== this.solution[i]) {
      this.entered = [];
      this.errors++;
      return { ok: false, message: 'Mauvaise séquence : les symboles s’éteignent et le panneau se réinitialise.' };
    }
    if (this.entered.length === this.solution.length) {
      this.solved = true;
      return { ok: true, message: 'Un déclic sourd : le mécanisme s’ouvre.', solved: true };
    }
    return { ok: true, message: `Bien. ${this.entered.length}/${this.solution.length}.` };
  }

  reset(): void {
    this.entered = [];
  }

  /** Texte affiché par l'indice visuel du décor (tableau). */
  clueLines(): string[] {
    if (this.mode === 'sound') return ['La boîte à musique rejoue toujours le même air.', 'Écoutez-la, puis reproduisez-le au piano.'];
    if (this.difficulty === 'easy') {
      return ['Le tableau montre, de gauche à droite :', this.solution.map((s) => SYMBOL_NAMES[s]).join(' · ')];
    }
    return [
      'Sous le tableau, une comptine griffonnée :',
      ...this.solution.map((s, i) => `${i + 1}. ${SYMBOL_RIDDLES[s]}`),
    ];
  }

  hint(level: number): string {
    if (this.mode === 'sound') {
      if (level <= 0) return 'Activez la boîte à musique pour écouter l’air.';
      if (level === 1) return 'Chaque note est soit grave, soit médium, soit aiguë. Les sous-titres les nomment.';
      return `La première note est ${NOTE_NAMES[this.solution[0] as string]}.`;
    }
    if (level <= 0) return 'Cherchez un tableau ou une inscription dans la pièce.';
    if (level === 1) return 'L’ordre compte : lisez les symboles dans l’ordre indiqué.';
    return `Le premier symbole est « ${SYMBOL_NAMES[this.solution[0] as string]} ».`;
  }
}

/* -------------------------------------------------------------------------- */
/* Interrupteurs électriques                                                  */
/* -------------------------------------------------------------------------- */
export class SwitchPuzzle {
  readonly kind = 'switches' as const;
  state: boolean[];
  solved = false;

  constructor(
    readonly id: string,
    readonly solution: boolean[],
  ) {
    this.state = solution.map(() => false);
    // Évite d'être résolu dès le départ.
    if (this.matches()) this.state[0] = true;
  }

  get count(): number {
    return this.solution.length;
  }

  matches(): boolean {
    return this.state.every((v, i) => v === this.solution[i]);
  }

  correctCount(): number {
    return this.state.filter((v, i) => v === this.solution[i]).length;
  }

  toggle(i: number): Feedback {
    if (this.solved) return { ok: true, message: 'Le courant est rétabli.', solved: true };
    if (i < 0 || i >= this.state.length) return { ok: false, message: 'Aucun interrupteur ici.' };
    this.state[i] = !this.state[i];
    if (this.matches()) {
      this.solved = true;
      return { ok: true, message: 'Les lumières se stabilisent. Le courant est rétabli.', solved: true };
    }
    return { ok: true, message: `${this.correctCount()}/${this.count} interrupteurs bien placés.` };
  }

  clueLines(): string[] {
    const up = this.solution.map((v, i) => (v ? i + 1 : 0)).filter((n) => n > 0);
    const down = this.solution.map((v, i) => (v ? 0 : i + 1)).filter((n) => n > 0);
    return [
      'Schéma au crayon sur le mur :',
      `Haut : ${up.length ? up.join(', ') : 'aucun'}`,
      `Bas : ${down.length ? down.join(', ') : 'aucun'}`,
    ];
  }

  hint(level: number): string {
    if (level <= 0) return 'Un schéma est affiché quelque part sur les murs.';
    if (level === 1) return 'Le schéma indique quels interrupteurs doivent être en haut.';
    const first = this.solution[0] ? 'haut' : 'bas';
    return `L’interrupteur 1 doit être en position ${first}.`;
  }
}

/* -------------------------------------------------------------------------- */
/* Vannes et niveaux d'eau                                                    */
/* -------------------------------------------------------------------------- */
export class ValvePuzzle {
  readonly kind = 'valves' as const;
  level: number;
  solved = false;
  turns = 0;

  constructor(
    readonly id: string,
    readonly start: number,
    readonly target: number,
  ) {
    this.level = start;
  }

  turn(valve: number): Feedback {
    if (this.solved) return { ok: true, message: 'Le niveau est stabilisé.', solved: true };
    const delta = VALVE_DELTAS[valve];
    if (delta === undefined) return { ok: false, message: 'Cette vanne est rouillée.' };
    this.level = (((this.level + delta) % VALVE_RING) + VALVE_RING) % VALVE_RING;
    this.turns++;
    if (this.level === this.target) {
      this.solved = true;
      return { ok: true, message: `Niveau ${this.level} : l’aiguille se fige sur la marque rouge. La porte se déverrouille.`, solved: true };
    }
    const dir = delta > 0 ? 'monte' : 'descend';
    return { ok: true, message: `Le niveau ${dir} : ${this.level}. Cible : ${this.target}.` };
  }

  gaugeText(): string {
    return `Niveau actuel : ${this.level} — Marque rouge : ${this.target}.`;
  }

  hint(level: number): string {
    if (level <= 0) return 'Le manomètre indique le niveau actuel et la cible.';
    if (level === 1) return `Chaque vanne ajoute ou retire un peu d’eau : ${VALVE_DELTAS.map((d) => (d > 0 ? `+${d}` : `${d}`)).join(', ')}.`;
    return 'Le cadran est circulaire : dépasser 10 ramène à 0.';
  }
}

/* -------------------------------------------------------------------------- */
/* Fusible + outil                                                            */
/* -------------------------------------------------------------------------- */
export class FusePuzzle {
  readonly kind = 'fuse' as const;
  solved = false;

  constructor(readonly id: string) {}

  tryInsert(inv: Inventory): Feedback {
    if (this.solved) return { ok: true, message: 'La boîte électrique ronronne.', solved: true };
    if (!inv.has('screwdriver')) return { ok: false, message: 'Le capot est vissé. Il faut un outil pour l’ouvrir.' };
    if (!inv.has('fuse')) return { ok: false, message: 'Le capot s’ouvre, mais un fusible manque à l’intérieur.' };
    inv.remove('fuse');
    this.solved = true;
    return { ok: true, message: 'Vous dévissez le capot et insérez le fusible. Le courant revient.', solved: true };
  }

  hint(level: number): string {
    if (level <= 0) return 'Le capot est vissé. Cherchez un outil et une pièce de rechange dans la pièce.';
    if (level === 1) return 'Fouillez les tiroirs et le chariot.';
    return 'Le tournevis ouvre le capot, le fusible rétablit le courant.';
  }
}

/* -------------------------------------------------------------------------- */
/* Détection d'anomalies                                                      */
/* -------------------------------------------------------------------------- */
export class AnomalyPuzzle {
  readonly kind = 'anomaly' as const;
  solved = false;
  wrong = 0;
  examined = new Set<string>();

  constructor(
    readonly id: string,
    readonly targets: string[],
    readonly anomalous: string,
  ) {}

  examine(furnId: string): void {
    this.examined.add(furnId);
  }

  flag(furnId: string): Feedback {
    if (this.solved) return { ok: true, message: 'L’anomalie est déjà signalée.', solved: true };
    if (furnId === this.anomalous) {
      this.solved = true;
      return { ok: true, message: 'Vous avez repéré l’anomalie. Quelque part, un verrou cède.', solved: true };
    }
    this.wrong++;
    return { ok: false, message: 'Rien d’anormal ici. Le silence se fait plus lourd.' };
  }

  hint(level: number): string {
    if (level <= 0) return 'Examinez chaque objet : un seul est faux.';
    if (level === 1) return 'Cherchez un détail qui contredit la logique : un sens, un reflet, une heure.';
    return 'Après avoir examiné un objet, interagissez de nouveau pour le signaler.';
  }
}

export type Puzzle = SequencePuzzle | SwitchPuzzle | ValvePuzzle | FusePuzzle | AnomalyPuzzle;

/* -------------------------------------------------------------------------- */
/* Fabrication                                                                */
/* -------------------------------------------------------------------------- */
const ANOMALY_TEXTS: Record<string, string> = {
  painting: 'Le tableau montre cette même pièce… vue de derrière. Quelqu’un y est assis, de dos.',
  clock: 'L’aiguille des secondes tourne à l’envers.',
  window: 'Le reflet dans la vitre cligne des yeux une seconde après vous.',
};

export function anomalyTextFor(kind: string): string {
  return ANOMALY_TEXTS[kind] ?? 'Quelque chose cloche, sans qu’on sache dire quoi.';
}

export const DIFFICULTY_LEVEL: Record<Difficulty, number> = { easy: 0, normal: 1, hard: 2 };

/** Complète les paramètres aléatoires (solution, cible…) d'une définition de puzzle. */
export function resolvePuzzleDef(def: PuzzleDef, rng: Rng, difficulty: Difficulty): PuzzleDef {
  const lvl = DIFFICULTY_LEVEL[difficulty];
  switch (def.kind) {
    case 'sequence': {
      if (def.solution && def.solution.length > 0) return def;
      if (def.mode === 'sound') {
        const len = 3 + lvl;
        const solution: string[] = [];
        for (let i = 0; i < len; i++) {
          let n = rng.pick(NOTES) as string;
          if (i > 0 && n === solution[i - 1]) n = NOTES[(NOTES.indexOf(n as (typeof NOTES)[number]) + 1) % NOTES.length] as string;
          solution.push(n);
        }
        return { ...def, solution };
      }
      const len = 3 + lvl;
      const pool = rng.shuffle([...SYMBOLS]);
      return { ...def, solution: pool.slice(0, len) as string[] };
    }
    case 'switches': {
      if (def.solution && def.solution.length > 0) return def;
      const n = 3 + lvl;
      let solution = Array.from({ length: n }, () => rng.chance(0.5));
      if (solution.every((v) => !v)) solution = solution.map((_, i) => i === 0);
      return { ...def, solution };
    }
    case 'valves': {
      const start = def.start ?? 2;
      if (def.target !== undefined && def.target !== start) return { ...def, start };
      // La cible vient d'une vraie suite de manœuvres : elle est donc toujours atteignable.
      let level = start;
      const moves = 3 + lvl;
      for (let i = 0; i < moves; i++) {
        const d = VALVE_DELTAS[rng.int(0, VALVE_DELTAS.length - 1)] as number;
        level = (((level + d) % VALVE_RING) + VALVE_RING) % VALVE_RING;
      }
      if (level === start) level = (start + VALVE_DELTAS[0]!) % VALVE_RING;
      return { ...def, start, target: level };
    }
    case 'anomaly': {
      if (def.anomalous) return def;
      return { ...def, anomalous: rng.pick(def.targets) };
    }
    case 'fuse':
      return def;
  }
}

export function createPuzzle(def: PuzzleDef, difficulty: Difficulty): Puzzle {
  switch (def.kind) {
    case 'sequence':
      return new SequencePuzzle(def.id, def.mode, def.solution ?? [], def.clueFurn, difficulty);
    case 'switches':
      return new SwitchPuzzle(def.id, def.solution ?? [true, false, true]);
    case 'valves':
      return new ValvePuzzle(def.id, def.start ?? 2, def.target ?? 7);
    case 'fuse':
      return new FusePuzzle(def.id);
    case 'anomaly':
      return new AnomalyPuzzle(def.id, def.targets, def.anomalous ?? def.targets[0] ?? '');
  }
}
