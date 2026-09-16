# Audit de sécurité + double authentification

Audit du 2026-09-16 sur l'ensemble de l'application (`apps/web`), suivi de la
mise en place de la 2FA par code à usage unique (TOTP). Ce document liste ce
qui a été trouvé, ce qui a été corrigé dans la foulée, et ce qui reste ouvert.

Périmètre couvert : authentification et session, les ~100 routes d'API, le
contrôle d'accès aux ressources (visibilité, partages nominatifs, liens
publics), les requêtes sortantes du serveur, le rendu de contenu utilisateur,
les en-têtes HTTP.

---

## 1. Ce qui a été corrigé

### 1.1 Double authentification absente → TOTP + codes de secours

Le mot de passe était le seul facteur, sur une instance qui héberge
l'intégralité d'une bibliothèque d'images, des carnets de visite et une
messagerie. Un mot de passe rejoué (fuite d'un autre service) donnait tout.

**Mis en place** — second facteur TOTP compatible Google Authenticator,
1Password, Bitwarden, Authy (RFC 6238 : HMAC-SHA1, 6 chiffres, 30 s, tolérance
±30 s pour la dérive d'horloge du téléphone).

- Activation en deux temps depuis **Réglages › Compte › Double
  authentification** : mot de passe → QR code → vérification d'un premier code.
  L'activation n'est effective qu'après cette vérification, pour qu'une appli
  mal configurée n'enferme jamais le compte dehors.
- **Dix codes de secours** à usage unique, affichés une seule fois, stockés
  hachés (SHA-256), régénérables. Consommation atomique (`updateMany` filtré
  sur `usedAt: null`) : deux connexions simultanées ne peuvent pas rejouer le
  même code.
- Secret TOTP **chiffré au repos** (AES-256-GCM) : un dump de la base ne suffit
  pas à générer des codes valides.
- Désactivation et régénération des codes exigent **mot de passe + code en
  cours** : une session volée ne suffit pas à retirer le second facteur.
- À la connexion, la page demande le code seulement si le compte l'exige
  (erreur typée `2fa_required` renvoyée par NextAuth) — le mot de passe n'est
  jamais reposté à un second endpoint.

Implémentation : `lib/auth/totp.ts` (vérifié contre les six vecteurs de test de
la RFC 6238), `lib/auth/secretBox.ts`, `lib/auth/recoveryCodes.ts`,
`lib/auth/twoFactor.ts`, routes `app/api/account/2fa/*`, UI
`components/settings/TwoFactorSettings.tsx`.

### 1.2 Aucune limitation des tentatives de connexion (force brute)

`/api/auth/callback/credentials` acceptait un nombre illimité de tentatives :
un mot de passe de 8 caractères tombait en quelques heures, et rien n'empêchait
un balayage sur tous les comptes de l'instance.

**Corrigé** — compteur d'échecs en base (`login_attempts`), sur deux clés en
parallèle : `user:<email>` (5 échecs → verrou 15 min) et `ip:<adresse>` (20
échecs, pour ne pas bloquer un bureau derrière un NAT partagé). Fenêtre
glissante d'une heure, remise à zéro à la première connexion réussie. Le même
compteur protège la vérification du code 2FA (6 chiffres = 1 million de
possibilités, à protéger comme un mot de passe court).

En base plutôt qu'en mémoire : en serverless, un compteur en RAM disparaît
entre deux requêtes.

Au passage, un email inconnu déclenche désormais une comparaison bcrypt à vide,
pour que le temps de réponse ne révèle plus quels comptes existent.

### 1.3 XSS stocké dans les blocs texte du carnet *(le plus sérieux)*

Les notes du carnet sont du HTML produit par Tiptap, enregistré tel quel
(`z.string().max(20000)`, aucun filtrage) puis réinjecté via
`dangerouslySetInnerHTML` dans `components/visits/bento/TileContent.tsx`. Un
commentaire du code affirmait que le rendu passait par le parseur ProseMirror —
ce n'est vrai que dans l'éditeur, pas à l'affichage.

Conséquence concrète : un collaborateur avec un accès **Éditeur** sur une
visite (ou n'importe quel appel direct à l'API avec un jeton valide) pouvait y
placer `<img src=x onerror="…">`. Le script s'exécutait ensuite chez le
propriétaire du carnet **et chez tous les visiteurs de la page publique
`/carnet/<token>`** — donc vol de session par lecture du DOM authentifié,
actions à l'insu de la victime.

**Corrigé** — assainissement par liste blanche (DOMPurify, balises Tiptap
uniquement, URL limitées à `http(s)`, `mailto:` et ancres) à **l'écriture**
(POST et PATCH des notes) **et au rendu** — les notes déjà en base restent
couvertes sans migration de données. Voir `lib/security/sanitizeHtml.ts`.

### 1.4 SSRF sur les imports par URL

`/api/import/direct` téléchargeait l'URL fournie par le client (extension
Chrome, bookmarklet) sans aucun contrôle de destination, et `/api/import/url`
suivait les liens courts `pin.it` de la même manière. Un compte authentifié
pouvait donc faire émettre au serveur des requêtes vers le réseau interne de
l'hébergeur : `http://169.254.169.254/` (métadonnées d'instance, souvent
porteuses de jetons), `http://localhost:…`, une IP privée de VPC. Le contenu
récupéré atterrissant dans la bibliothèque, la fuite était lisible et pas
seulement aveugle.

