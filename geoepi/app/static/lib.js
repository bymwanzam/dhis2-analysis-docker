// Pure helpers for the viewer (unit-tested in Node: tests/test_lib.js)
(function (root) {
  const RAMP = ['#440154', '#3b528b', '#21918c', '#5ec962', '#fde725'];
  const CAT = {'High-High': '#d7191c', 'Low-Low': '#2c7bb6', 'High-Low': '#f4a6a6', 'Low-High': '#9ecae1', 'Hot spot': '#d7191c', 'Cold spot': '#2c7bb6',
    'Most likely cluster': '#b2182b', 'Top 20 under all weightings': '#b2182b', 'Very high': '#bd0026', High: '#f03b20', Medium: '#fd8d3c', Low: '#fecc5c', 'Very low': '#ffffb2'};
  const GREY = '#e3e8e9', FALLBACK = ['#1b9e77', '#d95f02', '#7570b3', '#e7298a', '#66a61e', '#e6ab02'];
  const esc = s => String(s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const fin = v => typeof v === 'number' && Number.isFinite(v);
  const sorted = a => a.filter(fin).sort((x, y) => x - y);
  const pct = (a, p) => a[Math.min(a.length - 1, Math.max(0, Math.floor(p * (a.length - 1))))];
  const legendHTML = items => items.map(i => `<span><i style="background:${i.color}"></i>${esc(i.label)}</span>`).join('');
  function range(vals) { const s = sorted(vals); return s.length ? [pct(s, .02), pct(s, .98)] : [0, 1] }
  const scale01 = (v, lo, hi) => hi > lo ? Math.min(1, Math.max(0, (v - lo) / (hi - lo))) : .5;
  function numericScale(vals) {                 // 5 quantile classes
    const s = sorted(vals), br = [];
    for (let i = 1; i < 5; i++) br.push(s[Math.floor(i * s.length / 5)]);
    const edges = [s[0], ...br, s[s.length - 1]].map(x => +x.toPrecision(3));
    const items = RAMP.map((c, i) => ({color: c, label: `${edges[i]} \u2013 ${edges[i + 1]}`}));
    return {fn: v => fin(v) ? RAMP[br.filter(b => v >= b).length] : GREY, items, legend: legendHTML(items)};
  }
  function categoryScale(vals, colors) {
    const cats = [...new Set(vals.filter(v => v !== null && v !== undefined))].sort(); let k = 0;
    const m = Object.fromEntries(cats.map(c => [c, (colors && colors[c]) || (/^(Not significant|Outside|Other|No stable cluster)$/.test(c) ? GREY : CAT[c] || FALLBACK[k++ % FALLBACK.length])]));
    const items = cats.map(c => ({color: m[c], label: String(c)}));
    return {fn: v => m[v] || GREY, items, legend: legendHTML(items)};
  }
  const CRC = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0 } return t })();
  const crc32 = b => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0 };
  function zip(files) {                          // files: [{name, data: Uint8Array}] -> Uint8Array
    const enc = new TextEncoder(), parts = [], central = []; let off = 0;
    for (const f of files) {
      const name = enc.encode(f.name), crc = crc32(f.data), n = f.data.length;
      const h = new DataView(new ArrayBuffer(30));
      [[0, 0x04034b50, 4], [4, 20, 2], [6, 0x0800, 2], [8, 0, 2], [10, 0, 2], [12, 0x21, 2], [14, crc, 4], [18, n, 4], [22, n, 4], [26, name.length, 2], [28, 0, 2]]
        .forEach(([o, v, w]) => w === 4 ? h.setUint32(o, v, true) : h.setUint16(o, v, true));
      const c = new DataView(new ArrayBuffer(46));
      [[0, 0x02014b50, 4], [4, 20, 2], [6, 20, 2], [8, 0x0800, 2], [10, 0, 2], [12, 0, 2], [14, 0x21, 2], [16, crc, 4], [20, n, 4], [24, n, 4], [28, name.length, 2], [42, off, 4]]
        .forEach(([o, v, w]) => w === 4 ? c.setUint32(o, v, true) : c.setUint16(o, v, true));
      parts.push(new Uint8Array(h.buffer), name, f.data); central.push(new Uint8Array(c.buffer), name);
      off += 30 + name.length + n;
    }
    const cdSize = central.reduce((a, b) => a + b.length, 0), e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, cdSize, true); e.setUint32(16, off, true);
    const all = [...parts, ...central, new Uint8Array(e.buffer)], out = new Uint8Array(all.reduce((a, b) => a + b.length, 0)); let p = 0;
    for (const a of all) { out.set(a, p); p += a.length } return out;
  }
  const api = {esc, range, scale01, numericScale, categoryScale, legendHTML, zip, crc32};
  if (typeof module !== 'undefined') module.exports = api; else root.GeoLib = api;
})(this);
