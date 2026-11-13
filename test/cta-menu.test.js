const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '..', 'v21.html'), 'utf8');

test('gift CTAs are icon-only and offer only rose, donut, and confetti', () => {
  const gifts = html.match(/const GIFTS=\[([\s\S]*?)\];/);
  assert.ok(gifts, 'CTA gift list is missing');
  const keys = [...gifts[1].matchAll(/\{k:'([^']+)'/g)].map((match) => match[1]);
  assert.deepEqual(keys, ['rosa', 'dona', 'confeti']);
  assert.match(html, /class="r">\$\{g\.ic\}<\/span><span class="ar"/);
  assert.doesNotMatch(html, /class="r">\$\{g\.ic\}<\/span>\$\{g\.n\}/);
});
