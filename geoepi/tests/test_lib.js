const L = require('../app/static/lib.js'), assert = require('assert');
const v = Array.from({length: 100}, (_, i) => i);
const n = L.numericScale(v); assert.notStrictEqual(n.fn(0), n.fn(99)); assert.strictEqual(n.fn(null), '#e3e8e9');
assert.deepStrictEqual(L.range(v), [1, 97]); assert.strictEqual(L.scale01(5, 5, 5), .5); assert.strictEqual(L.scale01(200, 0, 100), 1);
const c = L.categoryScale(['a', 'b', null, 'Not significant'], {a: '#111111'}); assert.strictEqual(c.fn('a'), '#111111'); assert.strictEqual(c.fn('Not significant'), '#e3e8e9');
assert.strictEqual(L.esc('<b>"x"</b>'), '&lt;b&gt;&quot;x&quot;&lt;/b&gt;'); console.log('lib tests passed');
const items = L.numericScale(v).items; assert.strictEqual(items.length, 5); assert.ok(items[0].label.includes('\u2013'));
const z = L.zip([{name: 'a.png', data: new Uint8Array([1, 2, 3])}, {name: 'maps/b é.jpg', data: new Uint8Array(1000).fill(7)}]);
require('fs').writeFileSync(process.argv[2] || '/tmp/t.zip', z); console.log('zip written');
