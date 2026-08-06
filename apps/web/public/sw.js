const CACHE = 'mb-v12';
const SHARE_DB = 'moodboard-share';
// Coquille hors ligne : page entièrement rendue côté client, servie en repli
// quand une navigation échoue faute de réseau (cf. docs/carnet-hors-ligne.md).
const OFFLINE_URL = '/hors-ligne';

function extractUrl(text) {
  const m = (text || '').match(/https?:\/\/\S+/i);
  return m ? m[0] : '';
}

function isInstagramUrl(url) {
  return /instagram\.com/i.test(url);
}

function isPinterestUrl(url) {
  return /pinterest\.[a-z.]+|pin\.it/i.test(url);
}

function isYouTubeUrl(url) {
  return /youtube\.com|youtu\.be/i.test(url);
}

function openShareDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(SHARE_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('batches', { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function storeShareBatch(id, files, title) {
  const db = await openShareDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction('batches', 'readwrite');
    tx.objectStore('batches').put({ id, files, title, createdAt: Date.now() });
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

// Intercept the OS share POST before it hits the network — a share of
// several photos can exceed Vercel's 4.5MB serverless payload limit.
// Instead: stash the files locally and let the client upload them one
// by one against a per-file endpoint.
async function handleShareTarget(request) {
  const formData = await request.formData();
  const sharedTitle = (formData.get('title') || '').trim();
  const sharedText = (formData.get('text') || '').trim();
  // Instagram/Pinterest "Share to" sends the link as plain text (ACTION_SEND),
  // not the structured 'url' param — fall back to extracting it from text.
  const sharedUrl = (formData.get('url') || '').trim() || extractUrl(sharedText);
  const files = formData.getAll('image').filter((f) => f && f.size > 0);

  if (files.length > 0) {
    const id = crypto.randomUUID();
    await storeShareBatch(id, files, sharedTitle);
    return Response.redirect(`/share/upload?id=${id}`, 303);
  }

  if (sharedUrl && isInstagramUrl(sharedUrl)) {
    return Response.redirect('/share/instagram', 303);
  }

  if (sharedUrl && isPinterestUrl(sharedUrl)) {
    return Response.redirect(`/share/social?url=${encodeURIComponent(sharedUrl)}`, 303);
  }

  if (sharedUrl && isYouTubeUrl(sharedUrl)) {
    return Response.redirect(`/import/youtube?url=${encodeURIComponent(sharedUrl)}`, 303);
  }

  if (sharedUrl) {
    const params = new URLSearchParams({ imageUrl: sharedUrl });
    if (sharedTitle) params.set('title', sharedTitle);
    return Response.redirect(`/import/bookmarklet?${params}`, 303);
  }

  return Response.redirect('/upload', 303);
}

// `/` (start_url du manifeste) est une REDIRECTION 307 vers /library. Or
// `cache.put()` refuse une réponse redirigée : `cache.add('/')` échouait donc
// silencieusement, et l'ouverture à froid de la PWA hors ligne ne trouvait
// rien en cache. On enregistre la coquille SOUS LES DEUX CLÉS : le lancement
// hors réseau tombe alors directement dessus, sans dépendre du repli.
// Le cache ne sert qu'en cas d'échec réseau (stratégie réseau d'abord), donc
// `/` continue de rediriger normalement en ligne.
// URL SYNTHÉTIQUE listant les ressources de la coquille. Stockée dans le cache
// lui-même : le worker peut être arrêté à tout moment, une variable de module
// ne survivrait pas.
const MANIFESTE_URL = '/__coquille-manifeste';

async function lireManifeste(c) {
  try {
    const r = await c.match(MANIFESTE_URL);
    if (!r) return [];
    const d = await r.json();
    return Array.isArray(d.urls) ? d.urls : [];
  } catch { return []; }
}

async function ajouterAuManifeste(c, urls) {
  const deja = await lireManifeste(c);
  const fusion = [...new Set([...deja, ...urls])].slice(0, 400);
  await c.put(MANIFESTE_URL, new Response(JSON.stringify({ urls: fusion }), {
    headers: { 'content-type': 'application/json' },
  }));
}

async function precache() {
  const c = await caches.open(CACHE);
  try {
    const shell = await fetch(OFFLINE_URL, { cache: 'reload' });
    if (!shell.ok) return;
    const html = await shell.clone().text();

    // LES FICHIERS DE LA COQUILLE, MIS EN CACHE ICI ET MAINTENANT.
    //
    // Mettre en cache le seul HTML ne suffit pas : sa feuille de style et ses
    // bundles sont des requêtes distinctes. On comptait sur un préchauffage
    // opportuniste (iframe) pour les capturer à l'exécution — mais après un
    // déploiement les noms de fichiers changent, et le HTML tout juste mis en
    // cache pointait alors vers des fichiers absents : page servie SANS style
    // ni JavaScript, donc inerte (constaté sur mobile le 2026-08-06).
    //
    // On extrait donc les URL du document et on les met en cache dès
    // l'installation — c'est-à-dire exactement au moment où un nouveau
    // déploiement prend effet. Déterministe, sans dépendre d'une visite.
    const urls = new Set();
    const re = /(?:href|src)="(\/_next\/[^"]+)"/g;
    let m;
    while ((m = re.exec(html))) urls.add(m[1].replace(/&amp;/g, '&'));

    // Échecs unitaires tolérés : une ressource manquante ne doit pas empêcher
    // l'installation du worker ni annuler la mise en cache des autres.
    await Promise.allSettled([...urls].map((u) => c.add(u)));
    // Inscrites au manifeste : le taillage ne doit JAMAIS les évincer.
    await ajouterAuManifeste(c, [...urls]);

    await c.put(OFFLINE_URL, shell.clone());
    await c.put('/', shell.clone());
  } catch (e) {
    // Hors ligne à l'installation : on n'empêche pas le worker de s'installer.
  }
}

self.addEventListener('install', (e) => {
  e.waitUntil(precache().then(() => self.skipWaiting()));
});

// PLAFOND DU CACHE D'ASSETS.
//
// Ce cache ne contient que du DÉRIVÉ : documents HTML, JS, CSS, polices. Tout
// est re-téléchargeable — le purger ne coûte qu'un rechargement, jamais une
// donnée. Il peut donc être taillé librement, à l'inverse d'IndexedDB qui
// détient les captures non encore confirmées et n'est jamais purgé
// automatiquement (cf. lib/offline/localVisits.ts).
//
// Sans plafond il grossissait indéfiniment entre deux changements de version :
// chaque page visitée et chaque bundle d'un déploiement s'y accumulaient.
const MAX_ENTREES = 120;
// Jamais évincées : ce sont elles qui font tenir le mode hors ligne.
const ESSENTIELLES = ['/', OFFLINE_URL];

let tailleEnAttente = null;
function planifierTaillage() {
  if (tailleEnAttente) return;
  // Débounce : une rafale de mises en cache (chargement d'une page) ne
  // déclenche qu'un seul passage.
  tailleEnAttente = setTimeout(() => { tailleEnAttente = null; taillerCache(); }, 10000);
}

async function taillerCache() {
  const c = await caches.open(CACHE);
  const cles = await c.keys();
  if (cles.length <= MAX_ENTREES) return;

  // LES FICHIERS DE LA COQUILLE SONT INTOUCHABLES.
  //
  // Ne protéger que les deux documents HTML était une erreur de conception :
  // les assets précachés sont les entrées les PLUS ANCIENNES du cache, donc
  // les PREMIÈRES évincées dès qu'on dépasse le plafond en naviguant. On
  // jetait exactement ce qui fait tenir le mode hors ligne, tout en gardant
  // les pages visitées ensuite — d'où une coquille servie sans style ni
  // JavaScript (constaté sur mobile le 2026-08-06).
  const coquille = new Set(await lireManifeste(c));
  const estEssentielle = (req) => {
    const u = new URL(req.url);
    return ESSENTIELLES.includes(u.pathname)
      || u.pathname === MANIFESTE_URL
      || coquille.has(u.pathname + u.search)
      || coquille.has(u.pathname);
  };
  // `keys()` respecte l'ordre d'insertion : on retire les plus anciennes.
  const evinçables = cles.filter((r) => !estEssentielle(r));
  const trop = cles.length - MAX_ENTREES;
  await Promise.all(evinçables.slice(0, trop).map((r) => c.delete(r)));
}

// Purge les anciennes VERSIONS de cache (documents périmés, place occupée pour
// rien) puis ramène la version courante sous son plafond.
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((noms) => Promise.all(noms.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => taillerCache())
      .then(() => clients.claim())
  );
});

