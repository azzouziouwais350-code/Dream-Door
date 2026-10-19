import { CHAPTER_TITLES, ENDINGS, type EndingId, getEnding } from '../data/story';
import { getItemDef } from '../data/items';
import type { Difficulty } from '../core/types';
import { drawSymbolIcon, iconDataUrls } from '../gfx/icons';
import { keyLabel } from '../input/input';
import type { World } from '../game/world';
import {
  type Feedback,
  type Puzzle,
  NOTE_NAMES,
  SYMBOL_NAMES,
  SequencePuzzle,
  SwitchPuzzle,
  ValvePuzzle,
  VALVE_RING,
} from '../systems/puzzles';
import type { Meta } from '../systems/save';
import { ACTION_LABELS, type Action, type Settings } from '../systems/settings';
import { clear, formatTime, h } from './dom';

export interface UIActions {
  hasSave(): boolean;
  saveSummary(): string | null;
  meta(): Meta;
  settings(): Settings;
  applySettings(s: Settings): void;
  newGame(difficulty: Difficulty, seed: number | null): void;
  continueGame(): void;
  resume(): void;
  quitToMenu(): void;
  useItem(id: string): void;
  hint(): void;
  respawn(): void;
  world(): World | null;
  puzzleAction: World['puzzleAction'];
  answerChoice(i: number): void;
  chooseEnding(id: EndingId): void;
  playSequence(notes: string[]): void;
  resetSave(): void;
  captureKey(fn: (k: string) => void): void;
  cancelCapture(): void;
  fire(a: 'interact' | 'lamp' | 'inventory' | 'pause' | 'hint'): void;
  setTouch(x: number, y: number): void;
  setRun(v: boolean): void;
  toggleCrouch(): boolean;
  click(): void;
}

type ModalKind =
  | 'menu'
  | 'chapters'
  | 'options'
  | 'credits'
  | 'pause'
  | 'inventory'
  | 'map'
  | 'defeat'
  | 'ending'
  | 'puzzle'
  | 'dialogue'
  | 'read'
  | 'choice'
  | 'endingMenu'
  | 'confirm'
  | 'newgame';

const NOTE_COLORS: Record<string, string> = { grave: '#72dcd4', medium: '#f3b5d8', aigu: '#ffe6b0' };

export class UI {
  readonly root: HTMLElement;
  private hud: HTMLElement;
  private modalHost: HTMLElement;
  private toasts: HTMLElement;
  private subtitleEl: HTMLElement;
  private promptEl: HTMLElement;
  private doorEl: HTMLElement;
  private objEl: HTMLElement;
  private lampEl: HTMLElement;
  private lampFill: HTMLElement;
  private dangerEl: HTMLElement;
  private quickBar: HTMLElement;
  private touchLayer: HTMLElement;
  private joyBase: HTMLElement;
  private joyKnob: HTMLElement;
  private flashEl: HTMLElement;
  private modal: ModalKind | null = null;
  private modalStack: Array<() => void> = [];
  private icons = iconDataUrls();
  private subtitleTimer: number | null = null;
  private dialogue: { name: string; lines: string[]; i: number } | null = null;
  private lastQuick = '';
  private lastPrompt = '';
  private lastDoor = '';
  private lastObj = '';
  private lastLamp = -2;
  private lastDanger = -1;
  private joyId: number | null = null;

  constructor(
    parent: HTMLElement,
    private readonly act: UIActions,
  ) {
    this.root = h('div', { id: 'ui', class: 'ui' });
    this.hud = h('div', { class: 'hud hidden' });
    this.modalHost = h('div', { class: 'modal-host', role: 'dialog' });
    this.toasts = h('div', { class: 'toasts', ariaLive: 'polite' });
    this.subtitleEl = h('div', { class: 'subtitle hidden', ariaLive: 'polite' });
    this.promptEl = h('button', { class: 'prompt hidden', type: 'button', on: { click: () => this.act.fire('interact') } });
    this.doorEl = h('div', { class: 'hud-door' });
    this.objEl = h('div', { class: 'hud-objective' });
    this.lampFill = h('div', { class: 'meter-fill' });
    this.lampEl = h('div', { class: 'meter', title: 'Charge de la lampe' }, h('span', { class: 'meter-label', text: 'LAMPE' }), h('div', { class: 'meter-bar' }, this.lampFill));
    this.dangerEl = h('div', { class: 'danger', ariaLive: 'polite' });
    this.quickBar = h('div', { class: 'quick' });
    this.flashEl = h('div', { class: 'flash' });
    this.joyKnob = h('div', { class: 'joy-knob' });
    this.joyBase = h('div', { class: 'joy-base' }, this.joyKnob);
    this.touchLayer = this.buildTouch();

    const pauseBtn = h('button', { class: 'btn small hud-pause', type: 'button', text: 'II', ariaLabel: 'Pause', on: { click: () => this.act.fire('pause') } });
    const topLeft = h('div', { class: 'hud-tl px-frame' }, this.doorEl, this.objEl);
    const topRight = h('div', { class: 'hud-tr' }, this.lampEl, this.dangerEl, pauseBtn);
    this.hud.append(topLeft, topRight, this.quickBar, this.promptEl);
    this.root.append(this.flashEl, this.hud, this.toasts, this.subtitleEl, this.touchLayer, this.modalHost);
    parent.append(this.root);
    this.applyTouchVisibility();
    window.addEventListener('resize', () => this.applyTouchVisibility());
    this.applyAccessibility(act.settings());
  }

