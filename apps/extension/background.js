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
            year:         msg.year         || '',
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
              year:        msg.year        || '',
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

  // Vérification à la demande (bouton "Vérifier" du popup) — ne bloque pas
  // sur l'alarme périodique de checkForUpdate.
  if (msg.action === 'checkUpdate') {
    checkForUpdate().then(() => {
      chrome.storage.local.get(['updateAvailable', 'latestVersion', 'updateNotes'], sendResponse);
    });
    return true;
  }
});

// ── Vérification de mise à jour ──────────────────────────────────────────────
// Une extension chargée en "mode développeur" (Load unpacked) n'est JAMAIS
// mise à jour automatiquement par Chrome, contrairement au Chrome Web Store —
// il n'existe aucune API permettant à une extension de remplacer ses propres
// fichiers sur disque. On réduit la friction plutôt que de prétendre
// l'éliminer : on interroge périodiquement un petit marqueur de version
// public (régénéré par scripts/zip-extension.ps1 à chaque publication), on
// pose un badge rouge sur l'icône dès qu'une version plus récente existe, et
// le popup propose alors un téléchargement en un clic du zip à jour.
const UPDATE_CHECK_ALARM = 'mb-check-update';
const UPDATE_CHECK_PERIOD_MIN = 240; // 4h

function parseVersion(v) {
  return String(v || '0').split('.').map((n) => parseInt(n, 10) || 0);
}

function isNewerVersion(remote, local) {
  const r = parseVersion(remote);
  const l = parseVersion(local);
  for (let i = 0; i < Math.max(r.length, l.length); i++) {
    const rv = r[i] || 0, lv = l[i] || 0;
    if (rv !== lv) return rv > lv;
  }
  return false;
}

async function checkForUpdate() {
  const data = await cfg();
  const appUrl = (data.appUrl || DEFAULT_APP_URL).replace(/\/$/, '');
  const localVersion = chrome.runtime.getManifest().version;

  try {
    const res = await fetch(`${appUrl}/extension-version.json`, { cache: 'no-store' });
    if (!res.ok) return;
    const info = await res.json();
    const available = !!info.version && isNewerVersion(info.version, localVersion);

    await chrome.storage.local.set({
      updateAvailable: available,
      latestVersion: info.version || null,
      updateNotes: info.notes || '',
    });

    if (available) {
      chrome.action.setBadgeText({ text: '●' });
      chrome.action.setBadgeBackgroundColor({ color: '#f87171' });
    } else {
      chrome.action.setBadgeText({ text: '' });
    }
  } catch {
    // Réseau indisponible, ou moodboard.leotix.fr injoignable — on retentera
    // à la prochaine alarme (4h), pas de bruit pour l'utilisateur.
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(UPDATE_CHECK_ALARM, { periodInMinutes: UPDATE_CHECK_PERIOD_MIN });
  checkForUpdate();
});
chrome.runtime.onStartup.addListener(() => {
  checkForUpdate();
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === UPDATE_CHECK_ALARM) checkForUpdate();
});
