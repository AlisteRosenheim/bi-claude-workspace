/* Tarot Reader — app shell, views and actions. */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => { const a = new Uint8Array(12); crypto.getRandomValues(a); return [...a].map(b => b.toString(16).padStart(2, '0')).join(''); };
const nat = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
const stripExt = f => String(f || '').replace(/^.*[\\/]/, '').replace(/\.[a-z0-9]+$/i, '');
// Let the screen repaint before heavy work; the timeout covers hidden/background tabs where frames pause.
const nextFrame = () => new Promise(r => { let done = false; const go = () => { if (!done) { done = true; r(); } }; requestAnimationFrame(() => setTimeout(go, 0)); setTimeout(go, 60); });
const blobUrls = new WeakMap();
const urlOf = b => { if (!b) return ''; let u = blobUrls.get(b); if (!u) { u = URL.createObjectURL(b); blobUrls.set(b, u); } return u; };
const fmtDate = t => new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

const S = {
  cards: [], spreads: [], readings: [], settings: { key: 'main' },
  tab: 'read', session: null, draftQuestion: '', editCard: null, editSpread: null, openReading: null, detIndex: -1,
};
const view = () => $('#view');
const cardById = id => S.cards.find(c => c.id === id);
const spreadById = id => S.spreads.find(s => s.id === id);
const sortCards = () => S.cards.sort((a, b) => (a.order ?? 1e9) - (b.order ?? 1e9) || nat(a.name, b.name));
const nextOrder = () => S.cards.reduce((m, c) => Math.max(m, c.order ?? 0), 0) + 1;
const newCard = f => ({ id: uid(), name: '', group: '', keywords: '', reversedKeywords: '', description: '', upright: '', reversed: '', source: '', imageFile: '', image: null, thumb: null, feat: null, order: nextOrder(), ...f });
const saveSettings = () => DB.put('settings', S.settings);

// ---------- feedback ----------
let toastTimer;
function toast(msg, ms = 3200) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}
function busy(msg) {
  const b = $('#busy');
  if (msg) { $('#busy-msg').textContent = msg; b.hidden = false; } else b.hidden = true;
}

// ---------- images ----------
/** Decode an image file, honouring the phone camera's rotation (EXIF). */
async function loadImage(blob) {
  try { return await createImageBitmap(blob, { imageOrientation: 'from-image' }); }
  catch (e) { /* fall back for formats createImageBitmap can't read */ }
  const img = new Image(), url = URL.createObjectURL(blob); img.src = url;
  try { await img.decode(); return img; } catch (e) { throw new Error('not a readable image'); }
  finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
const imgW = img => img.naturalWidth || img.width, imgH = img => img.naturalHeight || img.height;
const freeImage = img => { if (img.close) img.close(); };
function drawScaled(img, maxSide, rotate) {
  const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
  const k = Math.min(1, maxSide / Math.max(w, h)), cw = Math.round(w * k), ch = Math.round(h * k);
  const c = document.createElement('canvas');
  if (rotate) { c.width = ch; c.height = cw; } else { c.width = cw; c.height = ch; }
  const g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingQuality = 'high';
  if (rotate) { g.translate(c.width, 0); g.rotate(Math.PI / 2); }
  g.drawImage(img, 0, 0, cw, ch);
  return c;
}
const canvasBlob = (c, q = 0.88) => new Promise(r => c.toBlob(r, 'image/jpeg', q));
/** Store a resized copy, a thumbnail and the recognition fingerprint. */
async function processArt(blob) {
  const img = await loadImage(blob);
  try {
    const rotate = imgW(img) > imgH(img) * 1.05;
    return {
      image: await canvasBlob(drawScaled(img, 1400, rotate), 0.9),
      thumb: await canvasBlob(drawScaled(img, 360, rotate), 0.85),
      feat: Vision.features(Vision.canonicalFromImage(img, rotate)),
    };
  } finally { freeImage(img); }
}
async function ensureFeatures() {
  const todo = S.cards.filter(c => c.image && (!c.feat || c.feat.v !== Vision.FEAT_VERSION || !c.thumb));
  for (let i = 0; i < todo.length; i++) {
    busy(`Preparing card art for recognition… ${i + 1}/${todo.length}`);
    try { Object.assign(todo[i], await processArt(todo[i].image)); await DB.put('cards', todo[i]); } catch (e) { console.warn(e); }
  }
  busy(false);
}
const blobToDataURL = b => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(b); });
function dataURLToBlob(du) {
  if (!du) return null;
  const [h, b] = du.split(','), mime = (h.match(/:(.*?);/) || [])[1] || 'image/jpeg', bin = atob(b);
  const arr = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}
const NATIVE = window.TarotNative;   // set when running inside the Android app
async function download(blob, name) {
  if (NATIVE) {
    // Stream to the Android shell in base64 chunks (multiple of 3 bytes so each decodes alone).
    const buf = new Uint8Array(await blob.arrayBuffer()), CH = 3 * 128 * 1024;
    if (!NATIVE.saveBegin(name, blob.type || 'application/octet-stream')) return toast('Could not save the file.');
    for (let i = 0; i < buf.length; i += CH) {
      const part = buf.subarray(i, i + CH); let s = '';
      for (let k = 0; k < part.length; k += 8192) s += String.fromCharCode.apply(null, part.subarray(k, k + 8192));
      if (!NATIVE.saveChunk(btoa(s))) return toast('Could not save the file.');
    }
    NATIVE.saveEnd();
    return;
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
const readText = f => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsText(f); });

// ---------- default spreads ----------
const DEFAULT_SPREADS = [
  { name: 'Single card', description: 'One card for a quick answer or a daily focus.',
    positions: [{ label: 'The card', meaning: 'The main message or energy around your question.', x: 0, y: 0 }] },
  { name: 'Past · Present · Future', description: 'Three cards in a row showing how a situation is moving.',
    positions: [
      { label: 'Past', meaning: 'What led to this situation.', x: -0.75, y: 0 },
      { label: 'Present', meaning: 'Where things stand now.', x: 0, y: 0 },
      { label: 'Future', meaning: 'Where things are heading if nothing changes.', x: 0.75, y: 0 }] },
  { name: 'Celtic Cross', description: 'A ten-card spread for a full look at a situation.',
    positions: [
      { label: 'Present', meaning: 'The heart of the matter right now.', x: 0, y: 0 },
      { label: 'Challenge', meaning: 'What crosses you — the obstacle or tension.', x: 0, y: 0, rot: true },
      { label: 'Foundation', meaning: 'The root or hidden basis of the situation.', x: 0, y: 1.15 },
      { label: 'Recent past', meaning: 'What is passing out of your life.', x: -0.95, y: 0 },
      { label: 'Potential', meaning: 'The best that can come of this; your conscious aim.', x: 0, y: -1.15 },
      { label: 'Near future', meaning: 'What is coming next.', x: 0.95, y: 0 },
      { label: 'Self', meaning: 'Your attitude and how you see yourself in this.', x: 2.1, y: 1.72 },
      { label: 'Environment', meaning: 'Other people and outside influences.', x: 2.1, y: 0.575 },
      { label: 'Hopes & fears', meaning: 'What you hope for or are afraid of.', x: 2.1, y: -0.575 },
      { label: 'Outcome', meaning: 'Where this is likely to lead.', x: 2.1, y: -1.72 }] },
];

async function load() {
  await DB.open();
  [S.cards, S.spreads, S.readings] = await Promise.all([DB.all('cards'), DB.all('spreads'), DB.all('readings')]);
  S.settings = (await DB.get('settings', 'main')) || { key: 'main' };
  if (!S.settings.seeded) {
    const seeded = DEFAULT_SPREADS.map(s => ({ id: uid(), ...s, positions: s.positions.map(p => ({ rot: false, ...p })) }));
    await DB.putMany('spreads', seeded); S.spreads.push(...seeded);
    S.settings.seeded = true; await saveSettings();
  }
  sortCards();
}

// ---------- shell ----------
const ICONS = {
  read: '<path d="M12 2l2.4 6.9H22l-6 4.6 2.3 7L12 16l-6.3 4.5 2.3-7-6-4.6h7.6z"/>',
  cards: '<rect x="4" y="3" width="11" height="16" rx="2"/><path d="M18 6.5l2 .6-4 13.4-7-2"/>',
  spreads: '<rect x="2" y="7" width="6" height="10" rx="1"/><rect x="9" y="7" width="6" height="10" rx="1"/><rect x="16" y="7" width="6" height="10" rx="1"/>',
  journal: '<path d="M5 3h12a2 2 0 012 2v16H7a2 2 0 01-2-2z"/><path d="M9 8h6M9 12h6"/>',
  setup: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9L7 7M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
};
const TABS = [['read', 'Read'], ['cards', 'Cards'], ['spreads', 'Spreads'], ['journal', 'Journal'], ['setup', 'Setup']];
function renderNav() {
  $('#nav').innerHTML = TABS.map(([id, label]) =>
    `<button class="${S.tab === id ? 'on' : ''}" data-act="tab" data-tab="${id}"><svg viewBox="0 0 24 24">${ICONS[id]}</svg><span>${label}</span></button>`).join('');
}
function render() {
  renderNav();
  ({ read: renderRead, cards: renderCards, spreads: renderSpreads, journal: renderJournal, setup: renderSetup })[S.tab]();
}

