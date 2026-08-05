# Carnet de visite hors ligne — diagnostic et plan

> Rédigé le 2026-08-05, à la demande de l'utilisateur : pouvoir créer et remplir
> une visite de musée **sans réseau ou avec un réseau très instable**, puis voir
> l'ensemble se synchroniser au retour de la connexion.
> **Aucun code n'a été écrit** : ce document sert à décider avant d'engager le chantier.

---

## 1. État des lieux (constaté dans le code)

### Ce qui marche déjà

`apps/web/lib/offline/outbox.ts` est une vraie file d'attente hors ligne, en
IndexedDB, qui stocke les **blobs** (photos, mémos vocaux) et les rejoue au
retour du réseau. Elle a des déclencheurs automatiques (`online`,
`visibilitychange`, chargement), un garde-fou de réentrance, un abandon après
5 essais, et une UI dédiée (`OutboxIndicator`). C'est une base solide et
éprouvée — le plan ci-dessous s'appuie dessus plutôt que de la remplacer.

### Les trois raisons pour lesquelles ça échoue aujourd'hui

**(a) Le service worker n'a pas de repli de navigation.**
`apps/web/public/sw.js` est en « réseau d'abord, cache ensuite ». Mais le cache
ne contient que les URL **déjà visitées**, et l'installation ne met en cache que
`/` — qui n'est qu'une redirection vers `/library`. Une page non visitée hors
ligne : `caches.match()` ne trouve rien, la promesse résout `undefined`, le
navigateur affiche sa page d'erreur. C'est très exactement le « pas de connexion
internet » constaté.

**(b) Toutes les pages sont rendues côté serveur, derrière l'authentification.**
`app/(app)/layout.tsx` appelle `auth()` et redirige vers `/login` ; les pages de
visite sont en `dynamic = "force-dynamic"`. Même une page mise en cache ne serait
qu'une photographie figée, et les requêtes de données échoueraient derrière.
**Conséquence structurante : le hors-ligne ne peut pas être un simple réglage de
cache. Il lui faut une surface rendue côté client, qui lise un stockage local.**

**(c) La file exige une visite qui existe déjà côté serveur.**
`enqueueCapture` prend un `visitId`, et le rejeu appelle
`PATCH /api/visits/{visitId}`. Elle sait donc alimenter une visite **déjà créée**,
mais ne sait pas créer la visite elle-même. C'est le cœur du manque.

### L'ampleur réelle du modèle

Une visite n'est pas un objet isolé : **17 sous-ressources** ont leur propre route
API (`app/api/visits/[id]/`) — `notes`, `titles`, `quotes`, `audio`, `embeds`,
`inspirations`, `cartel`, `ticket`, `palette`, `checklist`, `timeline`,
`highlight`, `sketch`, `artist`, `map`, `cover`, `layout`. Et `journalLayout`
(colonne JSON sur `Visit`) **référence les identifiants** de tous ces blocs.

C'est ce dernier point qui fixe la difficulté du chantier — voir §4.

---

## 2. Pourquoi un APK ne résout pas le problème

Un APK pour une application web, c'est l'une de ces trois choses :

| Approche | Ce que ça apporte pour le hors-ligne | Coût |
|---|---|---|
| **TWA** (voie standard Play Store) | **Rien.** C'est littéralement Chrome affichant la PWA dans une coquille. Comportement hors ligne strictement identique. | Faible |
| **WebView type Capacitor** | Le JS/CSS est embarqué dans l'APK : la coquille s'ouvre toujours. Règle la cause **(a)** — mais ni **(b)** ni **(c)**. | Moyen |
| **Application native** | Tout est réglé. | Réécriture complète du carnet : grille bento, éditeurs, 8 modules musée. Hors de proportion. |

**Le travail lourd — stocker une visite localement et réconcilier les
identifiants à la synchro — est identique dans les trois cas.** C'est de la
logique applicative, pas de l'empaquetage.

Deux arguments supplémentaires en faveur de la PWA :

