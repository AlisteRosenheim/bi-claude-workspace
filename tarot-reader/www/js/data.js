/* Local database (IndexedDB) and import/export parsing. Nothing leaves the device. */
const DB = (() => {
  let db;
  const STORES = [['cards', 'id'], ['spreads', 'id'], ['readings', 'id'], ['settings', 'key']];
  const p = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const store = (s, mode) => db.transaction(s, mode).objectStore(s);
  return {
    open: () => new Promise((res, rej) => {
      const r = indexedDB.open('tarot-reader', 1);
      r.onupgradeneeded = () => { for (const [n, k] of STORES) if (!r.result.objectStoreNames.contains(n)) r.result.createObjectStore(n, { keyPath: k }); };
      r.onsuccess = () => { db = r.result; res(); };
      r.onerror = () => rej(r.error);
    }),
    all: s => p(store(s, 'readonly').getAll()),
    get: (s, k) => p(store(s, 'readonly').get(k)),
    put: (s, v) => p(store(s, 'readwrite').put(v)),
    del: (s, k) => p(store(s, 'readwrite').delete(k)),
    clear: s => p(store(s, 'readwrite').clear()),
    putMany: (s, vals) => new Promise((res, rej) => {
      const t = db.transaction(s, 'readwrite'), st = t.objectStore(s);
      vals.forEach(v => st.put(v));
      t.oncomplete = () => res(); t.onerror = () => rej(t.error);
    }),
  };
})();