// ---------- READ ----------
function renderRead() {
  if (S.session) return renderResult();
  if (S.manual) return renderManual();
  const ready = S.cards.filter(c => c.feat).length;
  view().innerHTML = `
  <section class="hero">
    <div class="sigil">✦</div>
    <h2>Read a spread</h2>
    <p class="muted">Lay out your cards, take a clear photo from straight above, and the app will recognise each card and the spread.</p>
    ${ready ? `<p class="muted small">${ready} cards ready · ${S.spreads.length} spreads saved</p>`
      : `<div class="notice">Your deck has no card art yet. Add your card images in <button class="link" data-act="tab" data-tab="setup">Setup</button> first.</div>`}
    <label class="field"><span>Your question (optional)</span><input data-input="draftQ" value="${esc(S.draftQuestion)}" placeholder="What would you like guidance on?"></label>
    <div class="row center">
      <button class="btn primary big" data-act="pick" data-target="fCamera">Take photo</button>
      <button class="btn big" data-act="pick" data-target="fGallery">Choose photo</button>
    </div>
    <p class="muted small or">Can't get a clear photo?</p>
    <button class="btn" data-act="manualStart" ${S.spreads.length && S.cards.length ? '' : 'disabled'}>Choose the cards by hand</button>
    <details class="tips"><summary>Tips for good recognition</summary>
      <ul>
        <li>Shoot from directly above, with the whole spread in the frame.</li>
        <li>Use a plain surface that contrasts with the cards' edges.</li>
        <li>Leave a small gap between cards (a crossing card on top is fine).</li>
        <li>Avoid strong glare and shadows across the cards.</li>
        <li>Hold the phone so the top of the cards points to the top of the photo.</li>
      </ul>
    </details>
  </section>`;
}

async function startReading(file) {
  busy('Finding your cards…'); await nextFrame();
  try {
    const img = await loadImage(file);
    const hiC = drawScaled(img, 1600, false); freeImage(img);
    const loC = drawScaled(hiC, DETECT_SIZE, false);
    const hi = hiC.getContext('2d').getImageData(0, 0, hiC.width, hiC.height);
    const lo = loC.getContext('2d').getImageData(0, 0, loC.width, loC.height);
    const photoBlob = await canvasBlob(hiC, 0.85);
    S.session = { photoBlob, photoURL: URL.createObjectURL(photoBlob), hi, lo, k: hi.width / lo.width, W: hi.width, H: hi.height,
      dets: [], sens: 1, question: S.draftQuestion, notes: '', locked: false, addMode: false, saved: false };
    busy('Recognising cards…'); await nextFrame();
    runDetection();
  } catch (e) { console.error(e); toast('Could not read that photo: ' + e.message); }
  busy(false); render();
}
let DETECT_SIZE = 960;   // longest side of the image used to find cards
/** Try each detection setting and keep the one whose boxes look most like known cards. */
function runDetection() {
  const s = S.session; let best = null;
  for (const cfg of Vision.CFGS) {
    const r = Vision.detect(s.lo, s.sens, cfg);
    let dets = r.dets.map(d => ({ ...d, cx: d.cx * s.k, cy: d.cy * s.k, L: d.L * s.k, S: d.S * s.k }));
    dets.forEach(identifyDet);
    // With a real deck saved, a box that resembles none of the cards is table texture, not a card.
    if (S.cards.filter(c => c.feat).length >= 5) dets = dets.filter(d => d.matches.length && d.matches[0].score >= 0.25);
    const quality = dets.reduce((q, d) => q + (d.matches.length && d.matches[0].score > 0.55 ? d.matches[0].score : -0.4), 0);
    if (!best || quality > best.quality + 0.01) best = { quality, dets, r };
  }
  s.cardL = best.r.cardL * s.k; s.cardS = best.r.cardS * s.k; s.dets = best.dets;
  assignCards(); rankSpreads();
}
function identifyDet(d) { d.matches = Vision.identifyDet(S.session.hi, d, S.cards); }
/** Give each box its best card, never using the same card twice. */
function assignCards() {
  const s = S.session, used = new Set(s.dets.filter(d => d.manual && d.cardId).map(d => d.cardId)), pairs = [];
  s.dets.forEach((d, i) => { if (d.manual) return; d.cardId = null; d.matches.forEach(m => pairs.push({ i, m })); });
  pairs.sort((a, b) => b.m.score - a.m.score);
  for (const { i, m } of pairs) {
    const d = s.dets[i];
    if (d.cardId || used.has(m.id)) continue;
    d.cardId = m.id; d.flipped = m.flipped; d.score = m.score; used.add(m.id);
  }
  s.dets.forEach(d => { if (!d.manual) { d.reversed = !d.sideways && !!d.flipped; d.conf = confidence(d); } });
}
function confidence(d) {
  if (!d.cardId) return 'low';
  const other = d.matches.find(m => m.id !== d.cardId), margin = d.score - (other ? other.score : 0);
  if ((d.score > 0.6 && margin > 0.08) || (d.score > 0.85 && margin > 0.03)) return 'high';
  if (d.score > 0.45 && margin > 0.03) return 'medium';
  return 'low';
}
const lastUsed = id => (S.settings.spreadUse || {})[id] || 0;
function rankSpreads() {
  const s = S.session;
  s.ranks = S.spreads.map(sp => ({ id: sp.id, r: Vision.matchSpread(s.dets, sp.positions) })).filter(x => x.r)
    .sort((a, b) => Math.abs(a.r.score - b.r.score) < 0.02 ? lastUsed(b.id) - lastUsed(a.id) : a.r.score - b.r.score);
  if (!s.locked) s.spreadId = s.ranks.length ? s.ranks[0].id : '';
  applySpread();
}
function applySpread() {
  const s = S.session, sp = spreadById(s.spreadId);
  if (sp && s.dets.length) { s.fit = Vision.matchSpread(s.dets, sp.positions); s.assign = s.fit.assign; }
  else { s.fit = null; s.assign = []; Vision.readingOrder(s.dets).forEach((di, k) => { s.assign[di] = k; }); }
}
function spreadQuality(s) {
  const f = s.fit, sp = spreadById(s.spreadId);
  if (!f || !sp) return null;
  if (f.countDiff) {
    const more = s.dets.length > sp.positions.length;
    return { cls: 'low', text: `${f.countDiff} card${f.countDiff > 1 ? 's' : ''} ${more ? 'more' : 'fewer'} than this spread` };
  }
  if (f.rms < 0.3 && !f.sideMiss) return { cls: 'high', text: 'Clear match' };
  if (f.rms < 0.6) return { cls: 'medium', text: 'Likely match' };
  return { cls: 'low', text: 'Unsure — check the spread' };
}
function corners(d) {
  const vx = d.uy, vy = -d.ux, a = d.L / 2, b = d.S / 2;
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sv, su]) => [d.cx + vx * b * sv + d.ux * a * su, d.cy + vy * b * sv + d.uy * a * su].map(v => v.toFixed(1)));
}
function overlaySVG(s) {
  const g = s.dets.map((d, i) => {
    const j = s.assign[i], num = j >= 0 ? j + 1 : '?', r = Math.max(14, d.S * 0.17);
    const off = d.sideways ? d.L * 0.34 : 0, lx = d.cx + d.ux * off, ly = d.cy + d.uy * off;
    return `<g class="det ${d.conf}" data-act="det" data-i="${i}">
      <polygon points="${corners(d).map(p => p.join(',')).join(' ')}"/>
      <circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="${r.toFixed(1)}"/>
      <text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" font-size="${(r * 1.1).toFixed(1)}">${num}</text></g>`;
  }).join('');
  return `<svg viewBox="0 0 ${s.W} ${s.H}" data-act="photo" style="--sw:${Math.max(2, s.W / 320).toFixed(1)}">${g}</svg>`;
}
function interpHTML({ num, pos, card, reversed, di, missing, extra, act, hint }) {
  if (missing) return `<article class="interp missing">
    <div class="pos"><span class="num">${num}</span><div><div class="pos-label">${esc(pos.label)}</div>${pos.meaning ? `<div class="pos-meaning">${esc(pos.meaning)}</div>` : ''}</div></div>
    ${act ? `<button class="btn" ${act}>Choose the card</button>` : `<p class="muted small">${hint || 'No card was found for this position. Use “Add a missed card” and tap it on the photo.'}</p>`}</article>`;
  const img = card && card.thumb ? `<img src="${urlOf(card.thumb)}" alt="" class="${reversed ? 'rev' : ''}">` : '<div class="ph">?</div>';
  let meaning;
  if (!card) meaning = '<em>Tap the card to choose which one it is.</em>';
  else if (reversed && card.reversed) meaning = esc(card.reversed);
  else if (reversed && card.upright) meaning = `<em>No reversed meaning saved — upright meaning:</em>\n${esc(card.upright)}`;
  else if (card.upright) meaning = esc(card.upright);
  else meaning = '<em>No meaning saved for this card yet.</em>';
  return `<article class="interp ${extra ? 'extra' : ''}">
    <div class="pos"><span class="num">${num}</span><div><div class="pos-label">${esc(pos.label)}</div>${pos.meaning ? `<div class="pos-meaning">${esc(pos.meaning)}</div>` : ''}</div></div>
    <div class="interp-body">
      <button class="thumb" ${act || (di != null ? `data-act="det" data-i="${di}"` : 'tabindex="-1"')}>${img}</button>
      <div class="interp-text">
        <h3>${card ? esc(card.name) : 'Unknown card'}${reversed ? ' <span class="tag rev">Reversed</span>' : ''}</h3>
        ${(() => { const kw = card && (reversed ? card.reversedKeywords : card.keywords); return kw ? `<p class="kw">${esc(kw)}</p>` : ''; })()}
        ${card && card.description ? `<h4>Symbolism</h4><p class="txt">${esc(card.description)}</p>` : ''}
        <h4>Meaning${reversed ? ' (reversed)' : ''}</h4><p class="txt">${meaning}</p>
        ${card && card.source ? `<p class="src">Source: ${esc(card.source)}</p>` : ''}
      </div>
    </div></article>`;
}
function sessionItems(s) {
  const sp = spreadById(s.spreadId), n = sp ? sp.positions.length : s.dets.length, items = [];
  for (let j = 0; j < n; j++) {
    const di = s.assign.indexOf(j), d = s.dets[di];
    const pos = sp ? sp.positions[j] : { label: `Card ${j + 1}`, meaning: '' };
    items.push({ num: j + 1, pos, di: di >= 0 ? di : null, card: d ? cardById(d.cardId) : null, reversed: d ? !!d.reversed : false, missing: !d });
  }
  s.assign.forEach((j, i) => {
    if (j < 0) items.push({ num: '+', pos: { label: 'Extra card', meaning: 'Not part of this spread.' }, di: i, card: cardById(s.dets[i].cardId), reversed: !!s.dets[i].reversed, extra: true });
  });
  return items;
}
function renderResult() {
  const s = S.session, q = spreadQuality(s);
  const ranked = s.ranks.map(r => spreadById(r.id)).filter(Boolean);
  const opts = ranked.map(sp => `<option value="${sp.id}" ${sp.id === s.spreadId ? 'selected' : ''}>${esc(sp.name)} (${sp.positions.length})</option>`).join('')
    + `<option value="" ${!s.spreadId ? 'selected' : ''}>No spread — read left to right</option>`;
  const best = s.ranks.find(r => r.id === s.spreadId);
  const twins = best ? s.ranks.filter(r => r.id !== s.spreadId && !r.r.countDiff && Math.abs(r.r.score - best.r.score) < 0.05).map(r => spreadById(r.id).name) : [];
  const unsure = s.dets.filter(d => d.conf !== 'high').length;
  const items = sessionItems(s);
  view().innerHTML = `
  <section class="result">
    <div class="panel">
      <div class="spread-pick">
        <label for="spreadSel">Spread</label>
        <select id="spreadSel" data-change="pickSpread">${opts}</select>
        ${q ? `<span class="badge ${q.cls}">${q.text}</span>` : ''}
      </div>
      ${twins.length ? `<p class="hint">Same layout as: ${twins.map(esc).join(', ')}. Pick the right one above if needed.</p>` : ''}
      <div class="photo-wrap ${s.addMode ? 'adding' : ''}"><img src="${s.photoURL}" alt="Your spread">${overlaySVG(s)}</div>
      <div class="row wrap">
        <button class="btn ${s.addMode ? 'primary' : ''}" data-act="addMode">${s.addMode ? 'Now tap the missed card…' : '+ Add a missed card'}</button>
        <label class="sens">Detection <input type="range" min="0.5" max="1.8" step="0.1" value="${s.sens}" data-change="sens" aria-label="Detection sensitivity"></label>
      </div>
      <p class="muted small">${s.dets.length} card${s.dets.length === 1 ? '' : 's'} found.
        ${unsure ? `<span class="warn">${unsure} need${unsure === 1 ? 's' : ''} a check</span> — tap amber or red boxes to confirm the card.` : 'Tap any box to change the card or its direction.'}</p>
    </div>
    <label class="field"><span>Question</span><input data-input="sessQ" value="${esc(s.question)}" placeholder="(optional)"></label>
    <div class="reading">${items.map(interpHTML).join('')}</div>
    <div class="panel">
      <label class="field"><span>Your notes</span><textarea rows="3" data-input="sessNotes" placeholder="Thoughts, feelings, what stood out…">${esc(s.notes)}</textarea></label>
      <div class="row">
        <button class="btn primary" data-act="saveReading">${s.saved ? 'Saved ✓ — update' : 'Save to journal'}</button>
        <button class="btn" data-act="newReading">New reading</button>
      </div>
    </div>
  </section>`;
}
function openDet(i) {
  const s = S.session, d = s.dets[i], sp = spreadById(s.spreadId), j = s.assign[i];
  S.detIndex = i;
  const posName = j >= 0 ? `${j + 1} · ${sp ? sp.positions[j].label : 'Card ' + (j + 1)}` : 'Extra card';
  const cur = cardById(d.cardId);
  const pick = (c, score) => `<button class="pick ${c.id === d.cardId ? 'on' : ''}" data-act="detPick" data-id="${c.id}">
      ${c.thumb ? `<img src="${urlOf(c.thumb)}" alt="">` : '<div class="ph">?</div>'}<span>${esc(c.name)}</span>${score != null ? `<small>${Math.round(Math.max(0, score) * 100)}%</small>` : ''}</button>`;
  const dlg = $('#dlg');
  dlg.innerHTML = `
    <div class="dlg-head"><h3>${esc(posName)}</h3><button class="icon" data-act="closeDlg" aria-label="Close">✕</button></div>
    <div class="det-top">
      <div class="crop"><canvas id="crop" width="${Vision.CW}" height="${Vision.CH}"></canvas><small>What the app sees</small></div>
      <div class="col">
        <p>Card: <b>${cur ? esc(cur.name) : 'not recognised'}</b> ${d.manual ? '<span class="tag">chosen by you</span>' : `<span class="tag ${d.conf}">${{ high: 'sure', medium: 'fairly sure', low: 'unsure' }[d.conf]}</span>`}</p>
        <label class="check"><input type="checkbox" data-change="detRev" ${d.reversed ? 'checked' : ''}> Reversed (upside down)</label>
        <div class="row wrap"><button class="btn" data-act="detTurn">Turn box 90°</button><button class="btn danger" data-act="detRemove">Remove box</button></div>
      </div>
    </div>
    <h4>Best matches</h4>
    <div class="pick-grid">${d.matches.map(m => cardById(m.id)).filter(Boolean).map((c, k) => pick(c, d.matches[k].score)).join('') || '<p class="muted small">No card art to compare with yet.</p>'}</div>
    <h4>All cards</h4>
    <input class="search" placeholder="Search cards…" data-input="pickFilter">
    <div class="pick-grid" id="pickAll">${S.cards.map(c => pick(c)).join('')}</div>`;
  dlg.showModal();
  const px = Vision.warp(s.hi, d);
  $('#crop').getContext('2d').putImageData(new ImageData(d.reversed ? Vision.rot180(px) : px, Vision.CW, Vision.CH), 0, 0);
}

