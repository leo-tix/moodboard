// ─────────────────────────────────────────────────────────────────────────────
// Allègement des fonctions serveur (poste « Functions Storage » chez Vercel)
// ─────────────────────────────────────────────────────────────────────────────
//
// POURQUOI CE SCRIPT EXISTE PLUTÔT QU'UNE OPTION DE next.config.ts
//
// Next.js écrit un `.nft.json` par fonction serveur : la liste exhaustive des
// fichiers que Vercel empaquettera dans cette fonction. 145 fonctions ici, donc
// un fichier inutile de 3 Mo coûte 435 Mo par déploiement.
//
// L'option prévue pour ça est `outputFileTracingExcludes` dans next.config.ts.
// Elle est INOPÉRANTE sur ce projet : elle n'est lue que par
// `collect-build-traces`, et `next build` ne l'appelle que si le bundler N'EST
// PAS Turbopack (next/dist/build/index.js, la garde
// `bundler !== Bundler.Turbopack` autour de collectBuildTraces). Or la version
// 16 construit avec Turbopack, qui écrit lui-même ses `.nft.json` sans jamais
// consulter cette configuration. Vérifié en mesurant : l'option ajoutée au
// next.config.ts ne retire pas un octet.
//
// D'où cette passe explicite après le build. Elle ne touche QUE les listes de
// fichiers `.nft.json` — jamais le code compilé, jamais node_modules. En local
// elle n'a aucun effet observable : `next start` résout ses modules depuis
// node_modules et ne lit pas ces fichiers. Ils ne servent qu'à l'empaquetage
// du déploiement.
//
// RÈGLE : on ne retire ici que des fichiers dont on a établi qu'ils ne sont
// JAMAIS chargés à l'exécution. Chaque règle porte sa justification.

import { readFile, writeFile } from "node:fs/promises";
import { statSync } from "node:fs";
import { glob } from "node:fs/promises";
import path from "node:path";

const racineWeb = path.resolve(import.meta.dirname, "..");
const dossierServeur = path.join(racineWeb, ".next", "server");

/**
 * @typedef {object} Regle
 * @property {string} nom          Libellé affiché dans le rapport.
 * @property {RegExp} motif        Testé sur le chemin absolu du fichier tracé.
 * @property {"tout"|"pages"} portee  "pages" = seulement les fonctions de rendu
 *                                    de page, pas les gestionnaires de route.
 * @property {string} pourquoi     Justification, pour la relecture.
 */

