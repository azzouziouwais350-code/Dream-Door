import type { Ambience, Surface } from '../core/types';

export type MusicMood = 'none' | 'calm' | 'mystery' | 'chase';

interface Volumes {
  master: number;
  music: number;
  sfx: number;
  ambience: number;
}

const PENTA = [0, 2, 4, 7, 9];

function midiToHz(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}

/**
 * Gestionnaire audio centralisé : tout est synthétisé (aucune ressource externe, donc aucune licence à gérer).
 * Le contexte n'est créé qu'après un geste de l'utilisateur (politique des navigateurs).
 */
export class AudioManager {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicBus!: GainNode;
  private sfxBus!: GainNode;
  private ambBus!: GainNode;
  private reverb!: ConvolverNode;
  private reverbSend!: GainNode;
  private noiseBuf: AudioBuffer | null = null;
  private vol: Volumes = { master: 0.8, music: 0.6, sfx: 0.8, ambience: 0.7 };
  private ambNodes: { stop: () => void; gain: GainNode } | null = null;
  private ambKind: Ambience | null = null;
  private mood: MusicMood = 'none';
  private musicTimer: number | null = null;
  private musicStep = 0;
  private musicGain: GainNode | null = null;
  private chaseNodes: { stop: () => void } | null = null;
  private lastStep = 0;
  private disposed = false;
  private visibilityHandler = (): void => {
    if (!this.ctx) return;
    if (document.hidden) void this.ctx.suspend();
    else void this.ctx.resume();
  };

  constructor() {
    document.addEventListener('visibilitychange', this.visibilityHandler);
  }