// ---------- READ: choosing the cards by hand ----------
function startManual() {
  const recent = [...S.spreads].sort((a, b) => lastUsed(b.id) - lastUsed(a.id))[0];
  S.manual = { spreadId: recent.id, picks: [], question: S.draftQuestion, notes: '', saved: false, group: '' };
  render(); window.scrollTo(0, 0);
}
const manualItems = m => {
  const sp = spreadById(m.spreadId);
  return sp ? sp.positions.map((pos, j) => ({ j, pos, pick: m.picks[j], card: m.picks[j] && cardById(m.picks[j].cardId) })) : [];
};
/** The spread drawn as its layout, each position showing the chosen card (turned if reversed). */
function boardHTML(m) {
  const sp = spreadById(m.spreadId); if (!sp || !sp.positions.length) return '';
  const ext = p => p.rot ? [0.5, 0.31] : [0.31, 0.5];
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  sp.positions.forEach(p => { const [hx, hy] = ext(p); x0 = Math.min(x0, p.x - hx); x1 = Math.max(x1, p.x + hx); y0 = Math.min(y0, p.y - hy); y1 = Math.max(y1, p.y + hy); });
  const pad = 0.12, W = x1 - x0 + 2 * pad, H = y1 - y0 + 2 * pad;
  // Positions are placed in % of the board so it scales with the screen; crossing cards sit on top.
  const slots = sp.positions.map((p, j) => {
    const [hx, hy] = ext(p), pick = m.picks[j], card = pick && cardById(pick.cardId);
    const img = card && card.thumb ? `<img src="${urlOf(card.thumb)}" alt="" style="transform:translate(-50%,-50%) rotate(${(p.rot ? 90 : 0) + (pick.reversed ? 180 : 0)}deg)${p.rot ? `;width:${hy / hx * 100}%;height:${hx / hy * 100}%` : ''}">` : '';
    return `<button class="bslot ${card ? 'filled' : ''} ${p.rot ? 'rot' : ''}" data-act="manPick" data-j="${j}" aria-label="Position ${j + 1}: ${esc(p.label)}"
      style="left:${(p.x - hx - x0 + pad) / W * 100}%;top:${(p.y - hy - y0 + pad) / H * 100}%;width:${2 * hx / W * 100}%;height:${2 * hy / H * 100}%;z-index:${p.rot ? 2 : 1}">
      ${img}<span class="bnum">${j + 1}</span>${card ? '' : `<small>${esc(p.label)}</small>`}</button>`;
  }).join('');
  return `<div class="board" style="aspect-ratio:${W.toFixed(3)} / ${H.toFixed(3)}">${slots}</div>`;
}
function renderManual() {
  const m = S.manual, items = manualItems(m), filled = items.filter(it => it.card).length;
  const opts = S.spreads.map(sp => `<option value="${sp.id}" ${sp.id === m.spreadId ? 'selected' : ''}>${esc(sp.name)} (${sp.positions.length})</option>`).join('');
  view().innerHTML = `
  <section class="result">
    <div class="panel">
      <div class="spread-pick"><label for="manSpread">Spread</label><select id="manSpread" data-change="manSpread">${opts}</select></div>
      <p class="muted small">Tap a position to choose its card and whether it's upright or reversed.</p>
      ${boardHTML(m)}
      <p class="muted small">${filled} of ${items.length} cards chosen</p>
    </div>
    <label class="field"><span>Question</span><input data-input="manQ" value="${esc(m.question)}" placeholder="(optional)"></label>
    <div class="reading">${items.map(it => interpHTML({ num: it.j + 1, pos: it.pos, card: it.card, reversed: !!(it.pick && it.pick.reversed), missing: !it.card, act: `data-act="manPick" data-j="${it.j}"` })).join('')}</div>
    <div class="panel">
      <label class="field"><span>Your notes</span><textarea rows="3" data-input="manNotes" placeholder="Thoughts, feelings, what stood out…">${esc(m.notes)}</textarea></label>
      <div class="row">
        <button class="btn primary" data-act="manSave" ${filled ? '' : 'disabled'}>${m.saved ? 'Saved ✓ — update' : 'Save to journal'}</button>
        <button class="btn" data-act="newReading">New reading</button>
      </div>
    </div>
  </section>`;
}
const GROUPS = [['', 'All'], ['major', 'Major'], ['wands', 'Wands'], ['cups', 'Cups'], ['swords', 'Swords'], ['pentacles', 'Pentacles']];
/** Card chooser for one position: orientation, suit filter, search, and the cards. */
function openManPick(j) {
  const m = S.manual, sp = spreadById(m.spreadId), pos = sp.positions[j], cur = m.picks[j];
  S.manJ = j;
  if (S.manRev == null || S.manRevFor !== j) { S.manRev = cur ? !!cur.reversed : false; S.manRevFor = j; }
  const usedAt = new Map(); m.picks.forEach((p, k) => { if (p && k !== j) usedAt.set(p.cardId, k + 1); });
  const g = m.group, inGroup = c => !g || (g === 'major' ? /major/i.test(c.group) : new RegExp(g, 'i').test(c.group + ' ' + c.name));
  const dlg = $('#dlg');
  dlg.innerHTML = `
    <div class="dlg-head"><h3>${j + 1} · ${esc(pos.label)}</h3><button class="icon" data-act="closeDlg" aria-label="Close">✕</button></div>
    ${pos.meaning ? `<p class="muted small">${esc(pos.meaning)}</p>` : ''}
    <div class="seg" role="group" aria-label="Orientation">
      <button class="${S.manRev ? '' : 'on'}" data-act="manOrient" data-rev="0">Upright</button>
      <button class="${S.manRev ? 'on' : ''}" data-act="manOrient" data-rev="1">Reversed</button>
    </div>
    <div class="chips pick-chips">${GROUPS.map(([k, label]) => `<button class="${g === k ? 'on' : ''}" data-act="manGroup" data-g="${k}">${label}</button>`).join('')}</div>
    <input class="search" placeholder="Search cards…" data-input="pickFilter">
    <div class="pick-grid" id="pickAll">${S.cards.filter(inGroup).map(c => `
      <button class="pick ${cur && cur.cardId === c.id ? 'on' : ''} ${usedAt.has(c.id) ? 'used' : ''}" data-act="manChoose" data-id="${c.id}">
        ${c.thumb ? `<img src="${urlOf(c.thumb)}" alt="" class="${S.manRev ? 'rev' : ''}">` : '<div class="ph">?</div>'}
        <span>${esc(c.name)}</span>${usedAt.has(c.id) ? `<small>in position ${usedAt.get(c.id)}</small>` : ''}</button>`).join('')}</div>
    ${cur ? '<div class="row"><button class="btn danger" data-act="manClear">Remove this card</button></div>' : ''}`;
  if (!dlg.open) dlg.showModal();
}
async function saveManual() {
  const m = S.manual, sp = spreadById(m.spreadId);
  const items = manualItems(m).map(it => ({ label: it.pos.label, meaning: it.pos.meaning || '', cardId: it.card ? it.card.id : null, cardName: it.card ? it.card.name : '', reversed: !!(it.pick && it.pick.reversed), missing: !it.card, extra: false }));
  const rec = { id: m.readingId || uid(), date: m.date || Date.now(), question: m.question, spreadId: m.spreadId, spreadName: sp ? sp.name : '', items, notes: m.notes, photo: null };
  await DB.put('readings', rec);
  S.readings = S.readings.filter(r => r.id !== rec.id).concat(rec);
  m.readingId = rec.id; m.date = rec.date; m.saved = true;
  if (sp) { S.settings.spreadUse = { ...(S.settings.spreadUse || {}), [sp.id]: Date.now() }; await saveSettings(); }
  toast('Saved to your journal.'); render();
}

