'use strict';

const urlInput   = document.getElementById('appUrl');
const tokenInput = document.getElementById('apiToken');
const toggleBtn  = document.getElementById('toggleToken');
const saveBtn    = document.getElementById('save');
const status     = document.getElementById('status');

// Load saved values
chrome.storage.local.get(['appUrl', 'apiToken'], (r) => {
  if (r.appUrl)   urlInput.value   = r.appUrl;
  if (r.apiToken) tokenInput.value = r.apiToken;
});

// Toggle password visibility
toggleBtn.addEventListener('click', () => {
  const isHidden = tokenInput.type === 'password';
  tokenInput.type = isHidden ? 'text' : 'password';
  toggleBtn.textContent = isHidden ? '🙈' : '👁';
});

saveBtn.addEventListener('click', () => {
  const url   = urlInput.value.trim().replace(/\/$/, '');
  const token = tokenInput.value.trim();

  const data = {};
  if (url)   data.appUrl   = url;
  if (token) data.apiToken = token;

  // Clear moodboard cache when settings change
  data.moodboards   = null;
  data.moodboardsAt = null;

  chrome.storage.local.set(data, () => {
    status.textContent = '✓ Enregistré';
    setTimeout(() => { status.textContent = ''; }, 2000);
  });
});

[urlInput, tokenInput].forEach((el) => {
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter') saveBtn.click(); });
});

// ── Activation par site ──────────────────────────────────────────────────────
// Le clip d'image (content.js) lit la même liste `disabledSites` : ce switch
// ne fait qu'y ajouter/retirer l'hôte de l'onglet actif.
const siteRow    = document.getElementById('siteRow');
const siteHost   = document.getElementById('siteHost');
const siteToggle = document.getElementById('siteToggle');
let currentHost  = null;

chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  let host = null;
  try {
    const u = new URL(tabs[0]?.url || '');
    if (u.protocol === 'http:' || u.protocol === 'https:') host = u.hostname.replace(/^www\./, '');
  } catch { /* page sans URL exploitable (chrome://, nouvel onglet…) */ }

  // Le clip est de toute façon désactivé sur le site Moodboard lui-même
  // (exclu du manifest) : le switch n'y aurait aucun effet.
  if (!host || host === 'moodboard.leotix.fr') return;

  currentHost = host;
  siteHost.textContent = host;
  siteRow.style.display = 'flex';

  chrome.storage.local.get(['disabledSites'], (r) => {
    const disabled = r.disabledSites || [];
    siteToggle.checked = !disabled.includes(host);
  });
});

siteToggle.addEventListener('change', () => {
  if (!currentHost) return;
  chrome.storage.local.get(['disabledSites'], (r) => {
    const disabled = r.disabledSites || [];
    const next = siteToggle.checked
      ? disabled.filter((h) => h !== currentHost)
      : disabled.includes(currentHost) ? disabled : [...disabled, currentHost];
    chrome.storage.local.set({ disabledSites: next });
  });
});

// ── Mise à jour ───────────────────────────────────────────────────────────────
// Rien n'auto-update une extension en "mode développeur" (voir
// background.js, checkForUpdate) — on affiche juste ce qu'il trouve et on
// simplifie le pas suivant : télécharger le zip à jour en un clic, puis
// recharger depuis chrome://extensions (seule étape qu'aucune API n'automatise).
const updateBanner       = document.getElementById('updateBanner');
const updateTitleEl      = document.getElementById('updateTitle');
const updateNotesEl      = document.getElementById('updateNotes');
const updateDownloadBtn  = document.getElementById('updateDownload');
const updateOpenExtBtn   = document.getElementById('updateOpenExtensions');

function renderUpdateBanner(r) {
  if (!r.updateAvailable) { updateBanner.style.display = 'none'; return; }
  updateTitleEl.textContent = r.latestVersion ? `Nouvelle version disponible (v${r.latestVersion})` : 'Nouvelle version disponible';
  updateNotesEl.textContent = r.updateNotes || '';
  updateNotesEl.style.display = r.updateNotes ? 'block' : 'none';
  updateBanner.style.display = 'block';
}

chrome.storage.local.get(['updateAvailable', 'latestVersion', 'updateNotes'], renderUpdateBanner);
// Le popup est ré-ouvert souvent — une vérif à la demande ici coûte peu et
// évite d'attendre jusqu'à 4h (l'alarme périodique) pour voir le badge.
chrome.runtime.sendMessage({ action: 'checkUpdate' }, (r) => { if (r) renderUpdateBanner(r); });

updateDownloadBtn.addEventListener('click', () => {
  chrome.storage.local.get(['appUrl'], (r) => {
    const appUrl = (r.appUrl || 'https://moodboard.leotix.fr').replace(/\/$/, '');
    chrome.downloads.download({ url: `${appUrl}/moodboard-extension.zip`, filename: 'moodboard-extension.zip' });
  });
});

updateOpenExtBtn.addEventListener('click', () => {
  chrome.tabs.create({ url: 'chrome://extensions/' });
});
