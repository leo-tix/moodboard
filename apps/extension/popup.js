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
