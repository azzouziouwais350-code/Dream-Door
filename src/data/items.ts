import { getFragment } from './story';

export interface ItemDef {
  id: string;
  name: string;
  description: string;
  /** Indispensable à la progression. */
  essential: boolean;
  /** Clé de la texture d'icône (voir gfx/icons.ts). */
  icon: string;
  usable: boolean;
}

const BASE: Record<string, Omit<ItemDef, 'id'>> = {
  lamp: {
    name: 'Lampe de poche',
    description: 'Une lampe rechargeable. [F] pour l’allumer. Elle révèle des détails et consomme sa charge.',
    essential: false,
    icon: 'lamp',
    usable: true,
  },
  battery: {
    name: 'Batterie',
    description: 'Recharge la lampe de 90 secondes. Utilisez-la depuis l’inventaire.',
    essential: false,
    icon: 'battery',
    usable: true,
  },
  map: {
    name: 'Carte partielle',
    description: 'Un plan déchiré de l’hôtel. Elle affiche les portes déjà franchies et la prochaine.',
    essential: false,
    icon: 'map',
    usable: true,
  },
  chalk: {
    name: 'Craie lumineuse',
    description: 'Elle marque les murs d’une lueur pâle. Peut révéler ce que l’œil ne voit pas.',
    essential: false,
    icon: 'chalk',
    usable: true,
  },
  glassToken: {
    name: 'Jeton de verre',
    description: 'Lancé, il se brise avec un tintement. Attire l’attention loin de vous.',
    essential: false,
    icon: 'token',
    usable: true,
  },
  stoppedWatch: {
    name: 'Montre arrêtée',
    description: 'Elle indique 3 h 17. Le balancier n’a pas bougé depuis votre arrivée.',
    essential: false,
    icon: 'watch',
    usable: false,
  },
  screwdriver: {
    name: 'Tournevis',
    description: 'Un outil minuscule. Ouvre les capots et les mécanismes vissés.',
    essential: true,
    icon: 'screwdriver',
    usable: false,
  },
  fuse: {
    name: 'Fusible',
    description: 'Un fusible de céramique. Il manque à une boîte électrique.',
    essential: true,
    icon: 'fuse',
    usable: false,
  },
  badge: {
    name: 'Badge de concierge',
    description: 'Un badge en laiton gravé « Gardien ». Il est encore tiède.',
    essential: false,
    icon: 'badge',
    usable: false,
  },
};

export function isKeyId(id: string): boolean {
  return id.startsWith('key:');
}

export function isMemoryId(id: string): boolean {
  return id.startsWith('memory:');
}

export function keyNumber(id: string): string {
  return id.slice(4);
}

export function getItemDef(id: string): ItemDef {
  if (isKeyId(id)) {
    return {
      id,
      name: `Clé n°${keyNumber(id)}`,
      description: `Une clé de laiton marquée « ${keyNumber(id)} ». Elle ouvre la porte correspondante.`,
      essential: true,
      icon: 'key',
      usable: false,
    };
  }
  if (isMemoryId(id)) {
    const frag = getFragment(id.slice(7));
    return {
      id,
      name: frag ? `Fragment — ${frag.title}` : 'Fragment de souvenir',
      description: frag ? frag.text : 'Un éclat de souvenir qui ne vous appartient peut-être pas.',
      essential: false,
      icon: 'memory',
      usable: false,
    };
  }
  const base = BASE[id];
  if (!base) {
    return { id, name: id, description: 'Objet inconnu.', essential: false, icon: 'unknown', usable: false };
  }
  return { id, ...base };
}

export const ITEM_ICON_IDS = [
  'lamp',
  'battery',
  'map',
  'chalk',
  'token',
  'watch',
  'screwdriver',
  'fuse',
  'badge',
  'key',
  'memory',
  'unknown',
] as const;
