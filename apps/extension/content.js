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

// Returns { total: N|null, nextSel } if a carousel is detected, else null
function detectCarousel(img) {
  const nextSel = 'button[aria-label*="Next" i], button[aria-label*="Suivant" i], button[aria-label*="Siguiente" i], button[aria-label*="Weiter" i], button[aria-label*="Avanti" i]';
  if (!document.querySelector(nextSel)) return null;

  let el = img.parentElement;
  for (let d = 0; d < 12; d++) {
    if (!el || ['BODY', 'HTML'].includes(el.tagName)) break;
    const tabs = el.querySelectorAll('[role="tab"]');
    if (tabs.length > 1) return { total: tabs.length, nextSel };
    el = el.parentElement;
  }
  return { total: null, nextSel }; // carousel confirmed but count unknown
}

function buildDropdown() {
  if (!dropdown) return;
  dropdown.innerHTML = '';

  // ── Carousel section ──────────────────────────────────────────────────────
  if (currentImg) {
    const info = detectCarousel(currentImg);
    if (info) {
      const carHeader = document.createElement('div');
      S(carHeader, { padding: '6px 10px 4px', color: 'rgba(255,255,255,0.4)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.08em' });
      carHeader.textContent = 'Carousel';
      dropdown.appendChild(carHeader);

      const carItem = document.createElement('div');
      S(carItem, { padding: '7px 10px', color: 'white', cursor: 'pointer', transition: 'background 0.1s', fontSize: '12px' });
      carItem.textContent = info.total ? `Tout le carousel (${info.total} images)` : 'Tout le carousel';
      carItem.addEventListener('mouseenter', () => { carItem.style.background = 'rgba(255,255,255,0.08)'; });
      carItem.addEventListener('mouseleave', () => { carItem.style.background = ''; });
      carItem.addEventListener('click', (e) => {
        e.stopPropagation();
        dropdown.style.display = 'none';
        const imgRef = currentImg;
        const rc = imgRef.getBoundingClientRect();
        doSaveCarousel(info.total, (rc.left + rc.right) / 2, (rc.top + rc.bottom) / 2, info.nextSel);
      });
      dropdown.appendChild(carItem);

      const sep = document.createElement('div');
      S(sep, { height: '1px', background: 'rgba(255,255,255,0.08)', margin: '4px 0' });
      dropdown.appendChild(sep);
    }
  }

  // ── Moodboard section ─────────────────────────────────────────────────────
  const mbHeader = document.createElement('div');
  S(mbHeader, { padding: '6px 10px 4px', color: 'rgba(255,255,255,0.4)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.08em' });
  mbHeader.textContent = 'Ajouter à une planche';
  dropdown.appendChild(mbHeader);

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

function showStatus(text) {
  if (!wrap) return;
  const main = wrap.querySelector('button:first-child');
  if (main) { main.textContent = text; main.style.color = 'rgba(255,255,255,0.5)'; }
}

async function doSaveCarousel(total, cx, cy, nextSel) {
  const urls = [];
  const seen = new Set();
  const limit = total || 20;

  for (let i = 0; i < limit; i++) {
    showStatus(`Récup. ${i + 1}/${total || '?'}…`);

    if (i > 0) {
      const btn = document.querySelector(nextSel);
      if (!btn) break;
      btn.click();
      await new Promise((res) => setTimeout(res, 550));
    }

    const els = document.elementsFromPoint(cx, cy);
    const img = els.find((el) => el.tagName === 'IMG');
    if (!img) break;

    const url = bestUrl(img);
    if (seen.has(url)) break; // looped back to first slide
    seen.add(url);
    urls.push(url);
  }

  if (urls.length === 0) { showFeedback('✕ Aucune image', '#f87171'); return; }

  showStatus(`Envoi ${urls.length}…`);

  chrome.runtime.sendMessage({
    action: 'saveMany',
    imageUrls: urls,
    sourceUrl: location.href,
    author: guessAuthor(),
    title: document.title || '',
  }, (resp) => {
    if (resp?.ok) {
      const n = resp.saved;
      showFeedback(`✓ ${n}/${urls.length} sauvegardée${n > 1 ? 's' : ''}`, '#4ade80');
      scheduleHide(3500);
    } else {
      showFeedback(`✕ ${resp?.error || 'Erreur'}`, '#f87171');
    }
  });
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
