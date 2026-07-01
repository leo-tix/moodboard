const CACHE = 'mb-v7';
const SHARE_DB = 'moodboard-share';

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

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.add('/'))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => e.waitUntil(clients.claim()));

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

  // Network-first with cache fallback for pages and assets
  e.respondWith(
    fetch(request)
      .then((res) => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(request, clone));
        }
        return res;
      })
      .catch(() => caches.match(request))
  );
});
