import type { Difficulty } from '../core/types';

export type Action = 'up' | 'down' | 'left' | 'right' | 'interact' | 'run' | 'crouch' | 'inventory' | 'lamp' | 'pause' | 'hint';

export type Bindings = Record<Action, string[]>;

export const DEFAULT_BINDINGS: Bindings = {
  up: ['z', 'w', 'arrowup'],
  down: ['s', 'arrowdown'],
  left: ['q', 'a', 'arrowleft'],
  right: ['d', 'arrowright'],
  interact: ['e', 'enter'],
  run: ['shift'],
  crouch: ['control', 'c'],
  inventory: ['i', 'tab'],
  lamp: ['f'],
  pause: ['escape', 'p'],
  hint: ['h'],
};

export const ACTION_LABELS: Record<Action, string> = {
  up: 'Haut',
  down: 'Bas',
  left: 'Gauche',
  right: 'Droite',
  interact: 'Interagir',
  run: 'Courir',
  crouch: 'S’accroupir',
  inventory: 'Inventaire',
  lamp: 'Lampe',
  pause: 'Pause',
  hint: 'Indice',
};

export interface Settings {
  audio: { master: number; music: number; sfx: number; ambience: number };
  accessibility: {
    reduceMotion: boolean;
    subtitles: boolean;
    highContrast: boolean;
    textScale: number;
    hints: boolean;
  };
  difficulty: Difficulty;
  bindings: Bindings;
}

export function defaultSettings(): Settings {
  return {
    audio: { master: 0.8, music: 0.6, sfx: 0.8, ambience: 0.7 },
    accessibility: { reduceMotion: false, subtitles: true, highContrast: false, textScale: 1, hints: true },
    difficulty: 'normal',
    bindings: structuredClone(DEFAULT_BINDINGS),
  };
}

function clamp01(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : fallback;
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

/** Valide et complète des réglages inconnus : jamais d'exception, toujours un objet utilisable. */
export function sanitizeSettings(raw: unknown): Settings {
  const d = defaultSettings();
  if (typeof raw !== 'object' || raw === null) return d;
  const r = raw as Record<string, unknown>;
  const a = (typeof r.audio === 'object' && r.audio !== null ? r.audio : {}) as Record<string, unknown>;
  const x = (typeof r.accessibility === 'object' && r.accessibility !== null ? r.accessibility : {}) as Record<string, unknown>;
  const scale = typeof x.textScale === 'number' && [1, 1.25, 1.5].includes(x.textScale) ? x.textScale : 1;
  const difficulty: Difficulty = r.difficulty === 'easy' || r.difficulty === 'hard' ? r.difficulty : 'normal';
  const bindings = structuredClone(DEFAULT_BINDINGS);
  if (typeof r.bindings === 'object' && r.bindings !== null) {
    const b = r.bindings as Record<string, unknown>;
    for (const action of Object.keys(bindings) as Action[]) {
      const v = b[action];
      if (Array.isArray(v) && v.length > 0 && v.length <= 4 && v.every((k) => typeof k === 'string' && k.length > 0 && k.length <= 16)) {
        bindings[action] = v as string[];
      }
    }
  }
  return {
    audio: {
      master: clamp01(a.master, d.audio.master),
      music: clamp01(a.music, d.audio.music),
      sfx: clamp01(a.sfx, d.audio.sfx),
      ambience: clamp01(a.ambience, d.audio.ambience),
    },
    accessibility: {
      reduceMotion: bool(x.reduceMotion, d.accessibility.reduceMotion),
      subtitles: bool(x.subtitles, d.accessibility.subtitles),
      highContrast: bool(x.highContrast, d.accessibility.highContrast),
      textScale: scale,
      hints: bool(x.hints, d.accessibility.hints),
    },
    difficulty,
    bindings,
  };
}
