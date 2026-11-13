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

test('classic mode creates a fixed Olimpia versus Cerro tournament with their shirt-color flags', () => {
  assert.match(html, /TOURNAMENT_OPTIONS=TOURNAMENT_MODES\.slice\(\)/);
  assert.match(html, /TOURNAMENT_MODES=\['libre','clasico'/);
  assert.match(html, /clasico:'CLÁSICO OLIMPIA VS CERRO'/);
  assert.match(html, /if\(mode==='clasico'\)return\['ol','cp'\]/);
  assert.match(html, /bracketFrom\(mode==='clasico'\?ids:ids\.slice\(\)\.sort/);
  assert.match(html, /FINAL CLÁSICA/);
  assert.match(html, /SHORT=\{libre:'LIBRE',clasico:'CLÁSICO'/);
  assert.match(html, /if\(k==='ol'\)return `<rect[^`]+fill="#fff"[^`]+fill="#111"/);
  assert.match(html, /cp:\['#0b3d91','#c8102e'\]/);
});

test('trophy button changes the persistent tournament selector even when rotation is locked', () => {
  assert.match(html, /tournamentButton\.onclick=\(\)=>\{\s*const selector=document\.getElementById\('bTorneoSel'\);\s*if\(selector\)\{selector\.click\(\);return\}/);
  assert.match(html, /TOURNAMENT_OPTIONS\.includes\(mode\)/);
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
  assert.match(html, /if\(e&&!e\.bot\)\{\s*const n=TAP_POLICY\.statEventDelta\(e\.type,e\.activityCount\)/);
  assert.match(html, /TAP_POLICY\.isInteractionEvent\(e\.type\)/);
  assert.match(html, /stFmt\(HEART_N\)/);
  assert.match(html, /const lim=idleLimitMs\(\),seconds=Math\.max/);
  assert.match(html, /ST\[e\.type\]\+=n/);
});

test('real tap, turbo, and gift calculations run through the browser activity policy', () => {
  assert.match(html, /const tapCount=TAP_POLICY\.tapEventDelta\(type,count\)/);
  assert.match(html, /window\.recordLiveTap\(team,tapCount\)/);
  assert.match(html, /window\.recordLiveTap=\(team,count\)=>heartAdd\(team,count\)/);
  assert.doesNotMatch(html, /const taps=TAP_POLICY\.tapEventDelta\(type,n\)/);
  assert.match(html, /TAP_POLICY\.consumeTapCount\(heart\[t\],n,HEART_N\)/);
  assert.match(html, /TAP_POLICY\.giftProgress\(gifts,GIFT_PROGRESS\)/);
  assert.match(html, /TAP_POLICY\.giftTurboDuration\(count,GIFT_TURBO_MS\)/);
  assert.match(html, /LS\.set\(ST_KEY,rest\)/);
});

test('fan avatars and their live events use the same left or right side', () => {
  assert.match(html, /function supportTeamFor\(key\)/);
  assert.match(html, /TAP_POLICY\.resolveSupportSide\(key,T\.length,picks\.get\(key\),fanSides\.get\(key\)\)/);
  assert.match(html, /window\.resolveSupportTeamFor=supportTeamFor/);
  assert.match(html, /team=user\?window\.resolveSupportTeamFor\(key\):sel/);
  assert.match(html, /recentTeam>=0\?recentTeam:\(user\?window\.resolveSupportTeamFor\(key\):-1\)/);
  assert.doesNotMatch(html, /picks\.set\(key,team\);fanSides\.set\(key,team\)/);
});

test('large bottom-right gift count mirrors the real gift statistic without an icon', () => {
  assert.match(html, /id="giftTotal"[^>]*>0<\/div>/);
  assert.match(html, /#giftTotal\{[^}]*right:10px;bottom:5px[^}]*color:#ff3b30[^}]*font:900 38px/);
  assert.match(html, /giftTotal\.textContent=stFmt\(ST\.gift\)/);
  assert.match(html, /giftTotal\.setAttribute\('aria-label','Regalos recibidos: '\+ST\.gift\)/);
});

test('gift turbo reminder repeats every five minutes only past 50 percent and level four', () => {
  assert.match(html, /const GIFT_TURBO_REMINDER_MS=5\*60\*1000/);
  assert.match(html, /progress>50&&tapLevel>=4/);
  assert.match(html, /now-giftTurboReminderAt>=GIFT_TURBO_REMINDER_MS/);
  assert.match(html, /giftTurboReminderAt=now;return/);
  assert.match(html, /Enviar un regalo a tu equipo activa el modo turbo y le ayuda a llegar más rápido a la meta\./);
});
