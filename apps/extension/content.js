'use strict';

// ── State ─────────────────────────────────────────────────────────────────────
let wrap = null;          // outer container (button + dropdown)
let dropdown = null;      // moodboard picker
let currentImg = null;
let hideTimer = null;
let moodboards = [];      // cached list
let moodboardsLoaded = false;

// ── DOM helpers ───────────────────────────────────────────────────────────────
const S = (el, styles) => Object.assign(el.style, styles);

function makeWrap() {
  const w = document.createElement('div');
  w.setAttribute('data-mb', '1');
  S(w, {
    position: 'fixed',
    zIndex: '2147483647',
    display: 'none',
    alignItems: 'stretch',
    borderRadius: '6px',
    overflow: 'hidden',
    boxShadow: '0 2px 12px rgba(0,0,0,0.5)',
    border: '1px solid rgba(255,255,255,0.12)',
    fontFamily: 'system-ui,-apple-system,sans-serif',
    fontSize: '12px',
    fontWeight: '500',
    userSelect: 'none',
    pointerEvents: 'all',
  });

  // Main save button
  const main = document.createElement('button');
  main.setAttribute('data-mb', '1');
  main.textContent = 'Sauvegarder';
  S(main, {
    background: 'rgba(10,10,10,0.88)',
    backdropFilter: 'blur(6px)',
    color: 'white',
    border: 'none',
    padding: '5px 10px',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    lineHeight: '1.4',
  });
  main.addEventListener('click', (e) => { e.stopPropagation(); doSave(null); });
  main.addEventListener('mouseenter', () => clearTimeout(hideTimer));
  main.addEventListener('mouseleave', onWrapLeave);

  // Dropdown arrow button
  const arrow = document.createElement('button');
  arrow.setAttribute('data-mb', '1');
  arrow.innerHTML = '&#9660;';
  S(arrow, {
    background: 'rgba(30,30,30,0.88)',
    backdropFilter: 'blur(6px)',
    color: 'rgba(255,255,255,0.7)',
    border: 'none',
    borderLeft: '1px solid rgba(255,255,255,0.1)',
    padding: '5px 7px',
    cursor: 'pointer',
    lineHeight: '1.4',
    fontSize: '9px',
  });
  arrow.addEventListener('click', (e) => { e.stopPropagation(); toggleDropdown(); });
  arrow.addEventListener('mouseenter', () => clearTimeout(hideTimer));
  arrow.addEventListener('mouseleave', onWrapLeave);

  w.appendChild(main);
  w.appendChild(arrow);
  document.documentElement.appendChild(w);
  return { wrap: w, main, arrow };
}

function makeDropdown() {
  const d = document.createElement('div');
  d.setAttribute('data-mb', '1');
  S(d, {
    position: 'fixed',
    zIndex: '2147483646',
    display: 'none',
    flexDirection: 'column',
    background: 'rgba(18,18,18,0.96)',
    backdropFilter: 'blur(8px)',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: '6px',
    boxShadow: '0 4px 16px rgba(0,0,0,0.6)',
    minWidth: '180px',
    maxHeight: '220px',
    overflowY: 'auto',
    fontFamily: 'system-ui,-apple-system,sans-serif',
    fontSize: '12px',
    pointerEvents: 'all',
  });
  d.addEventListener('mouseenter', () => clearTimeout(hideTimer));
  d.addEventListener('mouseleave', onWrapLeave);
  document.documentElement.appendChild(d);
  return d;
}

// ── Positioning ───────────────────────────────────────────────────────────────
function position(img) {
  const r = img.getBoundingClientRect();
  if (!wrap) {
    const els = makeWrap();
    wrap = els.wrap;
  }
  if (!dropdown) dropdown = makeDropdown();
  wrap.style.display = 'flex';
  dropdown.style.display = 'none';
  wrap.style.top  = `${r.top + 8}px`;
  wrap.style.left = `${r.right - 8}px`;
  wrap.style.transform = 'translateX(-100%)';
}

function positionDropdown() {
  if (!wrap || !dropdown) return;
  const wr = wrap.getBoundingClientRect();
  dropdown.style.top  = `${wr.bottom + 4}px`;
  dropdown.style.left = `${wr.left}px`;
}

// ── Moodboard dropdown ────────────────────────────────────────────────────────
function toggleDropdown() {
  if (!dropdown) return;
  const open = dropdown.style.display === 'flex';
  if (open) { dropdown.style.display = 'none'; return; }

  buildDropdown();
  positionDropdown();
  dropdown.style.display = 'flex';

  if (!moodboardsLoaded) {
    moodboardsLoaded = true;
    chrome.runtime.sendMessage({ action: 'getMoodboards' }, (boards) => {
      moodboards = boards || [];
      buildDropdown();
    });
  }
}

