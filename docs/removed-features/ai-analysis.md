# Analyse IA (Google Gemini) — retirée le 2026-07-09

Fonctionnalité complètement supprimée du site à la demande de l'utilisateur.
Ce document conserve tout ce qui est nécessaire pour la réintégrer un jour
sans repartir de zéro. Rien n'a été supprimé "en douce" : ce doc + l'historique
git (voir commit de suppression) donnent la totalité du code original.

## Ce que faisait la fonctionnalité

Pour une inspiration donnée, un bouton "✦ Analyser avec l'IA" envoyait la
vignette (256px, JPEG qualité 75) à Gemini Vision, qui répondait en JSON avec :
- `tags` (max 15) — proposés en chips, acceptables un par un ou "Tout accepter"
- `styleKeywords` (max 8) — cliquables pour les ajouter comme tag
- `moodDescriptor` — une phrase, applicable comme description
- `technicalNotes` — notes technique/composition/lumière, affichées seules
- `suggestedTitle` — applicable en un clic
- `suggestedCategoryIds` (0 à 3, choisis parmi les catégories réelles de l'app)

Trois points d'entrée additionnels déclenchaient la même analyse :
1. **Upload** (`/upload` DropZone) — toggle "IA" optionnel, analyse en tâche de
   fond après upload, badges de statut par fichier (analyse/fait ✦/erreur !/quota ⏳).
2. **GlobalUploadProvider** (drag&drop ou Ctrl+V n'importe où dans l'app) — même
   toggle et logique, en widget flottant.
3. **MoodboardEditor** — pas de toggle par upload, mais respectait un réglage
   global `Réglages → Général → "Analyse IA automatique à l'import"`
   (`localStorage` clé `moodboard:aiOnImport`), tirait l'analyse en
   fire-and-forget après chaque image déposée/collée sur le canvas.
4. **YouTubeImportClient** — toggle IA propre à ce flux d'import.
5. **BatchEditBar** — "✦ Analyser avec l'IA" en lot sur la sélection multiple,
   avec compteur de progression séquentiel.

## Schéma Prisma (avant suppression)

```prisma
model Inspiration {
  ...
  aiAnalysis     AIAnalysis?
  ...
}

model AIAnalysis {
  id              String      @id @default(cuid())
  inspirationId   String      @unique
  rawResponse     Json
  styleKeywords   String[]
  moodDescriptor  String?
  technicalNotes  String?
  processedAt     DateTime    @default(now())

  inspiration     Inspiration @relation(fields: [inspirationId], references: [id], onDelete: Cascade)

  @@map("ai_analyses")
}
```

`Tag.source: TagSource` (`MANUAL | AI`) — l'enum `AI` existe toujours dans le
schéma (conservé, inoffensif) mais n'était de toute façon jamais posé par la
route d'analyse (les tags acceptés étaient créés via le chemin normal de
création de tag, toujours `MANUAL`).

## Lib Gemini — `lib/ai/gemini.ts` (fichier entier, ~185 lignes)

Dépendance : `@google/genai` (`^2.5.0`), client instancié avec
`GEMINI_API_KEY`. Modèle utilisé : **`gemini-2.5-flash`**, `temperature: 0.3`,
`maxOutputTokens: 4096`.

Points clés à ne pas réinventer si on réintègre :
- **Retry avec back-off exponentiel** (`withRetry`) : 3 tentatives, délais
  5s → 15s → 30s, honore un `retryDelay`/`Retry-After` explicite dans l'erreur
  si présent. Détecte 429/RESOURCE_EXHAUSTED/quota/rate limit et 503/overloaded.
- **`GeminiRateLimitError`** — erreur typée avec `retryAfter` (secondes),
  levée seulement après épuisement des retries → permet à l'UI d'afficher
  "réessayer dans Ns" plutôt qu'une erreur générique.
- **Extraction JSON robuste** : la réponse Gemini est parfois entourée d'un
  fence ` ```json ... ``` `, parfois du JSON brut — regex qui gère les deux
  avant `JSON.parse`.
- **Prompt** (`buildPrompt`) — en français, décrit explicitement le format
  JSON attendu et injecte la liste réelle des catégories de l'app (id + nom)
  pour que `suggestedCategoryIds` reste valide côté DB.

```ts
export interface ImageAnalysis {
  tags: string[];
  styleKeywords: string[];
  moodDescriptor: string;
  technicalNotes: string;
  suggestedTitle?: string;
  suggestedCategoryIds?: string[];
}
export interface CategoryHint { id: string; name: string; }
export async function analyzeImageWithGemini(
  imageBuffer: Buffer, mimeType?: string, categories?: CategoryHint[]
): Promise<ImageAnalysis>
```

Le prompt complet (à réutiliser tel quel, il fonctionnait bien) :

```
Tu es un expert en direction artistique et histoire de l'art.
Analyse cette image et réponds UNIQUEMENT en JSON valide avec cette structure exacte:
{
  "tags": ["tag1", "tag2", ...],
  "styleKeywords": ["mot1", "mot2", ...],
  "moodDescriptor": "une phrase courte décrivant l'ambiance",
  "technicalNotes": "notes sur la technique, composition, lumière",
  "suggestedTitle": "titre suggéré si pertinent",
  "suggestedCategoryIds": ["id1", "id2"]
}

Pour les tags (max 15): couleurs dominantes, style artistique, technique, époque, thème, émotion, composition.
Pour styleKeywords (max 8): mouvement artistique, influences, esthétique.
Pour suggestedCategoryIds: choisis parmi ces catégories disponibles celles qui correspondent le mieux à l'image (0 à 3 maximum, utilise exactement les ids fournis):
{liste "id: ..., nom: ..." des catégories}
Réponds en français.
```

