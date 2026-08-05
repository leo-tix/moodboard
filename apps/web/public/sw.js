const CACHE = 'mb-v9';
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
async function precache() {
  const c = await caches.open(CACHE);
  try {
    const shell = await fetch(OFFLINE_URL, { cache: 'reload' });
    if (shell.ok) {
      await c.put(OFFLINE_URL, shell.clone());
      await c.put('/', shell.clone());
    }
  } catch (e) {
    // Hors ligne à l'installation : on n'empêche pas le worker de s'installer.
  }
}

self.addEventListener('install', (e) => {
  e.waitUntil(precache().then(() => self.skipWaiting()));
});

// Purge les anciennes versions de cache pour ne pas laisser traîner des
// documents périmés (et de la place occupée pour rien).
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((noms) => Promise.all(noms.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => clients.claim())
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
            caches.open(CACHE).then((c) => c.put(request, clone)).catch(() => {});
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
          caches.open(CACHE).then((c) => c.put(request, clone)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(request))
  );
});
