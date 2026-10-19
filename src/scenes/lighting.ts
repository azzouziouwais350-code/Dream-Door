export interface LightSpot {
  /** Position écran (pixels CSS). */
  x: number;
  y: number;
  /** Rayon horizontal ; le rayon vertical suit l'aplatissement isométrique. */
  rx: number;
  squash: number;
  strength: number;
}

export interface LightFrame {
  dark: number;
  tint: number;
  flicker: number;
  reduceMotion: boolean;
  highContrast: boolean;
  time: number;
  lights: LightSpot[];
  chased: boolean;
  hidden: boolean;
}

function rgb(c: number): [number, number, number] {
  return [(c >> 16) & 255, (c >> 8) & 255, c & 255];
}

/**
 * Éclairage : un canevas 2D posé au-dessus du rendu Phaser. On l'assombrit, puis on « perce » la nuit
 * avec des dégradés (lampe, lampadaires, zones sûres). Peu coûteux et net quel que soit le zoom.
 */
export class Lighting {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private w = 0;
  private h = 0;

  constructor(parent: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'lighting';
    Object.assign(this.canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none' });
    parent.append(this.canvas);
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D indisponible');
    this.ctx = ctx;
  }

  resize(w: number, h: number): void {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = w;
    this.h = h;
    this.canvas.width = Math.max(1, Math.floor(w * this.dpr));
    this.canvas.height = Math.max(1, Math.floor(h * this.dpr));
  }

  setVisible(v: boolean): void {
    this.canvas.style.display = v ? 'block' : 'none';
  }

  destroy(): void {
    this.canvas.remove();
  }

  render(f: LightFrame): void {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, this.w, this.h);

    let alpha = Math.min(0.92, 0.05 + f.dark * 1.08);
    if (f.highContrast) alpha *= 0.55;
    if (f.flicker > 0) {
      // Vacillement doux (≈ 2,4 Hz, sans bascule brutale) ; en mouvement réduit : simple assombrissement.
      const wave = f.reduceMotion ? 0.5 : 0.5 + 0.5 * Math.sin(f.time * 15);
      alpha = Math.min(0.95, alpha + f.flicker * (0.12 + 0.3 * wave));
    }
    const [r, g, b] = rgb(0x11111f);
    const [tr, tg, tb] = rgb(f.tint);
    const mixr = Math.round(r * 0.85 + tr * 0.15);
    const mixg = Math.round(g * 0.85 + tg * 0.15);
    const mixb = Math.round(b * 0.85 + tb * 0.15);
    ctx.fillStyle = `rgba(${mixr},${mixg},${mixb},${alpha.toFixed(3)})`;
    ctx.fillRect(0, 0, this.w, this.h);

    ctx.globalCompositeOperation = 'destination-out';
    for (const l of f.lights) {
      ctx.save();
      ctx.translate(l.x, l.y);
      ctx.scale(1, l.squash);
      const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, l.rx);
      grad.addColorStop(0, `rgba(0,0,0,${Math.min(1, l.strength)})`);
      grad.addColorStop(0.55, `rgba(0,0,0,${(l.strength * 0.6).toFixed(3)})`);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(-l.rx, -l.rx, l.rx * 2, l.rx * 2);
      ctx.restore();
    }
    ctx.globalCompositeOperation = 'source-over';

    // Vignette ; rouge pulsée en poursuite.
    const cx = this.w / 2;
    const cy = this.h / 2;
    const rad = Math.hypot(cx, cy);
    const vg = ctx.createRadialGradient(cx, cy, rad * 0.45, cx, cy, rad);
    if (f.chased) {
      const pulse = f.reduceMotion ? 0.5 : 0.5 + 0.5 * Math.sin(f.time * 6);
      vg.addColorStop(0, 'rgba(120,10,30,0)');
      vg.addColorStop(1, `rgba(150,10,40,${(0.28 + 0.2 * pulse).toFixed(3)})`);
    } else {
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(1, f.hidden ? 'rgba(0,0,0,0.6)' : 'rgba(5,4,15,0.32)');
    }
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, this.w, this.h);
  }
}
