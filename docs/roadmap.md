# Roadmap produit — social, collaboration, visites

Document vivant issu de la session du 2026-07-09. Capture les décisions produit
prises avec l'utilisateur pour ne pas les reperdre entre les sessions. À
mettre à jour au fil de l'eau (statut, décisions qui changent).

## Ordre de priorité décidé

1. **✅ Fait, poussé en prod** (commits `5f455ea`…`be5cc1f`, 2026-07-09) —
   Drag & drop bibliothèque (collection/visite/corbeille) + uniformisation de
   la redirection post-upload vers `/triage` + **unification du système sur
   tout le site** (planches, carnet de visite)
2. Collections & visites collaboratives (fondation pour le reste) — pas commencé
3. Feed social — pas commencé
4. Messagerie — pas commencé
5. Refonte du module visites (carnet premium) — pas commencé

---

## 1. Drag & drop bibliothèque + unification site-wide (✅ fait)

Depuis la grille `/library`, glisser une ou plusieurs images (sélection
multiple existante respectée) vers :
- une collection existante → ajout, avec flash de succès sur le chip
- une visite existante → rattachement, avec flash de succès
- "+ Nouvelle collection" / "+ Nouvelle visite" → création à la volée
- une corbeille flottante → suppression avec confirmation

**Réalisé avec un vrai geste tactile** : Framer Motion piloté à la main
(`useDragControls`), **poignée dédiée au tactile / saisie libre à la souris**
(pas un simple appui long — cette première approche a échoué pour une raison
de plateforme fondamentale, voir mémoire agent), hit-testing par coordonnées
(`elementFromPoint`) plutôt que l'API HTML5 Drag&Drop qui ne fonctionne pas au
toucher.

