'use strict';

// ── Overlay button ────────────────────────────────────────────────────────────

let btn = null;
let currentImg = null;
let hideTimer = null;

function getBtn() {
  if (btn) return btn;

  btn = document.createElement('div');
  btn.setAttribute('data-moodboard', '1');

  btn.innerHTML =
    '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" style="flex-shrink:0">' +
      '<path d="M2 14h12M8 2v9M4 7l4 4 4-4" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>' +
    '</svg>' +
    '<span>Sauvegarder</span>';

  Object.assign(btn.style, {
    position: 'fixed',
    zIndex: '2147483647',
    display: 'none',
    alignItems: 'center',
    gap: '6px',
    padding: '5px 10px',
    background: 'rgba(10,10,10,0.88)',
    backdropFilter: 'blur(6px)',
    WebkitBackdropFilter: 'blur(6px)',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: '6px',
    color: 'white',
    fontFamily: 'system-ui,-apple-system,sans-serif',
    fontSize: '12px',
    fontWeight: '500',
    cursor: 'pointer',
    boxShadow: '0 2px 12px rgba(0,0,0,0.5)',
    userSelect: 'none',
    pointerEvents: 'all',
    transition: 'opacity 0.1s',
    lineHeight: '1',
    whiteSpace: 'nowrap',
  });

  btn.addEventListener('mouseenter', () => clearTimeout(hideTimer));
  btn.addEventListener('mouseleave', scheduleHide);
  btn.addEventListener('click', handleSave);

  document.documentElement.appendChild(btn);
  return btn;
}

function bestUrl(img) {
  if (!img.srcset) return img.currentSrc || img.src;
  const entries = img.srcset.split(',').map((s) => {
    const parts = s.trim().split(/\s+/);
    return { url: parts[0], w: parseInt(parts[1] || '0') };
  });
  entries.sort((a, b) => b.w - a.w);
  return entries[0]?.url || img.src;
}

function guessAuthor() {
  // Instagram post author
  const sel = [
    'header a._aaqt',            // old class
    'header a[href*="/"][role]',  // generic profile link in header
    'article header a',
  ];
  for (const s of sel) {
    const el = document.querySelector(s);
    if (el?.textContent?.trim()) return el.textContent.trim();
  }
  return '';
}

function position(img) {
  const r = img.getBoundingClientRect();
  const b = getBtn();
  b.style.display = 'flex';
  // top-right corner, 8px inset
  b.style.top  = `${r.top  + 8}px`;
  b.style.left = `${r.right - 8}px`;
  b.style.transform = 'translateX(-100%)';
}

function scheduleHide() {
  hideTimer = setTimeout(() => {
    if (btn) btn.style.display = 'none';
    currentImg = null;
  }, 280);
}

function handleSave(e) {
  e.stopPropagation();
  e.preventDefault();
  if (!currentImg) return;

  const imageUrl = bestUrl(currentImg);
  if (!imageUrl || imageUrl.startsWith('data:')) {
    showFeedback('⚠ Image non supportée', '#fb923c');
    return;
  }

  chrome.runtime.sendMessage({
    action: 'save',
    imageUrl,
    sourceUrl: location.href,
    author: guessAuthor(),
    title: document.title || '',
  });

  showFeedback('✓ Ouverture…', '#4ade80');
}

function showFeedback(text, color) {
  if (!btn) return;
  const prev = btn.innerHTML;
  btn.innerHTML = `<span style="color:${color};font-size:12px">${text}</span>`;
  setTimeout(() => { if (btn) btn.innerHTML = prev; }, 2200);
}

// ── Event listeners ───────────────────────────────────────────────────────────

document.addEventListener('mouseover', (e) => {
  // Ignore our own button
  if (e.target.closest('[data-moodboard]')) return;

  const img = e.target.closest('img');
  if (!img) return;

  // Skip tiny images (icons, avatars)
  const r = img.getBoundingClientRect();
  if (r.width < 80 || r.height < 80) return;

  clearTimeout(hideTimer);
  currentImg = img;
  position(img);
}, { passive: true });

document.addEventListener('mouseout', (e) => {
  if (e.target.closest('[data-moodboard]')) return;
  const img = e.target.closest('img');
  if (!img || img !== currentImg) return;

  // Don't hide if moving onto our button
  const rel = e.relatedTarget;
  if (rel && (rel === btn || btn?.contains(rel))) return;

  scheduleHide();
}, { passive: true });

// Hide on scroll to avoid stale positioning
document.addEventListener('scroll', () => {
  if (btn) btn.style.display = 'none';
  currentImg = null;
}, { passive: true, capture: true });
