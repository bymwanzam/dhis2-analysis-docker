// Renders the current map view (selected layers, title, legends) to a PNG/JPEG blob.
// Draws everything itself on a canvas, so the legend is always included and no extra library is needed.
(function (root) {
  const FONT = '"Segoe UI", Roboto, Arial, sans-serif';
  const HEAT_STOPS = [[0.4, '#0000ff'], [0.6, '#00ffff'], [0.7, '#00ff00'], [0.8, '#ffff00'], [1, '#ff0000']];
  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c };

  function heatPalette() {
    const c = mk(1, 256), g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 256);
    HEAT_STOPS.forEach(([o, col]) => gr.addColorStop(o, col));
    g.fillStyle = gr; g.fillRect(0, 0, 1, 256); return g.getImageData(0, 0, 1, 256).data;
  }
  function drawHeat(ctx, spec, project, s, W, H) {
    const r = 16 * s, blur = 18 * s, sz = Math.ceil(2 * (r + blur)), sp = mk(sz, sz), sg = sp.getContext('2d');
    const gr = sg.createRadialGradient(sz / 2, sz / 2, r * 0.2, sz / 2, sz / 2, r + blur);
    gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); sg.fillStyle = gr; sg.fillRect(0, 0, sz, sz);
    const off = mk(W, H), g = off.getContext('2d'), [lo, hi] = [spec.legend.lo, spec.legend.hi];
    for (const p of spec.points) {
      if (!Number.isFinite(p.value)) continue;
      const q = project(p.lat, p.lng); if (q.x < -sz || q.y < -sz || q.x > W + sz || q.y > H + sz) continue;
      g.globalAlpha = Math.max(0.06, hi > lo ? Math.min(1, Math.max(0, (p.value - lo) / (hi - lo))) : 0.5);
      g.drawImage(sp, q.x - sz / 2, q.y - sz / 2);
    }
    const img = g.getImageData(0, 0, W, H), d = img.data, pal = heatPalette();
    for (let i = 0; i < d.length; i += 4) { const a = d[i + 3]; if (a > 8) { d[i] = pal[a * 4]; d[i + 1] = pal[a * 4 + 1]; d[i + 2] = pal[a * 4 + 2]; d[i + 3] = Math.min(255, a * 1.4) } else d[i + 3] = 0 }
    g.globalAlpha = 1; g.putImageData(img, 0, 0); ctx.drawImage(off, 0, 0);
  }
  function drawPolys(ctx, spec, project, s) {
    ctx.lineWidth = 0.6 * s; ctx.strokeStyle = '#ffffff'; ctx.globalAlpha = 0.85;
    for (const f of spec.data.features) {
      const g = f.geometry; if (!g) continue;
      const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
      ctx.beginPath();
      for (const poly of polys) for (const ring of poly) { ring.forEach(([x, y], i) => { const p = project(y, x); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y) }); ctx.closePath() }
      ctx.fillStyle = spec.colour(f.properties[spec.field]); ctx.fill('evenodd'); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  function drawPoints(ctx, spec, project, s) {
    ctx.lineWidth = 0.6 * s; ctx.strokeStyle = '#7a1010'; ctx.fillStyle = 'rgba(215,48,31,.6)';
    for (const f of spec.data.features) {
      if (!f.geometry || f.geometry.type !== 'Point') continue;
      const p = project(f.geometry.coordinates[1], f.geometry.coordinates[0]);
      ctx.beginPath(); ctx.arc(p.x, p.y, 3 * s, 0, 6.2832); ctx.fill(); ctx.stroke();
    }
  }
  function drawTiles(ctx, map, s) {
    const box = map.getContainer().getBoundingClientRect();
    map.getPane('tilePane').querySelectorAll('img.leaflet-tile-loaded').forEach(img => {
      if (getComputedStyle(img).opacity === '0') return;
      const r = img.getBoundingClientRect();
      ctx.drawImage(img, (r.left - box.left) * s, (r.top - box.top) * s, r.width * s, r.height * s);
    });
  }
  function box(ctx, x, y, w, h, s) {
    ctx.fillStyle = 'rgba(255,255,255,.93)'; ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = s;
    ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, w, h, 5 * s) : ctx.rect(x, y, w, h); ctx.fill(); ctx.stroke();
  }
  function wrap(ctx, text, maxW) {
    const out = []; let line = '';
    for (const w of String(text).split(' ')) { const t = line ? line + ' ' + w : w; if (ctx.measureText(t).width > maxW && line) { out.push(line); line = w } else line = t }
    if (line) out.push(line); return out;
  }
  // legends stacked from the bottom-left corner upwards
  function drawLegends(ctx, specs, s, H) {
    const pad = 10 * s, fs = 12 * s, sw = 15 * s, gap = 8 * s; let y = H - pad;
    for (const sp of specs.slice().reverse()) {
      ctx.font = `600 ${fs}px ${FONT}`; const maxW = 270 * s;
      const head = wrap(ctx, sp.title, maxW); ctx.font = `${fs * .95}px ${FONT}`; const sub = sp.label ? wrap(ctx, sp.label, maxW) : [];
      const lg = sp.legend; let body = 0, bw = 0;
      if (lg.type === 'items') {
        const cols = lg.items.length > 8 ? 2 : 1, rows = Math.ceil(lg.items.length / cols);
        const colW = Math.max(...lg.items.map(i => ctx.measureText(i.label).width)) + sw + 8 * s; body = rows * (sw + 4 * s); bw = colW * cols + (cols - 1) * 10 * s; lg._cols = cols; lg._colW = colW; lg._rows = rows;
      } else { bw = 190 * s; body = sw + fs * 1.4 }
      ctx.font = `600 ${fs}px ${FONT}`; const hw = Math.max(...head.map(l => ctx.measureText(l).width)); ctx.font = `${fs * .95}px ${FONT}`;
      const w = Math.max(bw, hw, ...sub.map(l => ctx.measureText(l).width)) + 2 * pad;
      const h = pad * 2 + head.length * fs * 1.25 + sub.length * fs * 1.2 + 6 * s + body, x = pad, top = y - h;
      box(ctx, x, top, w, h, s); let cy = top + pad + fs;
      ctx.fillStyle = '#17262b'; ctx.font = `600 ${fs}px ${FONT}`; head.forEach(l => { ctx.fillText(l, x + pad, cy); cy += fs * 1.25 });
      ctx.fillStyle = '#5d6f74'; ctx.font = `${fs * .95}px ${FONT}`; sub.forEach(l => { ctx.fillText(l, x + pad, cy); cy += fs * 1.2 });
      cy += 2 * s; ctx.fillStyle = '#17262b';
      if (lg.type === 'items') lg.items.forEach((it, i) => {
        const c = Math.floor(i / lg._rows), r = i % lg._rows, ix = x + pad + c * (lg._colW + 10 * s), iy = cy + r * (sw + 4 * s);
        ctx.fillStyle = it.color; ctx.fillRect(ix, iy, sw, sw); ctx.strokeStyle = 'rgba(0,0,0,.3)'; ctx.lineWidth = s; ctx.strokeRect(ix, iy, sw, sw);
        ctx.fillStyle = '#17262b'; ctx.fillText(it.label, ix + sw + 6 * s, iy + sw - 3.5 * s);
      }); else {
        const gr = ctx.createLinearGradient(x + pad, 0, x + pad + 190 * s - 0, 0);
        HEAT_STOPS.forEach(([o, c]) => gr.addColorStop(o, c)); gr.addColorStop(0, 'rgba(0,0,255,.15)');
        ctx.fillStyle = gr; ctx.fillRect(x + pad, cy, 190 * s, sw * .8);
        ctx.fillStyle = '#17262b'; ctx.fillText(String(+lg.lo.toPrecision(3)), x + pad, cy + sw * .8 + fs);
        const t = String(+lg.hi.toPrecision(3)); ctx.fillText(t, x + pad + 190 * s - ctx.measureText(t).width, cy + sw * .8 + fs);
      }
      y = top - gap;
    }
  }
  function drawTitle(ctx, title, subtitle, s) {
    const pad = 10 * s; ctx.font = `700 ${17 * s}px ${FONT}`; const tw = ctx.measureText(title).width;
    ctx.font = `${11.5 * s}px ${FONT}`; const sw = ctx.measureText(subtitle).width, w = Math.max(tw, sw) + 2 * pad, h = 52 * s;
    box(ctx, pad, pad, w, h, s); ctx.fillStyle = '#17262b'; ctx.font = `700 ${17 * s}px ${FONT}`; ctx.fillText(title, 2 * pad, pad + 23 * s);
    ctx.fillStyle = '#5d6f74'; ctx.font = `${11.5 * s}px ${FONT}`; ctx.fillText(subtitle, 2 * pad, pad + 42 * s);
  }

  // specs: [{kind, title, label, legend, data|points, field, colour}] drawn in order (first = bottom)
  async function render({map, specs, title, subtitle, scale = 2, basemap = true, format = 'png'}) {
    const size = map.getSize(), W = Math.round(size.x * scale), H = Math.round(size.y * scale);
    const cv = mk(W, H), ctx = cv.getContext('2d');
    ctx.fillStyle = '#dfe7e8'; ctx.fillRect(0, 0, W, H);
    const project = (lat, lng) => { const p = map.latLngToContainerPoint([lat, lng]); return {x: p.x * scale, y: p.y * scale} };
    if (basemap) drawTiles(ctx, map, scale);
    for (const sp of specs) {
      if (sp.kind === 'choropleth') drawPolys(ctx, sp, project, scale);
      else if (sp.kind === 'points') drawPoints(ctx, sp, project, scale);
      else if (sp.kind === 'heat') drawHeat(ctx, sp, project, scale, W, H);
    }
    drawLegends(ctx, specs, scale, H); drawTitle(ctx, title, subtitle, scale);
    ctx.font = `${10 * scale}px ${FONT}`; ctx.fillStyle = 'rgba(0,0,0,.6)';
    const att = (basemap ? '\u00a9 OpenStreetMap contributors \u00b7 ' : '') + 'Spatial Disease Modeling with R (GHS)', aw = ctx.measureText(att).width;
    ctx.fillText(att, W - aw - 8 * scale, H - 8 * scale);
    return new Promise((res, rej) => {
      try { cv.toBlob(b => b ? res(b) : rej(new Error('Image encoding failed')), format === 'jpeg' ? 'image/jpeg' : 'image/png', 0.92) }
      catch (e) { rej(e) }
    });
  }
  function download(blob, name) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
  root.GeoExport = {render, download};
})(this);
