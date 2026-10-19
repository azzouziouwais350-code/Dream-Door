import type Phaser from 'phaser';
import { AudioManager, type MusicMood } from './audio/audio';
import type { Difficulty } from './core/types';
import { OPENING_LINES, type EndingId } from './data/story';
import { World } from './game/world';
import { InputManager } from './input/input';
import type { GameScene } from './scenes/game';
import { generateChapter, roomIndexOf } from './systems/generator';
import { type KeyValueStore, type Meta, SETTINGS_KEY, SaveManager, browserStore } from './systems/save';
import type { Settings } from './systems/settings';
import { formatTime } from './ui/dom';
import { UI, type UIActions } from './ui/ui';

const CUE_SFX: Record<string, string> = {
  ceiling_creak: 'cue_creak',
  ceiling_warning: 'cue_creak',
  ceiling_miss: 'cue_creak',
  concierge_alert: 'cue_alert',
  concierge_hears: 'cue_alert',
  concierge_catch: 'cue_alert',
  concierge_inspect: 'cue_steps',
  concierge_steps: 'cue_steps',
  false_hum: 'cue_hum',
  swimmer_wake: 'cue_water',
  swimmer_lunge: 'cue_water',
};

/**
 * Orchestration : relie le monde (logique), la scène (rendu), l'interface DOM, l'audio, les entrées et les sauvegardes.
 * Aucune règle de jeu ici : tout vient de `World`.
 */
export class App {
  private readonly store: KeyValueStore = browserStore();
  private readonly saves = new SaveManager(this.store);
  private readonly audio = new AudioManager();
  private readonly input: InputManager;
  private readonly ui: UI;
  private settings: Settings;
  private meta: Meta;
  private world: World | null = null;
  private playing = false;
  private unsub: Array<() => void> = [];
  private pendingSeq: string[] | null = null;
  private mood: MusicMood = 'none';
  private summaryCache: { key: string; text: string } | null = null;
  private saveFailed = false;
  private scene: GameScene;