/** @type {Regle[]} */
const REGLES = [
  {
    nom: "Prisma — moteurs WASM des autres bases",
    motif: /@prisma[\\/]client[\\/]runtime[\\/]query_engine_bg\./,
    portee: "tout",
    pourquoi:
      "Prisma livre son moteur de requêtes compilé en WASM pour CHACUNE des " +
      "bases qu'il sait piloter (PostgreSQL, MySQL, SQL Server, SQLite, " +
      "CockroachDB), en double (.js + .mjs) : ~30 Mo par fonction. Ces fichiers " +
      "ne sont chargés que par le client « edge » (@prisma/client/edge, via " +
      "runtime/wasm-engine-edge). Ici on tourne en Node avec le moteur natif " +
      ".prisma/client/libquery_engine-*.so.node ; aucun code n'importe le " +
      "client edge (le proxy/middleware ne touche pas la base).",
  },
  {
    nom: "Prisma — compilateurs de requêtes WASM",
    motif: /@prisma[\\/]client[\\/]runtime[\\/]query_compiler_bg\./,
    portee: "tout",
    pourquoi:
      "~25 Mo par fonction. Le « query compiler » ne sert qu'avec les " +
      "fonctionnalités en avant-première `queryCompiler` + `driverAdapters`, " +
      "que packages/db/schema.prisma n'active pas.",
  },
  {
    nom: "Prisma — WASM du client généré",
    motif: /[\\/]\.prisma[\\/]client[\\/]query_engine_bg\.wasm$/,
    portee: "tout",
    pourquoi:
      "2,3 Mo par fonction. Chargé par .prisma/client/wasm.js (chemin edge), " +
      "jamais par index.js (chemin Node), qui est celui que lib/db/index.ts " +
      "emprunte via `import { PrismaClient } from \"@prisma/client\"`.",
  },
  {
    nom: "Prisma — runtimes des autres cibles (edge, binaire, React Native…)",
    // On garde `library.*` (le runtime réellement chargé) et `client.*`.
    motif:
      /(@prisma[\\/]client[\\/]runtime[\\/](binary|react-native|edge|edge-esm|wasm-engine-edge|wasm-compiler-edge|index-browser)\.(js|mjs)$|[\\/]\.prisma[\\/]client[\\/](edge|wasm|query_engine_bg|index-browser)\.js$|[\\/]\.prisma[\\/]client[\\/]wasm-(edge-light|worker)-loader\.mjs$)/,
    portee: "tout",
    pourquoi:
      "~3 Mo par fonction. @prisma/client publie un runtime par cible " +
      "d'exécution ; une seule est empruntée. La chaîne réelle est vérifiable " +
      "à la lecture du client généré : .prisma/client/index.js ne contient " +
      "qu'un `require('@prisma/client/runtime/library.js')`. Les autres " +
      "entrées ne sont atteintes que par .prisma/client/edge.js (→ runtime/" +
      "edge.js) et wasm.js (→ runtime/wasm-engine-edge.js), c'est-à-dire par " +
      "`@prisma/client/edge`, que rien n'importe ici.",
  },
  {
    nom: "Déclarations TypeScript (.d.ts)",
    motif: /\.d\.(ts|mts|cts)$/,
    portee: "tout",
    pourquoi:
      "Jamais chargées à l'exécution. Next les écarte lui-même quand il " +
      "construit avec webpack ('**/*.d.ts' dans les serverIgnores de " +
      "collect-build-traces.js) ; Turbopack ne le fait pas.",
  },
  {
    nom: "IA embarquée — transformers.js et son runtime ONNX",
    motif: /[\\/]node_modules[\\/](@huggingface[\\/]transformers|onnxruntime-node|onnxruntime-common)([\\/]|$)/,
    portee: "tout",
    pourquoi:
      "7,5 Mo par page. Ces modèles tournent EXCLUSIVEMENT dans des Web " +
      "Workers du navigateur (lib/ai/vision.worker.ts pour les suggestions " +
      "d'images, lib/audio/whisper.worker.ts pour la transcription vocale). " +
      "Ils remontaient dans le graphe serveur parce que " +
      "`new Worker(new URL(\"./vision.worker.ts\", import.meta.url))` fait " +
      "entrer le module du worker — et donc ses imports statiques — dans le " +
      "graphe de la page qui l'héberge (chaîne : (app)/layout.tsx → " +
      "GlobalUploadProvider → MetadataPanel → AiSuggestPanel → imageAnalysis).",
  },
  {
    nom: "sharp — copie de l'optimiseur d'images de Next",
    motif: /[\\/]node_modules[\\/](sharp|@img[\\/]sharp-[^\\/]+|@img[\\/]colour)([\\/]|$)/,
    portee: "pages",
    pourquoi:
      "17,1 Mo par page (libvips-cpp.so surtout). Aucune page ne traite " +
      "d'image : le traitement (lib/image/process.ts, colors.ts, tilePhoto.ts, " +
      "generatePreview.ts) n'est appelé que depuis des gestionnaires de route " +
      "/api/**, qui gardent leur sharp. Cette copie-là est celle que `next` " +
      "tire pour SON optimiseur d'images — et chez Vercel, /_next/image est " +
      "servi par l'optimiseur de la plateforme, pas par la fonction de la page. " +
      "C'est exactement ce que fait Next lui-même quand il construit avec " +
      "webpack sur Vercel : collect-build-traces.js ignore alors " +
      "'**/node_modules/sharp/**/*' et '**/@img/sharp-libvips*/**/*' dès que " +
      "`hasNextSupport` est vrai. Turbopack n'applique pas cet oubli ; on le " +
      "rétablit ici.",
  },
];