// ---------- CARDS ----------
function renderCards() {
  const n = S.cards.length, art = S.cards.filter(c => c.image).length, mean = S.cards.filter(c => c.upright).length;
  view().innerHTML = `
  <section>
    <div class="toolbar"><h2>Your cards</h2><button class="btn" data-act="newCard">+ Add card</button></div>
    ${n ? `<p class="muted small">${n} cards · ${art} with art · ${mean} with meanings</p>
      <input class="search" placeholder="Search cards…" data-input="cardFilter">`
      : `<div class="notice">No cards yet. Go to <button class="link" data-act="tab" data-tab="setup">Setup</button> to add your card art, descriptions and meanings in bulk.</div>`}
    <div class="card-grid">${S.cards.map(c => `
      <button class="cg" data-act="editCard" data-id="${c.id}" data-key="${esc(Parse.norm(c.name + c.group + c.keywords))}">
        ${c.thumb ? `<img src="${urlOf(c.thumb)}" alt="" loading="lazy">` : '<div class="ph">no art</div>'}
        <span>${esc(c.name || 'Untitled')}</span>
        ${!c.upright ? '<i class="flag" title="No meaning yet">!</i>' : ''}
      </button>`).join('')}</div>
  </section>`;
}
function openCardEditor(id) {
  const c = id ? cardById(id) : null;
  S.editCard = c ? { ...c } : newCard({});
  S.editCard._new = !c;
  drawCardEditor();
  $('#dlg').showModal();
}
function drawCardEditor() {
  const c = S.editCard, f = (k, label, rows) => rows
    ? `<label class="field"><span>${label}</span><textarea name="${k}" rows="${rows}">${esc(c[k])}</textarea></label>`
    : `<label class="field"><span>${label}</span><input name="${k}" value="${esc(c[k])}"></label>`;
  $('#dlg').innerHTML = `
  <form data-submit="saveCard">
    <div class="dlg-head"><h3>${c._new ? 'New card' : 'Edit card'}</h3><button type="button" class="icon" data-act="closeDlg" aria-label="Close">✕</button></div>
    <div class="ce-top">
      <div class="ce-img">${c.thumb ? `<img src="${urlOf(c.thumb)}" alt="">` : '<div class="ph">no art</div>'}</div>
      <div class="col">
        <button type="button" class="btn" data-act="pick" data-target="fCardImage">${c.image ? 'Replace image' : 'Add image'}</button>
        ${c.image ? '<button type="button" class="btn" data-act="cardImageRemove">Remove image</button>' : ''}
        ${c.imageFile ? `<small class="muted">${esc(c.imageFile)}</small>` : ''}
      </div>
    </div>
    ${f('name', 'Name')}
    <div class="two">${f('group', 'Arcana / suit')}${f('keywords', 'Upright keywords')}</div>
    ${f('description', 'Description of the art', 4)}
    ${f('upright', 'Upright meaning', 5)}
    ${f('reversedKeywords', 'Reversed keywords')}
    ${f('reversed', 'Reversed meaning', 5)}
    ${f('source', 'Source of meanings')}
    <div class="row">
      ${!c._new ? '<button type="button" class="btn danger" data-act="deleteCard">Delete</button>' : ''}
      <span class="grow"></span>
      <button type="button" class="btn" data-act="closeDlg">Cancel</button>
      <button class="btn primary">Save</button>
    </div>
  </form>`;
}

