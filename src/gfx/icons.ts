import { PAL, shade } from '../core/palette';
import { ITEM_ICON_IDS } from '../data/items';
import { type Ctx, css, makeCanvas, px } from './pixel';

const ICON = 16;

function drawIcon(ctx: Ctx, id: string): void {
  const r = (x: number, y: number, w: number, h: number, c: number, a = 1): void => px(ctx, x, y, w, h, c, a);
  switch (id) {
    case 'lamp':
      r(6, 2, 4, 3, 0x6b7388);
      r(5, 5, 6, 6, 0xd6a85c);
      r(6, 5, 4, 5, PAL.light);
      r(4, 11, 8, 3, 0x433a6b);
      r(7, 14, 2, 1, 0x433a6b);
      r(3, 7, 1, 1, PAL.light, 0.6);
      r(12, 7, 1, 1, PAL.light, 0.6);
      break;
    case 'battery':
      r(5, 3, 6, 11, 0x433a6b);
      r(6, 4, 4, 9, PAL.meadow);
      r(7, 2, 2, 2, 0xc3c9d6);
      r(7, 6, 2, 4, 0xffffff);
      break;
    case 'map':
      r(2, 3, 12, 10, 0xe9d8a6);
      r(2, 3, 12, 1, 0xc9b27a);
      r(4, 6, 5, 1, 0xc2476b);
      r(8, 6, 1, 5, 0xc2476b);
      r(9, 10, 3, 1, 0xc2476b);
      r(11, 8, 2, 2, 0x4f8f98);
      break;
    case 'chalk':
      r(5, 4, 6, 9, 0xf6f0fa);
      r(5, 12, 6, 2, 0xb8a3f5);
      r(4, 3, 8, 1, PAL.water, 0.7);
      r(3, 2, 10, 1, PAL.water, 0.35);
      break;
    case 'token':
      r(5, 4, 6, 8, 0x9fe2e8, 0.9);
      r(6, 3, 4, 1, 0x9fe2e8, 0.9);
      r(6, 12, 4, 1, 0x9fe2e8, 0.9);
      r(6, 5, 1, 4, 0xffffff);
      break;
    case 'watch':
      r(7, 1, 2, 3, 0xd6a85c);
      r(4, 4, 8, 9, 0xd6a85c);
      r(5, 5, 6, 7, 0xfff6e0);
      r(8, 6, 1, 3, 0x2c2236);
      r(8, 8, 3, 1, 0x2c2236);
      r(7, 13, 2, 2, 0xd6a85c);
      break;
    case 'screwdriver':
      r(7, 2, 3, 6, 0xf36b7a);
      r(6, 3, 1, 4, 0xc2476b);
      r(8, 8, 1, 6, 0xc3c9d6);
      r(8, 13, 1, 1, 0x8d95ab);
      break;
    case 'fuse':
      r(4, 6, 8, 4, 0xece3f5);
      r(2, 6, 2, 4, 0xd6a85c);
      r(12, 6, 2, 4, 0xd6a85c);
      r(5, 7, 6, 2, 0xf36b7a, 0.5);
      r(7, 7, 2, 2, 0x2c2236);
      break;
    case 'badge':
      r(4, 2, 8, 12, 0xd6a85c);
      r(5, 3, 6, 10, 0xe9c984);
      r(6, 5, 4, 1, 0x2c2236);
      r(6, 7, 4, 1, 0x2c2236);
      r(6, 9, 3, 1, 0x2c2236);
      r(7, 1, 2, 2, 0x6b7388);
      break;
    case 'key':
      r(3, 3, 5, 5, 0xd6a85c);
      r(4, 4, 3, 3, 0x2c2236);
      r(7, 6, 7, 2, 0xd6a85c);
      r(11, 8, 2, 3, 0xd6a85c);
      r(13, 8, 1, 2, 0xd6a85c);
      r(3, 3, 5, 1, 0xffe6b0);
      break;
    case 'memory':
      r(7, 2, 2, 2, PAL.rose);
      r(5, 4, 6, 2, PAL.lavender);
      r(3, 6, 10, 3, PAL.rose);
      r(5, 9, 6, 2, PAL.lavender);
      r(7, 11, 2, 3, PAL.rose);
      r(7, 6, 2, 3, 0xffffff);
      break;
    default:
      r(4, 4, 8, 8, 0x6b7388);
      r(7, 6, 2, 2, 0xffffff);
      r(7, 9, 2, 1, 0xffffff);
  }
}

export function iconCanvas(id: string): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(ICON, ICON);
  drawIcon(ctx, id);
  return canvas;
}

export function iconDataUrls(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const id of ITEM_ICON_IDS) out[id] = iconCanvas(id).toDataURL();
  return out;
}

export function drawSymbolIcon(symbol: string): string {
  const { canvas, ctx } = makeCanvas(20, 20);
  const r = (x: number, y: number, w: number, h: number, c: number): void => px(ctx, x, y, w, h, c);
  switch (symbol) {
    case 'sun':
      r(7, 7, 6, 6, PAL.light);
      for (const [x, y] of [[9, 2], [9, 15], [2, 9], [15, 9], [4, 4], [14, 4], [4, 14], [14, 14]] as const) r(x, y, 2, 2, PAL.light);
      break;
    case 'moon':
      r(5, 4, 8, 12, PAL.lavender);
      r(9, 4, 6, 12, 0x282044);
      r(8, 6, 2, 8, PAL.lavender);
      break;
    case 'star':
      r(9, 2, 2, 16, PAL.rose);
      r(2, 9, 16, 2, PAL.rose);
      r(5, 5, 10, 10, PAL.rose);
      r(7, 7, 6, 6, 0xffffff);
      break;
    case 'eye':
      r(2, 8, 16, 4, PAL.water);
      r(4, 6, 12, 8, PAL.water);
      r(7, 7, 6, 6, 0xffffff);
      r(9, 8, 3, 4, 0x11111f);
      break;
    case 'wave':
      for (let i = 0; i < 4; i++) {
        r(2 + i * 4, 6 + (i % 2) * 4, 4, 2, PAL.water);
        r(2 + i * 4, 12 + (i % 2) * 4 - 4, 4, 2, shade(PAL.water, -0.2));
      }
      break;
    default:
      r(4, 4, 12, 12, 0x6b7388);
  }
  return canvas.toDataURL();
}

export function cssVar(c: number): string {
  return css(c);
}
