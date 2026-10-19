import type {
  DoorDef,
  FurnKind,
  FurnitureDef,
  HideProps,
  RoomCategory,
  RoomDef,
} from '../../core/types';

export const KEY_PLACEHOLDER = '@KEY';

export const HIDE = {
  wardrobe: { vision: true, noise: true, inspectable: true, label: 'Armoire' } satisfies HideProps,
  closet: { vision: true, noise: true, inspectable: false, label: 'Placard à balais' } satisfies HideProps,
  nook: { vision: true, noise: false, inspectable: true, label: 'Recoin du comptoir' } satisfies HideProps,
  underBed: { vision: true, noise: true, inspectable: true, label: 'Sous le lit' } satisfies HideProps,
  booth: { vision: true, noise: false, inspectable: false, label: 'Isoloir de velours' } satisfies HideProps,
};

type FurnExtra = Partial<Omit<FurnitureDef, 'kind' | 'x' | 'y' | 'w' | 'h' | 'id'>>;

export function F(id: string, kind: FurnKind, x: number, y: number, w: number, h: number, extra: FurnExtra = {}): FurnitureDef {
  const isWall = extra.wall !== undefined;
  return { id, kind, x, y, w, h, blocking: !isWall, ...extra };
}

/** Porte sur le mur nord (y = 0) : couvre les tuiles x..x+1. */
export function doorN(id: string, at: number, role: DoorDef['role'], extra: Partial<DoorDef> = {}): DoorDef {
  return { id, wall: 'N', at, role, ...extra };
}

/** Porte sur le mur ouest (x = 0) : couvre les tuiles y..y+1. */
export function doorW(id: string, at: number, role: DoorDef['role'], extra: Partial<DoorDef> = {}): DoorDef {
  return { id, wall: 'W', at, role, ...extra };
}

export function doorPoint(d: Pick<DoorDef, 'wall' | 'at'>): { x: number; y: number } {
  return d.wall === 'N' ? { x: d.at + 1, y: 0.5 } : { x: 0.5, y: d.at + 1 };
}

export interface RoomTemplate extends Omit<RoomDef, 'id'> {
  tid: string;
  /** Plage d'indices de salle dans le chapitre (0 = accueil). */
  minIndex: number;
  maxIndex: number;
  weight: number;
  /** Peut accueillir une salle annexe secrète via un meuble déplaçable. */
  secretAnnex?: 'watch' | 'chalk';
  /** Ajoute une fausse porte et son annexe. */
  falseDoor?: boolean;
  tags?: string[];
}

export function category(c: RoomCategory): RoomCategory {
  return c;
}
