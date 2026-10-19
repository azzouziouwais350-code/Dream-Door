import type { Difficulty, ItemStack } from '../core/types';
import { Inventory } from './inventory';
import { type Settings, defaultSettings, sanitizeSettings } from './settings';

export const SAVE_VERSION = 1;
export const SAVE_KEY = 'dream-doors:save';
export const META_KEY = 'dream-doors:meta';
export const SETTINGS_KEY = 'dream-doors:settings';

/** État persistant d'une salle déjà visitée. */
export interface RoomState {
  searched: string[];
  taken: string[];
  solved: string[];
  moved: string[];
  revealed: string[];
  unlocked: string[];
  marks: Array<{ x: number; y: number }>;
  npcTalks: number;
}

export function emptyRoomState(): RoomState {
  return { searched: [], taken: [], solved: [], moved: [], revealed: [], unlocked: [], marks: [], npcTalks: 0 };
}

export interface Checkpoint {
  roomId: string;
  inventory: ItemStack[];
  lampCharge: number;
  roomStates: Record<string, RoomState>;
  visited: string[];
}

export interface SaveData {
  version: number;
  chapter: number;
  seed: number;
  difficulty: Difficulty;
  roomId: string;
  inventory: ItemStack[];
  lampCharge: number;
  roomStates: Record<string, RoomState>;
  visited: string[];
  checkpoint: Checkpoint;
  hintLevels: Record<string, number>;
  playTime: number;
  savedAt: number;
}

/** Progression globale (indépendante de la partie en cours). */
export interface Meta {
  endings: string[];
  chaptersUnlocked: number;
  bestRooms: number;
}

export function defaultMeta(): Meta {
  return { endings: [], chaptersUnlocked: 1, bestRooms: 0 };
}

/** Stockage abstrait : localStorage dans le navigateur, mémoire dans les tests. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export class MemoryStore implements KeyValueStore {
  private data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
}

export function browserStore(): KeyValueStore {
  try {
    const ls = window.localStorage;
    const probe = '__dd_probe__';
    ls.setItem(probe, '1');
    ls.removeItem(probe);
    return ls;
  } catch {
    // Navigation privée / stockage bloqué : on retombe sur la mémoire (la partie ne survivra pas à l'actualisation).
    return new MemoryStore();
  }
}

/* -------------------------------------------------------------------------- */
/* Validation                                                                 */
/* -------------------------------------------------------------------------- */
const isStr = (v: unknown, max = 128): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const strArr = (v: unknown, maxLen = 400): v is string[] => Array.isArray(v) && v.length <= maxLen && v.every((x) => isStr(x));

function validRoomState(v: unknown): v is RoomState {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    strArr(r.searched) &&
    strArr(r.taken) &&
    strArr(r.solved) &&
    strArr(r.moved) &&
    strArr(r.revealed) &&
    strArr(r.unlocked) &&
    Array.isArray(r.marks) &&
    r.marks.length <= 64 &&
    r.marks.every((m) => typeof m === 'object' && m !== null && isNum((m as { x: unknown }).x) && isNum((m as { y: unknown }).y)) &&
    isNum(r.npcTalks)
  );
}

function validRoomStates(v: unknown): v is Record<string, RoomState> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const entries = Object.entries(v as Record<string, unknown>);
  if (entries.length > 400) return false;
  return entries.every(([k, s]) => isStr(k) && validRoomState(s));
}

function validInventory(v: unknown): v is ItemStack[] {
  return new Inventory().load(v);
}

export type Migration = (raw: Record<string, unknown>) => Record<string, unknown>;

/** Applique les migrations successives `from → from+1` jusqu'à la version courante. */
export function migrate(raw: Record<string, unknown>, migrations: Record<number, Migration> = {}, target = SAVE_VERSION): Record<string, unknown> | null {
  let cur = raw;
  let version = typeof cur.version === 'number' ? cur.version : 0;
  if (version > target) return null; // sauvegarde d'une version plus récente : on refuse plutôt que de corrompre.
  while (version < target) {
    const step = migrations[version];
    if (!step) return null;
    cur = step(cur);
    version = typeof cur.version === 'number' ? cur.version : version + 1;
  }
  return cur;
}