**Corrigé** — `lib/security/safeFetch.ts` : schéma http(s) obligatoire,
résolution DNS explicite, refus de toute adresse non publique (boucle locale,
RFC 1918, CGNAT, lien-local, ULA IPv6, IPv4 encapsulée en IPv6), et
revalidation **à chaque redirection** (`redirect: "manual"` suivi à la main),
ce qui bloque aussi le contournement par redirection.

Au passage, l'aiguillage Pinterest/Instagram se faisait sur une sous-chaîne de
l'URL entière (`url.includes("pinterest.")`) : `https://interne.example/?x=pinterest.com`
partait dans la branche Pinterest. Le test porte désormais sur le **nom d'hôte**.

### 1.5 Remontée de chemin dans `/api/proxy-image`

Le filtre `^[\w.\-/]+$` autorisait le point et la barre, donc `../` : la clé
`../../quelque-chose` sortait du préfixe du bucket après normalisation par
`fetch`. Impact limité (même hôte R2, contenu public), mais la garde annoncée
en commentaire ne tenait pas. **Corrigé** : tout segment `..` est rejeté.

### 1.6 En-têtes HTTP manquants

Ni CSP ni HSTS n'étaient envoyés.

**Ajoutés** dans `next.config.ts` :

- **HSTS** `max-age=63072000; includeSubDomains; preload` — interdit tout
  retour en HTTP en clair, donc le vol de cookie de session par rétrogradation.