// ---------- SPREADS ----------
function miniLayout(positions, size = 84) {
  if (!positions.length) return '';
  const ext = p => p.rot ? [0.5, 0.29] : [0.29, 0.5];
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  positions.forEach(p => { const [hx, hy] = ext(p); x0 = Math.min(x0, p.x - hx); x1 = Math.max(x1, p.x + hx); y0 = Math.min(y0, p.y - hy); y1 = Math.max(y1, p.y + hy); });
  const pad = 0.08;
  const rects = positions.map((p, i) => { const [hx, hy] = ext(p);
    return `<rect x="${p.x - hx}" y="${p.y - hy}" width="${hx * 2}" height="${hy * 2}" rx="0.05"/><text x="${p.x}" y="${p.y}">${i + 1}</text>`; }).join('');
  return `<svg class="mini" viewBox="${x0 - pad} ${y0 - pad} ${x1 - x0 + pad * 2} ${y1 - y0 + pad * 2}" style="max-width:${size}px;max-height:${size}px">${rects}</svg>`;
}
function renderSpreads() {
  if (S.editSpread) return renderSpreadEditor();
  view().innerHTML = `
  <section>
    <div class="toolbar"><h2>Spreads</h2>
      <button class="btn" data-act="newSpread">+ New</button></div>
    <p class="muted small">When you photograph a reading, the app compares the card layout with these to work out which spread you used.</p>
    <div class="panel add-spread">
      <b>Add a spread from a picture</b>
      <div class="row wrap">
        <button class="btn primary" data-act="pick" data-target="fTemplate">Spread template picture</button>
        <button class="btn" data-act="pick" data-target="fSpreadPhoto">Photo of laid-out cards</button>
      </div>
      <p class="muted small">A <b>template picture</b> is a diagram of the spread, e.g. a page from a book, a screenshot, or a photo of one. The app reads the boxes, numbers, position names and meanings. A <b>photo of laid-out cards</b> takes just the shape; you name the positions yourself.</p>
    </div>
    <div class="spread-list">${S.spreads.map(sp => `
      <button class="spread-item" data-act="editSpread" data-id="${sp.id}">
        <div class="mini-wrap">${miniLayout(sp.positions)}</div>
        <div><b>${esc(sp.name)}</b> <span class="muted small">${sp.positions.length} card${sp.positions.length === 1 ? '' : 's'}</span>
        ${sp.description ? `<p class="muted small">${esc(sp.description)}</p>` : ''}</div>
      </button>`).join('') || '<div class="notice">No spreads yet.</div>'}</div>
  </section>`;
}
function openSpreadEditor(sp, isNew, extra = {}) {
  if (S.editSpread && S.editSpread.pictureURL) URL.revokeObjectURL(S.editSpread.pictureURL);
  S.editSpread = { isNew, ...extra, draft: { id: sp.id || uid(), name: sp.name || '', description: sp.description || '', positions: (sp.positions || []).map(p => ({ label: '', meaning: '', rot: false, ...p })) } };
  S.tab = 'spreads'; render();
}
function renderSpreadEditor() {
  const { draft: e, isNew, pictureURL, note } = S.editSpread;
  view().innerHTML = `
  <section class="editor">
    <div class="toolbar"><button class="btn" data-act="spBack">← Back</button><h2>${isNew ? 'New spread' : 'Edit spread'}</h2></div>
    ${note ? `<div class="notice small">${note}</div>` : ''}
    ${pictureURL ? `<details class="tips" open><summary>Your picture</summary><img class="tpl-pic" src="${pictureURL}" alt="Spread template"></details>` : ''}
    <label class="field"><span>Name</span><input data-input="spName" value="${esc(e.name)}" placeholder="e.g. Relationship spread"></label>
    <label class="field"><span>About this spread</span><textarea rows="2" data-input="spDesc">${esc(e.description)}</textarea></label>
    <h4>Layout</h4>
    <p class="muted small">Drag the cards into the shape you lay them out in. The photo match uses this shape, so it only needs to be roughly right.</p>
    <div class="layout" id="layout"></div>
    <div class="row"><button class="btn" data-act="spAdd">+ Add position</button></div>
    <h4>Positions</h4>
    <ol class="pos-list">${e.positions.map((p, i) => `
      <li>
        <div class="pos-head"><span class="num">${i + 1}</span>
          <input data-input="posLabel" data-i="${i}" value="${esc(p.label)}" placeholder="Position name">
          <button class="icon" data-act="posMove" data-i="${i}" data-d="-1" aria-label="Move up" ${i === 0 ? 'disabled' : ''}>↑</button>
          <button class="icon" data-act="posMove" data-i="${i}" data-d="1" aria-label="Move down" ${i === e.positions.length - 1 ? 'disabled' : ''}>↓</button>
          <button class="icon danger" data-act="posDel" data-i="${i}" aria-label="Remove">✕</button></div>
        <textarea rows="2" data-input="posMeaning" data-i="${i}" placeholder="What this position means">${esc(p.meaning)}</textarea>
        <label class="check"><input type="checkbox" data-change="posRot" data-i="${i}" ${p.rot ? 'checked' : ''}> Sideways (e.g. a crossing card)</label>
      </li>`).join('')}</ol>
    <div class="row">
      <button class="btn primary" data-act="spSave">Save spread</button>
      ${!isNew ? '<button class="btn danger" data-act="spDelete">Delete</button>' : ''}
    </div>
  </section>`;
  drawLayout();
}
let layoutT = null;
function drawLayout() {
  const el = $('#layout'); if (!el) return;
  const ps = S.editSpread.draft.positions;
  if (!ps.length) { el.innerHTML = '<p class="muted small center">Add a position to start.</p>'; el.style.height = ''; return; }
  const ext = p => p.rot ? [0.5, 0.29] : [0.29, 0.5];
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  ps.forEach(p => { const [hx, hy] = ext(p); x0 = Math.min(x0, p.x - hx); x1 = Math.max(x1, p.x + hx); y0 = Math.min(y0, p.y - hy); y1 = Math.max(y1, p.y + hy); });
  const pad = 0.6; x0 -= pad; x1 += pad; y0 -= pad * 0.6; y1 += pad * 0.6;
  const U = Math.max(44, Math.min(110, (el.clientWidth || 320) / (x1 - x0)));
  const offX = ((el.clientWidth || 320) - (x1 - x0) * U) / 2;
  layoutT = { x0, y0, U, offX };
  el.style.height = Math.round((y1 - y0) * U) + 'px';
  el.innerHTML = ps.map((p, i) => {
    const [hx, hy] = ext(p);
    return `<div class="slot" data-i="${i}" style="left:${offX + (p.x - x0) * U}px;top:${(p.y - y0) * U}px;width:${hx * 2 * U}px;height:${hy * 2 * U}px">
      <b>${i + 1}</b><small>${esc(p.label)}</small></div>`;
  }).join('');
}
function initLayoutDrag() {
  let drag = null;
  document.addEventListener('pointerdown', e => {
    const slot = e.target.closest('#layout .slot'); if (!slot || !layoutT) return;
    const p = S.editSpread.draft.positions[+slot.dataset.i];
    drag = { slot, p, sx: e.clientX, sy: e.clientY, ox: p.x, oy: p.y };
    slot.setPointerCapture(e.pointerId); slot.classList.add('drag'); e.preventDefault();
  });
  document.addEventListener('pointermove', e => {
    if (!drag) return;
    const snap = v => Math.round(v * 20) / 20, { U, x0, y0, offX } = layoutT;
    drag.p.x = snap(drag.ox + (e.clientX - drag.sx) / U); drag.p.y = snap(drag.oy + (e.clientY - drag.sy) / U);
    drag.slot.style.left = offX + (drag.p.x - x0) * U + 'px'; drag.slot.style.top = (drag.p.y - y0) * U + 'px';
  });
  const end = () => { if (!drag) return; drag = null; drawLayout(); };
  document.addEventListener('pointerup', end); document.addEventListener('pointercancel', end);
}

// ---------- JOURNAL ----------
function renderJournal() {
  if (S.openReading) return renderJournalEntry();
  const list = [...S.readings].sort((a, b) => b.date - a.date);
  view().innerHTML = `
  <section>
    <div class="toolbar"><h2>Journal</h2></div>
    ${list.length ? '' : '<div class="notice">Readings you save will appear here.</div>'}
    <div class="j-list">${list.map(r => `
      <button class="j-item" data-act="openReading" data-id="${r.id}">
        ${r.photo ? `<img src="${urlOf(r.photo)}" alt="">` : '<div class="ph">✦</div>'}
        <div><div class="muted small">${fmtDate(r.date)} · ${esc(r.spreadName)}</div>
          ${r.question ? `<b>${esc(r.question)}</b>` : ''}
          <div class="chips">${r.items.filter(it => it.cardName).map(it => `<span>${esc(it.cardName)}${it.reversed ? ' ↓' : ''}</span>`).join('')}</div></div>
      </button>`).join('')}</div>
  </section>`;
}
function renderJournalEntry() {
  const r = S.readings.find(x => x.id === S.openReading);
  if (!r) { S.openReading = null; return renderJournal(); }
  view().innerHTML = `
  <section class="result">
    <div class="toolbar"><button class="btn" data-act="closeReading">← Journal</button><span class="grow"></span><button class="btn danger" data-act="deleteReading">Delete</button></div>
    <p class="muted small">${fmtDate(r.date)} · ${esc(r.spreadName)}</p>
    ${r.question ? `<h2>${esc(r.question)}</h2>` : ''}
    ${r.photo ? `<div class="photo-wrap"><img src="${urlOf(r.photo)}" alt="Spread photo"></div>` : ''}
    <div class="reading">${r.items.map((it, k) => {
      const card = cardById(it.cardId) || (it.cardName ? { name: it.cardName } : null);
      return interpHTML({ num: it.extra ? '+' : k + 1, pos: { label: it.label, meaning: it.meaning }, card, reversed: it.reversed, missing: it.missing, extra: it.extra, hint: 'No card was recorded for this position.' });
    }).join('')}</div>
    <div class="panel"><label class="field"><span>Notes</span><textarea rows="4" data-change="jNotes">${esc(r.notes)}</textarea></label></div>
  </section>`;
}