/** Retourne une sauvegarde valide ou null. Ne lève jamais d'exception. */
export function parseSave(json: string | null, migrations: Record<number, Migration> = {}): SaveData | null {
  if (!json || json.length > 2_000_000) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const migrated = migrate(raw as Record<string, unknown>, migrations);
  if (!migrated) return null;
  const s = migrated;
  if (s.version !== SAVE_VERSION) return null;
  if (!isNum(s.chapter) || !Number.isInteger(s.chapter) || s.chapter < 1 || s.chapter > 5) return null;
  if (!isNum(s.seed) || !Number.isInteger(s.seed)) return null;
  if (s.difficulty !== 'easy' && s.difficulty !== 'normal' && s.difficulty !== 'hard') return null;
  if (!isStr(s.roomId)) return null;
  if (!validInventory(s.inventory)) return null;
  if (!isNum(s.lampCharge) || s.lampCharge < 0 || s.lampCharge > 600) return null;
  if (!validRoomStates(s.roomStates)) return null;
  if (!strArr(s.visited)) return null;
  const cp = s.checkpoint as Record<string, unknown> | undefined;
  if (typeof cp !== 'object' || cp === null) return null;
  if (!isStr(cp.roomId) || !validInventory(cp.inventory) || !isNum(cp.lampCharge) || !validRoomStates(cp.roomStates) || !strArr(cp.visited)) return null;
  const hl = s.hintLevels;
  if (typeof hl !== 'object' || hl === null || Array.isArray(hl)) return null;
  if (!Object.values(hl as Record<string, unknown>).every((n) => isNum(n) && n >= 0 && n <= 9)) return null;
  if (!isNum(s.playTime) || s.playTime < 0) return null;
  return s as unknown as SaveData;
}

/* -------------------------------------------------------------------------- */
/* Gestionnaire                                                               */
/* -------------------------------------------------------------------------- */
export type LoadResult = { ok: true; data: SaveData } | { ok: false; reason: 'none' | 'corrupted' };

export class SaveManager {
  constructor(private readonly store: KeyValueStore) {}

  save(data: SaveData): boolean {
    try {
      this.store.setItem(SAVE_KEY, JSON.stringify(data));
      return true;
    } catch {
      return false;
    }
  }

  load(migrations: Record<number, Migration> = {}): LoadResult {
    let json: string | null = null;
    try {
      json = this.store.getItem(SAVE_KEY);
    } catch {
      return { ok: false, reason: 'none' };
    }
    if (json === null) return { ok: false, reason: 'none' };
    const data = parseSave(json, migrations);
    return data ? { ok: true, data } : { ok: false, reason: 'corrupted' };
  }

  hasSave(): boolean {
    try {
      return this.store.getItem(SAVE_KEY) !== null;
    } catch {
      return false;
    }
  }

  /** Conserve la sauvegarde illisible sous une autre clé avant de l'effacer, pour ne rien détruire en silence. */
  quarantineCorrupted(): void {
    try {
      const raw = this.store.getItem(SAVE_KEY);
      if (raw !== null) this.store.setItem(`${SAVE_KEY}:corrupted`, raw.slice(0, 200_000));
      this.store.removeItem(SAVE_KEY);
    } catch {
      /* rien à faire */
    }
  }

  clear(): void {
    try {
      this.store.removeItem(SAVE_KEY);
    } catch {
      /* ignoré */
    }
  }

  loadMeta(): Meta {
    const d = defaultMeta();
    try {
      const raw = this.store.getItem(META_KEY);
      if (!raw) return d;
      const m = JSON.parse(raw) as Record<string, unknown>;
      const endings = Array.isArray(m.endings) ? m.endings.filter((e): e is string => typeof e === 'string').slice(0, 8) : [];
      return {
        endings: [...new Set(endings)],
        chaptersUnlocked: isNum(m.chaptersUnlocked) ? Math.max(1, Math.min(5, Math.floor(m.chaptersUnlocked))) : 1,
        bestRooms: isNum(m.bestRooms) ? Math.max(0, Math.floor(m.bestRooms)) : 0,
      };
    } catch {
      return d;
    }
  }

  saveMeta(meta: Meta): void {
    try {
      this.store.setItem(META_KEY, JSON.stringify(meta));
    } catch {
      /* ignoré */
    }
  }

  loadSettings(): Settings {
    try {
      const raw = this.store.getItem(SETTINGS_KEY);
      if (!raw) return defaultSettings();
      return sanitizeSettings(JSON.parse(raw));
    } catch {
      return defaultSettings();
    }
  }

  saveSettings(s: Settings): void {
    try {
      this.store.setItem(SETTINGS_KEY, JSON.stringify(s));
    } catch {
      /* ignoré */
    }
  }
}
