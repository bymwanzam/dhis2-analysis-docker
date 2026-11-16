// Renders real run outputs with the real export.js on a node canvas. usage: node test_export.js <outdir> <run3> <run4> <run5>
const {createCanvas} = require('canvas'), fs = require('fs'), path = require('path');
const L = require('../app/static/lib.js');
global.document = {createElement: t => { const c = createCanvas(1, 1); c.toBlob = (cb, type, q) => cb({buf: type === 'image/jpeg' ? c.toBuffer('image/jpeg', {quality: q}) : c.toBuffer('image/png')}); return c }};
global.getComputedStyle = () => ({opacity: '1'});
const X = require('../app/static/export.js').GeoExport;
const [out, r3, r4, r5] = process.argv.slice(2); fs.mkdirSync(out, {recursive: true});
const W = 900, H = 640, b = [-3.2, 4.8, 1.2, 11.1];
const map = {getSize: () => ({x: W, y: H}), getContainer: () => ({getBoundingClientRect: () => ({left: 0, top: 0})}), getPane: () => ({querySelectorAll: () => []}),
  latLngToContainerPoint: ([lat, lng]) => ({x: (lng - b[0]) / (b[2] - b[0]) * W, y: H - (lat - b[1]) / (b[3] - b[1]) * H})};
const J = f => JSON.parse(fs.readFileSync(f));
const poly = (file, field, label, colors, num = true) => { const d = J(file), v = d.features.map(f => f.properties[field]); const sc = num ? L.numericScale(v) : L.categoryScale(v, colors);
  return {kind: 'choropleth', title: 'Demo layer', label, data: d, field, colour: sc.fn, legend: {type: 'items', items: sc.items}} };
(async () => {
  const esda = poly(`${r3}/esda_districts.geojson`, 'type', 'LISA cluster persistence, 2023-24', {'Persistent high cluster': '#B2182B'}, false);
  const rr = poly(`${r4}/disease_map.geojson`, 'RR_mean', 'Posterior mean relative risk');
  const cls = poly(`${r4}/disease_map.geojson`, 'class', 'Risk and certainty', {'High risk, certain: act': '#B2182B', 'Not high, uncertain: watch': '#92C5DE'}, false);
  const fc = poly(`${r5}/forecast_districts.geojson`, 'fc_2024_09', 'Forecast (spatio-temporal) \u00b7 Sep 2024');
  const pts = []; for (let i = 0; i < 400; i++) { const a = Math.random() * 6.28, r = Math.random() ** 2 * 1.2; pts.push({lat: 8.5 + r * Math.sin(a), lng: -1 + r * Math.cos(a), value: 1 / (1 + r)}) }
  const heat = {kind: 'heat', title: 'Case density, sigma 500 m (per km2)', label: '', points: pts, legend: {type: 'heat', lo: 0.45, hi: 1}};
  const cases = {kind: 'points', title: 'Confirmed cases', label: '', data: {features: pts.slice(0, 60).map(p => ({geometry: {type: 'Point', coordinates: [p.lng, p.lat]}}))}, legend: {type: 'items', items: [{color: '#d7301f', label: 'Case'}]}};
  const jobs = {'single_category.png': [esda], 'single_numeric.jpg': [rr], 'forecast.png': [fc], 'stacked_polygon_heat_points.png': [rr, heat, cases], 'two_legends.png': [cls, heat]};
  for (const [name, specs] of Object.entries(jobs)) {
    const blob = await X.render({map, specs, title: 'Bayesian disease mapping', subtitle: 'Run a1b2c3 \u00b7 module4_data \u00b7 28/10/2026', scale: 2, basemap: false, format: name.endsWith('jpg') ? 'jpeg' : 'png'});
    fs.writeFileSync(path.join(out, name), blob.buf); console.log(name, blob.buf.length, 'bytes');
  }
})().catch(e => { console.error(e); process.exit(1) });