// ── Budget de poids ────────────────────────────────────────────────────────
//
// Un chiffre affiché à chaque build ne protège de rien si personne ne le lit.
// Ces deux plafonds arrêtent le build en cas de dérive, pour que le
// dépassement soit un choix ÉCRIT (on modifie la constante dans le même
// commit que la dépendance qui l'a causé) et non une surprise sur la facture
// trois mois plus tard.
//
// Ils attrapent deux dérives distinctes :
//   - TOTAL : une dépendance lourde entre dans le graphe de toutes les
//     fonctions (le cas Prisma/sharp qui a mené à ce script).
//   - FONCTION : une seule route devient énorme sans que le total bronche.
//
// Ils attrapent aussi le cas sournois : une montée de version majeure de
// Prisma ou de Next réorganise ses fichiers, les motifs des règles ci-dessus
// ne correspondent plus à rien, le script n'élague plus — et seul le poids le
// dirait.
//
// Valeurs posées le 2026-09-17, mesuré à 3,27 Go au total et 39,4 Mo pour la
// plus lourde fonction (une route /api qui embarque sharp). La marge est
// volontairement large : il s'agit d'attraper une dérive d'un facteur deux,
// pas de faire échouer un build parce qu'on a ajouté un composant.
const BUDGET_TOTAL_MO = 4500;
const BUDGET_FONCTION_MO = 50;

// Échappatoire pour un déploiement urgent : le build passe, l'avertissement
// reste. À n'utiliser que le temps de corriger.
const IGNORER_BUDGET = process.env.POIDS_FONCTIONS_IGNORER_BUDGET === "1";

const octets = (n) => `${(n / 1e6).toFixed(1)} Mo`;

/** Taille d'un fichier, 0 s'il a disparu (les traces contiennent des liens
 *  symboliques et des chemins pnpm qui peuvent ne plus résoudre). */
function taille(p) {
  try {
    return statSync(p).size;
  } catch {
    return 0;
  }
}

async function principal() {
  const fichiers = [];
  for await (const f of glob("**/*.nft.json", { cwd: dossierServeur })) {
    fichiers.push(path.join(dossierServeur, f));
  }
  if (fichiers.length === 0) {
    console.warn("[alleger-traces] aucun .nft.json trouvé — rien à faire.");
    return;
  }

  let avant = 0;
  let apres = 0;
  const gainParRegle = new Map(REGLES.map((r) => [r.nom, 0]));
  /** Poids APRÈS élagage, par fonction — pour le budget par fonction. */
  const poidsParFonction = [];

  for (const trace of fichiers) {
    const dossier = path.dirname(trace);
    // Une fonction de PAGE : .next/server/app/**/page.js.nft.json. Les
    // gestionnaires de route sont route.js.nft.json, le serveur lui-même
    // next-server.js.nft.json.
    const estPage = path.basename(trace) === "page.js.nft.json";

    const contenu = JSON.parse(await readFile(trace, "utf8"));
    const gardes = [];
    // Un même fichier peut apparaître plusieurs fois dans la liste (chemins
    // relatifs distincts) : on ne compte sa taille qu'une fois.
    const vus = new Set();
    const vusGardes = new Set();
    let poidsFonction = 0;

    for (const rel of contenu.files ?? []) {
      const absolu = path.normalize(path.join(dossier, rel));
      const t = vus.has(absolu) ? 0 : taille(absolu);
      vus.add(absolu);
      avant += t;

      const regle = REGLES.find(
        (r) =>
          (r.portee === "tout" || estPage) && r.motif.test(absolu)
      );
      if (regle) {
        gainParRegle.set(regle.nom, gainParRegle.get(regle.nom) + t);
        continue;
      }
      gardes.push(rel);
      if (!vusGardes.has(absolu)) {
        vusGardes.add(absolu);
        apres += t;
        poidsFonction += t;
      }
    }

    poidsParFonction.push({
      poids: poidsFonction,
      nom: path
        .relative(dossierServeur, trace)
        .replace(/\.nft\.json$/, "")
        .replace(/\\/g, "/"),
    });

    if (gardes.length !== (contenu.files ?? []).length) {
      await writeFile(
        trace,
        JSON.stringify({ version: contenu.version, files: gardes })
      );
    }
  }

  console.log(
    `\n[alleger-traces] ${fichiers.length} fonctions — ${octets(avant)} → ${octets(apres)} ` +
      `(−${octets(avant - apres)}, ${(((avant - apres) / avant) * 100).toFixed(0)} %)`
  );
  for (const [nom, gain] of gainParRegle) {
    if (gain > 0) console.log(`    −${octets(gain).padStart(9)}  ${nom}`);
  }
  console.log("");

  verifierBudget(apres, poidsParFonction);
}