## Route API — `app/api/inspirations/[id]/analyze/route.ts` (POST, entière)

`maxDuration = 60`. Séquence :
1. Auth + vérifie que l'inspiration appartient au profil (`userId`, scoping
   multi-profils déjà en place — à refaire pareil si réintégré après la
   migration multi-utilisateur du 2026-07-09).
2. Récupère l'inspiration (image principale + tags + catégories) et toutes
   les `Category` en parallèle.
3. Exige un `thumbnailKey` ; fetch la vignette depuis `R2_PUBLIC_URL`.
4. Resize 256×256 via `sharp` → réduit le payload envoyé à Gemini (~10-20 Ko
   au lieu de ~150 Ko).
5. Appelle `analyzeImageWithGemini`. Sur `GeminiRateLimitError` → `429`
   `{ error: "rate_limit", message, retryAfter }`.
6. `db.aIAnalysis.upsert()` (clé `inspirationId`) — stocke `rawResponse`
   complet + les 3 champs dénormalisés.
7. Filtre `tags`/`suggestedCategoryIds` contre l'existant pour ne renvoyer
   que les suggestions **nouvelles** (`suggestedTags`, `suggestedCategories`).
8. Réponse : `{ analysis: {moodDescriptor, styleKeywords, technicalNotes,
   suggestedTitle}, suggestedTags, suggestedCategories }`.

## UI retirée

- **`MetadataPanel.tsx`** — section "Analyse IA" complète (bouton
  Analyser/Re-analyser, "Tout accepter", chips mood/style/tags/catégories
  suggérés cliquables, placeholder "Laisse Gemini analyser l'image…").
  Props `aiAnalysis`, `aiFirst` (le prop `autoAnalyze` était déjà mort avant
  suppression, jamais passé par aucun appelant).
- **`DetailPageClient.tsx`** + les deux pages serveur `library/[id]/page.tsx`
  et `@modal/(.)library/[id]/page.tsx` — sélectionnaient
  `aiAnalysis: { moodDescriptor, styleKeywords }` et le transmettaient.
- **`BatchEditBar.tsx`** — bouton lot "Analyser avec l'IA" + compteur.
- **`DropZone.tsx`** / **`GlobalUploadProvider.tsx`** — toggle IA, machine à
  état `aiStatus` (`analyzing|done|error|quota`), badges par fichier, bouton
  "Réanalyser" en cas de 429, patch automatique des suggestions acceptées
  vers `PATCH /api/inspirations/[id]`.
- **`YouTubeImportClient.tsx`** — toggle IA propre, `analyzeInspiration()`.
- **`GeneralSettings.tsx`** — toggle "Analyse IA automatique à l'import",
  clé `localStorage` `moodboard:aiOnImport` (export `AI_IMPORT_KEY`).
- **`MoodboardEditor.tsx`** — lecture de `AI_IMPORT_KEY` + fetch fire-and-forget
  vers la route d'analyse après drop/paste d'image sur le canvas.
- **`privacy/page.tsx`** — mention "Google Gemini AI (opt-in uniquement)"
  comme sous-traitant de données, retirée de la politique de confidentialité.

## Variables d'environnement

- `GEMINI_API_KEY` — retirée de `.env.example`. **Encore présente sur
  Vercel** (non supprimée côté hébergeur, au cas où) — à nettoyer
  manuellement si vraiment plus besoin, ou à laisser si réintégration prévue.

## Effet de bord : page "Réglages → Général" supprimée

`GeneralSettings.tsx` ne contenait *que* le toggle "Analyse IA automatique à
l'import" (`localStorage` `moodboard:aiOnImport`, lu par `MoodboardEditor.tsx`
avant de tirer l'analyse en fire-and-forget après drop/paste sur le canvas).
Une fois ce toggle retiré, la page/section n'avait plus aucun contenu — j'ai
donc supprimé toute la page `/settings/general` + son entrée dans
`SettingsNav.tsx` plutôt que de laisser une page vide. Si une autre fonction
"Général" apparaît un jour, il faudra recréer la page (et l'entrée de nav)
depuis zéro — ce n'était pas un simple retrait de section.

## Pour réintégrer un jour

1. Restaurer `packages/db/schema.prisma` (modèle `AIAnalysis` + relation) et
   repasser une migration `prisma db push` (expand, pas besoin de backfill
   puisque la table sera vide).
2. Restaurer `lib/ai/gemini.ts` tel quel (voir ci-dessus, ou `git show` sur le
   commit de suppression).
3. Restaurer la route `analyze/route.ts`, en adaptant le scoping `userId` à
   l'état du schéma au moment de la réintégration.
4. Réintégrer l'UI un morceau à la fois en commençant par `MetadataPanel`
   (le point d'entrée manuel le plus simple), avant de rebrancher les 4 flux
   d'auto-analyse (upload, global upload, moodboard editor, YouTube import).
5. Remettre `GEMINI_API_KEY` dans `.env.local` + Vercel si retirée.
6. Remettre la mention Gemini dans `privacy/page.tsx`.
