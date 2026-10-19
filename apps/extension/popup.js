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