/**
 * Compare le poids obtenu aux plafonds et arrête le build s'ils sont
 * dépassés. Le message explique quoi faire — un build rouge sans mode
 * d'emploi ne sert qu'à faire perdre du temps.
 */
function verifierBudget(total, poidsParFonction) {
  poidsParFonction.sort((a, b) => b.poids - a.poids);
  const plusLourde = poidsParFonction[0];
  const depassements = [];

  if (total > BUDGET_TOTAL_MO * 1e6) {
    depassements.push(
      `TOTAL : ${octets(total)} pour un plafond de ${BUDGET_TOTAL_MO} Mo ` +
        `(dépassement de ${octets(total - BUDGET_TOTAL_MO * 1e6)}).`
    );
  }
  if (plusLourde && plusLourde.poids > BUDGET_FONCTION_MO * 1e6) {
    depassements.push(
      `FONCTION : ${plusLourde.nom} pèse ${octets(plusLourde.poids)} ` +
        `pour un plafond de ${BUDGET_FONCTION_MO} Mo.`
    );
  }
  if (depassements.length === 0) {
    const margeTotal = (100 * total) / (BUDGET_TOTAL_MO * 1e6);
    console.log(
      `[alleger-traces] budget : ${margeTotal.toFixed(0)} % du plafond total, ` +
        `plus lourde fonction ${octets(plusLourde?.poids ?? 0)} / ${BUDGET_FONCTION_MO} Mo.\n`
    );
    return;
  }

  console.error("\n╭─ POIDS DES FONCTIONS SERVEUR : BUDGET DÉPASSÉ ─────────────");
  for (const d of depassements) console.error(`│  ${d}`);
  console.error("│");
  console.error("│  Les cinq fonctions les plus lourdes :");
  for (const { poids, nom } of poidsParFonction.slice(0, 5)) {
    console.error(`│    ${octets(poids).padStart(9)}  ${nom}`);
  }
  console.error("│");
  console.error("│  Chez Vercel, ce poids est multiplié par le nombre de");
  console.error("│  déploiements conservés — c'est ce qui avait bloqué les");
  console.error("│  déploiements en septembre 2026 (voir l'en-tête de ce script).");
  console.error("│");
  console.error("│  Quoi faire :");
  console.error("│   1. Trouver ce qui est entré : regrouper les fichiers du");
  console.error("│      .nft.json d'une fonction par paquet npm et trier.");
  console.error("│   2. Si le paquet n'est jamais chargé à l'exécution, lui");
  console.error("│      ajouter une règle ci-dessus, avec sa justification.");
  console.error("│   3. Si le poids est légitime, relever le plafond DANS LE");
  console.error("│      MÊME COMMIT, pour que l'historique garde la raison.");
  console.error("│");
  console.error("│  Urgence : POIDS_FONCTIONS_IGNORER_BUDGET=1 laisse passer.");
  console.error("╰────────────────────────────────────────────────────────────\n");

  if (IGNORER_BUDGET) {
    console.error("[alleger-traces] budget ignoré (POIDS_FONCTIONS_IGNORER_BUDGET=1).\n");
    return;
  }
  // L'élagage lui-même a déjà eu lieu : les traces sont correctes, c'est le
  // RÉSULTAT qui est jugé trop lourd. On sort en échec pour que `next build`
  // — et donc le déploiement — s'arrête là.
  process.exitCode = 1;
}

principal().catch((e) => {
  // Un échec TECHNIQUE ici ne doit pas casser le déploiement : au pire les
  // fonctions restent lourdes, ce qui est le comportement d'avant ce script.
  // À ne pas confondre avec le dépassement de budget ci-dessus, lui
  // délibérément bloquant.
  console.error("[alleger-traces] échec, traces laissées intactes :", e);
});
