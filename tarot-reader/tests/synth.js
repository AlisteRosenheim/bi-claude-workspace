/* Synthetic end-to-end test: fake deck + fake photo of a spread → run the real pipeline. */
window.SynthTest = (() => {
  function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
  function makeCard(i, R) {
    const c = document.createElement('canvas'); c.width = 350; c.height = 600; const g = c.getContext('2d');
    g.fillStyle = '#f2ead8'; g.fillRect(0, 0, 350, 600);                 // shared cream border
    g.fillStyle = '#222'; g.fillRect(14, 14, 322, 572);
    const h = R() * 360;
    const grd = g.createLinearGradient(0, 20, 0, 520); grd.addColorStop(0, `hsl(${h},55%,${30 + R() * 40}%)`); grd.addColorStop(1, `hsl(${(h + 60 + R() * 120) % 360},50%,${20 + R() * 40}%)`);
    g.fillStyle = grd; g.fillRect(20, 20, 310, 500);
    for (let k = 0; k < 7; k++) {
      g.fillStyle = `hsla(${R() * 360},${40 + R() * 50}%,${20 + R() * 60}%,0.9)`;
      g.beginPath();
      if (R() < 0.5) g.arc(40 + R() * 270, 40 + R() * 460, 15 + R() * 70, 0, 7);
      else { g.moveTo(30 + R() * 290, 30 + R() * 480); for (let v = 0; v < 3 + (R() * 3 | 0); v++) g.lineTo(30 + R() * 290, 30 + R() * 480); }
      g.fill();
    }
    g.fillStyle = '#f2ead8'; g.fillRect(20, 528, 310, 52);
    g.fillStyle = '#222'; g.font = 'bold 30px Georgia'; g.textAlign = 'center'; g.fillText('CARD ' + (i + 1), 175, 565);
    return c;
  }
  async function deck(n = 78, seed = 7) {
    const R = rng(seed), cards = [];
    for (let i = 0; i < n; i++) {
      const cv = makeCard(i, R);
      cards.push({ ...newCard({ name: 'Card ' + (i + 1), upright: 'Upright meaning ' + (i + 1), reversed: 'Reversed meaning ' + (i + 1), description: 'Art of card ' + (i + 1) }), feat: Vision.features(Vision.canonicalFromImage(cv, false)), _canvas: cv });
    }
    return cards;
  }
  /** Use the real deck already saved in the app (its stored art) instead of generated cards. */
  async function realDeck() {
    const cards = (await DB.all('cards')).filter(c => c.image && c.feat);
    for (const c of cards) {
      const bm = await createImageBitmap(c.image), cv = document.createElement('canvas');
      cv.width = bm.width; cv.height = bm.height; cv.getContext('2d').drawImage(bm, 0, 0); c._canvas = cv;
    }
    return cards;
  }
  /** Draw a photo of the given spread. Returns {blob, truth:[{id, reversed, pos}]} */
  async function photo(cards, positions, seed = 3, opts = {}) {
    const R = rng(seed), W = 3000, H = 2250, c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
    // wood-ish background
    g.fillStyle = opts.bg || '#5b3b24'; g.fillRect(0, 0, W, H);
    for (let k = 0; k < 400; k++) { g.strokeStyle = `rgba(${30 + R() * 40},${15 + R() * 20},0,${0.15 + R() * 0.2})`; g.lineWidth = 2 + R() * 8; g.beginPath(); const y = R() * H; g.moveTo(0, y); g.bezierCurveTo(W / 3, y + R() * 60 - 30, 2 * W / 3, y + R() * 60 - 30, W, y + R() * 40 - 20); g.stroke(); }
    const ch = opts.cardH || 430, cw = ch * 350 / 600;
    const xs = positions.map(p => p.x), ys = positions.map(p => p.y);
    const cx0 = W / 2 - (Math.max(...xs) + Math.min(...xs)) / 2 * ch * (opts.spacing || 1), cy0 = H / 2 - (Math.max(...ys) + Math.min(...ys)) / 2 * ch * (opts.spacing || 1);
    const pool = cards.map((c, i) => i).sort(() => R() - 0.5), truth = [];
    positions.forEach((p, j) => {
      const card = cards[pool[j]], rev = !p.rot && R() < 0.35;
      truth.push({ id: card.id, reversed: rev, pos: j });
      g.save();
      g.translate(cx0 + p.x * ch * (opts.spacing || 1) + (R() - 0.5) * 30, cy0 + p.y * ch * (opts.spacing || 1) + (R() - 0.5) * 30);
      g.rotate((p.rot ? Math.PI / 2 : 0) + (rev ? Math.PI : 0) + (R() - 0.5) * 0.12);
      g.shadowColor = 'rgba(0,0,0,.5)'; g.shadowBlur = 18; g.shadowOffsetY = 6;
      const w = ch * card._canvas.width / card._canvas.height;   // keep the deck's own proportions
      g.drawImage(card._canvas, -w / 2, -ch / 2, w, ch);
      g.restore();
    });
    // lighting: warm tint + vignette + glare
    g.fillStyle = 'rgba(255,200,120,0.12)'; g.fillRect(0, 0, W, H);
    const vg = g.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, W * 0.75); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.45)'); g.fillStyle = vg; g.fillRect(0, 0, W, H);
    if (opts.glare) { const gl = g.createRadialGradient(W * 0.4, H * 0.35, 0, W * 0.4, H * 0.35, 260); gl.addColorStop(0, 'rgba(255,255,255,.55)'); gl.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gl; g.fillRect(0, 0, W, H); }
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.8));
    return { blob, truth };
  }
  async function run({ spreadName = 'Celtic Cross', seed = 3, opts = {}, deckSize = 78 } = {}) {
    if (!window._synthDeck || window._synthDeck.length !== deckSize) window._synthDeck = await deck(deckSize);
    S.cards = window._synthDeck;               // in memory only — not saved
    const sp = S.spreads.find(s => s.name.startsWith(spreadName));
    const { blob, truth } = await photo(S.cards, sp.positions, seed, opts);
    const t0 = performance.now();
    await startReading(blob);
    const ms = Math.round(performance.now() - t0), s = S.session;
    let cardOK = 0, revOK = 0, posOK = 0; const misses = [];
    for (const t of truth) {
      const di = s.dets.findIndex(d => d.cardId === t.id);
      if (di < 0) {
        const dj = s.assign.indexOf(t.pos), d = s.dets[dj];
        const rank = d ? d.matches.findIndex(m => m.id === t.id) : -2;
        misses.push({ pos: t.pos, conf: d && d.conf, rank, best: d && d.score && d.score.toFixed(3), truthScore: d && rank >= 0 ? d.matches[rank].score.toFixed(3) : null, sideways: d && d.sideways });
        continue;
      }
      cardOK++;
      if (!!s.dets[di].reversed === t.reversed) revOK++;
      if (s.assign[di] === t.pos) posOK++;
    }
    return { spread: spreadName, seed, found: s.dets.length, expected: truth.length, chosen: (spreadById(s.spreadId) || {}).name, quality: spreadQuality(s).text, cardOK, revOK, posOK, misses, scores: s.dets.map(d => d.score && +d.score.toFixed(2)).join(','), conf: s.dets.map(d => d.conf).join(','), ms };
  }
  /** Score several detection settings on the same photos. */
  async function sweep(cases, cfgs) {
    if (!window._synthDeck) window._synthDeck = await deck(78);
    S.cards = window._synthDeck;
    window._photos = window._photos || {};
    for (const [name, seed, opts] of cases) {
      const key = name + seed + JSON.stringify(opts);
      if (!window._photos[key]) window._photos[key] = await photo(S.cards, S.spreads.find(s => s.name.startsWith(name)).positions, seed, opts);
    }
    const out = [];
    for (const cfg of cfgs) {
      if (cfg.size) DETECT_SIZE = cfg.size;
      let found = 0, ok = 0, total = 0, spreadOK = 0; const per = [];
      for (const [name, seed, opts] of cases) {
        const { blob, truth } = window._photos[name + seed + JSON.stringify(opts)];
        await startReading(blob);
        const s = S.session, okHere = truth.filter(t => s.dets.some(d => d.cardId === t.id)).length;
        total += truth.length; ok += okHere; found += Math.min(s.dets.length, truth.length);
        const sp = spreadById(s.spreadId); if (sp && sp.name.startsWith(name) && s.dets.length === truth.length) spreadOK++;
        per.push(`${okHere}/${truth.length}${s.dets.length !== truth.length ? '(' + s.dets.length + ')' : ''}`);
      }
      out.push(`${JSON.stringify(cfg)} cards ${ok}/${total} spreads ${spreadOK}/${cases.length} :: ${per.join(' ')}`);
    }
    return out;
  }
  return { deck, realDeck, photo, run, sweep };
})();
