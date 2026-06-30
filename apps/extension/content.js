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

// ── Metadata extraction ───────────────────────────────────────────────────────

function findCard(img) {
  const vpArea = window.innerWidth * window.innerHeight;
  let el = img.parentElement;
  for (let i = 0; i < 10; i++) {
    if (!el || ['BODY', 'HTML', 'MAIN', 'HEADER', 'FOOTER', 'NAV'].includes(el.tagName)) break;
    const r = el.getBoundingClientRect();
    if (r.width * r.height < vpArea * 0.55 && el.querySelector('h1,h2,h3,h4,h5,h6')) return el;
    el = el.parentElement;
  }
  return null;
}

// ── Site-specific: eyecannndy.com ─────────────────────────────────────────────

// Returns true if the element is inside a navigation/header zone
function inNav(el) {
  return !!el.closest('nav, header, [class*="nav" i], [class*="menu" i], [class*="header" i], [id*="nav" i]');
}

// Deduplicate doubled text inserted by icon spans: "FEATUREDFEATURED" → "FEATURED"
function dedupeText(t) {
  if (t.length % 2 !== 0) return t;
  const half = t.slice(0, t.length / 2);
  return half === t.slice(t.length / 2) ? half : t;
}

function extractEyecandyMeta() {
  const r = { title: '', author: '', description: '', tags: [], year: '' };
  const seen = new Set();

  // ① Heading outside nav/header → title + year
  for (const h of document.querySelectorAll('h1, h2, h3')) {
    if (inNav(h)) continue;
    const full = h.textContent.trim();
    if (!full || full.length < 3) continue;
    const ym = full.match(/\((\d{4})\)/);
    if (ym) r.year = ym[1];
    r.title = full.replace(/\s*\(\d{4}\)\s*/, '').trim();
    break; // first non-nav heading wins
  }

  // ② Description: first long paragraph outside nav, not a metadata row
  const META_ROW = /^(technique|director|dop|cinematographer|editor|colorist|production|composer|camera|original source)\s*[-–:]/i;
  for (const p of document.querySelectorAll('p')) {
    if (inNav(p)) continue;
    const t = p.textContent.trim();
    if (t.length > 60 && !META_ROW.test(t)) { r.description = t.slice(0, 500); break; }
  }

  // ③ Metadata rows: "Label - value, value"
  const SKIP_LABEL = new Set(['original source', 'source']);
  const SKIP_VALUE = new Set(['link', 'here', 'source', 'click here']);

  for (const el of document.querySelectorAll('p, div, li')) {
    if (inNav(el) || el.children.length > 20) continue;
    const raw = el.textContent.trim();
    const m = raw.match(/^(Technique|Director|DOP|Cinematographer|Editor|Colorist|Production Design|Composer|Production|Camera|Original Source)\s*[-–:]\s*/i);
    if (!m) continue;

    const label = m[1].toLowerCase();
    if (SKIP_LABEL.has(label)) continue;

    const links = Array.from(el.querySelectorAll('a')).map(a => a.textContent.trim()).filter(Boolean);
    const values = (links.length ? links : raw.replace(m[0], '').split(',').map(s => s.trim()))
      .filter(v => v && !SKIP_VALUE.has(v.toLowerCase()));

    if (label === 'director') {
      r.author = values.join(', ');
    } else {
      for (const v of values) {
        const key = v.toUpperCase();
        if (!seen.has(key)) { seen.add(key); r.tags.push(v); }
      }
    }
  }

  // ④ Tag pills — look for elements with pill/tag class names, outside nav
  const PILL_SEL = [
    '[class*="tag"i]', '[class*="pill"i]', '[class*="badge"i]',
    '[class*="keyword"i]', '[class*="label"i]',
    'a[href*="/technique/"]', 'a[href*="/tag/"]',
    'a[href*="/keyword/"]', 'a[href*="/mood/"]',
  ].join(', ');

  for (const el of document.querySelectorAll(PILL_SEL)) {
    if (inNav(el)) continue;
    let t = dedupeText(el.textContent.trim());
    if (!t || t.length > 40 || SKIP_VALUE.has(t.toLowerCase())) continue;
    const key = t.toUpperCase();
    if (!seen.has(key)) { seen.add(key); r.tags.push(t); }
  }

  r.tags = [...new Set(r.tags)].slice(0, 25);
  return r;
}

// Site-specific dispatcher
const SITE_EXTRACTORS = {
  'eyecannndy.com': extractEyecandyMeta,
  'eyecandy.com':   extractEyecandyMeta,
};

