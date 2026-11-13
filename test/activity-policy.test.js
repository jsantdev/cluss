const assert = require('node:assert/strict');
const test = require('node:test');
const policy = require('../modules/overlay/public/activity-policy');

test('new LIVE members do not count as interaction activity', () => {
  assert.equal(policy.isInteractionEvent('member'), false);
  assert.equal(policy.isInteractionEvent('chat'), true);
});

test('statistics bar counts every supported event with the right activity delta', () => {
  assert.equal(policy.statEventDelta('member'), 1);
  assert.equal(policy.statEventDelta('chat'), 1);
  assert.equal(policy.statEventDelta('gift', 4), 4);
  assert.equal(policy.statEventDelta('like', 2.8), 2);
  assert.equal(policy.statEventDelta('follow'), 1);
  assert.equal(policy.statEventDelta('share'), 1);
  assert.equal(policy.statEventDelta('unknown'), 0);
  assert.equal(policy.statEventDelta('gift', 0), 1);
});

test('statistics bar formats units consistently at thousand and million boundaries', () => {
  assert.equal(policy.formatStatCount(999), '999');
  assert.equal(policy.formatStatCount(1000), '1K');
  assert.equal(policy.formatStatCount(1250), '1.3K');
  assert.equal(policy.formatStatCount(999499), '999K');
  assert.equal(policy.formatStatCount(999500), '1M');
  assert.equal(policy.formatStatCount(1250000), '1.3M');
});

test('tap limit rises by 50 or 100 for activity above the rate thresholds', () => {
  assert.equal(policy.tapLimitStep(3), 0);
  assert.equal(policy.tapLimitStep(3.01), 50);
  assert.equal(policy.tapLimitStep(10), 50);
  assert.equal(policy.tapLimitStep(10.01), 100);
});

test('advanced matches with over 1000 interactions wait up to two idle minutes', () => {
  assert.equal(policy.inactivityTimeoutMs(79.99, 1001), 60000);
  assert.equal(policy.inactivityTimeoutMs(80, 1000), 60000);
  assert.equal(policy.inactivityTimeoutMs(80, 1001), 120000);
  assert.equal(policy.shouldFinishForInactivity(119999, 120000), false);
  assert.equal(policy.shouldFinishForInactivity(120000, 120000), true);
});

test('other matches finish after one idle minute', () => {
  assert.equal(policy.inactivityTimeoutMs(20, 50), 60000);
  assert.equal(policy.shouldFinishForInactivity(59999, 60000), false);
  assert.equal(policy.shouldFinishForInactivity(60000, 60000), true);
});

test('inactivity display counts down and resets to the configured timeout', () => {
  assert.equal(policy.inactivityRemainingSeconds(0, 60000), 60);
  assert.equal(policy.inactivityRemainingSeconds(1500, 60000), 59);
  assert.equal(policy.inactivityRemainingSeconds(60000, 60000), 0);
  assert.equal(policy.inactivityRemainingSeconds(0, 120000), 120);
});

test('only a normally finished final awards a cup', () => {
  assert.equal(policy.shouldAwardCup(true, false), true);
  assert.equal(policy.shouldAwardCup(true, true), false);
  assert.equal(policy.shouldAwardCup(false, true), false);
});

test('free tournament fills missing chat teams with random teams without duplicates', () => {
  const first = policy.selectFreeTournamentPair([], ['a', 'b', 'c'], () => 0);
  assert.deepEqual(first, ['a', 'b']);

  const oneRegistered = policy.selectFreeTournamentPair(['viewer-team'], ['viewer-team', 'fallback'], () => 0);
  assert.deepEqual(oneRegistered, ['viewer-team', 'fallback']);

  const twoRegistered = policy.selectFreeTournamentPair(['top-team', 'second-team'], ['fallback']);
  assert.deepEqual(twoRegistered, ['top-team', 'second-team']);
});

test('fans keep supporting their assigned side across their live events', () => {
  assert.equal(policy.resolveSupportSide('ana', 2, 1, 0), 1);
  assert.equal(policy.resolveSupportSide('ana', 2, -1, 1), 1);
  assert.equal(policy.resolveSupportSide('a', 2), 1);
  assert.equal(policy.resolveSupportSide('b', 2), 0);
  assert.equal(policy.resolveSupportSide('a', 2), policy.resolveSupportSide('a', 2));
  assert.equal(policy.resolveSupportSide('a', 0), -1);
});