**Étendu ensuite à tout le site** (demande explicite de l'utilisateur) via un
hook partagé `hooks/useDragHandle.ts` + composant `components/ui/DragHandle.tsx` :
- Grille des planches (`MoodboardGrid.tsx`) — réordonnancement (n'avait
  aucun fallback tactile avant) + dépôt sur dossier
- Carnet de visite (`VisitJournal.tsx`) — réordonnancement des blocs image/note

**Fiabilité + réordonnancement en temps réel (2026-07-10)** : après le premier
retour utilisateur ("ça ne fonctionne pas à tous les coups, pas dynamique"),
resplice du state en direct pendant le survol. Puis 2e retour ("des sautes et
des petits bugs") → **refonte complète du réordonnancement** sur le modèle
éprouvé des vraies libs DnD (dnd-kit / react-beautiful-dnd / Trello) :
**overlay flottant + item fantôme**, dans un hook dédié `hooks/useSortableGrid.ts`.
La cause du "saute" était le conflit `drag`+`layout` de Framer sur le même
élément (il bouge ET se réorganise) ; la solution découple les deux : un clone
`position:fixed` suit le pointeur (piloté par ref, zéro re-render/frame) pendant
que le fantôme et ses voisins se réorganisent proprement via `layout`.
`MoodboardGrid` et `VisitJournal` migrés dessus (la bibliothèque garde
`useDragHandle`, son drag n'est pas du reorder). Détails → mémoire agent.

Détails techniques complets et bugs rencontrés → mémoire agent (sections
"Drag & drop bibliothèque…" et "Unification du système de drag & drop…" dans
`project_moodboard.md`), pas dupliqués ici.

## 2. Redirection post-upload → triage (✅ fait)

Toute image uploadée redirige vers `/triage` plutôt que `/library` sur les 5
points d'entrée (`DropZone`, `GlobalUploadProvider`, `YouTubeImportClient`,
bookmarklet, flux PWA share).

## 3. Collections & visites collaboratives

**Décision : à faire.** Nouvelle table de collaborateurs, généralisable à
Collection, Visit, et potentiellement Moodboard (coédition de planches) :

```
CollectionCollaborator { collectionId, userId, role: OWNER|EDITOR|VIEWER }
VisitCollaborator      { visitId, userId, role: OWNER|EDITOR|VIEWER }
```

Toutes les routes API existantes qui vérifient `userId` strict devront aussi
accepter les collaborateurs. UI : bouton "Inviter" (par email), liste avatars.

## 4. Feed social

**Décision : visibilité par profil** (pas par image). Un toggle "profil
visible par mes amis" dans les réglages ; tout ce qui est `isAccepted:true,
isArchived:false` du profil apparaît dans le feed des personnes qui le
suivent. Le triage reste toujours privé par nature.

Nécessite un modèle `Follow` (`followerId`, `followingId`, statut) et une
page `/social` qui interroge les inspirations des profils suivis.

## 5. Messagerie

**Décision : vraie messagerie dès le départ**, pas juste un partage ponctuel.
- `Conversation`, `Message` (senderId, conversationId, content, timestamp)
- Pièce jointe = référence à une Inspiration / Collection / Moodboard
  (le destinataire peut l'accepter dans son triage ou une collection)
- Temps réel à trancher au moment de l'implémentation : polling (simple, pas
  de dépendance externe) vs service dédié (Ably/Pusher/websockets) si l'usage
  prévu est très actif. Décision reportée à la phase d'implémentation.
- "Collaborer sur une planche" via un message = en réalité le point 3
  (Moodboard + collaborateurs), la messagerie sert à *initier* la
  collaboration, pas à la porter techniquement.

## 6. Refonte du module visites — "carnet premium"

Trois sources d'inspiration citées par l'utilisateur pour cette refonte :
**iPhone Journal** (couverture, ajout en live, stats/carte), **Google Photos
albums partagés** (collaboratif, export/partage public), **Notion**
(éditeur de blocs). Améliorations, par ordre d'intérêt exprimé :

- **✅ Éditeur de carnet façon Notion (2026-07-10)** : réorganisation des
  blocs déjà refaite (overlay+fantôme, voir section 1 ci-dessus). Texte
  stylisé ajouté via Tiptap/ProseMirror (choix tranché par l'utilisateur
  face à l'alternative "blocs custom") — titres H2/H3, gras, italique,
  listes à puces/numérotées.
- **Blocs modulaires supplémentaires dans les notes (2026-07-10)** :
  **image inline** avec wrap texte façon magazine (node Tiptap
  `InlineImage`) et **bloc audio** intégré au texte. **Remplacé par la
  refonte "blocs purs" du 2026-07-13 ci-dessous** (image/audio ne
  s'intègrent plus DANS un bloc texte, ce sont des blocs autonomes).
  Dessin à main levée inline toujours reporté.
- **✅ Couverture de visite personnalisable (2026-07-10)** : bandeau
  carrousel plein-large en tête de `/visites/[id]` (`VisitCoverCarousel.tsx`),
  façon Apple Journal — remplace le header statique, scroll-snap + points de
  pagination.
- **✅ Carte cumulée (2026-07-10)** : nouvelle page `/visites/carte` — toutes
  les visites géolocalisées sur une carte Leaflet, pins-photo avec
  clustering (`leaflet.markercluster`), carrousel bas synchronisé
  (façon Google Photos / Apple Plans). Reste sur Leaflet (pas de bascule 3D,
  décidé avec l'utilisateur).
- **Ajout d'image en temps réel depuis le carnet** : bouton "+ Photo" dans
  `VisitJournal`, et sur mobile déclenchement direct de l'appareil photo
  (`<input type="file" capture="environment">` ou équivalent) pour
  documenter une visite en live, pendant qu'on est encore sur place. Pas
  commencé.
- **Visites collaboratives** — voir point 3. Pas commencé.
- **Export / partage public du carnet** — lien public à la manière du
  partage de planches existant (`shareToken`/`shareExpiry` sur Moodboard,
  pattern réutilisable sur Visit), ou export PDF. Pas commencé.
- **Statistiques (Insights)** — streaks, mots écrits, répartition par type de
  contenu façon Apple Journal Insights. Évoqué mais pas dans le lot du
  2026-07-10 (scope resserré à éditeur + couverture + carte). Pas commencé.
- **Menu "/" façon Notion** pour insérer un bloc dans une note — reporté au
  profit de boutons dédiés (🖼/🎙) dans la toolbar, plus rapide à livrer.
  **Remis au programme par le plan du 2026-07-13 (Phase 2 ci-dessous).**

---

## 7. Plan "Assistant de Visite Culturelle" (brief utilisateur 2026-07-13)

Brief produit complet fourni par l'utilisateur — vision : PWA sombre,
assistant de visite pour directeur artistique. Deux paradigmes stricts :
**mobile = captation friction zéro (Apple Journal)**, **desktop = table de
montage modulaire (Notion)**. Statut de chaque item vs l'existant :

### Phase 1 — Mobile "friction zéro" (✅ 2026-07-13, commit `aac0821` + 4 tours de retours terrain)
- **✅ FAB `+` persistant** (safe-area-inset-bottom) — `VisitCaptureFab.tsx`,
  redessiné ensuite en Phase 2F (menu galerie/mémo/caméra).
- **✅ Scan & Snap** : capture caméra native + compression client
  (`lib/image/clientResize.ts`, downscale 2400px + JPEG 0.86 — nécessaire
  après un signalement terrain, une photo smartphone dépasse couramment la
  limite serveur de 10 Mo).
- **✅ Mémos vocaux + transcription** — transcription live via Web Speech API
  (`fr-FR`, gratuite, cohérent avec le retrait de Gemini), **+ Whisper WASM
  local** (`@huggingface/transformers`, on-device, ~40 Mo au premier usage)
  en secours pour iOS PWA où Web Speech n'existe pas. Décision produit
  actée : pas d'API IA externe payante.
- **✅ Enrichissement auto GPS** : `CreateVisitModal` — "utiliser ma
  position" via `navigator.geolocation` + reverse geocoding Photon.
- **✅ Onboarding contextuel des permissions** : modale explicative avant la
  première demande micro (`localStorage["mb-mic-onboarded"]`), jamais à
  l'ouverture de la page.
- **4 tours de retours terrain réels (iPhone/PWA)** ont suivi la livraison
  initiale et corrigé des bugs invisibles en dev : `Permissions-Policy`
  bloquant micro/geoloc sitewide, upload photo cassé (mauvais champ de
  réponse API), waveforms invisibles sur Safari (webm non décodable +
  pourcentages CSS qui s'effondrent + placeholder invisible sur fond sombre),
  resync du journal après capture sans reload manuel, error boundary autour
  du lecteur audio (un crash pouvait effacer définitivement un mémo).
  Détails complets → mémoire agent, sessions "retour terrain" 1 à 4.

### Phase 2 — Desktop "table de montage" (✅ 2026-07-13, sauf bloc Moodboard)
- Éditeur par blocs D&D — ✅ (overlay+fantôme + Tiptap, lots précédents).
- **✅ Design "flottant"** : notes sans bordure ni fond gris permanent,
  structurées par les marges sur fond noir (fond léger au survol/édition).
- **✅ Bloc "Œuvre"** : cartel typographique automatique sous chaque image
  du carnet (Titre, puis Artiste · Année en italique) depuis
  `Inspiration.title/author/year`.
- **Bloc "Moodboard"** (grille d'images pleine largeur) — SEUL restant de
  la phase, pas commencé.
- **✅ Bloc "Citation"** : d'abord un blockquote intégré au texte (2026-07-13
  matin), **promu bloc autonome `VisitQuote`** l'après-midi même (voir
  refonte "blocs purs" ci-dessous).
- **✅ Toolbar fantôme + commande `/`** : la toolbar statique a disparu —
  bubble menu au surlignage (B/I/H2/listes, `@tiptap/react/menus`) et
  menu "/" (extension custom `SlashCommand` sur `@tiptap/suggestion`,
  popup DOM sans dépendance, filtrable, navigation clavier) pour insérer
  titres/listes dans un bloc texte.
- **✅ Auto-save continu + indicateur ●/✓** : save debouncé 800ms pendant
  la frappe via un chemin `persistNote` qui ne ferme pas l'éditeur et ne
  supprime jamais (le vide→suppression reste au blur).

### Phase 2C — Refonte "blocs purs" façon Notion (✅ 2026-07-13)
Retour utilisateur sur Phase 2 : les images/audio intégrés DANS un bloc
texte "ne servent à rien car on ne peut pas les déplacer" (hors du système
de réordonnancement `useSortableGrid`, qui n'opère qu'au niveau des blocs
top-level). Parti pris tranché : **chaque bloc du carnet est pur, un seul
type** (Notion-like) — plus de composition à l'intérieur d'un bloc.
- **Schéma additif** : nouvelles tables `VisitQuote`, `VisitColumns`
  (`leftType/leftId`, `rightType/rightId` — référence polymorphe non
  typable en Prisma, résolue au niveau applicatif) ; `VisitAudio` promu
  bloc top-level (+`transcript`, `+order`, avant : uniquement référencé
  depuis le HTML d'une note). Migration one-off (dry-run puis `--write`)
  extrait les clips audio + transcripts déjà embarqués dans d'anciennes
  notes vers des lignes `VisitAudio` autonomes, et nettoie le HTML.
- **`InlineImage` et `AudioBlock`** (nodes Tiptap) supprimés — l'image et
  l'audio ne sont plus insérables dans un bloc texte, uniquement comme
  blocs autonomes depuis le menu "+ Bloc" du carnet. `blockquote` retiré
  du schéma Tiptap (StarterKit `blockquote: false`).
- **Bloc "2 colonnes"** (`VisitColumns`) : place deux blocs purs côte à
  côte (texte/citation/image/audio, pas de colonnes imbriquées). Un bloc
  "réclamé" par une colonne est exclu de la séquence plate du carnet
  (calculé côté serveur dans `page.tsx`, pas contraint en base). Retirer un
  bloc d'un slot ("✕") le déréclame sans le supprimer — il redevient
  autonome dans le carnet.
- **Titre du bloc texte** (H2 à l'époque) : police serif arrondie dédiée
  (Fraunces, axe variable `SOFT`, `next/font/google`) à ~2.1em, nettement
  différenciée du corps de texte (avant : 1.05em, quasi invisible). **Promu
  bloc autonome `VisitTitle` le jour même, voir Phase 2D.**
- Mémo vocal FAB : crée directement un bloc `VisitAudio` autonome (POST
  `/api/visits/[id]/audio` avec `transcript` en champ natif) au lieu de
  construire une note wrapper avec HTML embarqué.

### Phase 2D — Titre autonome, colonnes par drag, retouches carnet (✅ 2026-07-13)
Retour utilisateur immédiat sur 2C, six demandes ciblées :
- **Bloc "Titre" autonome** (`VisitTitle`, même forme que `VisitQuote` —
  texte brut) : le H2 n'est plus une option de formatage à l'intérieur
  d'un bloc texte, c'est son propre type de bloc top-level (`TitleEditor.tsx`,
  police Fraunces réutilisée). Le bloc texte ne garde que le Sous-titre H3.
  Migration one-off a extrait les 2 `<h2>` restés intégrés dans d'anciennes
  notes réelles vers des `VisitTitle`, en renumérotant toute la séquence des
  2 visites concernées (dry-run confirmé, puis appliqué avec accord
  utilisateur).
- **Glisser un bloc existant dans une colonne** : `useSortableGrid` exposait
  déjà `onHover`/`onDrop(hitEl,...)` (même pattern que `LibraryDropZone`) —
  chaque slot vide expose `data-drop-key="columns:<id>:<slot>"`, hit-testé à
  la fin du drag. Si la cible est un slot vide, le bloc dragué (n'importe
  quel type sauf colonnes) est réclamé au lieu d'être simplement réordonné —
  "juste une façon de changer la disposition", pas de duplication.
- **"+ Bloc" → clic dans le vide** : le bouton pill explicite en fin de
  carnet est remplacé par une zone pleine largeur quasi invisible au repos
  (`opacity-0 hover:opacity-70`), texte "Cliquer, ou taper « / »…", qui ouvre
  le même sélecteur de type au clic ou à la touche "/".
- **Sous-titre H3** : mise en page revue (1.35em/650, avant quasi identique
  au corps) pour une hiérarchie claire body < H3 < Titre.
- **Titre d'image éditable au clic** : le cartel sous chaque image devient
  un `<input>` inline au clic (PATCH `/api/inspirations/[id]`), sans quitter
  le carnet — `EditableImageTitle` dans `VisitJournal.tsx`.
- **Image archivée visible dans le carnet** : `page.tsx` ne filtrait plus
  que `status:"READY"` — le filtre `isArchived:false` supprimé (l'archivage
  masque de la bibliothèque de travail, pas du carnet de visite).
- Vérifié en navigateur réel via compte de test jetable (voir mémoire agent
  pour la technique) : les 6 points testés de bout en bout, compte supprimé
  après coup.

### Phase 2E — Colonnes multi-blocs, sortir/redéplacer, switch (✅ 2026-07-13)
Trois demandes utilisateur sur le bloc "2 colonnes" : empiler plusieurs blocs
dans un même côté (titre puis texte puis audio), pouvoir sortir/redéplacer un
bloc qui y a été inséré, et switcher la position des blocs qui y sont.
- **`VisitColumns.left`/`.right` : d'un bloc unique à une PILE** —
  `leftType/leftId/rightType/rightId` remplacés par `left`/`right` (`Json`,
  tableau ordonné `[{type,id}, ...]`). Migration expand→migrate (les 2
  lignes réelles existantes converties en tableaux à un élément, confirmées
  identiques avant/après) ; la phase contract (suppression des anciennes
  colonnes SQL) est restée bloquée par le classificateur de sécurité malgré
  l'accord utilisateur répété — colonnes laissées en place, mortes mais
  inoffensives (plus jamais lues/écrites par le nouveau code).
- **Drag unifié top-level ↔ colonne ↔ colonne** : les blocs imbriqués dans
  une pile portent désormais `data-sortable-key` au même titre que les blocs
  top-level (`ColumnStackItem`), donc draguables avec le MÊME `useSortableGrid`.
  `onDrop` résout la cible (`locateBlock`/`removeAtLoc`/`getBlockAtLoc`,
  fonctions pures) en 3 cas : dépose sur une pile → ajoutée à la fin ; dépose
  sur un bloc top-level précis → ressort la colonne à cet endroit ; aucune
  cible → sort simplement en fin de séquence (comportement de secours).
- **Bug trouvé en testant, invisible à la revue** : le `onPointerDown` d'un
  bloc imbriqué remontait (bubbling React) jusqu'au conteneur "2 colonnes"
  englobant, qui a lui-même un `onPointerDown` de drag (pour se réordonner
  parmi les blocs top-level) — le second handler ÉCRASAIT l'armement du
  premier (`armedRef` est une ref unique, pas une pile), si bien que
  glisser un bloc imbriqué déplaçait en réalité TOUTE la colonne. Fix :
  `e.stopPropagation()` dans le `onPointerDown` de `ColumnStackItem` avant
  d'appeler le handler du hook.
- **↑/↓ + ✕ Retirer + Supprimer** par bloc imbriqué (menu "⋯" propre à
  `ColumnStackItem`, même vocabulaire que le menu top-level) — chemin fiable
  pour réordonner/sortir un bloc sans dépendre de la précision du drag.
- **"⇄ Échanger gauche/droite"** dans le menu du bloc colonnes — swap
  intégral des deux piles en un clic.
- Vérifié en navigateur réel (compte de test jetable) : empilement
  Titre+Texte+Audio dans une même colonne, ↑/↓ au sein de la pile, switch
  gauche/droite, sortie via ✕, sortie via drag vers une position top-level
  précise (après le fix stopPropagation), et régression du drag top-level →
  colonne — tout persisté et revérifié après rechargement complet.

### Phase 2F — FAB : menu d'action à 3 icônes (✅ 2026-07-13)
Refonte du bouton "+" de capture basée sur un zoning/wireframe fourni par
l'utilisateur (4 panneaux : idle, filler, menu ouvert 3 icônes + fermer,
enregistrement). Décisions clarifiées via AskUserQuestion (toutes acceptées
sur l'option recommandée) : tap ouvre un menu, appui long conservé tel quel
(bypass direct du menu, instruction explicite de l'utilisateur) ; l'icône
image ouvre la galerie (nouveau, pas de capture forcée) ; l'icône caméra
reste identique au comportement actuel.
- `VisitCaptureFab.tsx` : `fileInputRef` unique scindé en `galleryInputRef`
  (sans `capture`) et `cameraInputRef` (`capture="environment"` conservé).
- Tap sur le FAB ouvre `actionMenuOpen` (popover 3 boutons ronds 🖼/🎙/📷 + ✕
  Fermer en dessous, fermeture au clic extérieur). Appui long : timer
  identique à avant, ferme le menu s'il était ouvert puis appelle
  `startMemo()` directement, sans jamais passer par le menu.
- Vérifié en navigateur réel (compte de test jetable) : tap ouvre les 4
  boutons ; 🖼 déclenche `galleryInputRef` (`capture:null` confirmé par
  espionnage de `HTMLInputElement.prototype.click`) ; 📷 déclenche
  `cameraInputRef` (`capture:"environment"` confirmé) ; ✕ ferme le menu sans
  effet de bord ; 🎙 ferme le menu et ouvre le même écran d'onboarding mémo
  vocal qu'avant ; appui long simulé (pointerdown + ~1s + pointerup) ouvre
  directement l'onboarding mémo vocal sans jamais afficher le menu
  (`hasMenu: false` vérifié) — régression explicitement à éviter, confirmée
  absente.
- Piège d'automatisation retrouvé : après un clic déclenchant un
  `<input type="file">` OU l'ouverture d'une demande de permission micro,
  `computer{action:"screenshot"}` peut timeout (rendu mis en pause par un
  dialogue natif du navigateur), alors que `javascript_tool` continue de lire
  le DOM réel sans problème — se fier à l'état DOM (JS) plutôt qu'au
  screenshot dans ce cas.

### Phase 3 — Refonte UI/UX de l'existant (✅ 2026-07-13)
- **Hiérarchie typographique de la grille `/visites`** : l'en-tête d'année
  (`VisitsClient.tsx`) était identique à l'eyebrow "Archive" (même
  `text-xs uppercase tracking-widest`) — passé en `font-serif text-2xl
  md:text-3xl font-semibold` (Fraunces, déjà utilisée pour les blocs Titre
  du carnet). Carte de visite : la hiérarchie lieu > exposition contredisait
  la page de détail (où l'exposition est l'info principale) — inversée :
  exposition en `font-serif` primaire, lieu en secondaire, repli sur le
  lieu seul si pas d'exposition.
- **Menus lourds → icônes** : le trigger "⋯" des blocs texte (note/titre/
  citation) dans `VisitJournal.tsx` était toujours visible (pas de
  `opacity-0`), contrairement à son équivalent sur les blocs visuels —
  cause : le wrapper texte utilise un groupe Tailwind **nommé** `group/note`
  (pas le `group` générique), donc `group-hover:opacity-100` ne matchait
  jamais ; fix = `group-hover/note:opacity-100`. Le pill texte "N visites
  non localisées" (`VisitsGlobalMap.tsx`) devient une icône "⌖" + badge
  count (avec `title` pour l'accessibilité), même comportement au clic.
- **Bottom sheet détail visite sur la carte mobile** : nouveau
  `VisitDetailSheet.tsx` (pattern `AddToCollectionModal.tsx` — portal,
  framer-motion, backdrop + drag handle + ✕), déclenché au tap d'un pin
  dans `VisitsGlobalMap.tsx` **uniquement sur tactile**
  (`matchMedia("(pointer: coarse)")` au moment du clic) — le comportement
  desktop existant (fly + surbrillance carrousel) reste inchangé, la
  feuille s'ajoute en plus plutôt que de le remplacer. Contenu : cover,
  titre hiérarchisé (même logique exposition/lieu que la grille), date,
  nombre d'images, lien "Voir le carnet →".
- **Piège de vérification découvert cette session** : dans ce navigateur
  d'automatisation, `computer{action:"hover"}` fait bien matcher `:hover`
  côté CSSOM (`element.matches(':hover')` → `true`, confirmé y compris sur
  l'ancêtre `.group/note`) mais **`getComputedStyle` ne reflète jamais le
  style résultant** — vérifié avec un cas de contrôle simple et déjà en
  prod (`hover:opacity-70` sur le bouton "+ Bloc" du carnet, sans aucun
  `group`) qui échoue exactement pareil. Conclusion : limitation de l'outil
  de test pour le survol pur, pas un bug produit — se fier à l'inspection
  statique du CSS généré (`document.styleSheets`, cascade/spécificité) pour
  les styles hover-only, et réserver la vérification interactive aux
  interactions **clic/tap**, qui fonctionnent normalement.

### Phase 4 — PWA & perfs
- **Offline-first — outbox de capture (✅ 2026-07-13)** : périmètre choisi
  par l'utilisateur (AskUserQuestion parmi outbox seul / +création visite /
  offline-first complet) = **outbox de capture** (photos + mémos vocaux vers
  une visite existante), le scénario musée à wifi instable qui a motivé le
  plan. Reste hors périmètre pour l'instant : création de visite hors ligne
  (mapping d'ids locaux) et lecture hors ligne du carnet/archives.
  - `lib/offline/outbox.ts` : store IndexedDB `moodboard-offline/captures`
    (le blob est cloné-structuré tel quel), `enqueueCapture` /
    `listPending` / `flushOutbox` (rejoue exactement les API du chemin en
    ligne : `POST /api/upload/image` + `PATCH addInspirationIds` pour une
    photo, `POST /api/visits/[id]/audio` pour un mémo), pubsub pour les vues
    React, garde-fou de réentrance `flushing`, event `moodboard-outbox-synced`.
  - **⚠ iPhone = pas de Background Sync API en PWA iOS** : la resync ne
    repose PAS dessus. `ensureAutoFlush()` installe des déclencheurs qui
    marchent partout, iOS compris : événement `online`, `visibilitychange`
    (retour au premier plan), et flush au chargement (rattrape une session
    fermée hors ligne). Rien n'est délégué au Service Worker (qui dupliquerait
    la logique upload+rattachement).
  - `lib/offline/useOutbox.ts` (hook) + `components/visits/OutboxIndicator.tsx`
    (pastille au-dessus du FAB : "N en attente · hors ligne" / "…·réessayer" +
    bouton de rejeu manuel / "Synchronisation…").
  - `VisitCaptureFab.tsx` : hors ligne → `enqueueCapture` au lieu du message
    "connexion requise" ; en ligne, si l'upload échoue en cours de route
    (blip réseau) → fallback enqueue (mais PAS si l'upload a réussi et que
    seul le rattachement a échoué — sinon ré-upload en double). Écoute
    `moodboard-outbox-synced` → `router.refresh()` pour faire apparaître la
    capture synchronisée dans le carnet.
  - Vérifié en navigateur réel (compte de test jetable, nettoyé + R2 purgé) :
    photo injectée hors ligne (`navigator.onLine` forcé à false) → 1 entrée
    IndexedDB + indicateur "1 en attente · hors ligne" ; retour online +
    event `online` → `POST /api/upload/image` 200 puis `PATCH …` 200, outbox
    vidée, indicateur disparu, image rattachée à la visite côté serveur
    (`status:READY`, clés R2 présentes).
  - **Améliorations possibles ensuite** (non faites) : rendu optimiste des
    captures en attente directement dans le carnet (placeholders), et
    Background Sync API en enrichissement progressif sur Chrome/Android.
- Animations transform/opacity only — déjà largement le cas.
- Blocage pull-to-refresh / sélection texte UI ; manifest `standalone` — ✅
  manifest déjà standalone, le reste = petite passe CSS.

### Phase 5 — Social & export (✅ 2026-07-14)
- **✅ Carnet public read-only** (`app/carnet/[token]/page.tsx`) : bouton
  Partager sur une visite (`VisitShareButton`) → lien `/carnet/[token]`
  public (7j / 30j / sans expiration, révocable) via
  `POST /api/visits/[id]/share`, même pattern que le partage des planches.
  `Visit.shareToken`/`shareExpiry` ajoutés (SQL additif, pas de push
  destructif). Rendu lecture seule `VisitJournalReadOnly` (réutilise la CSS
  `.note-prose`, la police serif du titre, le lecteur audio + son error
  boundary — pas de composant d'édition). Logique de fusion des blocs
  extraite en helper partagé `lib/visits/journalItems.ts`. Route ajoutée à
  l'allowlist publique de `proxy.ts` (comme `/share`).
- **✅ Module de partage "folder lab"** (`FolderLab.tsx`,
  `app/(app)/visites/[id]/dossier`) : clone fidèle de folderlab.javii.tools —
  dossier macOS d'où débordent des cartes photos, nuancier de teinte,
  styles Tucked/Peek/Open/Spill, orientation, Frame, Glass, shake, export.
  Rendu **canvas** (pas html2canvas) : le dossier + cartes redessinés à la
  main → PNG transparent, images chargées via `lib/image/loadForCanvas.ts`
  (R2 CORS + repli proxy, même stratégie que l'export planches). Pré-rempli
  avec les images de la visite, sélecteur pour ajuster (max 6). **Premium de
  l'original (Glass, vidéo) laissé libre** — app perso mono-tenant, décision
  actée.
- **✅ Export 9:16 (story/reel)** : intégré au folder lab — bouton « ↓ 9:16 »
  qui compose la scène du dossier centrée sur un canvas 1080×1920 fond
  sombre (Instagram/TikTok). (L'export vidéo animé de l'original reste une
  suite possible : `MediaRecorder` sur canvas.)
- **Tags transversaux — RETIRÉ après coup (2026-07-14)** : le filtre par tags
  sur `/visites` (pills) a bien été livré, mais **retiré à la demande de
  l'utilisateur** : avec des dizaines de tags il saturait tout l'écran (surtout
  mobile) avant d'afficher la moindre visite. Affichage + tuyauterie
  (`tagsByVisit`/`allTags`) supprimés. À reproposer un jour sous une forme non
  envahissante (ex. champ de recherche/filtre repliable) si le besoin revient.
- Vérifié en navigateur réel (compte de test jetable, supprimé + R2 purgé) :
  génération/révocation du lien public + accès `/carnet/[token]` SANS cookies
  (200, pas de redirection login) ; folder lab (teinte, styles, export PNG
  1680×1410 et 9:16 1080×1920 pixel-corrects avec les 4 cartes en éventail) ;
  filtrage transversal (#Scénographie → 1 visite, #Typographie → 2 visites).
- **Piège de vérification (à retenir)** : mesurer la position d'un élément
  animé par Framer Motion `layout` via `getBoundingClientRect()` donne des
  valeurs FAUSSES (le transform d'animation en vol s'ajoute) — lire plutôt le
  `style.top` inline ; et les lectures `getComputedStyle` juste après un clic
  peuvent précéder le commit React. Le state réel se lit dans le fiber
  (`__reactFiber$…`.memoizedState) — c'est ce qui a permis de confirmer que le
  composant fonctionnait alors que les mesures suggéraient le contraire.

- **Module de partage "folder lab" (demande explicite utilisateur 2026-07-13)** —
  reproduire **exactement le fonctionnement ET le design** de
  https://folderlab.javii.tools/ ("folderlab — macOS folders with peek
  photos", made by javi), appliqué aux images d'une visite (ou d'une planche) :
  générer un visuel "dossier macOS d'où débordent des cartes photos", partageable
  en image ou vidéo. Recoupe l'item "Export 9:16 story/reel" ci-dessus mais avec
  un rendu et une UX très précis à cloner. Spécification à reproduire fidèlement :
  - **Scène centrale** : un dossier macOS stylisé (grand rectangle arrondi,
    teinte réglable) avec 1 à 6 cartes photos glissées derrière/dedans qui
    « dépassent » en éventail par le haut.
  - **Nuancier de teinte du dossier** (colonne de gauche) : grille de pastilles
    de couleurs (teintes façon dossiers macOS), sélection = change la couleur du
    dossier ; pastille sélectionnée entourée d'un anneau.
  - **Ajout de photos** : bouton « + add (N/6) » (max 6), miniatures des photos
    ajoutées affichées en bas ; « clear » vide tout.
  - **Styles d'agencement des cartes** (exclusifs, colonne de droite) :
    **Tucked** (rangées bien dans le dossier), **Peek** (dépassent un peu),
    **Open** (écartées), **Spill** (débordent largement en éventail).
  - **Orientation / découpe** : **Vertical** (icône ciseaux — ratio/orientation
    des cartes, portrait) ; **Frame** (cadre/bordure autour des cartes) ;
    **Glass** (effet glassmorphism — **réservé premium**, cadenas).
  - **Animations** : « shake » (secousse/jiggle des cartes), transitions
    fluides entre styles.
  - **Export** : « ↓ PNG » (image fixe, gratuit) et « ↓ Video » (export animé,
    **réservé premium**, cadenas). Pour Moodboard, remplacer le gating premium
    par un accès libre (app perso mono-tenant) OU le conserver désactivé —
    décision produit à trancher au moment du build.
  - **Design** : fond sombre quasi noir, contrôles en **pills** arrondies
    (clair sur sombre), état actif d'un style = pill sombre inversée, boutons
    d'action premium teintés (bleu). Playful, minimal, centré.
  - **Intégration Moodboard suggérée** (à préciser au build) : accessible depuis
    une visite (« Partager en dossier ») pré-rempli avec ses images / cover ;
    rendu client réutilisant le pipeline canvas de l'export PNG des planches ;
    l'export vidéo = capture d'animation (piste à définir : `MediaRecorder` sur
    canvas, ou WebCodecs). URL de référence à garder sous les yeux pendant le
    build : https://folderlab.javii.tools/.

---

## 8. Carnet « grille modulaire » façon Bento.me (✅ 2026-07-15 → 07-19)

Refonte majeure du carnet de visite : on abandonne la pile de blocs pleine
largeur + colonnes pour une **grille bento** (formats fixes, drag & resize,
panneau de réglages), puis on étoffe le catalogue de modules « musée » et on
peaufine l'ensemble. Source de vérité de la disposition : un seul champ JSON
`Visit.journalLayout` (`JournalTile[]` — `{type,id,w,h, + flags}`), résolu vers
son contenu par `buildBentoLayout()` (`lib/visits/journalItems.ts`), partagé
éditeur (`VisitJournal`) **et** page publique (`VisitJournalReadOnly`).

### 8.0 — Fondations grille bento
- Registre des formats `lib/visits/bentoSpans.ts` : médias = 4 formats fixes
  (Carré/Large/Vertical/Grand) ; auto-hauteur (note/checklist/frise/cartel +
  fiche wiki) = largeur choisie, hauteur MESURÉE (`useMeasuredRows`, paliers de
  grille). Grille dense CSS (`grid-auto-flow:dense`, désactivée dès qu'un
  séparateur est présent pour garder des sections nettes).
- Composants `components/visits/bento/` : `BentoGrid`, `BentoTile` (wrapper +
  drag/resize/settings), `TileContent` (dispatch par type, partagé
  affichage/lecture), `TileSettingsModal` (pop-up central), `FormatPicker`,
  `AddTileButton`, `SectionNav`, + une tuile par module.
- Persistance : `PATCH /api/visits/[id]/layout` (liste complète, `commitLayout`
  = `tilesRef` source synchrone pour fiabiliser drop/resize).

### 8.1 — Modules « carnet de visite musée/expo » (8 modules)
Tables Prisma additives (`VisitCartel/Palette/Ticket/Sketch/Highlight/Checklist/
Timeline`) + le séparateur SANS table (texte dans `journalLayout`) :
- **Cartel** (fiche d'œuvre) + **OCR on-device** (Tesseract.js, dynamic import) :
  recadrage avant OCR, parseur `parseCartel` validé sur 7 cartels réels (deux
  conventions titre-d'abord / artiste-d'abord), image non stockée. Auto-hauteur.
- **Billet** : pré-rempli depuis la visite, galerie/photo, look ticket
  (perforation + **encoches demi-cercle** latérales).
- **Palette** : extraction couleurs client (canvas) **depuis une ZONE choisie**
  (`PaletteZoneModal`, aperçu live) au lieu de toute l'image.
- **Fiche wiki** (Wikipédia FR) : recherche à autosuggestions →
  **carte d'identité auto-hauteur** avec **infobox Wikidata structurée**
  (naissance/décès + lieux, nationalité, activité, mouvement, genres, œuvres —
  P569/P19/P570/P20/P27/P106/P135/P136/P800, labels FR), image à gauche au ratio
  d'origine, résumé, **toggles** portrait/infos/résumé. `VisitEmbed.data Json`.
- **Croquis** à main levée (réutilise le moteur crayon des planches,
  `lib/moodboard/pencil.ts`).
- **Coup de cœur / notation**, **Checklist** interactive, **Frise** (tri auto
  des dates, siècles romains gérés).
- **Séparateur de section** : bande pleine largeur (`grid-column:1/-1`) + puce
  titrée multi-ligne, et **sommaire « Parcours de la visite »** en timeline
  verticale cliquable (ancre `sep-<id>`, scroll).

### 8.2 — Module texte « façon carnet de notes »
- Réglures horizontales en overlay pleine hauteur DERRIÈRE le texte (inset,
  grille de base 28px → chaque ligne tombe sur une réglure, démarrage à 20px
  pour éviter un trait au-dessus de la 1re ligne), grain papier (SVG base64
  inline — Lightning CSS/Tailwind v4 rejette le data-uri en feuille), coin corné
  + ombre douce, titres serif. **OCR d'un panneau** d'expo → texte inséré dans
  le bloc (généralisation de `CartelScanModal`, retour texte brut).

### 8.3 — Page partagée : parité + auteur
- Tous les réglages d'affichage transitent par `buildBentoLayout` → rendu
  identique éditeur/public (vérifié : hideTitle, fitContain, flags fiche,
  séparateurs, auto-hauteur). Carte alignée sur l'éditeur (`zoom=5` +
  `countryOutline`). **Byline auteur** (nom + photo, repli initiales) — page
  publique uniquement.
- Option **« Ratio d'origine »** (image + croquis) : `object-contain` + marge +
  coins arrondis, flag `fitContain` dans le layout.

**Pièges outillage récurrents cette session** : (a) `computer{screenshot}` du
navigateur de test se fige systématiquement → tout vérifié par mesure du DOM
(`javascript_tool`) ; (b) Turbopack garde une **CSS compilée en cache** (règles
fantômes, `56px` fantôme) — un simple restart ne suffit pas, il faut purger
`.next` ; (c) les `<input>` contrôlés React n'enregistrent pas la frappe du
clavier synthétique du sandbox → typer via `computer.type` réel ou valider le
rendu depuis la base.

---

## 9. Suggestions IA locales sur les images (✅ 2026-07-18 → 07-20)

Analyse d'image **100 % dans le navigateur** (aucune API externe, aucune image
envoyée) qui propose **titre + catégories + tags** à valider. Panneau
`AiSuggestPanel` dans le **triage** et la **visionneuse** (`MetadataPanel`), plus
un **toggle « auto »** dans le panneau d'upload (`AiAutoSuggestToggle`,
localStorage `mb-ai-autosuggest`) — l'utilisateur clique ce qu'il garde.

**Moteur — SigLIP zero-shot** (`Xenova/siglip-base-patch16-224`, transformers.js
4.2, WASM). Astuce clé : le vocabulaire est FIXE, donc ses embeddings TEXTE sont
**pré-calculés offline** (`lib/ai/siglipTextEmbeds.json`, 232 vecteurs × 768,
base64 Float32) avec **ensembling de 3 gabarits** moyennés. Au runtime on ne
charge QUE l'encodeur d'IMAGE (`SiglipVisionModel`, en Web Worker
`vision.worker.ts`, repli thread principal) → chaque image = un encodage +
un produit scalaire. `pooler_output` (vision) = embedding image ;
`SiglipTextModel.pooler_output` == `text_embeds` (le pooler EST la projection).

**Fichiers** (`apps/web/lib/ai/`) :
- `imageVocab.data.mjs` — SOURCE UNIQUE du vocabulaire (JS pur, partagé
  app/générateur/tests) : ~33 catégories + ~15 dimensions de tags (couleur,
  teinte, technique, composition, cadrage, sujet, matière, lumière, ambiance,
  style, époque, **typo à 22 tags**), `flatConcepts()` (ordre canonique =
  contrat avec les embeds), `PROMPT_TEMPLATES`, `siglipText()`.
- `imageVocab.ts` — façade TYPÉE au-dessus du `.mjs`.
- `imageMap.mjs` — logique PURE `mapScores(scores)` → `{categories, tags,
  titles}`. **z-score par image = confiance adaptative** ; titres à seuils par
  rôle (`Z_SUBJECT 1.9`, `Z_TECH 1.2`, `Z_LUM 1.3`, `Z_TYPO 1.0`, `Z_QUAL 0.5`) ;
  anti-doublon par radical ; garantie de présence du meilleur tag typo.
- `siglipEmbeds.ts` (`scoreImageEmbedding`) + `vision.worker.ts`.

**Régénérer les embeddings** (après modif du vocab) : le Node local n'a **PAS**
accès à huggingface.co ici → générer DANS LE NAVIGATEUR via une page dev jetable
(`SiglipTextModel` → ensemble → base64 **par paquets de 8192** sinon stack
overflow → POST vers une route qui écrit le JSON), puis supprimer page+route.
Détail dans la mémoire `reference_ai_image_embeds`.

**Qualité / limites** (validé sur images réelles de la bibliothèque) :
- Fiable : couleur, lumière (clair-obscur/néon), style (vaporwave/bauhaus/pop
  art), **typographie** (serif/display/monospace/graffiti/logo, catégorie
  Typographie), rendus 3D **isolés** (Noodles → 3D + Animation 3D).
- Resserré : « nature morte » limité à la vraie nature morte peinte/photo → ne
  se déclenche plus sur les rendus 3D d'objets.
- **Limite de modèle assumée** : sur les **collages 3D chargés/multicolores**
  (aplats fluo), SigLIP-base lit riso/collage/memphis — « 3D » ne monte même pas
  dans le top-8 technique, non corrigeable par prompt. Franchir ce plafond
  demanderait un modèle plus lourd (SigLIP-large / Florence-2 / Moondream, 500 Mo–
  1 Go+) — écarté pour rester « local léger ». L'utilisateur ajoute « 3D » à la
  main sur ces cas (l'indice « plastique » sort quand même).

Voir aussi le mémo vocal (Whisper `whisper-base_timestamped`, karaoké mot-à-mot,
traitement en arrière-plan) — même stack transformers.js locale, feature séparée.

---

## 10. Couche sociale : connexions, profils, visibilité, messagerie, feed (✅ 2026-07-20)

Transformation du produit mono-propriétaire en **réseau entre membres de
l'instance**. Livré en 4 phases (plan détaillé validé dans le fichier de plan).
Toutes les migrations `prisma db push` autorisées d'avance par l'utilisateur.

**Phase 1 — Profils + connexions.** `User.username` (@handle unique) + `User.bio` ;
model `Connection` (mutuelle, demande→acceptation, auto-accept si demande inverse).
Helpers `lib/access/connections.ts` (getConnectionIds, areConnected, relationStatus).
API `/api/connections`, `/api/members`, `/api/account/username`. Pages `/u/[username]`
(profil + bouton connexion à états) et `/reseau` (recherche + demandes + connexions).

**Phase 2 — Visibilité + ACL.** `Visibility` (PRIVATE défaut / CONNECTIONS / PUBLIC)
sur Moodboard/Visit/Collection ; `ResourceGrant` polymorphe (rôles VIEWER/EDITOR,
pas de FK → cleanup applicatif au DELETE). `lib/access/resolve.ts` : `resolveAccess`
(owner>grant>public>connexions, non-accès=404), `accessibleWhere(ForOwner)`. API
`/api/share/[resource]/[id]` + `/grants`. Panneau **ShareButton** (visibilité +
personnes/rôles + envoi en message) sur les 3 ressources. Profil liste les
ressources accessibles. **Planches : lecture partagée (visionneuse) + co-édition
(grant Éditeur → PATCH canvasData autorisé).**

**Phase 3 — Messagerie.** `Conversation` (paire canonique, status PENDING/ACTIVE,
initiator) + `Message` (texte + réf ressource/image + readAt). Entre connexions →
ACTIVE ; sinon PENDING (demande) jusqu'à réponse. API `/api/conversations(+/[id]
+/messages)` avec contrôle d'accès sur le contenu partagé. Page `/messages`
(inbox non-lus + fil + composeur + bannière demande), bouton « Message » sur le
profil, « Envoyer » une ressource depuis ShareButton.

**Phase 4 — Feed + notifications.** `/feed` = ressources récentes des autres
membres accessibles (`accessibleWhere`, byline auteur). Pastilles nav `SocialBadge`
(poll 30s) : demandes entrantes (Réseau), messages non lus (Messagerie), somme sur
« Plus » mobile. Entrées nav Réseau / Messagerie / Fil (Sidebar + BottomNav).

**Vérif** : tests DB dédiés — connexions 12/12, résolution d'accès 10/10,
messagerie 9/9 — + flux authentifiés live (connect, partage visibilité, envoi
message, feed). tsc propre à chaque phase.

### 10bis — 2e passe (✅ 2026-07-20, retours utilisateur)
- **BUG accès corrigé** : ouverture LECTURE SEULE des visites (`VisitReadOnlyView`
  extrait de la page carnet) et collections (grille) partagées par un tiers ;
  lien planche du profil réparé (/edit) ; cartes profil/feed cliquables.
- **Visibilité par défaut par type** dans les Réglages (User.defaultVisibility*,
  appliquée à la création).
- **Partage → messagerie** : ajouter une personne (grant) dépose un message ;
  bouton « Envoyer » image dans la visionneuse ; joindre une image depuis sa
  galerie dans le composeur ; image reçue → « Ajouter à ma galerie » (copie R2
  indépendante, quota).
- **Un seul bouton Partager** par ressource (visibilité + membres + lien public
  token réunis dans `ShareButton`).
- **Une seule page sociale** à onglets (Fil / Messagerie / Réseau, `SocialTabs`),
  une entrée nav « Social ».

**Reste à faire (suivi explicite)** :
- **CO-ÉDITION par un tiers des VISITES et COLLECTIONS** (lecture partagée OK ;
  édition partagée = seulement les planches pour l'instant, éditeur des visites/
  collections trop volumineux à câbler proprement).
- Auto-inscription ouverte, public web anonyme, likes/commentaires, temps réel :
  hors périmètre (voir le plan).

---

## Notes d'implémentation générales

- Le schéma est déjà multi-profils (migration 2026-07-09) — toute feature
  sociale s'appuie sur `User.id` existant, pas de refonte auth nécessaire.
- Respecter le pattern de scoping `userId` déjà en place partout ; les
  collaborateurs sont un *ajout* au contrôle d'accès, pas un remplacement.