- **CSP** volontairement tolérante sur les sources de données (`connect-src`
  et `img-src` en `https:`) parce que l'app télécharge ses modèles d'IA
  embarquée (transformers.js, tesseract.js) et ses tuiles de carte depuis des
  CDN tiers ; mais stricte sur l'exécution et la navigation : `object-src
  'none'`, `base-uri 'self'`, `form-action 'self'` (pas d'exfiltration d'un
  POST vers un domaine tiers), `frame-ancestors 'self'` (clickjacking).

`unsafe-inline` reste nécessaire pour le script d'enregistrement du service
worker et les styles en ligne : la défense contre le XSS repose donc sur
l'assainissement (§1.3), pas sur la CSP. Voir §3.1 pour la suite.

---

## 2. Ce qui a été vérifié et va bien

- **Contrôle d'accès aux ressources** — `lib/access/*` est appliqué de façon
  homogène : chaque route de visite/planche/collection passe par `isOwner` ou
  `canEditResource`, et répond `404` (jamais `403`) sur une ressource
  inaccessible, ce qui évite de confirmer son existence.
- **Routes admin** — `requireAdmin()` sur toutes les routes `/api/admin/*`, y
  compris la gestion des quotas.
- **Mots de passe** — bcrypt en coût 12, comparaison via `bcrypt.compare`,
  changement de mot de passe protégé par l'ancien.
- **Jetons d'API de l'extension** — 32 octets aléatoires, stockés hachés en
  SHA-256, jamais relisibles ; la génération révoque l'ancien jeton.
- **Liens publics** — `shareToken` en UUID v4, non énumérable ; la page
  `/carnet/<token>` n'expose que le carnet, pas le reste du compte.
- **Proxy YouTube** — liste blanche d'hôtes correcte (comparaison sur le nom
  d'hôte, pas une sous-chaîne).
- **Uploads** — type MIME vérifié, images ré-encodées par Sharp (ce qui
  neutralise au passage un SVG piégé ou un polyglotte), quota vérifié avant et
  après traitement.
- **Injection SQL** — aucune requête brute : tout passe par Prisma.
- **Le proxy de routes** (`proxy.ts`) laisse volontairement passer
  `api/share`, `api/import`, `api/auth` : chacune de ces routes refait son
  propre contrôle de session. Vérifié route par route.

---

## 3. Ce qui reste ouvert (par ordre d'intérêt)

### 3.1 CSP à nonce
Tant que `script-src` contient `unsafe-inline`, la CSP ne bloque pas un XSS.
Passer aux nonces impose le rendu dynamique de toutes les pages (perte du
statique et du cache CDN) : à arbitrer, la contrepartie n'est pas gratuite. Le
préalable serait de sortir le script d'enregistrement du service worker de
`app/layout.tsx` vers un fichier servi.

### 3.2 Révocation de session
Les sessions sont des JWT de 30 jours : changer son mot de passe ou activer la
2FA **ne déconnecte pas** les sessions déjà ouvertes. Correctif possible sans
changer de stratégie : un champ `sessionsValidFrom` sur l'utilisateur, comparé
dans le callback `jwt` (une lecture DB par requête — à mesurer).

### 3.3 Jetons d'API sans expiration ni portée
Le jeton de l'extension Chrome ne périme jamais et donne les mêmes droits que
la session. Une date d'expiration et une portée limitée à l'import seraient
plus sûres.

### 3.4 Politique de mot de passe
Minimum 8 caractères, sans autre contrôle. Avec la 2FA active le risque baisse
nettement ; sinon, vérifier la longueur (12+) et refuser les mots de passe
présents dans les fuites connues (API k-anonymat de Have I Been Pwned) serait
un bon complément.

### 3.5 Journal des connexions
Aucune trace des connexions réussies/échouées. Un simple historique
(date, IP, agent) consultable dans les réglages permettrait de repérer un accès
anormal — et la table `login_attempts` en est déjà la moitié.

---

## 4. Mise en production

1. **Migration de base** — trois nouveautés : colonnes 2FA sur `users`, tables
   `two_factor_recovery_codes` et `login_attempts`.
   ```bash
   pnpm db:migrate        # ou, si le projet suit `db push` : pnpm --filter @moodboard/db push
   ```
2. **Variable d'environnement** (optionnelle mais recommandée) :
   ```bash
   openssl rand -base64 32   # → TWO_FACTOR_ENCRYPTION_KEY
   ```
   Sans elle, la clé est dérivée de `NEXTAUTH_SECRET`. Dans les deux cas :
   changer la clé source rend les secrets TOTP existants illisibles et impose
   une réactivation de la 2FA (la connexion échoue proprement, l'app ne plante
   pas).
3. **Activer la 2FA** sur le compte admin en premier, et **noter les codes de
   secours** — c'est le seul filet si le téléphone est perdu.
4. Vérifier après déploiement qu'aucune ressource n'est bloquée par la CSP
   (console du navigateur, onglet Réseau) sur : carte des visites, lecteur
   YouTube, transcription audio, OCR d'un cartel.
