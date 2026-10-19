import { type Action, type Bindings, DEFAULT_BINDINGS } from '../systems/settings';

export interface InputCallbacks {
  onInteract: () => void;
  onLamp: () => void;
  onInventory: () => void;
  onPause: () => void;
  onHint: () => void;
  onAnyGesture: () => void;
}

export function normalizeKey(e: KeyboardEvent): string {
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase();
  return k === ' ' ? 'space' : k;
}

export function keyLabel(k: string): string {
  const map: Record<string, string> = {
    arrowup: '↑',
    arrowdown: '↓',
    arrowleft: '←',
    arrowright: '→',
    shift: 'Maj',
    control: 'Ctrl',
    escape: 'Échap',
    enter: 'Entrée',
    tab: 'Tab',
    space: 'Espace',
  };
  return map[k] ?? k.toUpperCase();
}

/**
 * Entrées clavier + tactile. Le clavier est lu par `event.key` (caractère), ce qui rend ZQSD (AZERTY)
 * et WASD (QWERTY) fonctionnels sans configuration.
 */
export class InputManager {
  private bindings: Bindings = structuredClone(DEFAULT_BINDINGS);
  private down = new Set<string>();
  private touchMove = { x: 0, y: 0 };
  private touchRun = false;
  private touchCrouch = false;
  private enabled = true;
  private cb: InputCallbacks;
  private rebinding: ((key: string) => void) | null = null;

  private onKeyDown = (e: KeyboardEvent): void => {
    this.cb.onAnyGesture();
    const k = normalizeKey(e);
    if (this.rebinding) {
      e.preventDefault();
      const fn = this.rebinding;
      this.rebinding = null;
      fn(k);
      return;
    }
    if (this.isBound(k)) {
      // Évite le défilement de la page et le focus Tab.
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'tab', 'space'].includes(k)) e.preventDefault();
    }
    if (e.repeat) return;
    this.down.add(k);
    if (this.matches('pause', k)) this.cb.onPause();
    if (!this.enabled) return;
    if (this.matches('interact', k)) this.cb.onInteract();
    else if (this.matches('lamp', k)) this.cb.onLamp();
    else if (this.matches('inventory', k)) this.cb.onInventory();
    else if (this.matches('hint', k)) this.cb.onHint();
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.down.delete(normalizeKey(e));
  };

  private onBlur = (): void => {
    this.down.clear();
    this.touchMove = { x: 0, y: 0 };
  };

  constructor(cb: InputCallbacks) {
    this.cb = cb;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('visibilitychange', this.onBlur);
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('visibilitychange', this.onBlur);
  }

  setBindings(b: Bindings): void {
    this.bindings = structuredClone(b);
  }

  getBindings(): Bindings {
    return structuredClone(this.bindings);
  }

  /** Active/désactive les actions de jeu (les menus restent pilotables). */
  setEnabled(v: boolean): void {
    this.enabled = v;
    if (!v) {
      this.touchMove = { x: 0, y: 0 };
    }
  }

  /** Attend la prochaine touche pour reconfigurer une action. */
  captureNextKey(fn: (key: string) => void): void {
    this.rebinding = fn;
  }

  cancelCapture(): void {
    this.rebinding = null;
  }

  private matches(action: Action, key: string): boolean {
    return this.bindings[action].includes(key);
  }

  private isBound(key: string): boolean {
    return (Object.keys(this.bindings) as Action[]).some((a) => this.bindings[a].includes(key));
  }

  private held(action: Action): boolean {
    return this.bindings[action].some((k) => this.down.has(k));
  }

  /** Axes de déplacement en espace écran (droite = +x, bas = +y). */
  axes(): { mx: number; my: number } {
    if (!this.enabled) return { mx: 0, my: 0 };
    let mx = (this.held('right') ? 1 : 0) - (this.held('left') ? 1 : 0);
    let my = (this.held('down') ? 1 : 0) - (this.held('up') ? 1 : 0);
    if (mx !== 0 && my !== 0) {
      mx *= Math.SQRT1_2;
      my *= Math.SQRT1_2;
    }
    mx += this.touchMove.x;
    my += this.touchMove.y;
    const len = Math.hypot(mx, my);
    if (len > 1) {
      mx /= len;
      my /= len;
    }
    return { mx, my };
  }

  running(): boolean {
    return this.enabled && (this.held('run') || this.touchRun);
  }

  crouching(): boolean {
    return this.enabled && (this.held('crouch') || this.touchCrouch);
  }

  /* -- Tactile -------------------------------------------------------- */
  setTouchMove(x: number, y: number): void {
    this.touchMove = { x, y };
  }

  setTouchRun(v: boolean): void {
    this.touchRun = v;
  }

  setTouchCrouch(v: boolean): void {
    this.touchCrouch = v;
  }

  toggleTouchCrouch(): boolean {
    this.touchCrouch = !this.touchCrouch;
    return this.touchCrouch;
  }

  fire(action: 'interact' | 'lamp' | 'inventory' | 'pause' | 'hint'): void {
    this.cb.onAnyGesture();
    if (action === 'pause') return this.cb.onPause();
    if (!this.enabled) return;
    if (action === 'interact') this.cb.onInteract();
    else if (action === 'lamp') this.cb.onLamp();
    else if (action === 'inventory') this.cb.onInventory();
    else this.cb.onHint();
  }
}
