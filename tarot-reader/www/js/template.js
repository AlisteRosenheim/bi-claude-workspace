/* Reads a picture of a spread template (a diagram from a book, website or screenshot):
   finds the card boxes, reads the text with on-device OCR (Tesseract), and turns it into
   a spread: name, positions, layout, and each position's label and meaning. */
const Template = (() => {
  const base = () => new URL('vendor/tesseract/', location.href).href;
  let workerP = null;

  function loadScript(src) {
    return new Promise((res, rej) => {
      if (window.Tesseract) return res();
      const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('OCR engine missing'));
      document.head.appendChild(s);
    });
  }
  async function worker() {
    if (!workerP) workerP = (async () => {
      await loadScript(base() + 'tesseract.min.js');
      const w = await Tesseract.createWorker('eng', 1, {
        workerPath: base() + 'worker.min.js', corePath: base(), langPath: base(),
        gzip: false, cacheMethod: 'none', workerBlobURL: false,
      });
      await w.setParameters({ tessedit_pageseg_mode: '11', preserve_interword_spaces: '1' });   // sparse text: labels scattered around boxes
      return w;
    })().catch(e => { workerP = null; throw e; });
    return workerP;
  }

  // ---------- text helpers ----------
  const clean = t => String(t || '').replace(/[|_~`{}\[\]<>©®]+/g, ' ').replace(/\s+/g, ' ').trim();
  const numOnly = t => { const m = clean(t).match(/^[(#]?(\d{1,2})[.):]?$/); return m ? +m[1] : null; };
  const WORDNUM = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12 };
  const LOOKALIKE = { I: '1', L: '1', '|': '1', '!': '1', Z: '2', A: '4', S: '5', G: '6', T: '7', B: '8', Q: '9', O: '0', D: '0' };
  /** "1ST", "2nd", "IST" (OCR for 1ST), "ZND", "fourth" → number. */
  function ordinal(tok) {
    const t = String(tok || '').toUpperCase().replace(/[^0-9A-Z|!]/g, '');
    if (WORDNUM[t.toLowerCase()]) return WORDNUM[t.toLowerCase()];
    const m = t.match(/^([0-9A-Z|!]{1,2}?)(ST|ND|RD|TH|5T|NO|N0|RO|R0)$/);
    if (!m) return null;
    const suf = m[2].replace('5T', 'ST').replace(/N[O0]/, 'ND').replace(/R[O0]/, 'RD');
    const digits = m[1].split('').map(ch => /\d/.test(ch) ? ch : LOOKALIKE[ch] || '').join('');
    if (digits.length !== m[1].length || !+digits) return null;   // "MIND" ends in ND but M isn't a digit
    const n = +digits, want = v => (v % 100 >= 11 && v % 100 <= 13) ? 'TH' : ({ 1: 'ST', 2: 'ND', 3: 'RD' }[v % 10] || 'TH');
    if (want(n) === suf) return n;
    return { ST: 1, ND: 2, RD: 3 }[suf] || n;   // trust the suffix when the digit was misread
  }
  const numberOf = t => numOnly(t) ?? ordinal(t);
  const isFiller = t => /^(CAR[DO0Y)]S?\)?|POSITION|NO\.?)$/i.test(clean(t));
  const titleCase = t => t === t.toUpperCase() && /[A-Z]{3}/.test(t) ? t.toLowerCase().replace(/\b[a-z]/g, m => m.toUpperCase()) : t;
  const centre = b => ({ x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 });
  function inside(d, p, pad = 0) {
    const dx = p.x - d.cx, dy = p.y - d.cy;
    const a = dx * d.ux + dy * d.uy, b = dx * d.uy - dy * d.ux;
    return Math.abs(a) <= d.L / 2 + pad && Math.abs(b) <= d.S / 2 + pad;
  }
  /** "Past – what led here" / "Mind (past, background)" → {label, meaning} */
  function split(text) {
    const m = text.match(/^(.{1,60}?)\s*(?:[:–—]|\s-\s)\s*(.+)$/);
    if (m && m[1].split(' ').length <= 6) return { label: m[1].trim(), meaning: m[2].trim() };
    const p = text.match(/^([^()]{0,40}?)\s*\(([^()]+)\)\s*\.?$/);
    if (p) return { label: p[1].trim(), meaning: p[2].trim() };
    return text.split(' ').length <= 12 ? { label: text.replace(/\.$/, ''), meaning: '' } : { label: '', meaning: text };
  }

  // ---------- page orientation ----------
  function rotated(c, quarter) {
    if (!quarter) return c;
    const r = document.createElement('canvas'), odd = quarter % 2;
    r.width = odd ? c.height : c.width; r.height = odd ? c.width : c.height;
    const g = r.getContext('2d'); g.translate(r.width / 2, r.height / 2); g.rotate(quarter * Math.PI / 2); g.drawImage(c, -c.width / 2, -c.height / 2);
    return r;
  }
  async function textScore(w, c) {
    const { data } = await w.recognize(drawScaled(c, 1000, false));
    return (data.words || []).filter(wd => wd.confidence > 70 && /[a-z]{3,}/i.test(wd.text)).length;
  }
  /** Quarter turns (clockwise) that make the text upright: whichever reads the most real words. */
  async function uprightTurns(w, c) {
    let best = 0, bestScore = await textScore(w, c);
    if (bestScore >= 12) return 0;
    for (const q of [2, 1, 3]) {
      const s = await textScore(w, rotated(c, q));
      if (s > bestScore) { best = q; bestScore = s; }
      if (bestScore >= 12) break;
    }
    return best;
  }

  // ---------- finding the boxes ----------
  /**
   * Boxes drawn as outlines (book pages, printed diagrams): find areas fully enclosed by
   * dark lines. Works on off-white paper, with uneven light and anything around the page.
   */
  function outlineBoxes(c) {
    const s = drawScaled(c, 1000, false), W = s.width, H = s.height, N = W * H, d = s.getContext('2d').getImageData(0, 0, W, H).data;
    const gray = new Float32Array(N);
    for (let i = 0; i < N; i++) gray[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
    const local = Vision.geom.blur(gray, W, H, Math.max(4, Math.round(Math.min(W, H) / 30)));
    let ink = new Uint8Array(N);
    for (let i = 0; i < N; i++) ink[i] = gray[i] < local[i] - 25 ? 1 : 0;    // darker than its surroundings
    ink = Vision.geom.morph(ink, W, H, 1, true);                               // seal small gaps in outlines
    const open = new Uint8Array(N); for (let i = 0; i < N; i++) open[i] = ink[i] ? 0 : 1;
    let boxes = Vision.geom.components(open, W, H, N * 0.002)
      .filter(cm => !cm.edge && cm.span < N * 0.2)
      .map(cm => { const r = Vision.geom.minRect(cm.hull); r.fill = cm.span / (r.L * r.S); return r; })
      .filter(r => r.fill > 0.85 && r.S / r.L > 0.4 && r.S / r.L < 0.95);
    if (boxes.length > 1) {   // keep boxes of a consistent size (drops frames, icons, page panels)
      const m = Vision.median(boxes.map(b => b.L * b.S));
      boxes = boxes.filter(b => b.L * b.S > m * 0.4 && b.L * b.S < m * 2.5);
    }
    const k = c.width / W, t = Math.max(2, Math.min(W, H) * 0.006);         // interior → outer edge of the line
    return boxes.map(b => Vision.orient({ cx: b.cx * k, cy: b.cy * k, L: (b.L + 2 * t) * k, S: (b.S + 2 * t) * k, ux: b.ux, uy: b.uy }));
  }
  /** Solid or filled boxes (and crossed cards) via the same detector used for card photos. */
  function solidBoxes(c) {
    const lo = drawScaled(c, 960, false), k = c.width / lo.width;
    return Vision.detect(lo.getContext('2d').getImageData(0, 0, lo.width, lo.height)).dets
      .map(d => ({ ...d, cx: d.cx * k, cy: d.cy * k, L: d.L * k, S: d.S * k }));
  }
  function findBoxes(c) {
    const ol = outlineBoxes(c), so = solidBoxes(c);
    // Outlines are more reliable on paper; the solid detector wins when it sees a crossed pair
    // that the outline method splits apart, or when there are no outlines at all.
    if (!ol.length) return so;
    if (so.some(d => d.occluded) && so.length === ol.length + 1) return so;
    return ol;
  }

  /**
   * OCR the inside of each box: cut out (inset from its outline, on white, enlarged for
   * legibility) and read as one block of text, which catches lone or decorative numbers
   * ("1ST CARD") that whole-page reading misses. Returns, per box, the words found inside it.
   */
  function boxCrop(c, b, H, P, binarise) {
    const ex = (Math.abs(b.ux) * b.L + Math.abs(b.uy) * b.S) / 2 * 0.84;
    const ey = (Math.abs(b.uy) * b.L + Math.abs(b.ux) * b.S) / 2 * 0.84;
    const cv = document.createElement('canvas');
    cv.width = Math.round(2 * ex * H / (2 * ey)) + 2 * P; cv.height = H + 2 * P;
    const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height);
    g.drawImage(c, b.cx - ex, b.cy - ey, 2 * ex, 2 * ey, P, P, cv.width - 2 * P, H);
    if (binarise) {   // pure black on white helps thin decorative lettering
      const id = g.getImageData(0, 0, cv.width, cv.height), d = id.data; let s = 0;
      for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2];
      const cut = s / (d.length / 4) / 3 * 0.7;
      for (let i = 0; i < d.length; i += 4) { const v = (d[i] + d[i + 1] + d[i + 2]) / 3 < cut ? 0 : 255; d[i] = d[i + 1] = d[i + 2] = v; }
      g.putImageData(id, 0, 0);
    }
    return cv;
  }
  /**
   * OCR the inside of each box, cut out from its outline and enlarged. Decorative numbers
   * ("1ST CARD") read inconsistently, so: one fast pass with every box stacked on one sheet,
   * then a second, individual read only for boxes whose number is still unclear.
   * Returns, per box, {words (reliable text), readings: [raw strings]}.
   */
  async function readBoxes(w, c, boxes) {
    const out = boxes.map(() => ({ words: [], readings: [] }));
    if (!boxes.length) return out;
    const keep = (o, data, minConf) => {
      for (const wd of data) {
        const text = clean(wd.text); if (!text) continue;
        o.readings.push(text);
        if (wd.confidence >= minConf) o.words.push({ text, conf: wd.confidence, bbox: wd.bbox });
      }
    };
    await w.setParameters({ tessedit_pageseg_mode: '6' });
    try {
      // Pass 1: all boxes, black-and-white, one per row.
      const tiles = boxes.map(b => boxCrop(c, b, 120, 0, true)), GAP = 60;
      const sheet = document.createElement('canvas');
      sheet.width = Math.max(...tiles.map(t => t.width)) + 2 * GAP; sheet.height = tiles.reduce((s, t) => s + t.height + GAP, GAP);
      const g = sheet.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, sheet.width, sheet.height);
      let y = GAP; const rows = tiles.map(t => { g.drawImage(t, GAP, y); const r = [y, y + t.height]; y += t.height + GAP; return r; });
      const { data } = await w.recognize(sheet);
      const per = boxes.map(() => []);
      for (const wd of data.words || []) {
        const cy = (wd.bbox.y0 + wd.bbox.y1) / 2, i = rows.findIndex(([a, b]) => cy >= a - GAP / 2 && cy < b + GAP / 2);
        if (i >= 0) per[i].push(wd);
      }
      per.forEach((ws, i) => keep(out[i], ws, 101));   // positions on the sheet aren't page positions: readings only
      // Pass 2: boxes without a clear number, read on their own in greyscale.
      for (let i = 0; i < boxes.length; i++) {
        const ev = numberEvidence(out[i].readings);
        if (Math.max(0, ...ev.values()) >= 2) continue;
        const { data: d2 } = await w.recognize(boxCrop(c, boxes[i], 220, 0, false));
        keep(out[i], d2.words || [], 50);
      }
    } finally { await w.setParameters({ tessedit_pageseg_mode: '11' }); }
    return out;
  }
  // OCR confusions seen in decorative lettering: a letter read where a digit was ("STH" = 5TH),
  // a digit read where a suffix letter was ("151" = 1ST), and digits that look alike (7 ↔ 1).
  const DIGIT_FOR = { O: '0', D: '0', I: '1', L: '1', Z: '2', A: '4', S: '5', G: '6', B: '8', T: '7', Q: '9' };
  const LETTER_FOR = { 5: 'S', 9: 'S', 1: 'T', 7: 'T', 0: 'D' };
  const SIMILAR = { 1: [7, 4], 7: [1], 4: [1], 3: [8], 8: [3], 6: [5], 5: [6], 2: [7] };
  const SUFFIX = { ST: 'ST', ND: 'ND', N: 'ND', NO: 'ND', RD: 'RD', RO: 'RD', TH: 'TH' };
  const SUFFIX_NUM = { ST: 1, ND: 2, RD: 3 };
  const suffixFor = n => (n % 100 >= 11 && n % 100 <= 13) ? 'TH' : ({ 1: 'ST', 2: 'ND', 3: 'RD' }[n % 10] || 'TH');
  /** How strongly a box's readings suggest each number: Map(number → weight). */
  function numberEvidence(readings) {
    const ev = new Map(), add = (n, wt) => { if (n > 0 && n <= 40) ev.set(n, (ev.get(n) || 0) + wt); };
    for (const r of readings) {
      if (WORDNUM[r.toLowerCase()]) { add(WORDNUM[r.toLowerCase()], 3); continue; }
      const plain = numOnly(r); if (plain != null) { add(plain, 2); continue; }
      const t = r.toUpperCase().replace(/[^0-9A-Z]/g, '');
      if (!t || t.length > 4 || /^CAR/.test(t) || isFiller(r)) continue;    // "CARD" ends in RD but isn't 3RD
      if (SUFFIX_NUM[t]) { add(SUFFIX_NUM[t], 1); continue; }               // "ST" alone
      let parsed = false;
      for (const hl of [1, 2]) {                                             // number part, then suffix part
        const head = t.slice(0, hl), tail = t.slice(hl);
        if (!tail || tail.length > 2) continue;
        const suf = SUFFIX[tail.split('').map(ch => /\d/.test(ch) ? LETTER_FOR[ch] || ch : ch).join('')];
        if (!suf) continue;
        const digits = head.split('').map(ch => /\d/.test(ch) ? ch : DIGIT_FOR[ch] || '').join('');
        if (digits.length !== head.length || !+digits) continue;   // "MIND" ends in ND but M isn't a digit
        parsed = true;
        const n = +digits, exact = /^\d+$/.test(head) && tail === suf;
        if (suffixFor(n) === suf) add(n, exact ? 3 : 2);                     // "4TH" strong, "STH" good
        else {                                                               // digit and suffix disagree: trust the suffix
          if (SUFFIX_NUM[suf]) add(SUFFIX_NUM[suf], 1);
          for (const alt of SIMILAR[n] || []) if (suffixFor(alt) === suf) add(alt, 1);
          add(n, 0.3);
        }
        break;
      }
      if (!parsed) { const lead = t.match(/^([1-9])[A-Z]{0,2}$/); if (lead) add(+lead[1], 1); }   // "3h)"
    }
    return ev;
  }
  const wordSet = t => new Set(String(t).toLowerCase().match(/[a-z]{2,}/g)?.map(x => x.slice(0, 5)) || []);
  /** Word overlap (Jaccard) between a box caption and a legend line, 0..1:
      "Do This" scores 1 against "Do this." but only 0.5 against "Do not do this." */
  function overlap(a, b) {
    const A = wordSet(a), B = wordSet(b); if (!A.size || !B.size) return 0;
    let k = 0; for (const x of A) if (B.has(x)) k++;
    return k / (A.size + B.size - k);
  }
  /** Minimum-cost assignment for a small square matrix. */
  function assign(cost) {
    const n = cost.length, INF = 1e18, u = new Float64Array(n + 1), v = new Float64Array(n + 1), p = new Int32Array(n + 1), way = new Int32Array(n + 1);
    for (let i = 1; i <= n; i++) {
      p[0] = i; let j0 = 0; const minv = new Float64Array(n + 1).fill(INF), used = new Uint8Array(n + 1);
      do {
        used[j0] = 1; const i0 = p[j0]; let delta = INF, j1 = 0;
        for (let j = 1; j <= n; j++) if (!used[j]) { const cur = cost[i0 - 1][j - 1] - u[i0] - v[j]; if (cur < minv[j]) { minv[j] = cur; way[j] = j0; } if (minv[j] < delta) { delta = minv[j]; j1 = j; } }
        for (let j = 0; j <= n; j++) { if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else minv[j] -= delta; }
        j0 = j1;
      } while (p[j0] !== 0);
      do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0);
    }
    const ans = new Array(n); for (let j = 1; j <= n; j++) ans[p[j] - 1] = j - 1; return ans;
  }

  /**
   * @param img ImageBitmap/canvas of the template
   * @param onStep progress callback(message)
   * @returns {name, description, positions:[{label, meaning, x, y, rot}], picture (upright canvas), turned, found:{boxes, legend, numbered}}
   */
  async function read(img, onStep = () => {}) {
    onStep('Starting the text reader (first time can take a little while)…');
    const w = await worker();
    let c = drawScaled(img, 2000, false);
    const times = {}, t0 = performance.now(), lap = k => { times[k] = Math.round(performance.now() - t0); };
    onStep('Checking which way up the picture is…');
    const turns = await uprightTurns(w, c);
    c = rotated(c, turns); lap('orient');

    onStep('Finding the card boxes…');
    const boxes = findBoxes(c).map(d => ({ ...d, num: null, inner: [], near: [] })); lap('boxes');

    onStep('Reading the text…');
    const { data } = await w.recognize(c); lap('page');
    const lines = (data.lines || []).map(l => ({
      text: clean(l.text), bbox: l.bbox, h: l.bbox.y1 - l.bbox.y0, conf: l.confidence,
      words: (l.words || []).map(wd => ({ text: clean(wd.text), bbox: wd.bbox, conf: wd.confidence }))
        .filter(wd => wd.text && (wd.conf >= 45 || numOnly(wd.text) != null)),
    })).filter(l => l.words.length).sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0);

    // 1) Text inside each box is read separately — box outlines confuse whole-page OCR.
    onStep('Reading the numbers on the boxes…');
    const readable = boxes.filter(b => !b.occluded);   // the card under a crossing card: its middle is hidden
    const perBox = await readBoxes(w, c, readable); lap('boxText');
    boxes.forEach(b => { b.readings = []; });
    readable.forEach((b, i) => {
      b.readings = perBox[i].readings;
      b.inner = perBox[i].words.filter(wd => numberOf(wd.text) == null && !isFiller(wd.text) && numberEvidence([wd.text]).size === 0 && /[a-z]{2}/i.test(wd.text));
    });

    // Whole-page words that fall inside a box: small captions ("Do This") read better here than in the crop.
    const outside = [];
    boxes.forEach(b => { b.pageInner = []; });
    for (const l of lines) {
      const rest = [];
      for (const wd of l.words) {
        const bx = boxes.find(b => inside(b, centre(wd.bbox)));
        if (!bx) { rest.push(wd); continue; }
        bx.readings.push(wd.text);
        if (wd.conf >= 60 && /[a-z]{3}/i.test(wd.text) && !isFiller(wd.text) && numberEvidence([wd.text]).size === 0) bx.pageInner.push(wd);
      }
      if (rest.length) outside.push({ ...l, words: rest, text: clean(rest.map(x => x.text).join(' ')),
        bbox: { x0: Math.min(...rest.map(x => x.bbox.x0)), y0: Math.min(...rest.map(x => x.bbox.y0)), x1: Math.max(...rest.map(x => x.bbox.x1)), y1: Math.max(...rest.map(x => x.bbox.y1)) } });
    }

    // 2) Numbered legend lines ("1. Past – …"), with wrapped continuation lines.
    const legend = new Map(), used = new Set();
    let cur = null;
    for (const l of outside) {
      const m = l.text.match(/^\(?(\d{1,2})\s*[.):\-–—]?\s+(.{2,})$/);
      if (m && +m[1] > 0 && +m[1] <= 30) { cur = { n: +m[1], text: m[2], last: l }; legend.set(cur.n, cur); used.add(l); continue; }
      if (cur && l.bbox.y0 - cur.last.bbox.y1 < cur.last.h * 1.2 && Math.abs(l.bbox.x0 - cur.last.bbox.x0) < cur.last.h * 4 && !boxes.some(b => inside(b, centre(l.bbox), b.L * 0.6))) {
        cur.text += ' ' + l.text; cur.last = l; used.add(l); continue;
      }
      cur = null;
    }

    // 3) Loose numbers next to a box, then nearby captions.
    for (const l of outside) {
      if (used.has(l) || /\bcard spread\b/i.test(l.text)) continue;   // "(3-Card Spread)" is a subtitle, not a caption
      const n = numberOf(l.text), p = centre(l.bbox);
      const near = boxes.map(b => ({ b, d: Math.hypot(p.x - b.cx, p.y - b.cy) })).filter(x => inside(x.b, p, x.b.L * 0.45)).sort((a, b) => a.d - b.d)[0];
      if (!near) continue;
      if (n != null) { near.b.readings.push(l.text); used.add(l); continue; }
      near.b.near.push(l); used.add(l);
    }

    // 4) Number the boxes. Each number 1..n goes to exactly one box, using all the clues at once:
    //    numbers read on or next to the box, and how well its caption matches a numbered legend line
    //    ("Do This" ↔ "3. Do this."). Boxes with no clues fall back to reading order.
    const nB = boxes.length, ro = Vision.readingOrder(boxes), rank = new Map(ro.map((bi, k2) => [bi, k2]));
    const ownText = b => (b.pageInner.length ? b.pageInner : b.inner).slice().sort((x, y) => x.bbox.y0 - y.bbox.y0 || x.bbox.x0 - y.bbox.x0).map(x => x.text).join(' ');
    const evidence = boxes.map(b => {
      const ev = numberEvidence(b.readings), caption = ownText(b) + ' ' + b.near.map(x => x.text).join(' ');
      return Array.from({ length: nB }, (_, k2) => {
        const lg = legend.get(k2 + 1), sim = lg ? overlap(caption, lg.text) : 0;
        return (ev.get(k2 + 1) || 0) + (sim >= 0.25 ? 4 * sim : 0);
      });
    });
    const pick = nB ? assign(boxes.map((b, bi) => evidence[bi].map((e, k2) => -e + 0.05 * Math.abs(rank.get(bi) - k2)))) : [];
    boxes.forEach((b, bi) => { b.num = pick[bi] + 1; });
    const supported = boxes.filter((b, bi) => evidence[bi][pick[bi]] > 0).length;
    const numbered = nB > 0 && supported >= nB - 1;   // at most one box placed by elimination
    const order = boxes.map((b, i) => i).sort((a, b) => boxes[a].num - boxes[b].num);
    const layout = boxes.length ? Vision.layoutFromDets(boxes) : [];
    // layoutFromDets returns positions in reading order; map back to box indices.
    const posOf = new Map(ro.map((bi, k2) => [bi, layout[k2]]));

    const positions = order.map((bi, k2) => {
      const b = boxes[bi], n = b.num;
      const lg = legend.get(n);
      const innerText = clean(ownText(b));
      const nearText = clean(b.near.map(x => x.text).join(' '));
      // Text on a box only counts if it has real words (decorative numbers read as junk like "IN)").
      const realWords = t => (t.match(/[a-z]{3,}/gi) || []).length;
      let label = '', meaning = '';
      if (lg) ({ label, meaning } = split(lg.text));
      if (!label && nearText) { const s = split(nearText); label = s.label; meaning = meaning || s.meaning; }
      if (!label && realWords(innerText) && innerText.length < 40) label = innerText;
      // A box's own caption makes a good meaning, unless it only repeats the label ("Not This" ⊂ "Do not do this").
      const labelWords = wordSet(label), extra = [...wordSet(innerText)].filter(x => !labelWords.has(x));
      if (!meaning && realWords(innerText) >= 2 && extra.length) meaning = innerText;
      const p = posOf.get(bi);
      return { label: label || `Position ${k2 + 1}`, meaning, x: p.x, y: p.y, rot: p.rot };
    });

    // No boxes found but a numbered list was: lay positions out in a row to arrange by hand.
    if (!positions.length && legend.size) {
      [...legend.values()].sort((a, b) => a.n - b.n).forEach((lg, i) => { const s = split(lg.text); positions.push({ label: s.label || `Position ${i + 1}`, meaning: s.meaning, x: i * 0.75, y: 0, rot: false }); });
    }

    // 5) Title: the biggest unused text near the top. Description: the remaining sentences.
    const rest = outside.filter(l => !used.has(l) && l.text.length > 2 && !/^\d+$/.test(l.text));
    // Titles are often in a decorative font that OCR reads with low confidence, so use the raw lines here.
    // The title sits above the boxes; lines that overlap a box are usually OCR noise from its outline.
    const boxTop = boxes.length ? Math.min(...boxes.map(b => b.cy - (Math.abs(b.uy) * b.L + Math.abs(b.ux) * b.S) / 2)) : c.height * 0.4;
    const top = (data.lines || []).map(l => ({ text: clean(l.text), bbox: l.bbox, h: l.bbox.y1 - l.bbox.y0, conf: l.confidence }))
      .filter(l => l.bbox.y1 <= Math.min(boxTop + 10, c.height * 0.45) && l.conf > 20 && l.h < c.height * 0.12
        && (l.text.match(/[a-z]/gi) || []).length >= 4 && !/^\(?\d|card spread/i.test(l.text))
      .sort((a, b) => (/spread/i.test(b.text) - /spread/i.test(a.text)) || b.h - a.h)[0];
    const name = top ? titleCase(top.text.replace(/[^a-z0-9'&\- ]/gi, ' ').replace(/\s+/g, ' ').trim()) : '';
    const description = clean(rest.filter(l => l !== top && l.text.length > 25 && !/card spread\)?$/i.test(l.text)).map(l => l.text).join(' ')).slice(0, 600);

    const debug = boxes.map((b, bi) => ({ at: [Math.round(b.cx), Math.round(b.cy)], num: b.num, readings: b.readings.join(' '), caption: ownText(b) + ' / ' + b.near.map(x => x.text).join(' '), ev: evidence[bi].map(e => +e.toFixed(1)).join(',') }));
    return { name, description, positions, picture: c, turned: turns, found: { boxes: boxes.length, legend: legend.size, numbered }, debug, times,
      legendText: [...legend.values()].map(l => l.n + ': ' + l.text) };
  }

  return { read, worker, ordinal, _internals: { findBoxes, readBoxes, rotated, uprightTurns } };
})();