const Parse = (() => {
  const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  /** Looser key: drops leading numbers and "the"/"of", so "00_the_fool" matches "The Fool". */
  const loose = s => norm(String(s || '').toLowerCase().replace(/[_.\-]+/g, ' ').replace(/^[\d\s]+/, '').replace(/\b(the|of)\b/g, ''));

  const CARD_FIELDS = {
    name: 'name', title: 'name', card: 'name', cardname: 'name',
    description: 'description', desc: 'description', art: 'description', artdescription: 'description', imagedescription: 'description', visual: 'description', symbolism: 'description',
    upright: 'upright', meaning: 'upright', uprightmeaning: 'upright', meanings: 'upright',
    reversed: 'reversed', reversedmeaning: 'reversed', reverse: 'reversed',
    keywords: 'keywords', keyword: 'keywords', tags: 'keywords', uprightkeywords: 'keywords',
    reversedkeywords: 'reversedKeywords', reversekeywords: 'reversedKeywords',
    suit: 'group', arcana: 'group', group: 'group',
    source: 'source', meaningsource: 'source', reference: 'source',
    image: 'imageFile', file: 'imageFile', filename: 'imageFile', imagefile: 'imageFile', img: 'imageFile',
    number: 'order', no: 'order', order: 'order', index: 'order',
  };
  const SPREAD_FIELDS = {
    spread: 'spread', spreadname: 'spread', name: 'spread',
    position: 'num', number: 'num', no: 'num', order: 'num',
    label: 'label', positionname: 'label', title: 'label',
    meaning: 'meaning', positionmeaning: 'meaning', description: 'meaning',
    x: 'x', y: 'y', sideways: 'rot', rotated: 'rot', rot: 'rot', crossing: 'rot',
    spreaddescription: 'spreadDescription', about: 'spreadDescription',
  };

  function csv(t, d) {
    const rows = []; let row = [], f = '', q = false;
    for (let i = 0; i < t.length; i++) {
      const ch = t[i];
      if (q) { if (ch === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; }
      else if (ch === '"' && f === '') q = true;
      else if (ch === d) { row.push(f); f = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && t[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
      else f += ch;
    }
    row.push(f); rows.push(row);
    return rows.filter(r => r.some(x => x.trim()));
  }
  function table(text, fields) {
    const first = text.split(/\r?\n/)[0];
    const count = c => first.split(c).length - 1;
    const delim = [['\t', count('\t')], [';', count(';')], [',', count(',')]].sort((a, b) => b[1] - a[1])[0][0];
    const rows = csv(text, delim);
    const head = rows.shift().map(h => fields[norm(h)] || null);
    return rows.map(r => { const o = {}; head.forEach((h, i) => { if (h && r[i] != null && r[i].trim() !== '') o[h] = r[i].trim(); }); return o; });
  }
  /** Map known keys; nested objects like {meanings:{upright, reversed}} are flattened. */
  function mapObj(obj, fields, o = {}) {
    for (const [k, v] of Object.entries(obj || {})) {
      if (v == null || v === '') continue;
      if (typeof v === 'object' && !Array.isArray(v)) { mapObj(v, fields, o); continue; }
      const f = fields[norm(k)];
      if (f && o[f] === undefined) o[f] = Array.isArray(v) ? v.join(', ') : String(v);
    }
    return o;
  }
  const clean = t => String(t || '').replace(/^﻿/, '').trim();

  /** Card text from CSV/TSV/JSON. Returns [{name, description, upright, ...}]. */
  function cards(text) {
    text = clean(text);
    if (!text) throw new Error('Nothing to import.');
    let recs;
    if (text[0] === '[' || text[0] === '{') {
      const data = JSON.parse(text);
      if (data && data.app === 'tarot-reader') throw new Error('This is a full backup — use “Restore backup” instead.');
      const arr = Array.isArray(data) ? data : Array.isArray(data.cards) ? data.cards
        : Object.entries(data).map(([k, v]) => typeof v === 'string' ? { name: k, upright: v } : { name: k, ...v });
      recs = arr.map(o => mapObj(o, CARD_FIELDS));
    } else {
      recs = table(text, CARD_FIELDS);
      if (!recs.length || !Object.keys(recs[0]).length) throw new Error('Could not read any columns. The first row should be headers such as: name, description, upright, reversed');
    }
    return recs;
  }

  /** Spreads from JSON ([{name, positions:[...]}]) or CSV (one row per position). */
  function spreads(text) {
    text = clean(text);
    if (!text) throw new Error('Nothing to import.');
    let list;
    if (text[0] === '[' || text[0] === '{') {
      const data = JSON.parse(text);
      const arr = Array.isArray(data) ? data : Array.isArray(data.spreads) ? data.spreads : [data];
      list = arr.map(s => ({
        name: s.name || s.title || s.spread,
        description: s.description || s.about || '',
        positions: (s.positions || s.cards || []).map(p => {
          if (typeof p === 'string') return { label: p };
          const o = mapObj(p, SPREAD_FIELDS);
          if (!o.label && o.spread) o.label = o.spread;   // "name" inside a position is its label
          return o;
        }),
      }));
    } else {
      const rows = table(text, SPREAD_FIELDS), by = new Map();
      for (const r of rows) {
        if (!r.spread) continue;
        if (!by.has(r.spread)) by.set(r.spread, { name: r.spread, description: '', positions: [] });
        const s = by.get(r.spread);
        if (r.spreadDescription) s.description = r.spreadDescription;
        s.positions.push(r);
      }
      list = [...by.values()];
    }
    const truthy = v => v === true || /^(1|y|yes|true|x|sideways|crossing)$/i.test(String(v || '').trim());
    return list.filter(s => s.name && s.positions.length).map(s => {
      const ps = s.positions.map((p, i) => ({ ...p, _i: p.num != null ? +p.num : i + 1 })).sort((a, b) => a._i - b._i);
      const hasXY = ps.every(p => p.x !== undefined && p.y !== undefined && !isNaN(+p.x) && !isNaN(+p.y));
      return {
        name: String(s.name).trim(), description: s.description || '',
        positions: ps.map((p, i) => ({
          label: p.label || `Position ${i + 1}`, meaning: p.meaning || '',
          x: hasXY ? +p.x : i * 0.75, y: hasXY ? +p.y : 0, rot: truthy(p.rot),
        })),
        needsLayout: !hasXY,
      };
    });
  }

  const q = v => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const toCSV = (head, rows) => '﻿' + [head, ...rows].map(r => r.map(q).join(',')).join('\r\n');

  return { norm, loose, cards, spreads, toCSV };
})();