- **L'iPad.** Un APK Android ne couvre pas l'iPad, qui fait partie des appareils
  utilisés. Le travail sur la PWA couvre les deux.
- **Le déploiement.** Un correctif PWA est en ligne en une poussée ; un APK hors
  Play Store impose une réinstallation manuelle à chaque version.

**Recommandation : faire le travail hors-ligne dans la PWA.** L'APK reste
possible ensuite, comme confort d'installation — et il n'aura d'intérêt qu'une
fois (a), (b) et (c) réglés.

---

## 3. Deux périmètres très différents

Il est important de ne pas les confondre, leur coût n'a rien à voir.

### Périmètre A — « je crée la visite avant de partir »
La visite existe déjà côté serveur. Sur place, sans réseau : ouvrir l'app,
consulter la visite, ajouter photos, vocaux, textes et modules.

Il manque essentiellement **(a)** et **(b)** : que l'app s'ouvre et sache
afficher la visite depuis un cache local. La file d'attente couvre déjà les
photos et les vocaux.

### Périmètre B — « je crée la visite de A à Z hors ligne »
C'est la demande initiale. Il faut en plus **(c)** : un stockage local des
visites, des identifiants temporaires, et un remappage à la synchro.

**A est un sous-ensemble strict de B**, et livrable bien plus tôt. B a un
avantage inattendu, décrit juste en dessous.

---

## 4. Le point dur : le remappage d'identifiants

Hors ligne, chaque bloc créé reçoit un identifiant local (`loc_…`), et
`journalLayout` référence ces identifiants locaux. À la synchro, chaque bloc
reçoit son identifiant serveur définitif — **la disposition doit donc être
réécrite** avec les nouveaux identifiants.

L'ordre de synchronisation n'est pas négociable :

1. Créer la **visite** → obtenir son `serverId`.
2. Envoyer **chaque bloc** dans cet ordre, en tenant une table `loc_… → serverId`.
   Les photos et les vocaux passent par la file existante (upload puis rattachement).
3. **En dernier**, envoyer `journalLayout` avec tous les identifiants remappés.

Si l'étape 3 part avant que tous les blocs aient un identifiant serveur, la
disposition référence des identifiants inexistants et **les tuiles disparaissent
de la grille** (le contenu reste en base, mais il sort du carnet). C'est le
risque principal du chantier ; il impose une synchro **transactionnelle côté
client** : on ne marque la visite comme synchronisée que si l'étape 3 aboutit,
et on sait reprendre au milieu.

### La bonne nouvelle : pas de conflit à gérer

Une visite **créée** hors ligne n'existe pas encore côté serveur : personne
d'autre ne peut l'avoir modifiée. La synchro est donc une **création pure**,
sans fusion ni résolution de conflit.

C'est ce qui rend le périmètre B beaucoup plus sûr qu'il n'en a l'air — et c'est
aussi pourquoi il faut le distinguer nettement de « modifier hors ligne une
visite existante », qui, lui, exige une vraie stratégie de conflits (deux
appareils, co-édition). **Ce dernier cas est explicitement hors périmètre.**

---

## 5. Architecture cible

### Stockage local (IndexedDB, base `moodboard-local`)

- `visits` — une visite : `localId`, `serverId?`, lieu, expo, date, géoloc,
  `journalLayout` (avec identifiants locaux), `dirty`, `updatedAt`.
- `blocks` — un bloc : `localId`, `visitLocalId`, `type`, `serverId?`, contenu,
  référence de blob éventuelle, `dirty`.
- `blobs` — photos, vocaux, croquis. La file actuelle stocke déjà des `Blob`,
  même mécanisme.

### Surface rendue côté client

Une route **entièrement cliente** capable d'afficher la liste des visites et le
carnet depuis le stockage local, sans aucun appel serveur. Le service worker la
sert en repli de navigation quand le réseau manque.