  constructor(game: Phaser.Game, scene: GameScene) {
    this.scene = scene;
    const firstRun = this.store.getItem(SETTINGS_KEY) === null;
    this.settings = this.saves.loadSettings();
    if (firstRun && typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.settings.accessibility.reduceMotion = true;
    }
    this.meta = this.saves.loadMeta();

    this.input = new InputManager({
      onInteract: () => this.onInteract(),
      onLamp: () => {
        if (this.canAct()) this.world?.toggleLamp();
      },
      onInventory: () => this.onInventory(),
      onPause: () => this.onPause(),
      onHint: () => {
        if (this.canAct()) this.world?.requestHint();
      },
      onAnyGesture: () => this.audio.unlock(),
    });
    this.input.setBindings(this.settings.bindings);
    window.addEventListener('pointerdown', () => this.audio.unlock(), { passive: true });
    this.audio.setVolumes(this.settings.audio);

    const parent = game.canvas.parentElement ?? document.body;
    this.ui = new UI(parent, this.actions());
    this.ui.applyAccessibility(this.settings);

    scene.hooks = {
      footstep: (surface, running, crouched) => this.audio.footstep(surface, running, crouched),
      frame: (w) => this.onFrame(w),
    };

    const flush = (): void => {
      if (document.hidden) this.world?.saveNow();
    };
    document.addEventListener('visibilitychange', flush);
    window.addEventListener('pagehide', () => this.world?.saveNow());

    document.getElementById('boot')?.remove();
    this.showMenu();

    if (new URLSearchParams(location.search).has('debug')) {
      (window as unknown as { __dd: unknown }).__dd = { app: this, world: () => this.world, scene: this.scene };
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Menu et cycle de partie                                                */
  /* ---------------------------------------------------------------------- */
  private sceneOptions(demo: boolean): { demo: boolean; reduceMotion: boolean; highContrast: boolean } {
    return { demo, reduceMotion: this.settings.accessibility.reduceMotion, highContrast: this.settings.accessibility.highContrast };
  }

  private showMenu(): void {
    this.unbind();
    this.playing = false;
    this.world = null;
    this.setMood('calm');
    this.audio.setAmbience('hotel');
    const demo = World.newGame((Math.random() * 2_000_000_000) | 1, 'normal');
    this.scene.attach(demo, this.sceneOptions(true));
    this.scene.paused = true;
    this.ui.closeModal();
    this.ui.showMenu();
  }

  private startGame(w: World, intro: boolean): void {
    this.unbind();
    this.world = w;
    this.playing = true;
    this.pendingSeq = null;
    this.bind(w);
    this.ui.closeModal();
    this.ui.showHud(true);
    this.scene.attach(w, this.sceneOptions(false));
    this.scene.paused = false;
    this.audio.setAmbience(w.room.ambience);
    this.setMood('calm');
    if (intro) this.ui.showRead('Réveil', OPENING_LINES);
  }

  private unbind(): void {
    for (const u of this.unsub) u();
    this.unsub = [];
  }

  private bind(w: World): void {
    const ev = w.events;
    this.unsub.push(
      ev.on('toast', (e) => this.ui.toast(e.text, e.tone)),
      ev.on('sfx', (e) => {
        const d = e.x !== undefined && e.y !== undefined ? Math.hypot(e.x - w.player.pos.x, e.y - w.player.pos.y) : undefined;
        this.audio.sfx(e.name, d === undefined ? {} : { distance: d });
      }),
      ev.on('sequence', (e) => {
        this.pendingSeq = e.notes;
        this.audio.playSequence(e.notes);
      }),
      ev.on('read', (e) => {
        const seq = this.pendingSeq;
        this.pendingSeq = null;
        this.pause();
        this.ui.showRead(e.title, e.lines, seq);
      }),
      ev.on('dialogue', (e) => {
        this.pause();
        this.ui.showDialogue(e.name, e.lines);
      }),
      ev.on('puzzle', (e) => {
        const p = w.puzzles.get(e.puzzleId);
        if (!p) return;
        this.pause();
        this.ui.openPuzzle(p);
      }),
      ev.on('choice', (e) => {
        this.pause();
        this.ui.showChoice(e.title, e.options);
      }),
      ev.on('endingMenu', (e) => {
        this.pause();
        this.ui.showEndingMenu(e.options);
      }),
      ev.on('ending', (e) => this.onEnding(w, e.id)),
      ev.on('defeat', (e) => {
        this.setMood('none');
        this.pause();
        this.ui.showDefeat(e.text);
      }),
      ev.on('cue', (c) => {
        if (this.settings.accessibility.subtitles) this.ui.subtitle(c.text);
        const sfx = c.kind === 'audio' ? CUE_SFX[c.id] : undefined;
        if (sfx) this.audio.sfx(sfx);
      }),
      ev.on('save', (data) => {
        if (!this.saves.save(data) && !this.saveFailed) {
          this.saveFailed = true;
          this.ui.toast('Sauvegarde impossible (stockage indisponible ou plein).', 'bad');
        }
      }),
      ev.on('roomLoaded', (e) => {
        this.audio.setAmbience(e.room.ambience);
        const idx = Math.max(0, w.roomIndex);
        if (idx > this.meta.bestRooms) {
          this.meta = { ...this.meta, bestRooms: idx };
          this.saves.saveMeta(this.meta);
        }
      }),
    );
  }

  private onEnding(w: World, id: EndingId): void {
    this.setMood('none');
    this.audio.sfx('ending');
    const endings = new Set(this.meta.endings);
    endings.add(id);
    this.meta = { endings: [...endings], chaptersUnlocked: Math.max(2, this.meta.chaptersUnlocked), bestRooms: Math.max(this.meta.bestRooms, w.plan.rooms.length - 1) };
    this.saves.saveMeta(this.meta);
    this.saves.clear();
    const fragments = w.inv.list().filter((s) => s.id.startsWith('memory:') && s.id !== 'memory:secret').length;
    this.pause();
    this.ui.showEnding(id, { time: w.playTime, rooms: w.visited.size, fragments, endings: this.meta.endings.length }, true);
  }

  /* ---------------------------------------------------------------------- */
  /* Pause / entrées                                                        */
  /* ---------------------------------------------------------------------- */
  private pause(): void {
    this.world?.setMove(0, 0);
    this.world?.setRun(false);
    this.scene.paused = true;
  }

  private canAct(): boolean {
    return this.playing && !!this.world && !this.ui.isModalOpen && this.world.status === 'playing';
  }

  private onInteract(): void {
    if (!this.playing || !this.world) return;
    if (this.ui.isModalOpen) {
      if (this.ui.currentModal === 'dialogue') this.ui.advanceDialogue();
      return;
    }
    if (this.world.status === 'playing') this.world.interact();
  }

  private onInventory(): void {
    if (!this.playing || !this.world) return;
    if (this.ui.currentModal === 'inventory') {
      this.ui.closeModal();
      this.resume();
      return;
    }
    if (this.canAct()) {
      this.pause();
      this.ui.openInventory();
    }
  }

  private onPause(): void {
    if (this.ui.isModalOpen) {
      this.ui.handleEscape();
      return;
    }
    if (this.canAct()) {
      this.pause();
      this.ui.showPause();
    }
  }

  private resume(): void {
    if (this.playing && this.world && this.world.status !== 'defeated' && this.world.status !== 'ended') this.scene.paused = false;
    this.world?.saveNow();
  }

  /* ---------------------------------------------------------------------- */
  /* Boucle                                                                 */
  /* ---------------------------------------------------------------------- */
  private onFrame(w: World): void {
    if (!this.playing || w !== this.world) return;
    const modal = this.ui.isModalOpen;
    this.scene.paused = modal || w.status === 'defeated' || w.status === 'ended';
    this.input.setEnabled(!modal);
    if (!this.scene.paused) {
      const a = this.input.axes();
      w.setMove(a.mx, a.my);
      w.setRun(this.input.running());
      w.setCrouch(this.input.crouching());
    }
    this.ui.updateHud(w);
    if (w.status === 'playing') this.setMood(w.isChased() ? 'chase' : w.dangerLevel() > 0 ? 'mystery' : 'calm');
  }

  private setMood(m: MusicMood): void {
    if (m === this.mood) return;
    this.mood = m;
    this.audio.setMood(m);
  }

  /* ---------------------------------------------------------------------- */
  /* Actions exposées à l'interface                                         */
  /* ---------------------------------------------------------------------- */
  private applySettings(s: Settings): void {
    this.settings = s;
    this.saves.saveSettings(s);
    this.audio.setVolumes(s.audio);
    this.input.setBindings(s.bindings);
    this.ui.applyAccessibility(s);
    this.scene.setOptions({ reduceMotion: s.accessibility.reduceMotion, highContrast: s.accessibility.highContrast });
  }

  private actions(): UIActions {
    return {
      hasSave: () => this.saves.hasSave(),
      saveSummary: () => this.saveSummary(),
      meta: () => this.meta,
      settings: () => this.settings,
      applySettings: (s) => this.applySettings(s),
      newGame: (difficulty: Difficulty, seed) => {
        this.settings = { ...this.settings, difficulty };
        this.saves.saveSettings(this.settings);
        const s = seed ?? ((Math.random() * 2_000_000_000) | 0) + 1;
        const w = World.newGame(s, difficulty);
        this.saves.clear();
        this.startGame(w, true);
        w.saveNow();
      },
      continueGame: () => {
        const r = this.saves.load();
        if (!r.ok) {
          if (r.reason === 'corrupted') {
            this.saves.quarantineCorrupted();
            this.ui.toast('La sauvegarde était illisible : elle a été mise de côté. Lancez une nouvelle partie.', 'bad');
            this.showMenu();
          }
          return;
        }
        try {
          this.startGame(World.restore(r.data), false);
        } catch {
          this.saves.quarantineCorrupted();
          this.ui.toast('La sauvegarde est incohérente : elle a été mise de côté.', 'bad');
          this.showMenu();
        }
      },
      resume: () => this.resume(),
      quitToMenu: () => {
        this.world?.saveNow();
        this.showMenu();
      },
      useItem: (id) => {
        if (this.world) this.world.useItem(id);
      },
      hint: () => {
        if (this.world) this.world.requestHint();
      },
      respawn: () => {
        const w = this.world;
        if (!w) return;
        this.ui.closeModal();
        w.respawnAtCheckpoint();
        this.scene.paused = false;
        this.setMood('calm');
      },
      world: () => this.world,
      puzzleAction: (id, action) => {
        if (!this.world) return { ok: false, message: '' };
        return this.world.puzzleAction(id, action);
      },
      answerChoice: (i) => {
        this.world?.answerChoice(i);
      },
      chooseEnding: (id) => {
        this.ui.closeModal();
        this.world?.chooseEnding(id);
      },
      playSequence: (notes) => {
        this.audio.playSequence(notes);
      },
      resetSave: () => {
        this.saves.clear();
        this.meta = { endings: [], chaptersUnlocked: 1, bestRooms: 0 };
        this.saves.saveMeta(this.meta);
      },
      captureKey: (fn) => this.input.captureNextKey(fn),
      cancelCapture: () => this.input.cancelCapture(),
      fire: (a) => this.input.fire(a),
      setTouch: (x, y) => this.input.setTouchMove(x, y),
      setRun: (v) => this.input.setTouchRun(v),
      toggleCrouch: () => this.input.toggleTouchCrouch(),
      click: () => this.audio.sfx('click'),
    };
  }

  private saveSummary(): string | null {
    const r = this.saves.load();
    if (!r.ok) return null;
    const key = `${r.data.savedAt}`;
    if (this.summaryCache?.key === key) return this.summaryCache.text;
    let text = formatTime(r.data.playTime);
    try {
      const plan = generateChapter(1, r.data.seed, r.data.difficulty);
      const idx = roomIndexOf(plan, r.data.roomId);
      text = `Porte ${String(Math.max(0, idx)).padStart(3, '0')} · ${formatTime(r.data.playTime)}`;
    } catch {
      /* résumé réduit au temps de jeu */
    }
    this.summaryCache = { key, text };
    return text;
  }
}
