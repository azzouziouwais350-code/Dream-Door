// Types partagés : données des salles, entités, objets. Aucune dépendance à Phaser.

export interface Vec2 {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Difficulty = 'easy' | 'normal' | 'hard';
export type Dir = 'DR' | 'DL' | 'UR' | 'UL';

export type FloorStyle = 'carpet' | 'checker' | 'wood' | 'tile' | 'marble' | 'dream';
export type WallStyle = 'stripes' | 'panel' | 'plain' | 'service' | 'dream';
export type Ambience = 'hotel' | 'corridor' | 'service' | 'quiet' | 'wind' | 'pool';
export type Surface = 'carpet' | 'wood' | 'tile' | 'marble';

export type RoomCategory = 'start' | 'calm' | 'key' | 'puzzle' | 'danger' | 'special' | 'side' | 'final';

export type FurnKind =
  | 'bed'
  | 'wardrobe'
  | 'closet'
  | 'desk'
  | 'drawer'
  | 'couch'
  | 'table'
  | 'plant'
  | 'floorlamp'
  | 'counter'
  | 'crate'
  | 'shelf'
  | 'rug'
  | 'fusebox'
  | 'breaker'
  | 'valve'
  | 'gauge'
  | 'musicbox'
  | 'piano'
  | 'console'
  | 'trolley'
  | 'painting'
  | 'window'
  | 'clock'
  | 'elevatorPanel'
  | 'statue';

export type EntityKind = 'watcher' | 'ceilingShadow' | 'swimmer' | 'concierge' | 'falseThreshold';

export interface ItemStack {
  id: string;
  count: number;
}

/** Propriétés d'une cachette : ce contre quoi elle protège. */
export interface HideProps {
  /** Protège contre les entités qui voient. */
  vision: boolean;
  /** Étouffe le bruit du joueur (sinon un grincement reste audible à courte portée). */
  noise: boolean;
  /** Une entité peut venir inspecter cette cachette. */
  inspectable: boolean;
  label: string;
}

export type LockDef =
  | { type: 'none' }
  | { type: 'key'; keyId: string }
  | { type: 'puzzle'; puzzleId: string }
  | { type: 'item'; item: string; count: number }
  | { type: 'ending' }
  | { type: 'sealed'; reason: string };

export type DoorRole = 'entry' | 'exit' | 'false' | 'secret';

export interface DoorDef {
  id: string;
  wall: 'N' | 'W';
  /** Index de la première tuile occupée (la porte couvre 2 tuiles). */
  at: number;
  role: DoorRole;
  lock?: LockDef;
  /** Identifiant d'une salle annexe (porte secrète / fausse porte). */
  target?: string;
  /** Porte cachée tant que `revealedBy` n'a pas eu lieu. */
  hidden?: boolean;
  revealedBy?: string;
  /** Dans une salle annexe : la porte ramène à la salle parente. */
  returns?: boolean;
  label?: string;
}

export interface FurnitureDef {
  id: string;
  kind: FurnKind;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Objet mural (tableau, fenêtre, horloge) : x ou y = indice le long du mur. */
  wall?: 'N' | 'W';
  blocking?: boolean;
  hide?: HideProps;
  loot?: ItemStack[];
  /** Peut recevoir la clé de la salle. */
  keySlot?: boolean;
  /** Peut recevoir un fragment de souvenir. */
  fragmentSlot?: boolean;
  /** Peut recevoir un petit objet bonus aléatoire. */
  bonus?: boolean;
  searchText?: string;
  read?: string[];
  puzzleId?: string;
  /** 'operate' : le joueur manipule l'énigme ; 'clue' : le meuble donne l'indice. */
  puzzleRole?: 'operate' | 'clue';
  /** Meuble déplaçable (une seule fois) : révèle un passage ou un objet. */
  movable?: { dx: number; dy: number; reveals?: string; text: string };
  label?: string;
}

export interface FloorItemDef {
  id: string;
  item: ItemStack;
  x: number;
  y: number;
}

export interface SafeZone {
  x: number;
  y: number;
  r: number;
}

export interface EntitySpawn {
  kind: EntityKind;
  x: number;
  y: number;
  patrol?: Vec2[];
  /** Délai de grâce avant que l'entité n'agisse. */
  delay?: number;
  announces?: string;
  /** Pour la fausse porte : id de la porte imitée. */
  doorId?: string;
  /** Ne laisse la zone d'eau à l'entité que dans ce rectangle. */
  water?: Rect;
}

export interface NpcDef {
  id: string;
  name: string;
  x: number;
  y: number;
}

export type PuzzleDef =
  | { id: string; kind: 'sequence'; mode: 'visual' | 'sound'; clueFurn: string; solution?: string[] }
  | { id: string; kind: 'switches'; solution?: boolean[] }
  | { id: string; kind: 'valves'; start?: number; target?: number }
  | { id: string; kind: 'fuse' }
  | { id: string; kind: 'anomaly'; targets: string[]; anomalous?: string };

export interface RoomDef {
  id: string;
  name: string;
  category: RoomCategory;
  w: number;
  h: number;
  floor: FloorStyle;
  wall: WallStyle;
  surface: Surface;
  ambience: Ambience;
  /** Obscurité ambiante 0..1 et teinte. */
  light: { dark: number; tint: number };
  spawn: Vec2;
  doors: DoorDef[];
  furniture: FurnitureDef[];
  floorItems?: FloorItemDef[];
  puzzles?: PuzzleDef[];
  safeZones?: SafeZone[];
  entities?: EntitySpawn[];
  npc?: NpcDef;
  objective: string;
  narration?: string;
  checkpoint?: boolean;
  water?: Rect;
}

export interface Cue {
  entityId: string;
  kind: 'visual' | 'audio';
  id: string;
  text: string;
}

export const EPS = 1e-6;