// ---------- SETUP ----------
function renderSetup() {
  const s = S.settings;
  view().innerHTML = `
  <section class="setup">
    <h2>Setup</h2>
    <p class="muted small">Everything is stored only on this device. Add your card art first, then the descriptions and meanings — the app joins them by card name.</p>

    <div class="panel">
      <h3><span class="step">1</span> Card art</h3>
      <p class="muted small">Pick one image per card (scans or straight-on photos of <b>your</b> deck, cropped to the card edge). The file name is used to match cards, e.g. <code>the-fool.jpg</code> or <code>00 The Fool.png</code>.</p>
      <label class="check"><input type="checkbox" id="artCreate" ${s.artCreate !== false ? 'checked' : ''} data-change="artCreate"> Create a new card for images that don't match an existing card</label>
      <div class="row wrap"><button class="btn primary" data-act="pick" data-target="fArt">Choose images</button>${NATIVE ? '' : '<button class="btn" data-act="pick" data-target="fArtDir">Choose a folder</button>'}</div>
      ${NATIVE ? '<p class="muted small">Tip: in the picker, long-press one image and then tap the others to select many at once.</p>' : ''}
    </div>

    <div class="panel">
      <h3><span class="step">2</span> Descriptions &amp; meanings</h3>
      <p class="muted small">Import a CSV (from Excel or Google Sheets) or JSON. Only <b>name</b> is required; columns can be in any order. You can import descriptions and meanings from separate files — empty cells never overwrite existing text.</p>
      <pre class="fmt">name,description,upright,reversed,keywords,source
The Fool,"A young traveller at a cliff edge…","New beginnings…","Recklessness…","beginnings, faith",My book</pre>
      <div class="row wrap">
        <button class="btn primary" data-act="pick" data-target="fCardText">Import file</button>
        <button class="btn" data-act="templateCSV">Download template${S.cards.length ? ' with my card names' : ''}</button>
      </div>
      <details><summary>Or paste text</summary>
        <textarea id="cardPaste" rows="5" placeholder="Paste CSV, tab-separated (copied from a spreadsheet) or JSON"></textarea>
        <button class="btn" data-act="importCardPaste">Import pasted text</button>
      </details>
    </div>

    <div class="panel">
      <h3><span class="step">3</span> Spreads</h3>
      <p class="muted small">Create spreads in the Spreads tab, or import them here — one row per position. <b>x</b> and <b>y</b> (in card heights) set the layout; leave them out and you can arrange the cards afterwards.</p>
      <pre class="fmt">spread,position,label,meaning,x,y,sideways
Love spread,1,You,How you feel,-0.8,0,
Love spread,2,Them,How they feel,0.8,0,
Love spread,3,Connection,What binds you,0,-1.1,</pre>
      <div class="row wrap"><button class="btn primary" data-act="pick" data-target="fSpreadText">Import file</button></div>
      <details><summary>Or paste text</summary>
        <textarea id="spreadPaste" rows="5" placeholder="Paste CSV or JSON"></textarea>
        <button class="btn" data-act="importSpreadPaste">Import pasted text</button>
      </details>
    </div>

    <div class="panel">
      <h3>Backup</h3>
      <p class="muted small">A backup file holds your cards, art, spreads and journal. Keep one somewhere safe, or use it to move everything to another device.</p>
      <div class="row wrap">
        <button class="btn" data-act="exportBackup">Save backup</button>
        <button class="btn" data-act="pick" data-target="fRestore">Restore backup / add deck pack</button>
        <button class="btn" data-act="exportCardsCSV">Export card text (CSV)</button>
      </div>
    </div>

    <div class="panel danger-zone">
      <h3>Start over</h3>
      <div class="row wrap">
        <button class="btn danger" data-act="wipe" data-what="cards">Delete all cards</button>
        <button class="btn danger" data-act="wipe" data-what="spreads">Delete all spreads</button>
        <button class="btn danger" data-act="wipe" data-what="readings">Delete journal</button>
      </div>
    </div>
  </section>`;
}

async function importArt(files) {
  files = [...files].filter(f => /^image\//.test(f.type) || /\.(png|jpe?g|webp|gif|avif|bmp)$/i.test(f.name)).sort((a, b) => nat(a.name, b.name));
  if (!files.length) return toast('No images found.');
  const create = S.settings.artCreate !== false;
  const byFile = new Map(), byName = new Map(), byLoose = new Map();
  const index = c => { if (c.imageFile) byFile.set(Parse.norm(stripExt(c.imageFile)), c); byName.set(Parse.norm(c.name), c); byLoose.set(Parse.loose(c.name), c); };
  S.cards.forEach(index);
  let matched = 0, created = 0, failed = 0; const skipped = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i], full = stripExt(f.name);
    // "Cups - Ace of Cups" → also try the part after the last " - "
    const tail = full.includes(' - ') ? full.slice(full.lastIndexOf(' - ') + 3) : full;
    busy(`Adding card art… ${i + 1}/${files.length}`); await nextFrame();
    const find = k => byFile.get(Parse.norm(k)) || byName.get(Parse.norm(k)) || byLoose.get(Parse.loose(k));
    let c = find(full) || find(tail);
    const base = tail;
    if (!c && !create) { skipped.push(f.name); continue; }
    let art;
    try { art = await processArt(f); } catch (e) { failed++; continue; }
    if (c) matched++;
    else {
      const pretty = base.replace(/^[\d\s._-]+/, '').replace(/[_-]+/g, ' ').trim().replace(/\b\w/g, m => m.toUpperCase()) || base;
      c = newCard({ name: pretty }); S.cards.push(c); created++;
    }
    Object.assign(c, art, { imageFile: f.name }); index(c);
    await DB.put('cards', c);
  }
  busy(false); sortCards();
  toast([matched && `${matched} matched to existing cards`, created && `${created} new cards`, skipped.length && `${skipped.length} skipped (no matching card)`, failed && `${failed} unreadable`].filter(Boolean).join(' · ') || 'Nothing imported', 6000);
  render();
}
async function importCardText(text) {
  let recs;
  try { recs = Parse.cards(text); } catch (e) { return toast(e.message, 6000); }
  const byName = new Map(S.cards.map(c => [Parse.norm(c.name), c])), byLoose = new Map(S.cards.map(c => [Parse.loose(c.name), c]));
  const byFile = new Map(S.cards.filter(c => c.imageFile).map(c => [Parse.norm(stripExt(c.imageFile)), c]));
  let updated = 0, created = 0, skipped = 0; const changed = new Set();
  for (const r of recs) {
    let c = (r.name && (byName.get(Parse.norm(r.name)) || byLoose.get(Parse.loose(r.name)))) || (r.imageFile && byFile.get(Parse.norm(stripExt(r.imageFile))));
    if (!c) {
      if (!r.name) { skipped++; continue; }
      c = newCard({ name: r.name.trim() }); S.cards.push(c); created++;
      byName.set(Parse.norm(c.name), c); byLoose.set(Parse.loose(c.name), c);
    } else updated++;
    for (const k of ['group', 'keywords', 'reversedKeywords', 'description', 'upright', 'reversed', 'source', 'imageFile']) if (r[k]) c[k] = r[k];
    if (r.order != null && !isNaN(+r.order)) c.order = +r.order;
    changed.add(c);
  }
  await DB.putMany('cards', [...changed]); sortCards();
  toast(`${updated} cards updated · ${created} new${skipped ? ` · ${skipped} rows without a name skipped` : ''}`, 6000);
  render();
}
async function importSpreadText(text) {
  let list;
  try { list = Parse.spreads(text); } catch (e) { return toast(e.message, 6000); }
  if (!list.length) return toast('No spreads found. Each row needs a spread name.', 6000);
  const out = [];
  for (const s of list) {
    const old = S.spreads.find(x => Parse.norm(x.name) === Parse.norm(s.name));
    const sp = { id: old ? old.id : uid(), name: s.name, description: s.description || (old && old.description) || '', positions: s.positions };
    if (old) Object.assign(old, sp); else S.spreads.push(sp);
    out.push(sp);
  }
  await DB.putMany('spreads', out);
  const needs = list.filter(s => s.needsLayout).length;
  toast(`${out.length} spread${out.length > 1 ? 's' : ''} imported${needs ? ` — ${needs} without x/y: arrange ${needs > 1 ? 'them' : 'it'} in the Spreads tab` : ''}`, 7000);
  render();
}
async function spreadFromPhoto(file) {
  busy('Finding cards…'); await nextFrame();
  try {
    const img = await loadImage(file), loC = drawScaled(img, DETECT_SIZE, false); freeImage(img);
    const r = Vision.detect(loC.getContext('2d').getImageData(0, 0, loC.width, loC.height));
    busy(false);
    if (!r.dets.length) return toast('No cards found in that photo.');
    openSpreadEditor({ name: '', positions: Vision.layoutFromDets(r.dets).map((p, i) => ({ ...p, label: `Position ${i + 1}` })) }, true);
    toast(`${r.dets.length} cards found — name the positions and save.`);
  } catch (e) { busy(false); toast('Could not read that photo.'); }
}
/** Build (or update) a spread from a picture of a spread template. */
async function spreadFromTemplate(file) {
  busy('Opening picture…'); await nextFrame();
  let res, img;
  try {
    img = await loadImage(file);
    res = await Template.read(img, msg => busy(msg));
  } catch (e) { console.error(e); busy(false); return toast('Could not read that picture: ' + e.message, 6000); }
  finally { if (img) freeImage(img); }
  busy(false);
  if (!res.positions.length) return toast('No card boxes or numbered positions found in that picture.', 6000);
  const old = res.name && S.spreads.find(s => Parse.norm(s.name) === Parse.norm(res.name));
  const f = res.found, bits = [];
  bits.push(f.boxes ? `${f.boxes} card box${f.boxes > 1 ? 'es' : ''} found` : 'no card boxes found — arrange the layout by dragging');
  if (f.legend) bits.push(`${f.legend} numbered description${f.legend > 1 ? 's' : ''} read`);
  if (f.boxes && !f.numbered) bits.push('positions numbered left-to-right — reorder if needed');
  if (res.turned) bits.push('picture turned upright');
  const note = `${old ? `This will <b>update your existing “${esc(old.name)}” spread</b>. ` : ''}Read from the picture: ${bits.join(' · ')}. Check the names and meanings, then save.`;
  const picture = res.turned ? await canvasBlob(res.picture, 0.85) : file;   // show the picture the right way up
  openSpreadEditor({ id: old ? old.id : undefined, name: res.name || (old && old.name) || '', description: res.description || (old && old.description) || '', positions: res.positions }, !old,
    { pictureURL: URL.createObjectURL(picture), note });
  window.scrollTo(0, 0);
}
async function exportBackup() {
  busy('Preparing backup…'); await nextFrame();
  try {
    const cards = await Promise.all(S.cards.map(async ({ feat, ...c }) => ({ ...c, image: c.image ? await blobToDataURL(c.image) : null, thumb: c.thumb ? await blobToDataURL(c.thumb) : null })));
    const readings = await Promise.all(S.readings.map(async r => ({ ...r, photo: r.photo ? await blobToDataURL(r.photo) : null })));
    const data = { app: 'tarot-reader', version: 1, exported: new Date().toISOString(), cards, spreads: S.spreads, readings };
    download(new Blob([JSON.stringify(data)], { type: 'application/json' }), `tarot-backup-${new Date().toISOString().slice(0, 10)}.json`);
  } finally { busy(false); }
}
async function restoreBackup(file) {
  let data;
  try { data = JSON.parse(await readText(file)); } catch (e) { return toast('That file is not a valid backup.'); }
  if (!data || data.app !== 'tarot-reader') return toast('That file is not a Tarot Reader backup.');
  if (data.kind === 'deck' || data.kind === 'pack') return mergePack(data);
  if (!confirm(`Replace everything on this device with this backup?\n\n${(data.cards || []).length} cards · ${(data.spreads || []).length} spreads · ${(data.readings || []).length} journal entries`)) return;
  busy('Restoring…'); await nextFrame();
  S.cards = (data.cards || []).map(c => ({ ...c, image: dataURLToBlob(c.image), thumb: dataURLToBlob(c.thumb), feat: null }));
  S.spreads = data.spreads || [];
  S.readings = (data.readings || []).map(r => ({ ...r, photo: dataURLToBlob(r.photo) }));
  for (const s of ['cards', 'spreads', 'readings']) { await DB.clear(s); await DB.putMany(s, S[s]); }
  sortCards(); await ensureFeatures();
  toast('Backup restored.'); render();
}
/** A pack (cards and/or spreads) is added to what's already here: matching cards get the new art,
    text you've already entered is kept, spreads with the same name are updated, the journal is untouched. */
