# DREAM DOORS — Ultimate Dreamcore Adventure

Jeu d'aventure/évasion en 2D isométrique, style pixel art « dreamcore / liminal », jouable dans le navigateur
(TypeScript + Vite + Phaser 3). Cinq chapitres sont prévus (~100 portes) ; **le chapitre I — « L'Hôtel des heures
immobiles » (20 portes) est entièrement jouable**. Les chapitres II à V ne sont pas encore développés.

## Commandes

```bash
npm install          # installe les dépendances
npm run dev          # serveur de développement (http://localhost:5173)
npm test             # tests automatisés (Vitest)
npm run typecheck    # vérification TypeScript
npm run build        # build de production dans dist/
npm run preview      # sert le build localement
```

Node 20 ou plus récent est recommandé.

## Commandes de jeu

| Action | Clavier | Mobile |
|---|---|---|
| Se déplacer | ZQSD / WASD / flèches | joystick virtuel |
| Interagir | E (ou Entrée) | bouton E |
| Courir | Maj (maintenu) | COURIR |
| S'accroupir | Ctrl ou C | BAS |
| Lampe | F | LAMPE |
| Inventaire | I ou Tab | SAC |
| Indice | H | ? |
| Pause | Échap ou P | II |

Les touches sont reconfigurables dans Options. Accessibilité : mouvement réduit, sous-titres des sons,
contraste élevé, taille du texte, volumes indépendants (général, musique, effets, ambiance).

## Contenu du chapitre I

- 20 portes générées de façon **déterministe à partir d'une graine** (même graine = même hôtel), à partir de
  17 modèles de salles et d'un validateur qui refuse toute génération impossible à terminer.
- 5 entités à états lisibles et signes d'alerte visuels et sonores : Le Veilleur, L'Ombre du Plafond, Le Nageur,
  Le Concierge, Le Faux-Seuil.
- Cachettes aux propriétés différentes (protègent de la vue, étouffent ou non le bruit, inspectables ou non).
- Énigmes : séquences de symboles et de notes, interrupteurs, vannes, fusible, détection d'anomalie, meubles à
  déplacer, passages secrets ; indices à trois niveaux.
- Inventaire : clés numérotées, lampe rechargeable, piles, carte partielle, craie lumineuse, jetons de verre,
  montre arrêtée, fragments de souvenir, outils.
- Trois personnages secondaires et quatre fins (la sortie, le retour, le gardien, la porte invisible).
- Sauvegarde automatique (localStorage) aux moments sûrs, avec validation, mise en quarantaine des sauvegardes
  corrompues et migration de version.

## Architecture

```
src/core        types, RNG à graine, maths isométriques, palette
src/systems     collisions, navigation, inventaire, énigmes, entités, générateur, validateur, sauvegarde
src/data        objets, histoire, modèles de salles (un fichier par chapitre : ajouter un chapitre = ajouter un fichier)
src/game        World : toute la logique de jeu, sans Phaser (donc testable sans navigateur)
src/gfx         sprites générés par code
src/audio       gestionnaire audio centralisé (synthèse Web Audio)
src/input       clavier et tactile
src/ui          interface DOM (menu, HUD, inventaire, carte, pause, énigmes, fins, options)
src/scenes      Phaser : Boot (textures), Game (rendu iso, caméra, éclairage)
src/app.ts      orchestration : monde ↔ scène ↔ interface ↔ audio ↔ sauvegarde
tests/          tests Vitest, dont une partie complète du chapitre I jouée par un robot
```

## Déploiement sur GitHub Pages

1. Pousser le dépôt sur GitHub (branche `main`).
2. Dans *Settings → Pages*, choisir **Source : GitHub Actions**.
3. Le workflow `.github/workflows/deploy.yml` lance typecheck, tests et build, puis publie `dist/`.

La base Vite est relative (`./`) : aucun réglage selon le nom du dépôt. Je n'ai pas pu publier le site depuis
cet environnement : le déploiement n'a donc pas été vérifié en conditions réelles.

## État réel du projet

Vérifié dans cet environnement : typecheck sans erreur, 62 tests passants, build de production réussi, jeu lancé
dans Chromium (menu, 23 salles affichées, ramassage, lampe, pause, transition de salle, rendu mobile).

Limites connues :
- Chapitres II à V : non développés (le générateur ne gère que le chapitre I).
- Pas de partie complète jouée à la main dans le navigateur : la complétion est vérifiée par un robot de test
  sur l'API du jeu, pas par un humain.
- Le son est synthétisé et n'a pas pu être écouté ici : le réglage musical/mixage reste à valider à l'oreille.
- Le bundle JavaScript fait ~1,4 Mo (Phaser), ~376 Ko compressé.
- Test tactile réel non effectué (seulement une émulation mobile).
