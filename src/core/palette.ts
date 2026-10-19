/** Palette principale Dreamcore (cahier des charges). */
export const PAL = {
  night: 0x11111f,
  hotel: 0x282044,
  lavender: 0xb8a3f5,
  rose: 0xf3b5d8,
  water: 0x72dcd4,
  meadow: 0xa8d6a0,
  sky: 0xa6d9ff,
  light: 0xffe6b0,
} as const;

export const CSS = {
  night: '#11111F',
  hotel: '#282044',
  lavender: '#B8A3F5',
  rose: '#F3B5D8',
  water: '#72DCD4',
  meadow: '#A8D6A0',
  sky: '#A6D9FF',
  light: '#FFE6B0',
} as const;

export function hex(n: number): string {
  return `#${n.toString(16).padStart(6, '0')}`;
}

/** Mélange linéaire de deux couleurs 0xRRGGBB. */
export function mix(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255;
  const ag = (a >> 8) & 255;
  const ab = a & 255;
  const br = (b >> 16) & 255;
  const bg = (b >> 8) & 255;
  const bb = b & 255;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}

export function shade(c: number, t: number): number {
  return t >= 0 ? mix(c, 0xffffff, t) : mix(c, 0x000000, -t);
}
