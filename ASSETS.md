# Ressources et licences

## Ressources du jeu

- **Graphismes** : aucun fichier image. Tous les sprites, sols, murs, meubles, personnages et icônes sont
  dessinés par du code (canevas 2D, `src/gfx/`) au démarrage. Créations originales de ce projet.
- **Sons et musique** : aucun fichier audio. Tout est synthétisé par la Web Audio API (`src/audio/audio.ts`).
- **Textes, histoire, personnages, entités** : originaux (`src/data/`).
- **Police** : pile de polices monospace du système (aucune police embarquée).

## Dépendances

| Paquet | Usage | Licence |
|---|---|---|
| Phaser 3 | moteur de rendu 2D | MIT |
| Vite | outil de build | MIT |
| TypeScript | langage / vérification de types | Apache-2.0 |
| Vitest | tests automatisés | MIT |

Le code du jeu est fourni sous licence MIT (à adapter par l'auteur du dépôt).