  /* ---------------------------------------------------------------------- */
  /* Accessibilité                                                           */
  /* ---------------------------------------------------------------------- */
  applyAccessibility(s: Settings): void {
    this.root.style.setProperty('--scale', String(s.accessibility.textScale));
    this.root.classList.toggle('hc', s.accessibility.highContrast);
    this.root.classList.toggle('rm', s.accessibility.reduceMotion);
    document.documentElement.classList.toggle('rm', s.accessibility.reduceMotion);
    this.subtitleEl.classList.toggle('off', !s.accessibility.subtitles);
  }

  /* ---------------------------------------------------------------------- */
  /* Tactile                                                                 */
  /* ---------------------------------------------------------------------- */
  private isTouch(): boolean {
    return 'ontouchstart' in window || navigator.maxTouchPoints > 0 || new URLSearchParams(location.search).has('touch');
  }

  private applyTouchVisibility(): void {
    this.touchLayer.classList.toggle('hidden', !this.isTouch() || !this.hudVisible);
  }

  private hudVisible = false;

  private buildTouch(): HTMLElement {
    const layer = h('div', { class: 'touch hidden' });
    const joyZone = h('div', { class: 'joy-zone' }, this.joyBase);
    const rect = (): DOMRect => joyZone.getBoundingClientRect();
    const update = (e: PointerEvent): void => {
      const r = rect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const max = r.width / 2 - 14;
      let dx = e.clientX - cx;
      let dy = e.clientY - cy;
      const len = Math.hypot(dx, dy);
      if (len > max) {
        dx = (dx / len) * max;
        dy = (dy / len) * max;
      }
      this.joyKnob.style.transform = `translate(${dx}px, ${dy}px)`;
      const nx = dx / max;
      const ny = dy / max;
      const mag = Math.hypot(nx, ny);
      // Zone morte : évite les dérives involontaires.
      if (mag < 0.18) this.act.setTouch(0, 0);
      else this.act.setTouch(nx, ny);
    };
    joyZone.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.joyId = e.pointerId;
      joyZone.setPointerCapture(e.pointerId);
      update(e);
    });
    joyZone.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.joyId) update(e);
    });
    const end = (e: PointerEvent): void => {
      if (e.pointerId !== this.joyId) return;
      this.joyId = null;
      this.joyKnob.style.transform = 'translate(0px, 0px)';
      this.act.setTouch(0, 0);
    };
    joyZone.addEventListener('pointerup', end);
    joyZone.addEventListener('pointercancel', end);

    const mkBtn = (cls: string, label: string, aria: string, handler: () => void): HTMLElement => {
      const b = h('button', { class: `tbtn ${cls}`, type: 'button', text: label, ariaLabel: aria });
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.act.click();
        handler();
      });
      return b;
    };
    const runBtn = h('button', { class: 'tbtn run', type: 'button', text: 'COURIR', ariaLabel: 'Courir (maintenir)' });
    runBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      runBtn.classList.add('on');
      this.act.setRun(true);
    });
    const stopRun = (): void => {
      runBtn.classList.remove('on');
      this.act.setRun(false);
    };
    runBtn.addEventListener('pointerup', stopRun);
    runBtn.addEventListener('pointercancel', stopRun);
    runBtn.addEventListener('pointerleave', stopRun);

    const crouchBtn = mkBtn('crouch', 'BAS', 'S’accroupir (bascule)', () => {
      const on = this.act.toggleCrouch();
      crouchBtn.classList.toggle('on', on);
    });
    const buttons = h(
      'div',
      { class: 'touch-buttons' },
      mkBtn('act', 'E', 'Interagir', () => this.act.fire('interact')),
      runBtn,
      mkBtn('lamp', 'LAMPE', 'Lampe', () => this.act.fire('lamp')),
      mkBtn('inv', 'SAC', 'Inventaire', () => this.act.fire('inventory')),
      crouchBtn,
      mkBtn('hint', '?', 'Indice', () => this.act.fire('hint')),
    );
    layer.append(joyZone, buttons);
    return layer;
  }

  /* ---------------------------------------------------------------------- */
  /* HUD                                                                     */
  /* ---------------------------------------------------------------------- */
  showHud(v: boolean): void {
    this.hudVisible = v;
    this.hud.classList.toggle('hidden', !v);
    this.applyTouchVisibility();
    if (!v) {
      this.subtitleEl.classList.add('hidden');
      clear(this.toasts);
    }
  }

  /** Mise à jour légère à chaque image : ne touche au DOM que si une valeur change. */
  updateHud(w: World): void {
    const door = `${w.currentDoorNumber} — ${w.room.name}`;
    if (door !== this.lastDoor) {
      this.lastDoor = door;
      this.doorEl.textContent = door;
    }
    if (w.objective !== this.lastObj) {
      this.lastObj = w.objective;
      this.objEl.textContent = `▸ ${w.objective}`;
    }
    const lampPct = w.inv.has('lamp') ? Math.round((w.lampCharge / 180) * 100) : -1;
    if (lampPct !== this.lastLamp) {
      this.lastLamp = lampPct;
      this.lampEl.classList.toggle('hidden', lampPct < 0);
      this.lampFill.style.width = `${Math.max(0, lampPct)}%`;
      this.lampEl.classList.toggle('low', lampPct >= 0 && lampPct < 12);
    }
    this.lampEl.classList.toggle('on', w.lampOn);
    const danger = w.dangerLevel();
    if (danger !== this.lastDanger) {
      this.lastDanger = danger;
      this.dangerEl.textContent = danger === 2 ? '⚠ DANGER' : danger === 1 ? '◉ Une présence…' : '';
      this.dangerEl.className = `danger lvl${danger}`;
    }
    const t = w.target;
    const prompt = t ? `[E] ${t.verb} — ${t.label}` : '';
    if (prompt !== this.lastPrompt) {
      this.lastPrompt = prompt;
      this.promptEl.textContent = prompt;
      this.promptEl.classList.toggle('hidden', !t);
    }
    const quick = w.inv
      .list()
      .map((s) => `${s.id}:${s.count}`)
      .join('|') + `|${w.inv.selected}`;
    if (quick !== this.lastQuick) {
      this.lastQuick = quick;
      this.renderQuick(w);
    }
  }

  private renderQuick(w: World): void {
    clear(this.quickBar);
    for (const s of w.inv.list().slice(0, 9)) {
      const def = getItemDef(s.id);
      const slot = h(
        'button',
        { class: 'qslot', type: 'button', title: def.name, ariaLabel: `${def.name} ×${s.count}`, on: { click: () => (def.usable ? this.act.useItem(s.id) : this.openInventory()) } },
        h('img', { class: 'icon', src: this.icons[def.icon] ?? this.icons.unknown, alt: '' }),
        s.count > 1 ? h('span', { class: 'qcount', text: String(s.count) }) : null,
      );
      this.quickBar.append(slot);
    }
  }

  toast(text: string, tone: 'info' | 'good' | 'bad' = 'info'): void {
    const el = h('div', { class: `toast ${tone}`, text });
    this.toasts.append(el);
    while (this.toasts.children.length > 4) this.toasts.firstElementChild?.remove();
    window.setTimeout(() => el.classList.add('fade'), 3600);
    window.setTimeout(() => el.remove(), 4300);
  }

  subtitle(text: string): void {
    this.subtitleEl.textContent = `♪ ${text}`;
    this.subtitleEl.classList.remove('hidden');
    if (this.subtitleTimer !== null) window.clearTimeout(this.subtitleTimer);
    this.subtitleTimer = window.setTimeout(() => this.subtitleEl.classList.add('hidden'), 4200);
  }

  flash(color = 'rgba(255,255,255,0.5)'): void {
    this.flashEl.style.background = color;
    this.flashEl.classList.remove('go');
    void this.flashEl.offsetWidth;
    this.flashEl.classList.add('go');
  }

  /* ---------------------------------------------------------------------- */
  /* Fenêtres modales                                                        */
  /* ---------------------------------------------------------------------- */
  get isModalOpen(): boolean {
    return this.modal !== null;
  }

  get currentModal(): ModalKind | null {
    return this.modal;
  }

  closeModal(): void {
    this.modal = null;
    this.dialogue = null;
    clear(this.modalHost);
    this.modalHost.classList.remove('open');
    this.act.cancelCapture();
  }

  private open(kind: ModalKind, content: HTMLElement, opts: { backdrop?: boolean; className?: string } = {}): void {
    clear(this.modalHost);
    this.modal = kind;
    this.modalHost.classList.add('open');
    this.modalHost.classList.toggle('plain', opts.backdrop === false);
    const frame = h('div', { class: `modal px-frame ${kind} ${opts.className ?? ''}` }, content);
    this.modalHost.append(frame);
    const first = frame.querySelector<HTMLElement>('button:not([disabled]), input, select');
    first?.focus({ preventScroll: true });
  }

  private btn(label: string, on: () => void, cls = '', disabled = false): HTMLButtonElement {
    return h('button', {
      class: `btn ${cls}`.trim(),
      type: 'button',
      text: label,
      disabled,
      on: {
        click: () => {
          this.act.click();
          on();
        },
      },
    });
  }

  /** Échap : ferme la fenêtre courante si elle peut l'être. Retourne true si elle a été gérée. */
  handleEscape(): boolean {
    switch (this.modal) {
      case null:
        return false;
      case 'menu':
        return true;
      case 'defeat':
      case 'ending':
        return true;
      case 'options':
      case 'credits':
      case 'chapters':
      case 'newgame':
      case 'confirm': {
        const back = this.modalStack.pop();
        if (back) back();
        return true;
      }
      case 'pause':
        this.closeModal();
        this.act.resume();
        return true;
      case 'dialogue':
        this.advanceDialogue();
        return true;
      default:
        this.closeModal();
        this.act.resume();
        return true;
    }
  }

  /* -- Menu principal ------------------------------------------------- */
  showMenu(): void {
    this.modalStack = [];
    this.showHud(false);
    const hasSave = this.act.hasSave();
    const summary = this.act.saveSummary();
    const meta = this.act.meta();
    const content = h(
      'div',
      { class: 'menu-body' },
      h('h1', { class: 'title', text: 'DREAM DOORS' }),
      h('p', { class: 'tagline', text: 'Aventure dreamcore dans un hôtel infini' }),
      h(
        'div',
        { class: 'menu-buttons' },
        this.btn('Nouvelle partie', () => (hasSave ? this.confirmNewGame() : this.showNewGame()), 'primary'),
        this.btn(summary ? `Continuer — ${summary}` : 'Continuer', () => this.act.continueGame(), '', !hasSave),
        this.btn('Chapitres', () => this.showChapters()),
        this.btn('Options', () => this.showOptions(() => this.showMenu())),
        this.btn('Crédits', () => this.showCredits()),
      ),
      h('p', { class: 'menu-foot', text: `Fins découvertes : ${meta.endings.length}/4` }),
    );
    this.open('menu', content, { backdrop: false, className: 'menu' });
  }

  private confirmNewGame(): void {
    this.modalStack.push(() => this.showMenu());
    this.open(
      'confirm',
      h(
        'div',
        {},
        h('h2', { text: 'Écraser la sauvegarde ?' }),
        h('p', { text: 'Une partie est déjà enregistrée. Une nouvelle partie la remplacera définitivement.' }),
        h('div', { class: 'row' }, this.btn('Annuler', () => this.showMenu()), this.btn('Nouvelle partie', () => this.showNewGame(), 'danger')),
      ),
    );
  }

  showNewGame(): void {
    this.modalStack = [() => this.showMenu()];
    const s = this.act.settings();
    let difficulty: Difficulty = s.difficulty;
    const seedInput = h('input', { type: 'text', value: '', class: 'input', ariaLabel: 'Graine', title: 'Laissez vide pour une graine aléatoire' });
    seedInput.setAttribute('placeholder', 'aléatoire');
    seedInput.setAttribute('inputmode', 'numeric');
    const diffRow = h('div', { class: 'seg', role: 'radiogroup' });
    const labels: Array<[Difficulty, string, string]> = [
      ['easy', 'Facile', 'Menaces plus lentes, indices clairs.'],
      ['normal', 'Normal', 'L’expérience recommandée.'],
      ['hard', 'Difficile', 'Menaces rapides, énigmes plus longues.'],
    ];
    const desc = h('p', { class: 'muted', text: '' });
    const refresh = (): void => {
      clear(diffRow);
      for (const [id, label, d] of labels) {
        const b = h('button', {
          class: `seg-btn ${id === difficulty ? 'on' : ''}`,
          type: 'button',
          text: label,
          role: 'radio',
          on: {
            click: () => {
              this.act.click();
              difficulty = id;
              refresh();
            },
          },
        });
        b.setAttribute('aria-checked', String(id === difficulty));
        diffRow.append(b);
        if (id === difficulty) desc.textContent = d;
      }
    };
    refresh();
    this.open(
      'newgame',
      h(
        'div',
        {},
        h('h2', { text: 'Nouvelle partie' }),
        h('p', { class: 'muted', text: CHAPTER_TITLES[1] ?? '' }),
        h('label', { class: 'field' }, h('span', { text: 'Difficulté' }), diffRow),
        desc,
        h('label', { class: 'field' }, h('span', { text: 'Graine (facultatif)' }), seedInput),
        h('p', { class: 'muted', text: 'Une même graine génère toujours le même hôtel.' }),
        h(
          'div',
          { class: 'row' },
          this.btn('Retour', () => this.showMenu()),
          this.btn(
            'Commencer',
            () => {
              const raw = seedInput.value.trim();
              const n = raw === '' ? null : Number.parseInt(raw, 10);
              this.act.newGame(difficulty, n !== null && Number.isFinite(n) ? Math.abs(n) % 2147483647 : null);
            },
            'primary',
          ),
        ),
      ),
    );
  }

  private showChapters(): void {
    this.modalStack = [() => this.showMenu()];
    const meta = this.act.meta();
    const list = h('div', { class: 'chapters' });
    for (let i = 1; i <= 5; i++) {
      const playable = i === 1;
      const unlocked = i <= meta.chaptersUnlocked;
      list.append(
        h(
          'div',
          { class: `chapter ${playable ? '' : 'locked'}` },
          h('div', { class: 'ch-title', text: CHAPTER_TITLES[i] ?? `Chapitre ${i}` }),
          h('div', { class: 'ch-state', text: playable ? 'Jouable' : unlocked ? 'Débloqué — bientôt disponible' : 'Verrouillé — bientôt disponible' }),
          playable ? this.btn('Jouer', () => (this.act.hasSave() ? this.confirmNewGame() : this.showNewGame()), 'small primary') : null,
        ),
      );
    }
    this.open('chapters', h('div', {}, h('h2', { text: 'Chapitres' }), list, h('div', { class: 'row' }, this.btn('Retour', () => this.showMenu()))));
  }

  private showCredits(): void {
    this.modalStack = [() => this.showMenu()];
    this.open(
      'credits',
      h(
        'div',
        {},
        h('h2', { text: 'Crédits' }),
        h(
          'div',
          { class: 'credits' },
          h('p', { text: 'DREAM DOORS — jeu original. Inspiré des mécaniques générales d’exploration et de survie de DOORS (Roblox) ; univers, personnages, entités, décors et histoire sont originaux.' }),
          h('p', { text: 'Graphismes : tous les sprites, textures et icônes sont dessinés en pixel art par du code original au lancement du jeu (aucune image externe).' }),
          h('p', { text: 'Audio : ambiances, musiques et effets sont synthétisés en temps réel avec l’API WebAudio (aucun fichier audio externe).' }),
          h('p', { text: 'Moteur : Phaser 3 (licence MIT). Outils : Vite (MIT), TypeScript (Apache-2.0), Vitest (MIT).' }),
          h('p', { text: 'Détails des licences : voir le fichier ASSETS.md du dépôt.' }),
        ),
        h('div', { class: 'row' }, this.btn('Retour', () => this.showMenu())),
      ),
    );
  }

  /* -- Options -------------------------------------------------------- */
  showOptions(back: () => void): void {
    this.modalStack = [back];
    const s = structuredClone(this.act.settings());
    const apply = (): void => this.act.applySettings(structuredClone(s));
    const slider = (label: string, key: keyof Settings['audio']): HTMLElement => {
      const out = h('span', { class: 'val', text: `${Math.round(s.audio[key] * 100)}%` });
      const input = h('input', { type: 'range', min: 0, max: 100, step: 5, value: String(Math.round(s.audio[key] * 100)), ariaLabel: label, class: 'range' });
      input.addEventListener('input', () => {
        s.audio[key] = Number(input.value) / 100;
        out.textContent = `${input.value}%`;
        apply();
      });
      return h('label', { class: 'field row-field' }, h('span', { text: label }), input, out);
    };
    const toggle = (label: string, get: () => boolean, set: (v: boolean) => void): HTMLElement => {
      const input = h('input', { type: 'checkbox', checked: get(), ariaLabel: label });
      input.addEventListener('change', () => {
        set(input.checked);
        apply();
      });
      return h('label', { class: 'field row-field' }, h('span', { text: label }), input);
    };
    const scale = h('select', { class: 'input', ariaLabel: 'Taille du texte' });
    for (const [v, l] of [[1, 'Normale'], [1.25, 'Grande'], [1.5, 'Très grande']] as const) {
      const o = h('option', { value: String(v), text: l });
      if (s.accessibility.textScale === v) o.selected = true;
      scale.append(o);
    }
    scale.addEventListener('change', () => {
      s.accessibility.textScale = Number(scale.value);
      apply();
    });
    const diff = h('select', { class: 'input', ariaLabel: 'Difficulté des nouvelles parties' });
    for (const [v, l] of [['easy', 'Facile'], ['normal', 'Normal'], ['hard', 'Difficile']] as const) {
      const o = h('option', { value: v, text: l });
      if (s.difficulty === v) o.selected = true;
      diff.append(o);
    }
    diff.addEventListener('change', () => {
      s.difficulty = diff.value as Difficulty;
      apply();
    });

    const keys = h('div', { class: 'keys' });
    const renderKeys = (): void => {
      clear(keys);
      for (const a of Object.keys(ACTION_LABELS) as Action[]) {
        const b = h('button', {
          class: 'btn small key',
          type: 'button',
          text: s.bindings[a].map(keyLabel).join(' / '),
          ariaLabel: `Reconfigurer ${ACTION_LABELS[a]}`,
          on: {
            click: (e) => {
              const target = e.currentTarget as HTMLButtonElement;
              target.textContent = 'Appuyez sur une touche…';
              this.act.captureKey((k) => {
                if (k !== 'escape') s.bindings[a] = [k];
                apply();
                renderKeys();
              });
            },
          },
        });
        keys.append(h('div', { class: 'key-row' }, h('span', { text: ACTION_LABELS[a] }), b));
      }
    };
    renderKeys();

    this.open(
      'options',
      h(
        'div',
        {},
        h('h2', { text: 'Options' }),
        h(
          'div',
          { class: 'options-scroll' },
          h('h3', { text: 'Audio' }),
          slider('Volume général', 'master'),
          slider('Musique', 'music'),
          slider('Effets', 'sfx'),
          slider('Ambiances', 'ambience'),
          h('h3', { text: 'Accessibilité' }),
          toggle('Réduire les mouvements et les effets', () => s.accessibility.reduceMotion, (v) => (s.accessibility.reduceMotion = v)),
          toggle('Sous-titres des sons importants', () => s.accessibility.subtitles, (v) => (s.accessibility.subtitles = v)),
          toggle('Contraste élevé', () => s.accessibility.highContrast, (v) => (s.accessibility.highContrast = v)),
          toggle('Indices facultatifs (touche H)', () => s.accessibility.hints, (v) => (s.accessibility.hints = v)),
          h('label', { class: 'field row-field' }, h('span', { text: 'Taille du texte' }), scale),
          h('label', { class: 'field row-field' }, h('span', { text: 'Difficulté (nouvelles parties)' }), diff),
          h('h3', { text: 'Commandes' }),
          keys,
          h('h3', { text: 'Données' }),
          this.btn('Réinitialiser la partie…', () => this.confirmReset(back), 'danger small'),
        ),
        h('div', { class: 'row' }, this.btn('Retour', back, 'primary')),
      ),
    );
  }

  private confirmReset(back: () => void): void {
    this.modalStack = [() => this.showOptions(back)];
    this.open(
      'confirm',
      h(
        'div',
        {},
        h('h2', { text: 'Supprimer la partie ?' }),
        h('p', { text: 'La sauvegarde sera effacée. Les fins déjà découvertes sont conservées.' }),
        h(
          'div',
          { class: 'row' },
          this.btn('Annuler', () => this.showOptions(back)),
          this.btn(
            'Supprimer',
            () => {
              this.act.resetSave();
              this.showOptions(back);
              this.toast('Sauvegarde supprimée.', 'info');
            },
            'danger',
          ),
        ),
      ),
    );
  }

  /* -- Pause ---------------------------------------------------------- */
  showPause(): void {
    this.modalStack = [];
    const w = this.act.world();
    this.open(
      'pause',
      h(
        'div',
        {},
        h('h2', { text: 'Pause' }),
        w ? h('p', { class: 'muted', text: `${w.currentDoorNumber} — ${w.room.name} · ${formatTime(w.playTime)}` }) : null,
        h(
          'div',
          { class: 'menu-buttons' },
          this.btn('Reprendre', () => this.resumeGame(), 'primary'),
          this.btn('Inventaire', () => this.openInventory(true)),
          this.btn('Carte', () => this.showMap(true)),
          this.btn('Indice', () => {
            this.resumeGame();
            this.act.hint();
          }),
          this.btn('Options', () => this.showOptions(() => this.showPause())),
          this.btn('Quitter vers le menu', () => this.act.quitToMenu()),
        ),
        h('p', { class: 'muted', text: 'La partie est sauvegardée automatiquement aux moments sûrs.' }),
      ),
    );
  }

  private resumeGame(): void {
    this.closeModal();
    this.act.resume();
  }

  /* -- Inventaire ----------------------------------------------------- */
  openInventory(fromPause = false): void {
    const w = this.act.world();
    if (!w) return;
    const render = (): void => {
      const list = w.inv.list();
      const grid = h('div', { class: 'inv-grid', role: 'listbox' });
      list.forEach((s, i) => {
        const def = getItemDef(s.id);
        const b = h(
          'button',
          {
            class: `inv-slot ${i === w.inv.selected ? 'sel' : ''} ${def.essential ? 'essential' : ''}`,
            type: 'button',
            role: 'option',
            ariaLabel: `${def.name}${s.count > 1 ? ` ×${s.count}` : ''}`,
            on: {
              click: () => {
                this.act.click();
                w.inv.select(i);
                render();
              },
            },
          },
          h('img', { class: 'icon big', src: this.icons[def.icon] ?? this.icons.unknown, alt: '' }),
          s.count > 1 ? h('span', { class: 'qcount', text: String(s.count) }) : null,
        );
        b.setAttribute('aria-selected', String(i === w.inv.selected));
        grid.append(b);
      });
      const selId = w.inv.selectedId();
      const def = selId ? getItemDef(selId) : null;
      const detail = h(
        'div',
        { class: 'inv-detail' },
        def
          ? h(
              'div',
              {},
              h('h3', { text: def.name }),
              def.essential ? h('span', { class: 'tag', text: 'ESSENTIEL' }) : null,
              h('p', { text: def.description }),
              def.usable && selId ? this.btn(selId === 'lamp' ? 'Allumer / éteindre' : 'Utiliser', () => {
                this.act.useItem(selId);
                render();
              }, 'primary small') : null,
            )
          : h('p', { class: 'muted', text: 'Votre inventaire est vide. Fouillez les meubles avec [E].' }),
      );
      const meter = w.inv.has('lamp') ? h('p', { class: 'muted', text: `Lampe : ${Math.round((w.lampCharge / 180) * 100)} %` }) : null;
      this.open(
        'inventory',
        h(
          'div',
          {},
          h('h2', { text: 'Inventaire' }),
          grid,
          detail,
          meter,
          h('div', { class: 'row' }, this.btn(fromPause ? 'Retour' : 'Fermer', () => (fromPause ? this.showPause() : this.resumeGame()), 'primary')),
        ),
      );
    };
    render();
  }

  /* -- Carte ---------------------------------------------------------- */
  showMap(fromPause = false): void {
    const w = this.act.world();
    if (!w) return;
    const lines = h('div', { class: 'map' });
    for (const l of w.mapLines()) lines.append(h('div', { class: 'map-line', text: l }));
    this.open(
      'map',
      h('div', {}, h('h2', { text: 'Carte de l’hôtel' }), lines, h('div', { class: 'row' }, this.btn(fromPause ? 'Retour' : 'Fermer', () => (fromPause ? this.showPause() : this.resumeGame()), 'primary'))),
    );
  }

  /* -- Défaite -------------------------------------------------------- */
  showDefeat(text: string): void {
    this.modalStack = [];
    this.open(
      'defeat',
      h(
        'div',
        {},
        h('h2', { class: 'bad', text: 'Capturé' }),
        h('p', { text }),
        h('p', { class: 'muted', text: 'Vous reprendrez au dernier point de contrôle, avec ce que vous aviez à ce moment-là.' }),
        h('div', { class: 'row' }, this.btn('Quitter vers le menu', () => this.act.quitToMenu()), this.btn('Reprendre au point de contrôle', () => this.act.respawn(), 'primary')),
      ),
    );
  }

  /* -- Dialogue ------------------------------------------------------- */
  showDialogue(name: string, lines: string[]): void {
    this.dialogue = { name, lines, i: 0 };
    this.renderDialogue();
  }

  private renderDialogue(): void {
    const d = this.dialogue;
    if (!d) return;
    const last = d.i >= d.lines.length - 1;
    this.open(
      'dialogue',
      h(
        'div',
        { class: 'dialogue', on: { click: () => this.advanceDialogue() } },
        h('div', { class: 'speaker', text: d.name }),
        h('p', { text: d.lines[d.i] ?? '' }),
        h('div', { class: 'row' }, this.btn(last ? 'Fermer' : 'Suite ▸', () => this.advanceDialogue(), 'small primary')),
      ),
      { backdrop: false },
    );
  }

  advanceDialogue(): void {
    const d = this.dialogue;
    if (!d) return;
    d.i++;
    if (d.i >= d.lines.length) {
      this.closeModal();
      this.act.resume();
    } else {
      this.renderDialogue();
    }
  }

  /* -- Lecture -------------------------------------------------------- */
  showRead(title: string, lines: string[], sequence: string[] | null = null): void {
    const flash = sequence
      ? h(
          'div',
          { class: 'seq-flash', ariaLive: 'polite' },
          ...sequence.map((n, i) => h('span', { class: 'seq-dot', style: { background: NOTE_COLORS[n] ?? '#fff' }, data: { i: String(i) }, text: NOTE_NAMES[n] ?? n })),
        )
      : null;
    this.open(
      'read',
      h('div', {}, h('h2', { text: title }), ...lines.map((l) => h('p', { text: l })), flash, h('div', { class: 'row' }, this.btn('Fermer', () => this.resumeGame(), 'primary'))),
    );
    if (sequence && flash) {
      const dots = [...flash.querySelectorAll<HTMLElement>('.seq-dot')];
      dots.forEach((d, i) => {
        window.setTimeout(() => {
          d.classList.add('lit');
          window.setTimeout(() => d.classList.remove('lit'), 450);
        }, i * 600 + 150);
      });
    }
  }

  /* -- Choix ---------------------------------------------------------- */
  showChoice(title: string, options: string[]): void {
    this.open(
      'choice',
      h(
        'div',
        {},
        h('h2', { text: title }),
        h(
          'div',
          { class: 'menu-buttons' },
          ...options.map((o, i) =>
            this.btn(
              o,
              () => {
                this.closeModal();
                this.act.answerChoice(i);
                this.act.resume();
              },
              i === 0 ? 'primary' : '',
            ),
          ),
        ),
      ),
    );
  }

  showEndingMenu(options: Array<{ id: EndingId; title: string; requirement: string; available: boolean }>): void {
    const list = h('div', { class: 'endings' });
    for (const o of options) {
      list.append(
        h(
          'div',
          { class: `ending ${o.available ? '' : 'locked'}` },
          h('div', { class: 'ending-title', text: o.available ? o.title : '???' }),
          h('div', { class: 'muted', text: o.available ? o.requirement : `Condition : ${o.requirement}` }),
          o.available
            ? this.btn(
                'Choisir',
                () => {
                  this.closeModal();
                  this.act.chooseEnding(o.id);
                },
                'small primary',
              )
            : null,
        ),
      );
    }
    this.open(
      'endingMenu',
      h('div', {}, h('h2', { text: 'Panneau de l’ascenseur' }), h('p', { class: 'muted', text: 'Chaque départ dépend de ce que vous avez trouvé.' }), list, h('div', { class: 'row' }, this.btn('Pas encore', () => this.resumeGame()))),
    );
  }

  /* -- Fin de chapitre ------------------------------------------------ */
  showEnding(id: EndingId, stats: { time: number; rooms: number; fragments: number; endings: number }, chapter2: boolean): void {
    const e = getEnding(id);
    let i = 0;
    const render = (): void => {
      const body = h('div', { class: 'ending-body' });
      if (i < e.lines.length) {
        body.append(h('p', { class: 'ending-line', text: e.lines[i] ?? '' }), h('div', { class: 'row' }, this.btn(i === e.lines.length - 1 ? 'Terminer' : 'Suite ▸', () => {
          i++;
          render();
        }, 'primary')));
      } else {
        body.append(
          h('h2', { text: 'Fin de chapitre' }),
          h('p', { class: 'ending-title', text: e.title }),
          h(
            'ul',
            { class: 'stats' },
            h('li', { text: `Temps de jeu : ${formatTime(stats.time)}` }),
            h('li', { text: `Portes franchies : ${stats.rooms}` }),
            h('li', { text: `Fragments de souvenir : ${stats.fragments}/6` }),
            h('li', { text: `Fins découvertes : ${stats.endings}/${ENDINGS.length}` }),
          ),
          ...(chapter2 ? [h('p', { class: 'muted', text: 'Le chapitre II s’ouvre devant vous… (bientôt disponible)' })] : []),
          h('div', { class: 'row' }, this.btn('Menu principal', () => this.act.quitToMenu(), 'primary')),
        );
      }
      this.open('ending', body, { className: 'ending-screen' });
    };
    render();
  }

  /* ---------------------------------------------------------------------- */
  /* Énigmes                                                                 */
  /* ---------------------------------------------------------------------- */
  openPuzzle(puzzle: Puzzle): void {
    const w = this.act.world();
    if (!w) return;
    let feedback = '';
    let tone: 'ok' | 'bad' | '' = '';
    const apply = (fb: Feedback): void => {
      feedback = fb.message;
      tone = fb.ok ? 'ok' : 'bad';
      render();
      if (fb.solved) window.setTimeout(() => this.resumeGame(), 1100);
    };
    const render = (): void => {
      const body = h('div', { class: 'puzzle' });
      if (puzzle instanceof SequencePuzzle) {
        const alphabet = puzzle.alphabet;
        const dots = h('div', { class: 'seq-progress' });
        for (let i = 0; i < puzzle.solution.length; i++) dots.append(h('span', { class: `pdot ${i < puzzle.entered.length ? 'on' : ''}` }));
        const pad = h('div', { class: `seq-pad ${puzzle.mode}` });
        for (const sym of alphabet) {
          const label = puzzle.mode === 'sound' ? (NOTE_NAMES[sym] ?? sym) : (SYMBOL_NAMES[sym] ?? sym);
          const b = h(
            'button',
            {
              class: 'seq-btn',
              type: 'button',
              ariaLabel: label,
              style: puzzle.mode === 'sound' ? { background: NOTE_COLORS[sym] ?? '#fff', color: '#11111F' } : {},
              on: {
                click: () => {
                  if (puzzle.mode === 'sound') this.act.playSequence([sym]);
                  apply(this.act.puzzleAction(puzzle.id, { type: 'press', value: sym }));
                },
              },
            },
            puzzle.mode === 'sound' ? null : h('img', { class: 'icon big', src: drawSymbolIcon(sym), alt: '' }),
            h('span', { text: label }),
          );
          pad.append(b);
        }
        body.append(h('h2', { text: puzzle.mode === 'sound' ? 'Piano' : 'Pupitre à symboles' }), h('p', { class: 'muted', text: 'Reproduisez la séquence dans l’ordre.' }), dots, pad, this.btn('Effacer', () => apply(this.act.puzzleAction(puzzle.id, { type: 'reset' })), 'small'));
      } else if (puzzle instanceof SwitchPuzzle) {
        const row = h('div', { class: 'switches' });
        puzzle.state.forEach((on, i) => {
          const b = h(
            'button',
            {
              class: `switch ${on ? 'on' : 'off'}`,
              type: 'button',
              ariaLabel: `Interrupteur ${i + 1} : ${on ? 'haut' : 'bas'}`,
              on: { click: () => apply(this.act.puzzleAction(puzzle.id, { type: 'toggle', index: i })) },
            },
            h('span', { class: 'lever' }),
            h('span', { class: 'num', text: String(i + 1) }),
          );
          row.append(b);
        });
        body.append(h('h2', { text: 'Tableau d’interrupteurs' }), h('p', { class: 'muted', text: 'Placez chaque interrupteur selon le schéma du mur.' }), row);
      } else if (puzzle instanceof ValvePuzzle) {
        const dial = h('div', { class: 'dial' });
        for (let i = 0; i < VALVE_RING; i++) {
          dial.append(
            h('span', {
              class: `tick ${i === puzzle.level ? 'cur' : ''} ${i === puzzle.target ? 'target' : ''}`,
              text: String(i),
              style: { transform: `rotate(${(i / VALVE_RING) * 360}deg) translateY(-3.6rem) rotate(${-(i / VALVE_RING) * 360}deg)` },
            }),
          );
        }
        dial.append(h('span', { class: 'level', text: String(puzzle.level) }));
        const valves = h('div', { class: 'valves' });
        for (let v = 0; v < 3; v++) valves.append(this.btn(`Vanne ${v + 1}`, () => apply(this.act.puzzleAction(puzzle.id, { type: 'turn', valve: v })), 'valve'));
        body.append(h('h2', { text: 'Vannes' }), h('p', { class: 'muted', text: `Amenez l’aiguille sur la marque rouge (${puzzle.target}). Le cadran est circulaire.` }), dial, valves);
      }
      body.append(h('p', { class: `feedback ${tone}`, text: feedback, ariaLive: 'assertive' }), h('div', { class: 'row' }, this.btn('Fermer', () => this.resumeGame())));
      this.open('puzzle', body);
    };
    render();
  }
}