async function mergePack(data) {
  const list = data.cards || [], spreads = data.spreads || [];
  if (!list.length && !spreads.length) return toast('That file is empty.');
  const what = [list.length && `${list.length} cards`, spreads.length && `${spreads.length} spreads`].filter(Boolean).join(' and ');
  if (!confirm(`Add ${what} to the app?\n\nCards you already have get this art; descriptions and meanings you've entered are kept. Spreads with the same name are updated. Your journal is not changed.`)) return;
  busy('Adding…'); await nextFrame();
  if (spreads.length) {
    const out = spreads.map(s => {
      const old = S.spreads.find(x => Parse.norm(x.name) === Parse.norm(s.name));
      const sp = { id: old ? old.id : uid(), name: s.name, description: s.description || '', positions: s.positions.map(p => ({ label: p.label || '', meaning: p.meaning || '', x: +p.x || 0, y: +p.y || 0, rot: !!p.rot })) };
      if (old) Object.assign(old, sp); else S.spreads.push(sp);
      return sp;
    });
    await DB.putMany('spreads', out);
  }
  if (list.length) await mergeCards(list);
  busy(false);
  toast(`Added ${what}.`, 5000); render();
}
async function mergeCards(list) {
  const byName = new Map(S.cards.map(c => [Parse.norm(c.name), c])), byLoose = new Map(S.cards.map(c => [Parse.loose(c.name), c]));
  let added = 0, updated = 0; const changed = [];
  for (const src of list) {
    const image = dataURLToBlob(src.image), thumb = dataURLToBlob(src.thumb);
    let c = byName.get(Parse.norm(src.name)) || byLoose.get(Parse.loose(src.name));
    if (!c) { c = newCard({ name: src.name }); S.cards.push(c); added++; } else updated++;
    if (image) Object.assign(c, { image, thumb, feat: null, imageFile: src.imageFile || c.imageFile });
    for (const k of ['group', 'keywords', 'reversedKeywords', 'description', 'upright', 'reversed', 'source']) if (!c[k] && src[k]) c[k] = src[k];
    if (src.order != null) c.order = src.order;
    changed.push(c);
  }
  await DB.putMany('cards', changed); sortCards();
  await ensureFeatures();
}
function exportCardsCSV(blank) {
  const head = ['name', 'group', 'keywords', 'reversed keywords', 'description', 'upright', 'reversed', 'source', 'image'];
  const rows = S.cards.map(c => blank ? [c.name, c.group, '', '', '', '', '', '', c.imageFile] : [c.name, c.group, c.keywords, c.reversedKeywords, c.description, c.upright, c.reversed, c.source, c.imageFile]);
  download(new Blob([Parse.toCSV(head, rows.length ? rows : [['The Fool', 'Major Arcana', '', '', '', '', '', '', '']])], { type: 'text/csv' }), blank ? 'tarot-cards-template.csv' : 'tarot-cards.csv');
}

