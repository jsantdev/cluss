const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'v21.html'), 'utf8');

test('free tournament is the default locked mode and can be manually unlocked', () => {
  assert.match(html, /let tournamentMode='libre'/);
  assert.match(html, /let lock='libre'/);
  assert.match(html, /v==='auto'\)lock=null/);
  assert.match(html, /SRV\.set\('cluss\.torneoLock',lock\|\|'auto'\)/);
});

test('empty free-tournament lanes do not show waiting-team labels', () => {
  assert.doesNotMatch(html, /ESPERANDO EQUIPO|esperando equipo/);
  assert.match(html, /function libreDuel\(\)/);
  assert.match(html, /const g=gs\[Math\.floor\(Math\.random\(\)\*gs\.length\)\]/);
  assert.match(html, /Nunca queda un carril vacio/);
});

test('inactivity victories advance without awarding a cup', () => {
  assert.match(html, /if\(fin&&!lowActivityFinished\)P\.cp\[id\]/);
  assert.match(html, /Gana por inactividad · sin copa/);
});

test('race divider and versus badge stay beneath the winner popup', () => {
  assert.match(html, /\.win\{[^}]*z-index:5/);
  assert.match(html, /#lanes\{gap:22px!important/);
  assert.match(html, /la viga central y el cartel VS ya NO flotan encima/);
});

test('statistics bar exposes all six LIVE event counters and both dynamic indicators', () => {
  const start = html.indexOf('<div class="evs" id="evs"');
  const end = html.indexOf('<div id="toast"', start);
  const bar = start < 0 || end < 0 ? '' : html.slice(start, end);
  for (const type of ['member', 'chat', 'gift', 'like', 'follow', 'share']) {
    assert.match(bar, new RegExp(`data-k="${type}"`), `${type} counter is missing`);
  }
  assert.match(html, /idleStat\.dataset\.k='idle'/);
  assert.match(html, /limStat\.dataset\.k='lim'/);
  assert.match(html, /id="idleCountdown"/);
  assert.match(html, /id="tapLimit"/);
});

test('statistics bar updates from real events and renders the live tap and idle values', () => {
  assert.match(html, /if\(e&&!e\.bot&&e\.type in ST\)/);
  assert.match(html, /TAP_POLICY\.isInteractionEvent\(e\.type\)/);
  assert.match(html, /stFmt\(HEART_N\)/);
  assert.match(html, /const lim=idleLimitMs\(\),seconds=Math\.max/);
  assert.match(html, /ST\[e\.type\]\+=n/);
});
