/* Generates spread-template pictures (like book diagrams) and runs Template.read on them. */
window.TemplateTest = (() => {
  function canvas(w, h, bg = '#fff') { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.fillStyle = bg; g.fillRect(0, 0, w, h); return [c, g]; }
  function box(g, cx, cy, w, h, opts = {}) {
    g.save(); g.translate(cx, cy); if (opts.rot) g.rotate(Math.PI / 2);
    if (opts.fill) { g.fillStyle = opts.fill; g.fillRect(-w / 2, -h / 2, w, h); }
    g.strokeStyle = opts.stroke || '#333'; g.lineWidth = opts.lw || 4; g.strokeRect(-w / 2, -h / 2, w, h);
    g.restore();
    if (opts.num != null) { g.fillStyle = opts.numColor || '#222'; g.font = `bold ${opts.numSize || 44}px Arial`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(opts.num), cx + (opts.rot ? h * 0.3 : 0), cy); }
  }
  function text(g, t, x, y, size = 28, opts = {}) { g.fillStyle = opts.color || '#222'; g.font = `${opts.bold ? 'bold ' : ''}${size}px ${opts.font || 'Georgia'}`; g.textAlign = opts.align || 'left'; g.textBaseline = 'alphabetic'; g.fillText(t, x, y); }

  const make = {
    // Numbered boxes + numbered legend underneath (typical book page)
    career() {
      const [c, g] = canvas(1400, 1700);
      text(g, 'Career Path Spread', 700, 120, 64, { align: 'center', bold: true });
      const W = 170, H = 290, pts = [[300, 450], [550, 450], [800, 450], [1050, 450], [675, 820]];
      pts.forEach(([x, y], i) => box(g, x, y, W, H, { num: i + 1 }));
      const legend = ['1. Where you are now - your current role and feelings', '2. Hidden strengths - talents you overlook', '3. Obstacles - what stands in the way',
        '4. Advice - the next step to take', '5. Outcome - where this path leads'];
      legend.forEach((t, i) => text(g, t, 120, 1110 + i * 62, 34, { font: 'Arial' }));
      return { c, expect: { name: 'Career Path Spread', n: 5, labels: ['Where you are now', 'Hidden strengths', 'Obstacles', 'Advice', 'Outcome'], xy: [[-1.3, -0.25], [-0.4, -0.25], [0.45, -0.25], [1.25, -0.25], [0, 1]] } };
    },
    // Unnumbered filled boxes with captions under each
    mbs() {
      const [c, g] = canvas(1500, 900, '#f6f1e7');
      text(g, 'Mind Body Spirit', 750, 110, 60, { align: 'center', bold: true, color: '#5a2d82' });
      [['Mind', 350], ['Body', 750], ['Spirit', 1150]].forEach(([t, x]) => { box(g, x, 430, 200, 340, { fill: '#c9b6e4', stroke: '#5a2d82', lw: 5 }); text(g, t, x, 680, 40, { align: 'center', font: 'Arial', bold: true }); });
      return { c, expect: { name: 'Mind Body Spirit', n: 3, labels: ['Mind', 'Body', 'Spirit'] } };
    },
    // Cross with a sideways card and the legend on the right side
    cross() {
      const [c, g] = canvas(1800, 1300);
      text(g, 'Crossroads', 900, 100, 60, { align: 'center', bold: true });
      const W = 150, H = 250;
      box(g, 400, 650, W, H, { num: 1 });
      box(g, 400, 650, W, H, { rot: true, num: 2, fill: '#fff' });
      box(g, 400, 330, W, H, { num: 3 }); box(g, 400, 970, W, H, { num: 4 });
      box(g, 130, 650, W, H, { num: 5 }); box(g, 670, 650, W, H, { num: 6 });
      ['1: You - your present state', '2: The crossing - what challenges you', '3: Above - your highest aim', '4: Below - your foundation', '5: Behind - what is passing', '6: Ahead - what is coming'].forEach((t, i) => text(g, t, 900, 420 + i * 80, 36, { font: 'Arial' }));
      return { c, expect: { name: 'Crossroads', n: 6, labels: ['You', 'The crossing', 'Above', 'Below', 'Behind', 'Ahead'], xy: [[0, 0], [0, 0], [0, -1.25], [0, 1.25], [-1.05, 0], [1.05, 0]] } };
    },
  };

  async function run(which) {
    const { c, expect } = make[which]();
    const t0 = performance.now();
    const res = await Template.read(c, m => console.log(m));
    const got = res.positions.map(p => p.label);
    // A label only counts if it is also on the right box (positions within 0.2 card heights).
    const near = (i) => !expect.xy || (res.positions[i] && Math.hypot(res.positions[i].x - expect.xy[i][0], res.positions[i].y - expect.xy[i][1]) < 0.2);
    const ok = expect.labels.filter((l, i) => (got[i] || '').toLowerCase() === l.toLowerCase() && near(i)).length;
    return { which, ms: Math.round(performance.now() - t0), name: res.name, nameOK: res.name.toLowerCase() === expect.name.toLowerCase(), positions: `${res.positions.length}/${expect.n}`, labelsOK: `${ok}/${expect.n}`, found: res.found,
      got: res.positions.map(p => `${p.label} | ${p.meaning} | ${p.x},${p.y}${p.rot ? ' rot' : ''}`) };
  }
  return { make, run };
})();
