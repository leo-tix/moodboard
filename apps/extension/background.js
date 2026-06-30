'use strict';

const DEFAULT_APP_URL = 'https://moodboard.leotix.fr';

async function cfg() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['appUrl', 'apiToken', 'moodboards', 'moodboardsAt'], resolve);
  });
}

// Fetch & cache moodboards list (TTL: 5 min)
async function getMoodboards(appUrl, token) {
  const now = Date.now();
  const data = await cfg();
  if (data.moodboards && data.moodboardsAt && now - data.moodboardsAt < 5 * 60 * 1000) {
    return data.moodboards;
  }
  try {
    const res = await fetch(`${appUrl}/api/moodboards`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return [];
    const list = await res.json();
    const boards = list.map((b) => ({ id: b.id, title: b.title }));
    chrome.storage.local.set({ moodboards: boards, moodboardsAt: now });
    return boards;
  } catch {
    return [];
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === 'save') {
    (async () => {
      const data = await cfg();
      const appUrl = (data.appUrl || DEFAULT_APP_URL).replace(/\/$/, '');
      const token  = data.apiToken || '';

      if (!token) {
        sendResponse({ ok: false, error: 'no_token' });
        return;
      }

      try {
        const res = await fetch(`${appUrl}/api/import/direct`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            imageUrl:     msg.imageUrl,
            sourceUrl:    msg.sourceUrl,
            title:        msg.title        || '',
            author:       msg.author       || '',
            description:  msg.description  || '',
            tags:         msg.tags         || [],
          }),
        });

        let result;
        try { result = await res.json(); } catch { result = {}; }
        if (!res.ok || !result.inspirationId) {
          sendResponse({ ok: false, error: result.error || `HTTP ${res.status}` });
          return;
        }

        // If a moodboard target is specified, add the image to it
        if (msg.moodboardId && result.inspirationId) {
          await fetch(`${appUrl}/api/moodboards/${msg.moodboardId}/items`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              inspirationId: result.inspirationId,
              storageKey:    result.storageKey,
              thumbnailKey:  result.thumbnailKey,
              width:         result.width  || 800,
              height:        result.height || 600,
              title:         result.title  || '',
            }),
          }).catch(() => {});
        }

        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
    })();
    return true;
  }

  if (msg.action === 'saveMany') {
    (async () => {
      const data = await cfg();
      const appUrl = (data.appUrl || DEFAULT_APP_URL).replace(/\/$/, '');
      const token  = data.apiToken || '';
      if (!token) { sendResponse({ ok: false, error: 'no_token' }); return; }

      let saved = 0, failed = 0;
      for (const imageUrl of msg.imageUrls) {
        try {
          const res = await fetch(`${appUrl}/api/import/direct`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({
              imageUrl,
              sourceUrl:   msg.sourceUrl,
              title:       msg.title       || '',
              author:      msg.author      || '',
              description: msg.description || '',
              tags:        msg.tags        || [],
            }),
          });
          let result = {};
          try { result = await res.json(); } catch { /* empty */ }
          if (res.ok && result.inspirationId) saved++;
          else failed++;
        } catch { failed++; }
      }
      sendResponse({ ok: saved > 0, saved, failed });
    })();
    return true;
  }

  if (msg.action === 'getMoodboards') {
    (async () => {
      const data = await cfg();
      const appUrl = (data.appUrl || DEFAULT_APP_URL).replace(/\/$/, '');
      const token  = data.apiToken || '';
      if (!token) { sendResponse([]); return; }
      const boards = await getMoodboards(appUrl, token);
      sendResponse(boards);
    })();
    return true;
  }
});
