import type { Cue, Difficulty, EntityKind, HideProps, Rect, SafeZone, Vec2 } from '../../core/types';
import type { NavGrid } from '../nav';

export interface PlayerView {
  pos: Vec2;
  hide: HideProps | null;
  hideId: string | null;
  /** Rayon de bruit actuel (0 = silencieux). */
  noiseRadius: number;
  lampOn: boolean;
  crouched: boolean;
  running: boolean;
  inSafeZone: boolean;
}

export interface HideSpotView {
  id: string;
  pos: Vec2;
  props: HideProps;
}

export interface RoomView {
  w: number;
  h: number;
  blockers: Rect[];
  nav: NavGrid;
  hideSpots: HideSpotView[];
  safeZones: SafeZone[];
  water?: Rect;
  doorPoints: Record<string, Vec2>;
}

export interface Noise {
  pos: Vec2;
  radius: number;
  kind: 'player' | 'object' | 'door' | 'throw';
}

export interface EntityContext {
  player: PlayerView;
  room: RoomView;
  noises: Noise[];
  difficulty: Difficulty;
  emit: (cue: Cue) => void;
  rng: () => number;
}

export interface Entity {
  readonly id: string;
  readonly kind: EntityKind;
  pos: Vec2;
  /** Angle de regard en radians (espace monde). */
  facing: number;
  state: string;
  /** L'entité a attrapé le joueur. */
  caught: boolean;
  /** L'entité a disparu de la salle. */
  gone: boolean;
  /** Visible à l'écran (peut être caché sous l'eau, au plafond…). */
  visible: boolean;
  /** Présente une menace active pour le joueur. */
  threatening: boolean;
  update(dt: number, ctx: EntityContext): void;
  /** Disparition forcée (énigme résolue, joueur sorti…). */
  dismiss(): void;
}