// ---------- actions ----------
const ACT = {
  tab: el => { S.tab = el.dataset.tab; if (S.tab !== 'spreads') S.editSpread = null; render(); window.scrollTo(0, 0); },
  pick: el => { const i = $('#' + el.dataset.target); i.value = ''; i.click(); },
  closeDlg: () => $('#dlg').close(),
  // reading
  det: (el, e) => { if (S.session && S.session.addMode && el.closest('svg')) return ACT.photo(el, e); if (el.dataset.i != null) openDet(+el.dataset.i); },
  photo: (el, e) => {
    const s = S.session; if (!s || !s.addMode) return;
    const svg = e.target.closest('svg'), pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM().inverse());
    const L = s.cardL || s.H * 0.28, d = { cx: p.x, cy: p.y, L, S: s.cardS || L * 0.58, ux: 0, uy: 1, sideways: false };
    identifyDet(d); s.dets.push(d); s.addMode = false;
    assignCards(); rankSpreads(); render();
  },
  addMode: () => { S.session.addMode = !S.session.addMode; render(); },
  newReading: () => { if (S.session) URL.revokeObjectURL(S.session.photoURL); S.session = null; S.manual = null; S.draftQuestion = ''; render(); window.scrollTo(0, 0); },
  // choosing cards by hand
  manualStart: startManual,
  manPick: el => { S.manRev = null; openManPick(+el.dataset.j); },
  manOrient: el => {
    S.manRev = el.dataset.rev === '1';
    const pick = S.manual.picks[S.manJ];
    if (pick) { pick.reversed = S.manRev; S.manual.saved = false; render(); }   // flipping an already chosen card
    openManPick(S.manJ);
  },
  manGroup: el => { S.manual.group = el.dataset.g; openManPick(S.manJ); },
  manChoose: el => {
    const m = S.manual, j = S.manJ, id = el.dataset.id;
    // A card can only be in one place: move it here if it was elsewhere.
    m.picks.forEach((p, k) => { if (p && p.cardId === id && k !== j) m.picks[k] = null; });
    m.picks[j] = { cardId: id, reversed: !!S.manRev }; m.saved = false;
    $('#dlg').close(); render();
  },
  manClear: () => { S.manual.picks[S.manJ] = null; S.manual.saved = false; $('#dlg').close(); render(); },
  manSave: saveManual,
  detPick: el => {
    const s = S.session, d = s.dets[S.detIndex], m = d.matches.find(x => x.id === el.dataset.id);
    d.cardId = el.dataset.id; d.manual = true; d.conf = 'high';
    if (m) { d.flipped = m.flipped; d.reversed = !d.sideways && m.flipped; }
    assignCards(); $('#dlg').close(); render();
  },
  detTurn: () => {
    const s = S.session, d = s.dets[S.detIndex];
    [d.ux, d.uy] = [-d.uy, d.ux]; Vision.orient(d); d.manual = false;
    identifyDet(d); assignCards(); rankSpreads(); openDet(S.detIndex); render();
  },
  detRemove: () => { const s = S.session; s.dets.splice(S.detIndex, 1); assignCards(); rankSpreads(); $('#dlg').close(); render(); },
  saveReading: async () => {
    const s = S.session, sp = spreadById(s.spreadId);
    const items = sessionItems(s).map(it => ({ label: it.pos.label, meaning: it.pos.meaning || '', cardId: it.card ? it.card.id : null, cardName: it.card ? it.card.name : '', reversed: it.reversed, missing: !!it.missing, extra: !!it.extra }));
    const rec = { id: s.readingId || uid(), date: s.date || Date.now(), question: s.question, spreadId: s.spreadId, spreadName: sp ? sp.name : 'Cards in order', items, notes: s.notes, photo: s.photoBlob };
    await DB.put('readings', rec);
    S.readings = S.readings.filter(r => r.id !== rec.id).concat(rec);
    s.readingId = rec.id; s.date = rec.date; s.saved = true;
    if (sp) { S.settings.spreadUse = { ...(S.settings.spreadUse || {}), [sp.id]: Date.now() }; await saveSettings(); }
    toast('Saved to your journal.'); render();
  },
  // cards
  newCard: () => openCardEditor(null),
  editCard: el => openCardEditor(el.dataset.id),
  cardImageRemove: () => { Object.assign(S.editCard, { image: null, thumb: null, feat: null }); keepForm(drawCardEditor); },
  deleteCard: async () => {
    if (!confirm(`Delete “${S.editCard.name}”?`)) return;
    await DB.del('cards', S.editCard.id); S.cards = S.cards.filter(c => c.id !== S.editCard.id);
    $('#dlg').close(); render();
  },
  // spreads
  newSpread: () => openSpreadEditor({ positions: [{ label: 'Position 1', meaning: '', x: 0, y: 0 }] }, true),
  editSpread: el => openSpreadEditor(spreadById(el.dataset.id), false),
  spBack: () => { S.editSpread = null; render(); },
  spAdd: () => {
    const ps = S.editSpread.draft.positions, last = ps[ps.length - 1];
    ps.push({ label: `Position ${ps.length + 1}`, meaning: '', x: last ? last.x + 0.75 : 0, y: last ? last.y : 0, rot: false });
    renderSpreadEditor();
  },
  posMove: el => { const ps = S.editSpread.draft.positions, i = +el.dataset.i, j = i + +el.dataset.d; [ps[i], ps[j]] = [ps[j], ps[i]]; renderSpreadEditor(); },
  posDel: el => { S.editSpread.draft.positions.splice(+el.dataset.i, 1); renderSpreadEditor(); },
  spSave: async () => {
    const e = S.editSpread.draft;
    if (!e.name.trim()) return toast('Give the spread a name.');
    if (!e.positions.length) return toast('Add at least one position.');
    const sp = { ...e, name: e.name.trim(), positions: e.positions.map(p => ({ label: p.label || 'Position', meaning: p.meaning || '', x: +p.x, y: +p.y, rot: !!p.rot })) };
    await DB.put('spreads', sp);
    const i = S.spreads.findIndex(x => x.id === sp.id); if (i >= 0) S.spreads[i] = sp; else S.spreads.push(sp);
    S.editSpread = null; toast('Spread saved.'); render();
  },
  spDelete: async () => {
    const e = S.editSpread.draft; if (!confirm(`Delete the spread “${e.name}”?`)) return;
    await DB.del('spreads', e.id); S.spreads = S.spreads.filter(x => x.id !== e.id); S.editSpread = null; render();
  },
  // journal
  openReading: el => { S.openReading = el.dataset.id; render(); window.scrollTo(0, 0); },
  closeReading: () => { S.openReading = null; render(); },
  deleteReading: async () => {
    if (!confirm('Delete this reading from your journal?')) return;
    await DB.del('readings', S.openReading); S.readings = S.readings.filter(r => r.id !== S.openReading); S.openReading = null; render();
  },
  // setup
  templateCSV: () => exportCardsCSV(true),
  exportCardsCSV: () => exportCardsCSV(false),
  exportBackup,
  importCardPaste: () => importCardText($('#cardPaste').value),
  importSpreadPaste: () => importSpreadText($('#spreadPaste').value),
  wipe: async el => {
    const what = el.dataset.what, label = { cards: 'all cards and their art', spreads: 'all spreads', readings: 'your whole journal' }[what];
    if (!confirm(`Delete ${label}? This cannot be undone (unless you have a backup).`)) return;
    await DB.clear(what); S[what] = []; toast('Deleted.'); render();
  },
};
/** Re-draw the card editor without losing unsaved typing. */
function keepForm(redraw) {
  const form = $('#dlg form');
  if (form) for (const [k, v] of new FormData(form)) S.editCard[k] = v;
  redraw();
}
const INPUT = {
  draftQ: el => { S.draftQuestion = el.value; },
  sessQ: el => { S.session.question = el.value; },
  sessNotes: el => { S.session.notes = el.value; },
  manQ: el => { S.manual.question = el.value; },
  manNotes: el => { S.manual.notes = el.value; },
  cardFilter: el => { const f = Parse.norm(el.value); $$('.card-grid .cg').forEach(b => { b.hidden = f && !b.dataset.key.includes(f); }); },
  pickFilter: el => { const f = Parse.norm(el.value); $$('#pickAll .pick').forEach(b => { b.hidden = f && !Parse.norm(b.textContent).includes(f); }); },
  spName: el => { S.editSpread.draft.name = el.value; },
  spDesc: el => { S.editSpread.draft.description = el.value; },
  posLabel: el => { S.editSpread.draft.positions[+el.dataset.i].label = el.value; drawLayout(); },
  posMeaning: el => { S.editSpread.draft.positions[+el.dataset.i].meaning = el.value; },
};
const CHANGE = {
  photo: el => el.files[0] && startReading(el.files[0]),
  manSpread: el => {
    const m = S.manual, n = spreadById(el.value).positions.length;
    m.spreadId = el.value; m.picks = m.picks.slice(0, n); m.saved = false;   // keep cards already placed in positions that still exist
    render();
  },
  pickSpread: el => { const s = S.session; s.spreadId = el.value; s.locked = true; applySpread(); render(); },
  sens: el => {
    const s = S.session; s.sens = +el.value;
    if (s.dets.some(d => d.manual) && !confirm('Re-scanning will undo the corrections you made. Continue?')) { el.value = s.sens; return render(); }
    s.locked = false; runDetection(); render();
  },
  detRev: el => { const d = S.session.dets[S.detIndex]; d.reversed = el.checked; d.manual = d.manual || !!d.cardId; render(); },
  posRot: el => { S.editSpread.draft.positions[+el.dataset.i].rot = el.checked; drawLayout(); },
  cardImage: async el => {
    const f = el.files[0]; if (!f || !S.editCard) return;
    busy('Processing image…');
    try { Object.assign(S.editCard, await processArt(f), { imageFile: f.name }); } catch (e) { toast('Could not read that image.'); }
    busy(false); keepForm(drawCardEditor);
  },
  artCreate: el => { S.settings.artCreate = el.checked; saveSettings(); },
  art: el => importArt(el.files),
  cardText: async el => el.files[0] && importCardText(await readText(el.files[0])),
  spreadText: async el => el.files[0] && importSpreadText(await readText(el.files[0])),
  spreadPhoto: el => el.files[0] && spreadFromPhoto(el.files[0]),
  template: el => el.files[0] && spreadFromTemplate(el.files[0]),
  restore: el => el.files[0] && restoreBackup(el.files[0]),
  jNotes: async el => {
    const r = S.readings.find(x => x.id === S.openReading); if (!r) return;
    r.notes = el.value; await DB.put('readings', r); toast('Notes saved.');
  },
};
const SUBMIT = {
  saveCard: async form => {
    const c = S.editCard;
    for (const [k, v] of new FormData(form)) c[k] = String(v).trim();
    if (!c.name) return toast('The card needs a name.');
    const isNew = c._new; delete c._new;
    await DB.put('cards', c);
    if (isNew) S.cards.push(c); else S.cards[S.cards.findIndex(x => x.id === c.id)] = c;
    sortCards(); $('#dlg').close(); render();
  },
};

function bind() {
  document.addEventListener('click', e => { const el = e.target.closest('[data-act]'); if (el && ACT[el.dataset.act]) ACT[el.dataset.act](el, e); });
  document.addEventListener('input', e => { const el = e.target.closest('[data-input]'); if (el && INPUT[el.dataset.input]) INPUT[el.dataset.input](el, e); });
  document.addEventListener('change', e => { const el = e.target.closest('[data-change]'); if (el && CHANGE[el.dataset.change]) CHANGE[el.dataset.change](el, e); });
  document.addEventListener('submit', e => { const el = e.target.closest('[data-submit]'); if (el) { e.preventDefault(); SUBMIT[el.dataset.submit](el, e); } });
  const dlg = $('#dlg');
  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
  initLayoutDrag();
  let w = innerWidth;
  addEventListener('resize', () => { if (Math.abs(innerWidth - w) > 40) { w = innerWidth; if (S.editSpread) drawLayout(); } });
}

/** Android back button: step back inside the app; returning false lets the app close. */
window.onNativeBack = () => {
  const dlg = $('#dlg');
  if (dlg.open) { dlg.close(); return true; }
  if (!$('#busy').hidden) return true;
  if (S.tab === 'spreads' && S.editSpread) { S.editSpread = null; render(); return true; }
  if (S.tab === 'journal' && S.openReading) { S.openReading = null; render(); return true; }
  if (S.tab !== 'read') { S.tab = 'read'; S.editSpread = null; render(); window.scrollTo(0, 0); return true; }
  const open = S.session || S.manual;
  if (open) {
    const unsaved = !open.saved && (S.session || open.picks.some(Boolean));
    if (!unsaved || confirm('Leave this reading? It hasn’t been saved to your journal.')) ACT.newReading();
    return true;
  }
  return false;
};

(async function init() {
  bind();
  try { await load(); } catch (e) { view().innerHTML = `<div class="notice">Could not open the app's storage: ${esc(e.message)}</div>`; return; }
  render();
  await ensureFeatures();
})();
