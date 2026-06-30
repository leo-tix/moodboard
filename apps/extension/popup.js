'use strict';

const input  = document.getElementById('appUrl');
const saveBtn = document.getElementById('save');
const status = document.getElementById('status');

// Load saved URL
chrome.storage.local.get(['appUrl'], (r) => {
  if (r.appUrl) input.value = r.appUrl;
});

saveBtn.addEventListener('click', () => {
  const url = input.value.trim().replace(/\/$/, '');
  if (!url) return;

  chrome.storage.local.set({ appUrl: url }, () => {
    status.textContent = '✓ Enregistré';
    setTimeout(() => { status.textContent = ''; }, 2000);
  });
});

input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') saveBtn.click();
});