// La page hors ligne nous dit ce qu'elle a RÉELLEMENT chargé pour s'afficher.
// L'extraction des URL depuis le HTML ne voyait que les attributs href/src :
// Next charge une partie de ses bundles dynamiquement, par des URL construites
// à l'exécution. Ils manquaient donc au cache, et la page s'affichait stylée
// mais SANS hydratation — inerte (constaté sur mobile le 2026-08-06).
self.addEventListener('message', (e) => {
  const data = e.data;
  if (!data || data.type !== 'cache-urls' || !Array.isArray(data.urls)) return;
  e.waitUntil(
    caches.open(CACHE).then(async (c) => {
      const urls = data.urls.slice(0, 200);
      await Promise.allSettled(urls.map((u) => c.add(u)));
      // Ce sont les bundles dont la page a BESOIN pour s'hydrater : ils
      // rejoignent la coquille protégée, sinon ils repartiraient au taillage.
      await ajouterAuManifeste(c, urls.map((u) => {
        try { return new URL(u, self.location.origin).pathname; } catch { return u; }
      }));
    },
    ),
  );
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  const url = new URL(request.url);

  if (url.origin !== location.origin) return;

  if (request.method === 'POST' && url.pathname === '/api/share') {
    e.respondWith(handleShareTarget(request));
    return;
  }

  if (request.method !== 'GET') return;

  // Don't cache API routes — always network
  if (url.pathname.startsWith('/api/')) {
    e.respondWith(fetch(request));
    return;
  }

  // NAVIGATION (ouverture d'une page) : réseau d'abord, puis repli en cascade.
  // Auparavant on retombait sur `caches.match(request)` seul : une page jamais
  // visitée n'était pas en cache, la promesse résolvait `undefined`, et le
  // navigateur affichait sa propre page d'erreur — d'où l'impossibilité
  // d'ouvrir l'app hors ligne (cf. docs/carnet-hors-ligne.md §1a).
  if (request.mode === 'navigate') {
    e.respondWith(
      fetch(request)
        .then((res) => {
          // `res.redirected` : `cache.put()` REFUSE une réponse redirigée et
          // lève une TypeError. Sans ce garde-fou, chaque passage sur `/` (307
          // vers /library) produisait un rejet de promesse non traité, et la
          // page n'était jamais mise en cache.
          if (res.ok && !res.redirected) {
            const clone = res.clone();
            caches.open(CACHE).then((c) => c.put(request, clone)).then(planifierTaillage).catch(() => {});
          }
          return res;
        })
        .catch(async () => {
          // 1. la page elle-même si on l'a déjà visitée
          const exact = await caches.match(request);
          if (exact) return exact;
          // 2. sinon la coquille hors ligne
          const shell = await caches.match(OFFLINE_URL);
          if (shell) return shell;
          // 3. dernier filet : jamais la page d'erreur du navigateur
          return new Response(
            '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
            + '<title>Hors ligne</title>'
            + '<body style="margin:0;display:grid;place-items:center;height:100vh;background:#0a0a0a;color:#e5e5e5;'
            + 'font-family:system-ui,sans-serif;text-align:center;padding:24px">'
            + '<div><p style="font-size:15px">Pas de connexion.</p>'
            + '<p style="font-size:13px;opacity:.6">Rouvre l\'application une fois le réseau revenu.</p></div>',
            { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
          );
        })
    );
    return;
  }

  // Ressources (JS, CSS, images…) : réseau d'abord, cache en repli.
  e.respondWith(
    fetch(request)
      .then((res) => {
        if (res.ok && !res.redirected) {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(request, clone)).then(planifierTaillage).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(request))
  );
});
