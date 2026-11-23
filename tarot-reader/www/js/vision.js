/* Vision: finds cards in a photo, recognises them against the saved art,
   and matches the layout to a saved spread. Plain JS, fully offline. */
const Vision = (() => {
  const CW = 60, CH = 104;          // canonical card size used for comparison
  const FEAT_VERSION = 1;
  // Detection settings tried on every photo: plain (best for most tables) and
  // texture-smoothed (helps on light or patterned tables). The app keeps whichever recognises better.
  const CFG = { blurDiv: 0, varK: 0 };
  const CFGS = [CFG, { blurDiv: 240, varK: 1.15 }];

  // ---------- colour ----------
  const LIN = new Float32Array(256);
  for (let i = 0; i < 256; i++) { const c = i / 255; LIN[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  const fl = t => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
  function lab(r, g, b, out) {
    const R = LIN[r], G = LIN[g], B = LIN[b];
    const x = fl((R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047);
    const y = fl(R * 0.2126 + G * 0.7152 + B * 0.0722);
    const z = fl((R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883);
    out[0] = 116 * y - 16; out[1] = 500 * (x - y); out[2] = 200 * (y - z);
  }

  // ---------- small maths helpers ----------
  const median = a => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
  const mean = a => a.reduce((s, x) => s + x, 0) / (a.length || 1);
  function unit(v) { let s = 0; for (let i = 0; i < v.length; i++) s += v[i] * v[i]; s = Math.sqrt(s) || 1; for (let i = 0; i < v.length; i++) v[i] /= s; return v; }
  function centre(v, scaleStd) {
    let m = 0; for (let i = 0; i < v.length; i++) m += v[i]; m /= v.length;
    let s = 0; for (let i = 0; i < v.length; i++) { v[i] -= m; s += v[i] * v[i]; }
    if (scaleStd) { const sd = Math.max(Math.sqrt(s / v.length), 2); for (let i = 0; i < v.length; i++) v[i] /= sd; }
    return v;
  }
  function dot(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }

  // ---------- card descriptors ----------
  function grid(src, w, h, gx, gy) {
    const out = new Float32Array(gx * gy);
    for (let cy = 0; cy < gy; cy++) {
      const y0 = Math.floor(cy * h / gy), y1 = Math.floor((cy + 1) * h / gy);
      for (let cx = 0; cx < gx; cx++) {
        const x0 = Math.floor(cx * w / gx), x1 = Math.floor((cx + 1) * w / gx);
        let s = 0;
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) s += src[y * w + x];
        out[cy * gx + cx] = s / ((y1 - y0) * (x1 - x0));
      }
    }
    return out;
  }
  function hog(L, w, h, gx, gy, bins) {
    const out = new Float32Array(gx * gy * bins);
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const dx = L[y * w + x + 1] - L[y * w + x - 1], dy = L[(y + 1) * w + x] - L[(y - 1) * w + x];
      const m = Math.hypot(dx, dy); if (m < 1) continue;
      let a = Math.atan2(dy, dx); if (a < 0) a += Math.PI;
      const b = Math.min(bins - 1, Math.floor(a / Math.PI * bins));
      const cx = Math.min(gx - 1, Math.floor(x * gx / w)), cy = Math.min(gy - 1, Math.floor(y * gy / h));
      out[(cy * gx + cx) * bins + b] += m;
    }
    for (let c = 0; c < gx * gy; c++) {
      let s = 0; for (let b = 0; b < bins; b++) s += out[c * bins + b] ** 2;
      s = Math.sqrt(s) + 10;
      for (let b = 0; b < bins; b++) out[c * bins + b] /= s;
    }
    return out;
  }

  /** Descriptor of a canonical CW x CH RGBA card image. */
  function features(px) {
    const mx = 5, my = 6, w = CW - 2 * mx, h = CH - 2 * my, n = w * h;
    const L = new Float32Array(n), A = new Float32Array(n), B = new Float32Array(n), t = [0, 0, 0];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = ((y + my) * CW + x + mx) * 4, k = y * w + x;
      lab(px[i], px[i + 1], px[i + 2], t); L[k] = t[0]; A[k] = t[1]; B[k] = t[2];
    }
    const th = unit(centre(grid(L, w, h, 10, 18), true));
    const cl = centre(grid(L, w, h, 5, 9), true), ca = centre(grid(A, w, h, 5, 9), false), cb = centre(grid(B, w, h, 5, 9), false);
    const col = new Float32Array(135);
    for (let i = 0; i < 45; i++) { col[i] = cl[i]; col[45 + i] = ca[i] / 10; col[90 + i] = cb[i] / 10; }
    unit(col);
    const g = unit(centre(hog(L, w, h, 5, 8, 9), false));
    return { v: FEAT_VERSION, t: th, c: col, g };
  }
  const similarity = (a, b) => 0.4 * dot(a.t, b.t) + 0.3 * dot(a.c, b.c) + 0.3 * dot(a.g, b.g);

  function rot180(px) {
    const o = new Uint8ClampedArray(px.length), n = px.length / 4;
    for (let i = 0; i < n; i++) { const j = (n - 1 - i) * 4, k = i * 4; o[k] = px[j]; o[k + 1] = px[j + 1]; o[k + 2] = px[j + 2]; o[k + 3] = 255; }
    return o;
  }
  function downsample(data, S) {
    const W = CW * S, out = new Uint8ClampedArray(CW * CH * 4), n = S * S;
    for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
        const i = ((y * S + sy) * W + x * S + sx) * 4; r += data[i]; g += data[i + 1]; b += data[i + 2];
      }
      const o = (y * CW + x) * 4; out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = 255;
    }
    return out;
  }

  /** Canonical pixels from a stored card image (already cropped to the card). */
  function canonicalFromImage(img, rotate) {
    const S = 3, c = document.createElement('canvas');
    c.width = CW * S; c.height = CH * S;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.imageSmoothingQuality = 'high';
    if (rotate) { g.translate(c.width, 0); g.rotate(Math.PI / 2); g.drawImage(img, 0, 0, c.height, c.width); }
    else g.drawImage(img, 0, 0, c.width, c.height);
    return downsample(g.getImageData(0, 0, c.width, c.height).data, S);
  }

  /** Cut a detected card out of the photo and straighten it to canonical size. */
  function warp(im, d) {
    const S = 3, W = im.width, H = im.height, src = im.data, out = new Uint8ClampedArray(CW * CH * 4);
    const ux = d.ux, uy = d.uy, vx = uy, vy = -ux, n = S * S;
    for (let j = 0; j < CH; j++) for (let i = 0; i < CW; i++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < S; sy++) {
        const fu = ((j + (sy + 0.5) / S) / CH - 0.5) * d.L;
        for (let sx = 0; sx < S; sx++) {
          const fv = ((i + (sx + 0.5) / S) / CW - 0.5) * d.S;
          let X = d.cx + vx * fv + ux * fu - 0.5, Y = d.cy + vy * fv + uy * fu - 0.5;
          if (X < 0) X = 0; else if (X > W - 1.001) X = W - 1.001;
          if (Y < 0) Y = 0; else if (Y > H - 1.001) Y = H - 1.001;
          const x0 = X | 0, y0 = Y | 0, fx = X - x0, fy = Y - y0, p = (y0 * W + x0) * 4, q = p + W * 4;
          const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
          r += src[p] * w00 + src[p + 4] * w10 + src[q] * w01 + src[q + 4] * w11;
          g += src[p + 1] * w00 + src[p + 5] * w10 + src[q + 1] * w01 + src[q + 5] * w11;
          b += src[p + 2] * w00 + src[p + 6] * w10 + src[q + 2] * w01 + src[q + 6] * w11;
        }
      }
      const o = (j * CW + i) * 4; out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = 255;
    }
    return out;
  }

  // Comparing only part of a card (e.g. the ends of a card under a crossing card).
  function subsetIdx(visible) {
    const my = 6, h = CH - 2 * my, frac = (cy, gy) => (my + (cy + 0.5) * h / gy) / CH, t = [], c = [], g = [];
    for (let cy = 0; cy < 18; cy++) if (visible(frac(cy, 18))) for (let cx = 0; cx < 10; cx++) t.push(cy * 10 + cx);
    for (let ch = 0; ch < 3; ch++) for (let cy = 0; cy < 9; cy++) if (visible(frac(cy, 9))) for (let cx = 0; cx < 5; cx++) c.push(ch * 45 + cy * 5 + cx);
    for (let cy = 0; cy < 8; cy++) if (visible(frac(cy, 8))) for (let cx = 0; cx < 5; cx++) for (let b = 0; b < 9; b++) g.push((cy * 5 + cx) * 9 + b);
    return { t, c, g };
  }
  function subCorr(a, b, idx) {
    let ma = 0, mb = 0; for (const i of idx) { ma += a[i]; mb += b[i]; } ma /= idx.length; mb /= idx.length;
    let ab = 0, aa = 0, bb = 0;
    for (const i of idx) { const x = a[i] - ma, y = b[i] - mb; ab += x * y; aa += x * x; bb += y * y; }
    return ab / Math.sqrt(aa * bb) || 0;
  }
  // A crossing card hides the middle band of the card beneath it; how much depends on the card shape.
  const endsCache = new Map();
  const endsOnly = ratio => {
    const key = Math.round(Math.min(0.85, Math.max(0.4, ratio)) * 20) / 20, half = key / 2 + 0.03;
    if (!endsCache.has(key)) endsCache.set(key, subsetIdx(f => f < 0.5 - half || f > 0.5 + half));
    return endsCache.get(key);
  };
  const simMasked = (a, b, idx) => 0.4 * subCorr(a.t, b.t, idx.t) + 0.3 * subCorr(a.c, b.c, idx.c) + 0.3 * subCorr(a.g, b.g, idx.g);

  /** Rank saved cards against one warped photo crop. Tests both orientations.
      occluded: false, or the card's width/height ratio when a crossing card covers its middle. */
  function identify(px, cards, top = 8, occluded = false) {
    const f0 = features(px), f1 = features(rot180(px)), idx = occluded ? endsOnly(occluded) : null;
    const sim = idx && idx.t.length >= 20 ? (a, b) => simMasked(a, b, idx) : similarity;
    const res = [];
    for (const c of cards) {
      if (!c.feat || c.feat.v !== FEAT_VERSION) continue;
      const a = sim(f0, c.feat), b = sim(f1, c.feat);
      res.push(a >= b ? { id: c.id, score: a, flipped: false } : { id: c.id, score: b, flipped: true });
    }
    res.sort((x, y) => y.score - x.score);
    return res.slice(0, top);
  }
  /** Identify a detected box, trying a few box sizes to absorb imprecise edges. */
  function identifyDet(im, d, cards, top = 8) {
    const best = new Map();
    for (const k of [1, 1.07, 0.94]) {
      const px = warp(im, { ...d, L: d.L * k, S: d.S * k });
      for (const m of identify(px, cards, top * 2, d.occluded ? d.S / d.L : false)) {
        const b = best.get(m.id); if (!b || m.score > b.score) best.set(m.id, m);
      }
    }
    return [...best.values()].sort((x, y) => y.score - x.score).slice(0, top);
  }

  // ---------- card detection ----------
  function pass(src, dst, W, H, r, dil, horiz) {
    const pad = dil ? 0 : 1, win = 2 * r + 1, len = horiz ? W : H, lines = horiz ? H : W;
    const step = horiz ? 1 : W;
    for (let l = 0; l < lines; l++) {
      const base = horiz ? l * W : l;
      let cnt = pad * r;
      for (let k = 0; k <= r; k++) cnt += k < len ? src[base + k * step] : pad;
      for (let k = 0; k < len; k++) {
        dst[base + k * step] = dil ? (cnt > 0 ? 1 : 0) : (cnt === win ? 1 : 0);
        const o = k - r, nx = k + r + 1;
        cnt -= o >= 0 ? src[base + o * step] : pad;
        cnt += nx < len ? src[base + nx * step] : pad;
      }
    }
  }
  function morph(m, W, H, r, dil) {
    const t = new Uint8Array(m.length), o = new Uint8Array(m.length);
    pass(m, t, W, H, r, dil, true); pass(t, o, W, H, r, dil, false);
    return o;
  }
  /** Two-pass box blur (close to Gaussian), radius r. */
  function blur(src, W, H, r) {
    let a = src, b = new Float32Array(src.length);
    for (let pass = 0; pass < 2; pass++) {
      for (let y = 0; y < H; y++) {
        const o = y * W; let s = 0;
        for (let x = -r; x <= r; x++) s += a[o + Math.min(W - 1, Math.max(0, x))];
        for (let x = 0; x < W; x++) {
          b[o + x] = s / (2 * r + 1);
          s += a[o + Math.min(W - 1, x + r + 1)] - a[o + Math.max(0, x - r)];
        }
      }
      const c = new Float32Array(src.length);
      for (let x = 0; x < W; x++) {
        let s = 0;
        for (let y = -r; y <= r; y++) s += b[Math.min(H - 1, Math.max(0, y)) * W + x];
        for (let y = 0; y < H; y++) {
          c[y * W + x] = s / (2 * r + 1);
          s += b[Math.min(H - 1, y + r + 1) * W + x] - b[Math.max(0, y - r) * W + x];
        }
      }
      a = c;
    }
    return a;
  }
  function fillHoles(m, W, H) {
    const seen = new Uint8Array(W * H), q = new Int32Array(W * H); let qh = 0, qt = 0;
    const push = i => { if (!m[i] && !seen[i]) { seen[i] = 1; q[qt++] = i; } };
    for (let x = 0; x < W; x++) { push(x); push((H - 1) * W + x); }
    for (let y = 0; y < H; y++) { push(y * W); push(y * W + W - 1); }
    while (qh < qt) {
      const i = q[qh++], x = i % W;
      if (x > 0) push(i - 1); if (x < W - 1) push(i + 1);
      if (i >= W) push(i - W); if (i < W * (H - 1)) push(i + W);
    }
    for (let i = 0; i < W * H; i++) if (!m[i] && !seen[i]) m[i] = 1;
  }
  function otsu(v, max) {
    const bins = 256, hist = new Float64Array(bins);
    for (let i = 0; i < v.length; i++) hist[Math.min(bins - 1, (v[i] / max * bins) | 0)]++;
    let sum = 0; for (let i = 0; i < bins; i++) sum += i * hist[i];
    let sB = 0, wB = 0, best = 0, th = 0;
    for (let i = 0; i < bins; i++) {
      wB += hist[i]; if (!wB) continue;
      const wF = v.length - wB; if (!wF) break;
      sB += i * hist[i];
      const mB = sB / wB, mF = (sum - sB) / wF, between = wB * wF * (mB - mF) ** 2;
      if (between > best) { best = between; th = i; }
    }
    return (th + 0.5) / bins * max;
  }
  function hull(pts) {
    pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], up = [];
    for (const p of pts) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
    for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
    up.pop(); lo.pop();
    return lo.concat(up);
  }
  function minRect(h) {
    let best = null;
    for (let i = 0; i < h.length; i++) {
      const a = h[i], b = h[(i + 1) % h.length];
      const ex = b[0] - a[0], ey = b[1] - a[1], len = Math.hypot(ex, ey); if (!len) continue;
      const ux = ex / len, uy = ey / len;
      let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
      for (const p of h) {
        const pa = p[0] * ux + p[1] * uy, pb = -p[0] * uy + p[1] * ux;
        if (pa < a0) a0 = pa; if (pa > a1) a1 = pa; if (pb < b0) b0 = pb; if (pb > b1) b1 = pb;
      }
      const area = (a1 - a0) * (b1 - b0);
      if (!best || area < best.area) best = { area, ux, uy, a0, a1, b0, b1 };
    }
    const ca = (best.a0 + best.a1) / 2, cb = (best.b0 + best.b1) / 2;
    const cx = ca * best.ux - cb * best.uy, cy = ca * best.uy + cb * best.ux;
    const sa = best.a1 - best.a0, sb = best.b1 - best.b0;
    return sa >= sb ? orient({ cx, cy, L: sa, S: sb, ux: best.ux, uy: best.uy })
                    : orient({ cx, cy, L: sb, S: sa, ux: -best.uy, uy: best.ux });
  }
  /** Long axis points down for upright cards, right for sideways cards. */
  function orient(d) {
    if (Math.abs(d.uy) >= Math.abs(d.ux)) { if (d.uy < 0) { d.ux = -d.ux; d.uy = -d.uy; } d.sideways = false; }
    else { if (d.ux < 0) { d.ux = -d.ux; d.uy = -d.uy; } d.sideways = true; }
    return d;
  }
  function components(m, W, H, minArea) {
    const labels = new Int32Array(W * H), q = new Int32Array(W * H), comps = [];
    const rmin = new Int32Array(H).fill(W), rmax = new Int32Array(H).fill(-1);
    let id = 0;
    for (let s = 0; s < W * H; s++) {
      if (!m[s] || labels[s]) continue;
      id++; let qh = 0, qt = 0; q[qt++] = s; labels[s] = id;
      while (qh < qt) {
        const i = q[qh++], x = i % W;
        if (x > 0 && m[i - 1] && !labels[i - 1]) { labels[i - 1] = id; q[qt++] = i - 1; }
        if (x < W - 1 && m[i + 1] && !labels[i + 1]) { labels[i + 1] = id; q[qt++] = i + 1; }
        if (i >= W && m[i - W] && !labels[i - W]) { labels[i - W] = id; q[qt++] = i - W; }
        if (i < W * (H - 1) && m[i + W] && !labels[i + W]) { labels[i + W] = id; q[qt++] = i + W; }
      }
      if (qt < minArea) continue;
      let y0 = H, y1 = -1, edge = false;
      for (let k = 0; k < qt; k++) {
        const i = q[k], x = i % W, y = (i / W) | 0;
        if (x < rmin[y]) rmin[y] = x; if (x > rmax[y]) rmax[y] = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
        if (x === 0 || y === 0 || x === W - 1 || y === H - 1) edge = true;
      }
      const pts = []; let span = 0;   // span: area including any holes (e.g. text inside a box)
      for (let y = y0; y <= y1; y++) if (rmax[y] >= 0) {
        pts.push([rmin[y], y], [rmax[y] + 1, y], [rmin[y], y + 1], [rmax[y] + 1, y + 1]);
        span += rmax[y] - rmin[y] + 1;
        rmin[y] = W; rmax[y] = -1;
      }
      comps.push({ area: qt, span, edge, hull: hull(pts) });
    }
    return comps;
  }

  /**
   * Find cards in a (downscaled) photo. Cards are separated from the table by
   * colour difference against the photo's edges, then each blob is fitted
   * with a rotated rectangle. Crossed pairs and touching cards are split
   * using the typical card size.
   */
  function detect(im, sens = 1, cfg = CFG) {
    const W = im.width, H = im.height, N = W * H, d = im.data;
    let Lc = new Float32Array(N), Ac = new Float32Array(N), Bc = new Float32Array(N); const t = [0, 0, 0];
    for (let i = 0; i < N; i++) { lab(d[i * 4], d[i * 4 + 1], d[i * 4 + 2], t); Lc[i] = t[0]; Ac[i] = t[1]; Bc[i] = t[2]; }
    // Smooth away fine table texture (wood grain, cloth weave); cards are large and survive.
    const br = cfg.blurDiv ? Math.round(Math.min(W, H) / cfg.blurDiv) : 0;
    if (br > 0) { Lc = blur(Lc, W, H, br); Ac = blur(Ac, W, H, br); Bc = blur(Bc, W, H, br); }
    const bw = Math.max(2, Math.round(Math.min(W, H) * 0.03)), border = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (x >= bw && x < W - bw && y >= bw && y < H - bw) continue;
      border.push(y * W + x);
    }
    const mL = median(border.map(i => Lc[i])), mA = median(border.map(i => Ac[i])), mB = median(border.map(i => Bc[i]));
    const dist = new Float32Array(N); let max = 1;
    for (let i = 0; i < N; i++) {
      const v = Math.hypot(Lc[i] - mL, (Ac[i] - mA) * 1.2, (Bc[i] - mB) * 1.2);
      dist[i] = v; if (v > max) max = v;
    }
    // The table's own variation (seen at the photo edges) sets a floor for the cut-off.
    const bd = border.map(i => dist[i]).sort((a, b) => a - b), tableVar = bd[Math.floor(bd.length * 0.97)] || 0;
    const T = Math.max(6, Math.max(otsu(dist, max), tableVar * (cfg.varK || 0)) / sens);
    let mask = new Uint8Array(N);
    for (let i = 0; i < N; i++) mask[i] = dist[i] > T ? 1 : 0;
    // Seal thin card outlines first, fill the card interiors, then drop specks.
    const r = Math.max(1, Math.round(Math.min(W, H) / 240));
    mask = morph(morph(mask, W, H, r, true), W, H, r, false);
    fillHoles(mask, W, H);
    mask = morph(morph(mask, W, H, r, false), W, H, r, true);

    const comps = components(mask, W, H, Math.max(30, N * 0.0015)).map(c => {
      const rc = minRect(c.hull); rc.area = c.area; rc.fill = c.area / (rc.L * rc.S); return rc;
    });
    // Card-shaped blobs set the typical card size. Decks vary from tall (0.5) to squarish (0.85).
    const good = comps.filter(c => c.fill > 0.8 && c.S / c.L > 0.45 && c.S / c.L < 0.9);
    const cardL = good.length ? median(good.map(c => c.L)) : 0;
    const cardS = good.length ? median(good.map(c => c.S)) : 0;
    // Is the mask set at a point given in the blob's own axes (fractions of its long side)?
    const at = (c, a, b) => {
      const x = Math.round(c.cx + c.ux * a * c.L - c.uy * b * c.L), y = Math.round(c.cy + c.uy * a * c.L + c.ux * b * c.L);
      return x >= 0 && y >= 0 && x < W && y < H && mask[y * W + x] === 1;
    };
    // A plus sign: all four arms present and (most of) the four corner notches empty.
    // The notches shrink as cards get squarer, so the corner test point moves outward.
    const isPlus = c => {
      const r = cardS / cardL, q = 0.5 - (1 - r) / 4;
      const arms = [[0.46, 0.2], [0.46, -0.2], [-0.46, 0.2], [-0.46, -0.2], [0.2, 0.46], [-0.2, 0.46], [0.2, -0.46], [-0.2, -0.46]];
      const corners = [[q, q], [q, -q], [-q, q], [-q, -q]];
      return arms.every(([a, b]) => at(c, a, b)) && corners.filter(([a, b]) => !at(c, a, b)).length >= 3;
    };
    const out = [];
    for (const c of comps) {
      if (!cardL) { out.push(c); continue; }
      const cardArea = cardL * cardS, ratio = c.S / c.L;
      if (c.area < cardArea * 0.3) continue;
      // Two cards crossed like a plus sign. The upright one is underneath, so only its ends are visible.
      if (ratio > Math.max(0.7, cardS / cardL + 0.08) && Math.abs(c.L - cardL) < cardL * 0.25 && c.area < cardArea * 2.2 && isPlus(c)) {
        const a = orient({ cx: c.cx, cy: c.cy, L: cardL, S: cardS, ux: c.ux, uy: c.uy });
        const b = orient({ cx: c.cx, cy: c.cy, L: cardL, S: cardS, ux: -c.uy, uy: c.ux });
        (a.sideways ? b : a).occluded = true;
        out.push(a, b);
        continue;
      }
      // Several cards touching in a line
      if (c.fill > 0.8 && c.area > cardArea * 1.6) {
        const errA = Math.abs(c.S - cardL) / cardL, errB = Math.abs(c.S - cardS) / cardS;
        if (Math.min(errA, errB) < 0.25) {
          const across = errA < errB, piece = across ? cardS : cardL;
          const n = Math.max(1, Math.round(c.L / piece)), step = c.L / n;
          for (let k = 0; k < n; k++) {
            const off = (k - (n - 1) / 2) * step, cx = c.cx + c.ux * off, cy = c.cy + c.uy * off;
            out.push(across ? orient({ cx, cy, L: c.S, S: step, ux: -c.uy, uy: c.ux })
                            : orient({ cx, cy, L: step, S: c.S, ux: c.ux, uy: c.uy }));
          }
          continue;
        }
      }
      // Anything else must look like a single card: solid and card-shaped.
      if (c.fill < 0.65 || ratio < 0.38 || ratio > 0.93) continue;
      out.push(c);
    }
    return { dets: out.map(({ cx, cy, L, S, ux, uy, sideways, occluded }) => ({ cx, cy, L, S, ux, uy, sideways, occluded: !!occluded })), cardL, cardS, threshold: T };
  }

  // ---------- spread matching ----------
  function hungarian(cost) {
    const n = cost.length, INF = 1e18;
    const u = new Float64Array(n + 1), v = new Float64Array(n + 1), p = new Int32Array(n + 1), way = new Int32Array(n + 1);
    for (let i = 1; i <= n; i++) {
      p[0] = i; let j0 = 0;
      const minv = new Float64Array(n + 1).fill(INF), used = new Uint8Array(n + 1);
      do {
        used[j0] = 1; const i0 = p[j0]; let delta = INF, j1 = 0;
        for (let j = 1; j <= n; j++) if (!used[j]) {
          const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
          if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
          if (minv[j] < delta) { delta = minv[j]; j1 = j; }
        }
        for (let j = 0; j <= n; j++) { if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else minv[j] -= delta; }
        j0 = j1;
      } while (p[j0] !== 0);
      do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0);
    }
    const ans = new Array(n);
    for (let j = 1; j <= n; j++) ans[p[j] - 1] = j - 1;
    return ans;
  }

  /**
   * Fit detected card centres to a spread template (positions in card-height
   * units). Allows shifting and uniform scaling, not rotation.
   * Lower score = better. assign[i] = position index for card i, or -1.
   */
  function matchSpread(dets, positions) {
    const n = dets.length, m = positions.length;
    if (!n || !m) return null;
    const Lm = median(dets.map(d => d.L)) || 1;
    const P = dets.map(d => ({ x: d.cx / Lm, y: d.cy / Lm, side: !!d.sideways }));
    const T = positions.map(p => ({ x: +p.x || 0, y: +p.y || 0, side: !!p.rot }));
    let s = 1, tx = mean(T.map(q => q.x)) - mean(P.map(q => q.x)), ty = mean(T.map(q => q.y)) - mean(P.map(q => q.y));
    const N = Math.max(n, m);
    let assign = [];
    for (let it = 0; it < 5; it++) {
      const cost = [];
      for (let i = 0; i < N; i++) {
        const row = new Array(N);
        for (let j = 0; j < N; j++) {
          if (i < n && j < m) {
            const dx = P[i].x * s + tx - T[j].x, dy = P[i].y * s + ty - T[j].y;
            row[j] = dx * dx + dy * dy + (P[i].side !== T[j].side ? 0.5 : 0);
          } else row[j] = 0;
        }
        cost.push(row);
      }
      const a = hungarian(cost);
      assign = a.slice(0, n).map(j => j < m ? j : -1);
      const pairs = assign.map((j, i) => [i, j]).filter(([, j]) => j >= 0);
      const pmx = mean(pairs.map(([i]) => P[i].x)), pmy = mean(pairs.map(([i]) => P[i].y));
      const tmx = mean(pairs.map(([, j]) => T[j].x)), tmy = mean(pairs.map(([, j]) => T[j].y));
      if (pairs.length >= 2) {
        let num = 0, den = 0;
        for (const [i, j] of pairs) { const px = P[i].x - pmx, py = P[i].y - pmy; num += px * (T[j].x - tmx) + py * (T[j].y - tmy); den += px * px + py * py; }
        s = den > 1e-6 ? Math.min(2, Math.max(0.5, num / den)) : 1;
      }
      tx = tmx - s * pmx; ty = tmy - s * pmy;
    }
    let sq = 0, sideMiss = 0, k = 0;
    assign.forEach((j, i) => {
      if (j < 0) return; k++;
      sq += (P[i].x * s + tx - T[j].x) ** 2 + (P[i].y * s + ty - T[j].y) ** 2;
      if (P[i].side !== T[j].side) sideMiss++;
    });
    const rms = Math.sqrt(sq / (k || 1));
    return { assign, rms, sideMiss, countDiff: Math.abs(n - m), score: rms + 0.35 * sideMiss + 0.8 * Math.abs(n - m) };
  }

  /** Left-to-right, top-to-bottom order for when no spread fits. */
  function readingOrder(dets) {
    const Lm = median(dets.map(d => d.L)) || 1;
    const idx = dets.map((d, i) => i).sort((a, b) => dets[a].cy - dets[b].cy);
    const rows = [];
    for (const i of idx) {
      const row = rows.find(r => Math.abs(r.y - dets[i].cy) < Lm * 0.5);
      if (row) { row.items.push(i); row.y = mean(row.items.map(k => dets[k].cy)); } else rows.push({ y: dets[i].cy, items: [i] });
    }
    rows.sort((a, b) => a.y - b.y);
    return rows.flatMap(r => r.items.sort((a, b) => dets[a].cx - dets[b].cx));
  }

  /** Turn detections into spread positions (card-height units, centred). */
  function layoutFromDets(dets) {
    const Lm = median(dets.map(d => d.L)) || 1, order = readingOrder(dets);
    const cx = mean(dets.map(d => d.cx)), cy = mean(dets.map(d => d.cy));
    const r2 = v => Math.round(v * 20) / 20;
    return order.map(i => ({ x: r2((dets[i].cx - cx) / Lm), y: r2((dets[i].cy - cy) / Lm), rot: !!dets[i].sideways }));
  }

  // Shape helpers shared with the spread-template reader.
  const geom = { components, minRect, morph, blur, lab };
  return { geom, CW, CH, FEAT_VERSION, CFG, CFGS, features, similarity, canonicalFromImage, warp, identify, identifyDet, rot180, detect, matchSpread, readingOrder, layoutFromDets, orient, median };
})();
