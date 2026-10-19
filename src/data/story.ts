export interface Fragment {
  id: string;
  title: string;
  text: string;
}

export const FRAGMENTS: Fragment[] = [
  { id: 'ch1_1', title: 'Le registre', text: 'Un nom a été gratté du registre. Il reste un J, trois chiffres et une heure : 3 h 17.' },
  { id: 'ch1_2', title: 'La nuit de service', text: 'Tu tenais la réception. Un voyageur est arrivé sans valise et t’a demandé l’heure.' },
  { id: 'ch1_3', title: 'Le balancier', text: 'Tu as arrêté l’horloge du hall pour qu’il ne parte pas. L’hôtel a gardé la minute, et toi avec.' },
  { id: 'ch1_4', title: 'Le Concierge', text: 'Il s’appelait Anselme. Il a gardé les portes avant toi, puis il a oublié pourquoi.' },
  { id: 'ch1_5', title: 'Les piscines', text: 'Au sous-sol, l’eau remonte vers le ciel. Quelqu’un y nage encore, très loin sous la surface.' },
  { id: 'ch1_6', title: 'La prairie', text: 'Par la fenêtre du salon, une prairie recule à mesure qu’on la regarde.' },
  {
    id: 'secret',
    title: 'Le carnet de la loge',
    text: 'Pour sortir : une montre qui marche, un nom retrouvé, ou une porte qu’on dessine soi-même.',
  },
];

export const CH1_FRAGMENT_IDS = ['ch1_1', 'ch1_2', 'ch1_3', 'ch1_4', 'ch1_5', 'ch1_6'];

export function getFragment(id: string): Fragment | undefined {
  return FRAGMENTS.find((f) => f.id === id);
}

export const NPC_NAMES: Record<string, string> = {
  orsolya: 'Orsolya, la réceptionniste figée',
  basile: 'Basile, le petit groom',
  ilye: 'Ilyë, l’ascensoriste',
};

/** Un tableau par visite : les visites suivantes donnent d’autres répliques. */
export const NPC_DIALOGUES: Record<string, string[][]> = {
  orsolya: [
    [
      'Bienvenue à l’Hôtel des heures immobiles.',
      'Vous n’avez pas de bagages. Personne n’en a, ici.',
      'La clé de la porte 000 est rangée quelque part dans cette pièce. Fouillez les meubles avec [E].',
    ],
    ['Les portes se suivent. Chaque salle cache de quoi ouvrir la suivante.', 'Si les lumières vacillent, ne restez pas dans le noir.'],
    ['Je compte les minutes depuis 3 h 17. Je ne suis jamais allée plus loin.'],
  ],
  basile: [
    [
      'Chut. Les armoires sont des amies, mais certaines n’aiment pas les visiteurs.',
      'Un jeton de verre lancé attire le Concierge. Il adore le bruit.',
    ],
    ['Le Concierge n’ouvre pas toutes les cachettes. Seulement celles où il vous a vu entrer.'],
    ['Un jour j’ai demandé à la lune de me ramener chez moi. Elle a répondu « bientôt ».'],
  ],
  ilye: [
    [
      'Dernier palier de ce chapitre. Je ne choisis pas pour vous.',
      'Il existe quatre façons de partir. Le panneau n’affiche que celles que vous avez méritées.',
    ],
    ['Une montre, un badge, des souvenirs, de la craie… Tout ce que vous avez ramassé compte.'],
  ],
};

export type EndingId = 'exit' | 'return' | 'guardian' | 'invisible';

export interface EndingDef {
  id: EndingId;
  title: string;
  requirement: string;
  lines: string[];
}

export const ENDINGS: EndingDef[] = [
  {
    id: 'exit',
    title: 'La sortie',
    requirement: 'Toujours disponible.',
    lines: [
      'L’ascenseur monte sans bruit. Les numéros s’effacent un à un.',
      'Quand les portes s’ouvrent, il n’y a plus de couloir : seulement un matin gris et le sentiment d’avoir oublié quelque chose.',
      'FIN — La sortie',
    ],
  },
  {
    id: 'return',
    title: 'Le retour',
    requirement: 'Nécessite la montre arrêtée.',
    lines: [
      'Vous remontez la montre. Pour la première fois depuis 3 h 17, le balancier oscille.',
      'Dans le hall, l’horloge repart. Orsolya sourit, enfin libre de finir sa phrase.',
      'FIN — Le retour',
    ],
  },
  {
    id: 'guardian',
    title: 'Le gardien',
    requirement: 'Nécessite le badge de concierge.',
    lines: [
      'Vous épinglez le badge. Les portes se redressent comme pour saluer.',
      'Quelque part, Anselme se souvient de son nom et s’en va. Vous prenez sa place, et la lampe, et le trousseau.',
      'FIN — Le gardien',
    ],
  },
  {
    id: 'invisible',
    title: 'La porte invisible',
    requirement: 'Nécessite la craie lumineuse et au moins 4 fragments de souvenir.',
    lines: [
      'Avec la craie, vous dessinez une porte sur le mur nu. Les souvenirs la remplissent comme de l’encre.',
      'Elle s’ouvre sur un couloir turquoise où l’eau coule vers le haut.',
      'FIN — La porte invisible (le chapitre II vous attend)',
    ],
  },
];

export function getEnding(id: EndingId): EndingDef {
  const e = ENDINGS.find((x) => x.id === id);
  if (!e) throw new Error(`Fin inconnue : ${id}`);
  return e;
}

export const CHAPTER_TITLES: Record<number, string> = {
  1: 'Chapitre I — L’Hôtel des heures immobiles',
  2: 'Chapitre II — Les Piscines sans fond',
  3: 'Chapitre III — La Prairie qui recule',
  4: 'Chapitre IV — Les Chambres au-dessus du ciel',
  5: 'Chapitre V — Le Dernier Seuil',
};

export const OPENING_LINES = [
  'Vous vous réveillez sur un tapis lavande. Personne ne vous a vu arriver.',
  'Une carte glissée dans votre poche : « Ne cherchez pas la sortie. Cherchez la prochaine porte. »',
];