function extractMetadata(img) {
  try {
    const host = location.hostname.replace(/^www\./, '');

    // Site-specific extractor (bypasses generic logic)
    if (SITE_EXTRACTORS[host]) {
      return SITE_EXTRACTORS[host]();
    }

    const meta = { title: '', author: '', description: '', tags: [], year: '' };

    // 1. JSON-LD structured data
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        let d = JSON.parse(script.textContent);
        if (Array.isArray(d)) d = d[0];
        if (d?.['@graph']) d = d['@graph'][0];
        if (!d) continue;
        meta.title       = meta.title       || String(d.name || d.headline || '');
        meta.author      = meta.author      || String(d.author?.name || d.creator?.name || '');
        meta.description = meta.description || String(d.description || '');
        if (!meta.year && d.datePublished) {
          const y = String(d.datePublished).match(/(\d{4})/);
          if (y) meta.year = y[1];
        }
        const kw = d.keywords;
        if (kw) {
          const list = typeof kw === 'string' ? kw.split(',') : Array.isArray(kw) ? kw : [];
          meta.tags.push(...list.map(k => String(k).trim()).filter(Boolean));
        }
      } catch {}
    }

    // 2. Nearest card/article containing this image
    const card = findCard(img);
    if (card) {
      if (!meta.title) {
        const h = card.querySelector('h1,h2,h3,h4,h5,h6');
        if (h) meta.title = h.textContent.trim();
      }
      if (!meta.description) {
        const p = card.querySelector('p');
        if (p) meta.description = p.textContent.trim().slice(0, 400);
      }
      if (!meta.author) {
        const a = card.querySelector('[rel="author"],[class*="author"],[class*="byline"],[data-author]');
        if (a) meta.author = a.textContent.trim();
      }
      for (const a of card.querySelectorAll('a[href]')) {
        const href = a.getAttribute('href') || '';
        if (/\/(tag|category|technique|style|type|topic|genre|medium|theme)\//i.test(href)) {
          const t = a.textContent.trim();
          if (t && !meta.tags.includes(t)) meta.tags.push(t);
        }
      }
    }

    // 3. Page h1 fallback for title (detail pages where the image isn't inside a card)
    if (!meta.title) {
      const h1 = document.querySelector('h1');
      if (h1) meta.title = h1.textContent.trim();
    }

    // 4. Year from title "(YYYY)"
    if (!meta.year && meta.title) {
      const ym = meta.title.match(/\((\d{4})\)/);
      if (ym) meta.year = ym[1];
    }

    // 5. URL path segments → auto-tags
    const skipWords = new Set(['www','com','html','index','post','article','page','blog','news','en','fr','de','es','it','p','s','r']);
    const existing = new Set(meta.tags.map(t => String(t).toLowerCase()));
    const pathTags = location.pathname.split('/').filter(Boolean)
      .filter(p => !/^\d+$/.test(p) && p.length < 40)
      .map(p => p.replace(/-/g, ' '))
      .filter(t => !skipWords.has(t.toLowerCase()) && !existing.has(t.toLowerCase()))
      .slice(0, 3);
    meta.tags.push(...pathTags);

    // 6. Instagram-specific author
    if (!meta.author && location.hostname.includes('instagram.com')) {
      const a = document.querySelector('header a[href*="/"]');
      if (a) meta.author = a.textContent.trim();
    }

    // 7. Open Graph / meta fallbacks
    if (!meta.title)
      meta.title = document.querySelector('meta[property="og:title"]')?.getAttribute('content')
        || document.querySelector('meta[name="twitter:title"]')?.getAttribute('content')
        || document.title || '';
    if (!meta.description)
      meta.description = document.querySelector('meta[property="og:description"]')?.getAttribute('content')
        || document.querySelector('meta[name="description"]')?.getAttribute('content') || '';
    if (!meta.author)
      meta.author = document.querySelector('meta[name="author"]')?.getAttribute('content')
        || document.querySelector('meta[property="article:author"]')?.getAttribute('content') || '';

    meta.title       = String(meta.title).slice(0, 200).trim();
    meta.description = String(meta.description).slice(0, 500).trim();
    meta.tags        = [...new Set(meta.tags.map(t => String(t).trim()).filter(Boolean))].slice(0, 20);

    return meta;
  } catch {
    return { title: document.title || '', author: '', description: '', tags: [], year: '' };
  }
}

function doSave(moodboardId) {
  if (!currentImg) return;
  const imageUrl = bestUrl(currentImg);
  if (!imageUrl || imageUrl.startsWith('data:')) {
    showFeedback('⚠ Non supporté', '#fb923c');
    return;
  }

  showFeedback('…', 'rgba(255,255,255,0.5)');
  const meta = extractMetadata(currentImg);

  chrome.runtime.sendMessage({
    action: 'save',
    imageUrl,
    sourceUrl: location.href,
    moodboardId: moodboardId || null,
    ...meta,
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

  const meta = extractMetadata(currentImg || document.querySelector('img'));

  chrome.runtime.sendMessage({
    action: 'saveMany',
    imageUrls: urls,
    sourceUrl: location.href,
    ...meta,
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