En ligne, rien ne change : les pages serveur actuelles restent la voie normale.
Le mode hors ligne est une surface **parallèle**, pas un remplacement — c'est ce
qui limite le risque de régression sur l'existant.

### Authentification

La coquille hors ligne ne doit **jamais** appeler `auth()`. Elle lit uniquement
le local. Le cookie de session sert à la synchro ; s'il a expiré, la synchro
échoue proprement, **les données restent** et l'app propose de se reconnecter.
Aucune donnée locale n'est supprimée avant confirmation serveur.

---

## 6. Risque à ne pas sous-estimer : l'éviction du stockage

Une visite de musée, c'est facilement 50 à 100 photos. Même compressées (~1 Mo),
on parle de **50 à 100 Mo dans IndexedDB**, potentiellement pendant des heures
avant la reconnexion.

Or un navigateur peut **évincer** le stockage d'un site sous pression disque —
et sur iOS, Safari est nettement plus agressif. Perdre une visite entière de
cette façon serait le pire scénario possible.

**Parade obligatoire :** demander `navigator.storage.persist()` (qui protège le
stockage de l'éviction automatique), surveiller `navigator.storage.estimate()`,
et prévenir l'utilisateur si le quota approche. À traiter dès la première phase,
pas à la fin.

C'est aussi, honnêtement, le seul point où un APK Capacitor a un avantage réel :
le stockage d'une application installée n'est pas soumis à l'éviction du
navigateur. Si les visites deviennent très volumineuses, cet argument peut à lui
seul justifier l'APK — **après** que le hors-ligne fonctionne.

---

## 7. Découpage proposé

| Phase | Contenu | Livre quoi | Ampleur |
|---|---|---|---|
| **1** | Coquille hors ligne : précache, repli de navigation, `storage.persist()`, indicateur d'état réseau franc | L'app s'ouvre sans réseau au lieu d'afficher une erreur | Courte |
| **2** | Cache local des visites en lecture + capture (photo/vocal/texte) dans une visite existante | **Périmètre A utilisable au musée** | Moyenne |
| **3** | Création d'une visite hors ligne : stockage local complet, identifiants temporaires | La visite se crée et se remplit sans réseau | Grande |
| **4** | Synchro transactionnelle avec remappage d'identifiants + reprise sur échec | **Périmètre B complet** | Grande, la plus délicate |
| **5** | *(optionnel)* Empaquetage APK (Capacitor), pour le confort d'installation et un stockage non évinçable | Installation hors navigateur | Moyenne |

Les phases 1 et 2 ont un bon rapport valeur/risque : elles rendent le carnet
utilisable au musée dès la prochaine sortie, sans toucher au modèle de données.
Les phases 3 et 4 forment un bloc — livrer 3 sans 4 n'a aucun intérêt.

---

## 8. Vérification

Le hors-ligne ne se teste pas de façon crédible « à l'œil ». Ce qu'il faudra :

- Un scénario de bout en bout **avec le réseau réellement coupé** (mode avion),
  pas seulement l'émulation du navigateur, qui ne reproduit pas les coupures
  partielles ni les timeouts.
- Le cas le plus traître : **réseau instable**, pas absent — une requête part,
  échoue à mi-chemin, l'utilisateur continue. C'est là que se logent les doubles
  envois et les tuiles orphelines.
- Un test explicite de reprise : tuer l'app en pleine synchro, la rouvrir,
  vérifier qu'on ne perd ni ne duplique rien.
- Vérifier que `journalLayout` post-synchro ne référence **aucun** identifiant
  `loc_…` restant.

---

## 9. Décisions à prendre

1. **Périmètre** : s'arrêter à A (phases 1-2), ou aller jusqu'à B (phases 1-4) ?
2. **APK** : à envisager après le hors-ligne, ou définitivement écarté ?
3. **Modifier hors ligne une visite existante** : confirmé hors périmètre ?
   (C'est ce qui amènerait la gestion de conflits, de loin la partie la plus
   coûteuse et la plus risquée.)

---

## 10. Politique de purge (décidée le 2026-08-05)

Deux stockages coexistent, et ils appellent des règles **opposées**. Les
confondre, c'est soit perdre des données, soit saturer le téléphone.

### IndexedDB — données utilisateur, jamais purgées d'office

Contient les captures non encore confirmées : photos, mémos, notes, et les
visites créées hors ligne. **Rien n'y est irremplaçable ailleurs.**

- **Règle absolue** : aucune suppression tant que le serveur n'a pas confirmé.
  Ni au bout d'un délai, ni sous pression de stockage — dans ce dernier cas on
  AVERTIT, on n'efface pas.
- **Libération bloc par bloc** : dès qu'un bloc reçoit son identifiant serveur,
  son blob est supprimé localement. Le fichier est alors sur R2 ; le garder en
  double ne protège plus rien. C'est ce qui empêche une visite synchronisée de
  continuer à occuper 50-100 Mo.
- **Rétention de la fiche** : une fois la visite entièrement synchronisée, il ne
  reste qu'une fiche de quelques centaines d'octets, conservée 7 jours pour que
  l'utilisateur voie ce qui est parti, puis effacée.
- Une reprise de synchro n'a jamais besoin d'un blob déjà libéré : un bloc
  porteur d'un `serverId` n'est jamais renvoyé.

### Cache API — données dérivées, taillées librement

Contient documents HTML, JS, CSS, polices. Tout est re-téléchargeable : purger
ne coûte qu'un rechargement, **jamais une donnée**.

- Les anciennes versions de cache sont supprimées à chaque activation.
- La version courante est plafonnée à **120 entrées**, les plus anciennes
  évincées en premier (l'ordre d'insertion de `Cache.keys()` fait foi).
- `/` et `/hors-ligne` ne sont **jamais** évincées : ce sont elles qui font
  tenir le mode hors ligne.
- Le taillage est déclenché après les mises en cache d'exécution, avec un
  débounce de 10 s pour ne pas repasser à chaque fichier d'une même page.
- Les images R2 ne transitent pas par ce cache (origine différente, le worker
  laisse passer) : le gros du volume n'est donc pas concerné.

### Ce qui reste à surveiller

`navigator.storage.persist()` protège de l'éviction automatique, mais un
utilisateur peut toujours vider les données du site depuis les réglages du
navigateur. C'est le seul cas où une capture non synchronisée serait perdue, et
il est hors de portée du code. La coquille affiche l'occupation du stockage pour
rendre la situation lisible.

## 11. Parité fonctionnelle hors ligne — à faire

Le hors-ligne couvre aujourd'hui **photo, mémo vocal, note**. Objectif retenu :
l'intégralité des fonctionnalités de visite. Ce que ça implique, par ordre de
difficulté croissante :

1. **Modules purement textuels** (coup de cœur, checklist, frise, cartel,
   billet, carte, séparateur) — stockage local du contenu, création à la
   synchro. Aucune difficulté nouvelle.
2. **Modules avec fichier** (croquis, photo de cartel, photo de billet, source
   de palette) — même schéma que les photos : blob local, puis upload et
   sous-route dédiée à la synchro.
3. **Disposition bento** (ordre, formats) — c'est le point dur : hors ligne, la
   disposition référencerait des identifiants LOCAUX, ce que le §4 évitait
   jusqu'ici en ne la construisant qu'à la synchro. Il faudra donc un vrai
   remappage `loc_ → serverId` appliqué à la disposition avant envoi.
4. **Fiche artiste (Wikipédia)** — dépend d'une API externe, ne peut pas être
   créée hors ligne. À désactiver explicitement avec un message clair plutôt
   qu'à laisser échouer.

Voie recommandée : extraire une **abstraction de persistance** derrière
`VisitJournal` (une interface avec les ~20 opérations de sauvegarde, deux
implémentations — serveur et locale). L'éditeur bento complet fonctionnerait
alors tel quel hors ligne, au lieu de maintenir deux interfaces en parallèle.
