// Background service worker — ouvre la fenêtre d'import Moodboard

const DEFAULT_APP_URL = 'http://localhost:3000';

async function getAppUrl() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['appUrl'], (result) => {
      resolve((result.appUrl || DEFAULT_APP_URL).replace(/\/$/, ''));
    });
  });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action !== 'save') return;

  (async () => {
    const appUrl = await getAppUrl();
    const params = new URLSearchParams({
      imageUrl: msg.imageUrl || '',
      sourceUrl: msg.sourceUrl || '',
      author: msg.author || '',
      title: msg.title || '',
    });

    chrome.windows.create({
      url: `${appUrl}/import/bookmarklet?${params}`,
      type: 'popup',
      width: 520,
      height: 720,
      focused: true,
    });

    sendResponse({ ok: true });
  })();

  return true; // keep channel open for async response
});
