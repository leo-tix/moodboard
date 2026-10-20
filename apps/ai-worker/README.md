# ai-worker

Worker IA continue — analyse les images de la bibliothèque (tags, catégories,
similarité/doublons) via un modèle auto-hébergé (SigLIP-large), aucune API
tierce. Tourne en permanence sur le VPS OVH partagé (le même que
`apps/gif-worker`), poll directement la base Postgres (Neon) pour trouver du
travail — pas de route HTTP exposée côté `apps/web`, pas d'appel entrant,
juste un `/health` local pour les checks ops.

Voir `C:\Users\leopa\.claude\plans\idempotent-humming-flamingo.md` pour le
plan complet (contexte, choix du modèle, phases).

## Fonctionnement

1. Réclame une `Inspiration` en attente (`aiStatus='PENDING'`, la même file
   sert aux nouveaux uploads et au rattrapage de l'existant).
2. Télécharge son image principale depuis R2 (lecture publique, pas de clé).
3. Calcule l'embedding (SigLIP-large). Les GIF (vidéos déjà converties par
   `gif-worker` avant stockage) sont ouverts normalement — PIL prend la
   frame 0 par défaut, pas besoin de ffmpeg.
4. Écrit le résultat (`embedding` pgvector, `aiStatus='DONE'`) ou une erreur
   (`aiStatus='ERROR'`, `aiError`) et passe au suivant.

Un balayage périodique remet en `PENDING` les jobs restés bloqués en
`PROCESSING` trop longtemps (worker redémarré en plein traitement).

## Déploiement (VPS)

```bash
cd /opt/moodboard-ai-worker
cp .env.example .env
# éditer .env : DATABASE_URL (connexion directe Neon), R2_PUBLIC_URL
docker compose up -d --build
curl http://127.0.0.1:8092/health
```

Mise à jour :

```bash
git pull   # ou re-synchroniser les fichiers
docker compose up -d --build
```

Logs :

```bash
docker compose logs -f ai-worker
```

Surveiller la charge pendant les premiers runs (notamment le rattrapage de
l'existant, Phase 3 du plan) :

```bash
docker stats
```

## Variables d'environnement

Voir `.env.example`. Seules `DATABASE_URL` et `R2_PUBLIC_URL` sont
obligatoires, le reste a des valeurs par défaut raisonnables.

## Embeddings texte (tags/catégories) — lent, mis en cache

Mesuré sur ce VPS : la tour texte de SigLIP-large prend **~27s par batch de
32 textes** en CPU single-thread — pour les ~330 concepts de tags (×3
gabarits d'ensembling) ça représente ~15 min **sans cache**. Les tags sont
donc mis en cache sur disque (`ai_worker_vocab_cache`, invalidé seulement si
`tag_vocab.py` change) : ce coût n'est payé qu'une fois par version du
vocabulaire, jamais à chaque redémarrage. Les catégories (dynamiques, depuis
la base) ne sont ré-embedées que si leur contenu a réellement changé depuis
le dernier calcul, pas sur un simple minuteur — éditer une catégorie dans
Réglages déclenche un recalcul (quelques dizaines de secondes selon le
nombre de catégories), pas un redémarrage à vide toutes les 30 min.

## Budget ressources

Mesuré sur ce VPS (2 vCPU / 3,7 Go partagés avec `gif-worker`,
`content-creator`, `serveur-pdf`) : SigLIP-large seul atteint ~1,9 Go de pic
RAM en inférence CPU. `compose.yaml` pose un cap `mem_limit: 2560m, cpus: 1.0`
— volontairement sous la RAM totale disponible pour ne jamais pouvoir
affamer les autres services (cgroups Docker isolent la mémoire : si ce
conteneur dépasse son cap, lui seul est tué par l'OOM killer, jamais les
autres). Le cache des poids du modèle est monté en volume nommé
(`ai_worker_hf_cache`) pour ne pas retélécharger ~1,9 Go à chaque
redéploiement.