  /** À appeler depuis un geste utilisateur (clic, touche, toucher). */
  unlock(): void {
    if (this.disposed) return;
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      const c = this.ctx;
      this.master = c.createGain();
      this.musicBus = c.createGain();
      this.sfxBus = c.createGain();
      this.ambBus = c.createGain();
      this.reverb = c.createConvolver();
      this.reverbSend = c.createGain();
      this.reverbSend.gain.value = 0.35;
      this.reverb.buffer = this.makeImpulse(2.4, 2.6);
      this.musicBus.connect(this.master);
      this.sfxBus.connect(this.master);
      this.ambBus.connect(this.master);
      this.reverbSend.connect(this.reverb);
      this.reverb.connect(this.master);
      this.master.connect(c.destination);
      this.noiseBuf = this.makeNoise(2);
      this.applyVolumes();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  get ready(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  setVolumes(v: Partial<Volumes>): void {
    this.vol = { ...this.vol, ...v };
    this.applyVolumes();
  }

  private applyVolumes(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.vol.master, t, 0.05);
    this.musicBus.gain.setTargetAtTime(this.vol.music, t, 0.05);
    this.sfxBus.gain.setTargetAtTime(this.vol.sfx, t, 0.05);
    this.ambBus.gain.setTargetAtTime(this.vol.ambience, t, 0.05);
  }

  dispose(): void {
    this.disposed = true;
    document.removeEventListener('visibilitychange', this.visibilityHandler);
    this.stopMusicTimer();
    this.ambNodes?.stop();
    this.chaseNodes?.stop();
    if (this.ctx) void this.ctx.close();
    this.ctx = null;
  }

  /* ---------------------------------------------------------------------- */
  /* Primitives                                                             */
  /* ---------------------------------------------------------------------- */
  private makeNoise(seconds: number): AudioBuffer {
    const c = this.ctx as AudioContext;
    const buf = c.createBuffer(1, Math.floor(c.sampleRate * seconds), c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  private makeImpulse(seconds: number, decay: number): AudioBuffer {
    const c = this.ctx as AudioContext;
    const len = Math.floor(c.sampleRate * seconds);
    const buf = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  private tone(freq: number, start: number, dur: number, opts: { type?: OscillatorType; gain?: number; bus?: GainNode; slide?: number; reverb?: boolean; attack?: number } = {}): void {
    const c = this.ctx;
    if (!c) return;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = opts.type ?? 'sine';
    osc.frequency.setValueAtTime(freq, start);
    if (opts.slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq * opts.slide), start + dur);
    const peak = opts.gain ?? 0.2;
    const attack = opts.attack ?? 0.008;
    g.gain.setValueAtTime(0.0001, start);
    g.gain.linearRampToValueAtTime(peak, start + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(g);
    g.connect(opts.bus ?? this.sfxBus);
    if (opts.reverb) g.connect(this.reverbSend);
    osc.start(start);
    osc.stop(start + dur + 0.05);
  }

  private noise(start: number, dur: number, opts: { freq?: number; q?: number; type?: BiquadFilterType; gain?: number; bus?: GainNode; sweep?: number } = {}): void {
    const c = this.ctx;
    if (!c || !this.noiseBuf) return;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = c.createBiquadFilter();
    f.type = opts.type ?? 'bandpass';
    f.frequency.setValueAtTime(opts.freq ?? 1200, start);
    if (opts.sweep) f.frequency.exponentialRampToValueAtTime(Math.max(40, (opts.freq ?? 1200) * opts.sweep), start + dur);
    f.Q.value = opts.q ?? 1;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, start);
    g.gain.linearRampToValueAtTime(opts.gain ?? 0.2, start + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    src.connect(f);
    f.connect(g);
    g.connect(opts.bus ?? this.sfxBus);
    src.start(start, Math.random() * 1.5);
    src.stop(start + dur + 0.05);
  }

  /* ---------------------------------------------------------------------- */
  /* Effets                                                                 */
  /* ---------------------------------------------------------------------- */
  sfx(name: string, opts: { distance?: number } = {}): void {
    const c = this.ctx;
    if (!c || c.state !== 'running') return;
    const t = c.currentTime;
    const att = opts.distance === undefined ? 1 : Math.max(0.15, 1 - opts.distance / 14);
    const G = (v: number): number => v * att;
    switch (name) {
      case 'click':
        this.tone(900, t, 0.05, { type: 'square', gain: G(0.05) });
        break;
      case 'pickup':
        this.tone(660, t, 0.1, { type: 'triangle', gain: G(0.14), reverb: true });
        this.tone(990, t + 0.08, 0.16, { type: 'triangle', gain: G(0.14), reverb: true });
        break;
      case 'key':
        for (let i = 0; i < 4; i++) this.tone(1800 + i * 330, t + i * 0.05, 0.25, { type: 'sine', gain: G(0.09), reverb: true });
        this.noise(t, 0.12, { freq: 5000, q: 2, gain: G(0.05) });
        break;
      case 'search':
        this.noise(t, 0.35, { freq: 2200, q: 0.8, gain: G(0.09) });
        this.noise(t + 0.4, 0.3, { freq: 1700, q: 0.8, gain: G(0.07) });
        break;
      case 'door':
        this.tone(95, t, 0.5, { type: 'sawtooth', gain: G(0.07), slide: 1.5 });
        this.noise(t, 0.5, { freq: 700, q: 3, gain: G(0.06), sweep: 2 });
        this.tone(60, t + 0.45, 0.3, { type: 'sine', gain: G(0.18) });
        break;
      case 'unlock':
        this.tone(1200, t, 0.05, { type: 'square', gain: G(0.07) });
        this.tone(800, t + 0.07, 0.08, { type: 'square', gain: G(0.07) });
        break;
      case 'locked':
        this.tone(140, t, 0.09, { type: 'square', gain: G(0.12) });
        this.tone(120, t + 0.12, 0.12, { type: 'square', gain: G(0.12) });
        break;
      case 'hide':
        this.tone(90, t, 0.18, { type: 'sine', gain: G(0.2) });
        this.noise(t, 0.2, { freq: 400, q: 1, gain: G(0.08) });
        break;
      case 'unhide':
        this.noise(t, 0.2, { freq: 600, q: 1, gain: G(0.07) });
        this.tone(110, t + 0.05, 0.14, { type: 'sine', gain: G(0.14) });
        break;
      case 'solved':
        [523, 659, 784, 1047].forEach((f, i) => this.tone(f, t + i * 0.09, 0.4, { type: 'triangle', gain: G(0.14), reverb: true }));
        break;
      case 'error':
        this.tone(160, t, 0.22, { type: 'sawtooth', gain: G(0.1), slide: 0.7 });
        break;
      case 'lamp':
        this.tone(1400, t, 0.03, { type: 'square', gain: G(0.06) });
        this.noise(t, 0.05, { freq: 3000, q: 1, gain: G(0.05) });
        break;
      case 'battery':
        this.tone(300, t, 0.2, { type: 'square', gain: G(0.07), slide: 2 });
        this.tone(600, t + 0.15, 0.2, { type: 'triangle', gain: G(0.1) });
        break;
      case 'glass':
        for (let i = 0; i < 6; i++) this.tone(2400 + Math.random() * 2600, t + i * 0.025, 0.2, { type: 'triangle', gain: G(0.09), reverb: true });
        this.noise(t, 0.2, { freq: 6500, q: 1.5, gain: G(0.1) });
        break;
      case 'chalk':
        this.noise(t, 0.25, { freq: 4000, q: 0.7, gain: G(0.06), type: 'highpass' });
        break;
      case 'drag':
        this.noise(t, 0.8, { freq: 160, q: 1.2, gain: G(0.17), type: 'lowpass' });
        break;
      case 'defeat':
        this.tone(220, t, 1.2, { type: 'sawtooth', gain: 0.15, slide: 0.25, reverb: true });
        this.noise(t, 0.8, { freq: 300, q: 0.7, gain: 0.12, type: 'lowpass' });
        break;
      case 'ending':
        [392, 494, 587, 784].forEach((f, i) => this.tone(f, t + i * 0.3, 1.8, { type: 'sine', gain: 0.12, reverb: true }));
        break;
      case 'note_grave':
        this.tone(196, t, 0.55, { type: 'triangle', gain: 0.2, reverb: true });
        break;
      case 'note_medium':
        this.tone(330, t, 0.55, { type: 'triangle', gain: 0.18, reverb: true });
        break;
      case 'note_aigu':
        this.tone(659, t, 0.55, { type: 'triangle', gain: 0.16, reverb: true });
        break;
      case 'cue_steps':
        for (let i = 0; i < 3; i++) this.tone(70, t + i * 0.42, 0.14, { type: 'sine', gain: 0.18 });
        break;
      case 'cue_alert':
        this.tone(880, t, 0.12, { type: 'square', gain: 0.1 });
        this.tone(1175, t + 0.1, 0.28, { type: 'square', gain: 0.1 });
        break;
      case 'cue_creak':
        this.tone(60, t, 1.1, { type: 'sawtooth', gain: 0.1, slide: 1.8 });
        this.noise(t, 1.1, { freq: 300, q: 5, gain: 0.05, sweep: 2.5 });
        break;
      case 'cue_water':
        this.noise(t, 0.6, { freq: 800, q: 4, gain: 0.1, sweep: 0.4 });
        break;
      case 'cue_hum':
        this.tone(115, t, 1.5, { type: 'sine', gain: 0.1 });
        this.tone(118, t, 1.5, { type: 'sine', gain: 0.08 });
        break;
      default:
        break;
    }
  }

  /** Bruit de pas selon la surface ; appelé à chaque pas. */
  footstep(surface: Surface, running: boolean, crouched: boolean): void {
    const c = this.ctx;
    if (!c || c.state !== 'running') return;
    const now = c.currentTime;
    if (now - this.lastStep < 0.08) return;
    this.lastStep = now;
    const g = (crouched ? 0.35 : running ? 1 : 0.65) * 0.1;
    switch (surface) {
      case 'carpet':
        this.noise(now, 0.09, { freq: 350, q: 0.6, gain: g * 0.9, type: 'lowpass' });
        break;
      case 'wood':
        this.noise(now, 0.07, { freq: 900, q: 2, gain: g });
        this.tone(130 + Math.random() * 20, now, 0.07, { type: 'sine', gain: g * 0.7 });
        break;
      case 'tile':
        this.noise(now, 0.05, { freq: 2600, q: 2.5, gain: g });
        this.tone(320 + Math.random() * 40, now, 0.05, { type: 'triangle', gain: g * 0.4, reverb: true });
        break;
      case 'marble':
        this.noise(now, 0.05, { freq: 3200, q: 3, gain: g * 1.1 });
        this.tone(480 + Math.random() * 50, now, 0.08, { type: 'triangle', gain: g * 0.4, reverb: true });
        break;
    }
  }

  /** Rejoue une séquence de notes (boîte à musique). Retourne la durée totale. */
  playSequence(notes: string[], gap = 0.6): number {
    const c = this.ctx;
    if (!c || c.state !== 'running') return 0;
    notes.forEach((n, i) => {
      window.setTimeout(() => this.sfx(`note_${n}`), i * gap * 1000);
    });
    return notes.length * gap;
  }

  /* ---------------------------------------------------------------------- */
  /* Ambiances                                                              */
  /* ---------------------------------------------------------------------- */
  setAmbience(kind: Ambience): void {
    const c = this.ctx;
    if (!c || this.ambKind === kind) return;
    this.ambKind = kind;
    const old = this.ambNodes;
    if (old) {
      old.gain.gain.setTargetAtTime(0, c.currentTime, 0.6);
      window.setTimeout(() => old.stop(), 2500);
    }
    this.ambNodes = this.buildAmbience(kind);
  }

  private buildAmbience(kind: Ambience): { stop: () => void; gain: GainNode } {
    const c = this.ctx as AudioContext;
    const g = c.createGain();
    g.gain.value = 0;
    g.gain.setTargetAtTime(1, c.currentTime, 1.2);
    g.connect(this.ambBus);
    const stoppers: Array<() => void> = [];
    const addOsc = (freq: number, type: OscillatorType, gain: number, lfoRate = 0, lfoDepth = 0): void => {
      const o = c.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      const og = c.createGain();
      og.gain.value = gain;
      o.connect(og);
      og.connect(g);
      if (lfoRate > 0) {
        const lfo = c.createOscillator();
        lfo.frequency.value = lfoRate;
        const lg = c.createGain();
        lg.gain.value = lfoDepth;
        lfo.connect(lg);
        lg.connect(og.gain);
        lfo.start();
        stoppers.push(() => lfo.stop());
      }
      o.start();
      stoppers.push(() => o.stop());
    };
    const addNoise = (freq: number, q: number, gain: number, type: BiquadFilterType = 'bandpass', lfoRate = 0, lfoDepth = 0): void => {
      const src = c.createBufferSource();
      src.buffer = this.noiseBuf;
      src.loop = true;
      const f = c.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      const ng = c.createGain();
      ng.gain.value = gain;
      src.connect(f);
      f.connect(ng);
      ng.connect(g);
      if (lfoRate > 0) {
        const lfo = c.createOscillator();
        lfo.frequency.value = lfoRate;
        const lg = c.createGain();
        lg.gain.value = lfoDepth;
        lfo.connect(lg);
        lg.connect(f.frequency);
        lfo.start();
        stoppers.push(() => lfo.stop());
      }
      src.start();
      stoppers.push(() => src.stop());
    };
    switch (kind) {
      case 'hotel':
        addOsc(55, 'sine', 0.05, 0.07, 0.015);
        addOsc(55.4, 'sine', 0.04);
        addOsc(110.5, 'triangle', 0.015, 0.11, 0.008);
        addNoise(300, 0.5, 0.012, 'lowpass');
        break;
      case 'corridor':
        addOsc(48, 'sine', 0.06, 0.05, 0.02);
        addNoise(500, 1.2, 0.03, 'bandpass', 0.08, 180);
        addOsc(120, 'sine', 0.01, 0.3, 0.008);
        break;
      case 'service':
        addNoise(220, 0.7, 0.06, 'lowpass');
        addOsc(100, 'sawtooth', 0.012);
        addOsc(50, 'sine', 0.045, 0.2, 0.01);
        break;
      case 'quiet':
        addOsc(196, 'sine', 0.012, 0.09, 0.006);
        addOsc(293.7, 'sine', 0.008, 0.06, 0.004);
        addNoise(250, 0.4, 0.008, 'lowpass');
        break;
      case 'wind':
        addNoise(700, 0.8, 0.07, 'bandpass', 0.11, 350);
        addOsc(65, 'sine', 0.03);
        break;
      case 'pool':
        addNoise(900, 2, 0.04, 'bandpass', 0.17, 300);
        addOsc(70, 'sine', 0.04, 0.12, 0.012);
        break;
    }
    return {
      gain: g,
      stop: () => {
        for (const s of stoppers) {
          try {
            s();
          } catch {
            /* déjà arrêté */
          }
        }
        g.disconnect();
      },
    };
  }

  /* ---------------------------------------------------------------------- */
  /* Musique                                                                */
  /* ---------------------------------------------------------------------- */
  setMood(mood: MusicMood): void {
    if (!this.ctx || mood === this.mood) return;
    this.mood = mood;
    this.stopMusicTimer();
    this.chaseNodes?.stop();
    this.chaseNodes = null;
    if (this.musicGain) {
      this.musicGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.5);
      this.musicGain = null;
    }
    if (mood === 'none') return;
    const c = this.ctx;
    const mg = c.createGain();
    mg.gain.value = 0;
    mg.gain.setTargetAtTime(1, c.currentTime, 0.8);
    mg.connect(this.musicBus);
    mg.connect(this.reverbSend);
    this.musicGain = mg;
    this.musicStep = 0;
    if (mood === 'chase') {
      this.startChase(mg);
      return;
    }
    const root = mood === 'calm' ? 57 : 53; // La / Fa
    const interval = mood === 'calm' ? 1900 : 2600;
    const tick = (): void => {
      if (!this.ctx || this.mood !== mood || this.disposed) return;
      const t = this.ctx.currentTime;
      const step = this.musicStep++;
      const degree = PENTA[(step * 3 + Math.floor(step / 5)) % PENTA.length] as number;
      const oct = step % 4 === 0 ? 0 : 12;
      this.padTone(midiToHz(root + degree + oct), t, mood === 'calm' ? 3.2 : 4.2, mg, mood === 'calm' ? 0.07 : 0.05);
      if (step % 2 === 0) this.padTone(midiToHz(root - 12), t, 4, mg, 0.06);
      if (mood === 'mystery' && step % 3 === 0) this.padTone(midiToHz(root + 1 + 12), t + 0.9, 3, mg, 0.025);
      this.musicTimer = window.setTimeout(tick, interval);
    };
    tick();
  }

  private padTone(freq: number, start: number, dur: number, bus: GainNode, gain: number): void {
    const c = this.ctx;
    if (!c) return;
    const o1 = c.createOscillator();
    const o2 = c.createOscillator();
    o1.type = 'triangle';
    o2.type = 'sine';
    o1.frequency.value = freq;
    o2.frequency.value = freq * 1.004;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, start);
    g.gain.linearRampToValueAtTime(gain, start + dur * 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    o1.connect(g);
    o2.connect(g);
    g.connect(bus);
    o1.start(start);
    o2.start(start);
    o1.stop(start + dur + 0.1);
    o2.stop(start + dur + 0.1);
  }

  private startChase(bus: GainNode): void {
    const c = this.ctx as AudioContext;
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = 55;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 220;
    const g = c.createGain();
    g.gain.value = 0.0001;
    const lfo = c.createOscillator();
    lfo.frequency.value = 2.2; // pouls
    const lg = c.createGain();
    lg.gain.value = 0.07;
    lfo.connect(lg);
    lg.connect(g.gain);
    g.gain.value = 0.08;
    o.connect(f);
    f.connect(g);
    g.connect(bus);
    const o2 = c.createOscillator();
    o2.type = 'square';
    o2.frequency.value = 110.7;
    const g2 = c.createGain();
    g2.gain.value = 0.015;
    o2.connect(g2);
    g2.connect(bus);
    o.start();
    o2.start();
    lfo.start();
    this.chaseNodes = {
      stop: () => {
        window.setTimeout(() => {
          for (const n of [o, o2, lfo]) {
            try {
              n.stop();
            } catch {
              /* déjà arrêté */
            }
          }
        }, 1500);
      },
    };
  }

  private stopMusicTimer(): void {
    if (this.musicTimer !== null) {
      window.clearTimeout(this.musicTimer);
      this.musicTimer = null;
    }
  }

  /** Arrête tout ce qui joue (retour au menu). */
  stopAll(): void {
    this.stopMusicTimer();
    this.setMood('none');
    if (this.ambNodes && this.ctx) {
      const old = this.ambNodes;
      old.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.3);
      window.setTimeout(() => old.stop(), 1500);
    }
    this.ambNodes = null;
    this.ambKind = null;
  }
}
