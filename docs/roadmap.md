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
- **✅ Blocs modulaires supplémentaires dans les notes (2026-07-10)** :
  **image inline** avec wrap texte façon magazine (node Tiptap
  `InlineImage`, pioche parmi les images déjà attachées à la visite) et
  **bloc audio** (enregistrement micro `MediaRecorder` → upload R2 → lecteur
  inline, nouveau modèle `VisitAudio` compté dans le quota de stockage par
  profil). Dessin à main levée inline toujours reporté (regroupé avec une
  future itération). Détails → mémoire agent.
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

### Phase 1 — Mobile "friction zéro"
- **FAB `+` persistant** (safe-area-inset-bottom) — nouveau.
- **Scan & Snap** : `<input type="file" accept="image/*"
  capture="environment">` → appareil photo natif instantané — recoupe
  le "+ Photo temps réel" déjà en roadmap, pas commencé.
- **Mémos vocaux + transcription** (appui long FAB → audio → texte en
  arrière-plan, ex. Whisper) — ⚠️ l'enregistrement existe ; la
  transcription = réintroduire une API IA externe payante alors que
  Gemini a été retiré volontairement (2026-07-09). **Décision produit
  explicite requise avant d'implémenter.**
- **Enrichissement auto** GPS/date/heure → tag lieu sans formulaire — nouveau.
- **Onboarding contextuel des permissions** (micro/GPS à la première
  utilisation, modale explicative) — nouveau.

### Phase 2 — Desktop "table de montage"
- Éditeur par blocs D&D — ✅ largement en place (overlay+fantôme + Tiptap).
- **Design "flottant"** : suppression bordures/fonds gris, structuration
  par marges seules sur fond noir — passe design, nouveau.
- **Bloc "Œuvre"** (photo + Titre/Artiste/Année typographiés) — les données
  existent déjà (`Inspiration.title/author/year`), c'est un rendu à créer.
- **Bloc "Moodboard"** (grille d'images pleine largeur) — nouveau.
- **Bloc "Citation"** — `blockquote` volontairement désactivé dans
  StarterKit : réactivation + style, trivial.
- **Toolbar fantôme** (au surlignage) + **commande `/`** — le "/" était
  reporté, remis au programme.
- **Auto-save continu + indicateur de statut** — le save au blur et à
  l'insertion existent ; manque le save debounced pendant la frappe et
  l'indicateur ●/✓ (pattern déjà présent dans MetadataPanel).

### Phase 3 — Refonte UI/UX de l'existant
- Hiérarchie typographique de la grille d'archives (/visites) ; menus
  lourds → icônes au survol ; **bottom sheets** pour le détail visite
  sur la carte mobile (pattern FilterDrawer/AddToCollectionModal réutilisable).

### Phase 4 — PWA & perfs
- **Offline-first** : IndexedDB pour photos/notes + sync Service Worker au
  retour réseau — **le plus gros chantier architectural du plan**
  (IndexedDB déjà utilisé par le flux Share Target, base réutilisable).
- Animations transform/opacity only — déjà largement le cas.
- Blocage pull-to-refresh / sélection texte UI ; manifest `standalone` — ✅
  manifest déjà standalone, le reste = petite passe CSS.

### Phase 5 — Social & export
- **Carnet public read-only** (article éditorial) — pattern
  `shareToken`/`shareExpiry` des planches réutilisable, déjà en roadmap §6.
- **Export 9:16** (story/reel) sur blocs Œuvre/Moodboard — nouveau,
  le pipeline canvas de l'export PNG moodboard est réutilisable.
- **Tags transversaux** (#Typographie, #Scénographie) — les tags existent
  sur Inspiration ; le filtrage transversal niveau visites est nouveau.

---

## Notes d'implémentation générales

- Le schéma est déjà multi-profils (migration 2026-07-09) — toute feature
  sociale s'appuie sur `User.id` existant, pas de refonte auth nécessaire.
- Respecter le pattern de scoping `userId` déjà en place partout ; les
  collaborateurs sont un *ajout* au contrôle d'accès, pas un remplacement.
