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

Améliorations demandées, par ordre d'intérêt exprimé :

- **Éditeur de carnet façon Notion** : réorganisation des blocs (images +
  notes) plus fluide qu'aujourd'hui, titres, texte stylisé (gras/italique/
  listes...), blocs audio insérables. Refonte significative de
  `VisitJournal.tsx` — actuellement de simples blocs texte/image en séquence
  triée par `order`. À évaluer : éditeur rich-text (Tiptap/ProseMirror) vs
  blocs typés custom (plus proche du système CanvasElement du moodboard).
- **Couverture de visite personnalisable** : les images ajoutées défilent en
  couverture (carrousel), aspect "vrai carnet premium".
- **Ajout d'image en temps réel depuis le carnet** : bouton "+ Photo" dans
  `VisitJournal`, et sur mobile déclenchement direct de l'appareil photo
  (`<input type="file" capture="environment">` ou équivalent) pour
  documenter une visite en live, pendant qu'on est encore sur place.
- **Visites collaboratives** — voir point 3.
- **Export / partage public du carnet** — lien public à la manière du
  partage de planches existant (`shareToken`/`shareExpiry` sur Moodboard,
  pattern réutilisable sur Visit), ou export PDF.
- **Statistiques et carte cumulée** — musées visités par an, carte globale de
  toutes les visites (au-delà de la mini-carte par visite actuelle).

---

## Notes d'implémentation générales

- Le schéma est déjà multi-profils (migration 2026-07-09) — toute feature
  sociale s'appuie sur `User.id` existant, pas de refonte auth nécessaire.
- Respecter le pattern de scoping `userId` déjà en place partout ; les
  collaborateurs sont un *ajout* au contrôle d'accès, pas un remplacement.