function buildDropdown() {
  if (!dropdown) return;
  dropdown.innerHTML = '';

  const header = document.createElement('div');
  S(header, { padding: '6px 10px 4px', color: 'rgba(255,255,255,0.4)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.08em' });
  header.textContent = 'Ajouter à une planche';
  dropdown.appendChild(header);

  if (moodboards.length === 0) {
    const empty = document.createElement('div');
    S(empty, { padding: '8px 10px', color: 'rgba(255,255,255,0.4)', fontStyle: 'italic' });
    empty.textContent = moodboardsLoaded ? 'Aucune planche' : 'Chargement…';
    dropdown.appendChild(empty);
    return;
  }

  moodboards.forEach((mb) => {
    const item = document.createElement('div');
    S(item, { padding: '7px 10px', color: 'white', cursor: 'pointer', transition: 'background 0.1s' });
    item.textContent = mb.title || 'Sans titre';
    item.addEventListener('mouseenter', () => { item.style.background = 'rgba(255,255,255,0.08)'; });
    item.addEventListener('mouseleave', () => { item.style.background = ''; });
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdown.style.display = 'none';
      doSave(mb.id);
    });
    dropdown.appendChild(item);
  });
}

// ── Save logic ────────────────────────────────────────────────────────────────
function bestUrl(img) {
  if (!img.srcset) return img.currentSrc || img.src;
  const parts = img.srcset.split(',').map((s) => {
    const [url, w] = s.trim().split(/\s+/);
    return { url, w: parseInt(w || '0') };
  });
  parts.sort((a, b) => b.w - a.w);
  return parts[0]?.url || img.src;
}

function guessAuthor() {
  for (const sel of ['article header a', 'header a[href*="/"]']) {
    const el = document.querySelector(sel);
    if (el?.textContent?.trim()) return el.textContent.trim();
  }
  return '';
}

function doSave(moodboardId) {
  if (!currentImg) return;
  const imageUrl = bestUrl(currentImg);
  if (!imageUrl || imageUrl.startsWith('data:')) {
    showFeedback('⚠ Non supporté', '#fb923c');
    return;
  }

  showFeedback('…', 'rgba(255,255,255,0.5)');

  chrome.runtime.sendMessage({
    action: 'save',
    imageUrl,
    sourceUrl: location.href,
    author: guessAuthor(),
    title: document.title || '',
    moodboardId: moodboardId || null,
  }, (resp) => {
    if (resp?.ok) {
      showFeedback(moodboardId ? '✓ Dans la planche' : '✓ Sauvegardé', '#4ade80');
      scheduleHide(2200);
    } else if (resp?.error === 'no_token') {
      showFeedback('⚠ Token manquant', '#fb923c');
    } else {
      const msg = resp?.error ? String(resp.error).slice(0, 28) : 'Erreur';
      showFeedback(`✕ ${msg}`, '#f87171');
    }
  });
}

function showFeedback(text, color) {
  if (!wrap) return;
  const main = wrap.querySelector('button:first-child');
  if (main) { main.textContent = text; main.style.color = color; }
  setTimeout(() => { if (main) { main.textContent = 'Sauvegarder'; main.style.color = 'white'; } }, 2200);
}

// ── Hide logic ────────────────────────────────────────────────────────────────
function scheduleHide(delay = 280) {
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    // Cancel if cursor is still over any part of our UI
    if (document.querySelector('[data-mb]:hover')) return;
    if (wrap) wrap.style.display = 'none';
    if (dropdown) dropdown.style.display = 'none';
    currentImg = null;
  }, delay);
}

function onWrapLeave() { scheduleHide(); }

// ── Event listeners ───────────────────────────────────────────────────────────
document.addEventListener('mouseover', (e) => {
  if (e.target.closest('[data-mb]')) return;

  // Direct hit on an <img>
  let img = e.target.closest('img');

  // Fallback: overlay div covering the image (Instagram carousel, Pinterest, etc.)
  if (!img) {
    const els = document.elementsFromPoint(e.clientX, e.clientY);
    img = els.find((el) => el.tagName === 'IMG') || null;
  }

  if (!img) return;
  const r = img.getBoundingClientRect();
  if (r.width < 80 || r.height < 80) return;
  clearTimeout(hideTimer);
  currentImg = img;
  position(img);
}, { passive: true });

document.addEventListener('mouseout', (e) => {
  if (e.target.closest('[data-mb]')) return;
  const img = e.target.closest('img');
  if (!img || img !== currentImg) return;
  const rel = e.relatedTarget;
  if (rel && rel.closest('[data-mb]')) return;
  scheduleHide();
}, { passive: true });

document.addEventListener('scroll', (e) => {
  // Ignore scroll events originating inside our own dropdown
  if (e.target instanceof Element && e.target.closest('[data-mb]')) return;
  if (wrap) wrap.style.display = 'none';
  if (dropdown) dropdown.style.display = 'none';
  currentImg = null;
}, { passive: true, capture: true });
