(function (root, factory) {
  const policy = factory();
  if (typeof module === 'object' && module.exports) module.exports = policy;
  root.TORTUWORLD_ACTIVITY_POLICY = policy;
})(globalThis, function () {
  const interactionTypes = new Set(['chat', 'gift', 'like', 'follow', 'share']);
  const statTypes = new Set(['member', 'chat', 'gift', 'like', 'follow', 'share']);
  const tapWeights = Object.freeze({ member: 1, chat: 10, like: 1, follow: 3, share: 5 });
  const eventCount = (activityCount) => {
    const count = Number(activityCount);
    return Number.isFinite(count) && count > 0 ? Math.max(1, Math.floor(count)) : 1;
  };
  const statEventDelta = (type, activityCount) => {
    if (!statTypes.has(type)) return 0;
    return type === 'gift' || type === 'like' ? eventCount(activityCount) : 1;
  };
  return Object.freeze({
    isInteractionEvent(type) {
      return interactionTypes.has(type);
    },
    tapEventDelta(type, activityCount) {
      const weight = Object.hasOwn(tapWeights, type) ? tapWeights[type] : 0;
      if (!weight) return 0;
      return weight * eventCount(activityCount);
    },
    statEventDelta,
    consumeTapCount(current, added, limit) {
      const value = Number(limit);
      const threshold = Math.floor(value);
      if (!Number.isFinite(threshold) || threshold < 1) return { remaining: 0, activations: 0 };
      const total = Math.max(0, Math.floor(Number(current) || 0))
        + Math.max(0, Math.floor(Number(added) || 0));
      return { remaining: total % threshold, activations: Math.floor(total / threshold) };
    },
    giftProgress(activityCount, progressPerGift) {
      return statEventDelta('gift', activityCount) * progressPerGift;
    },
    giftTurboDuration(activityCount, durationPerGift) {
      return statEventDelta('gift', activityCount) * durationPerGift;
    },
    formatStatCount(value) {
      const count = Math.max(0, Math.floor(Number(value) || 0));
      if (count < 1000) return String(count);
      if (count < 999500) {
        return `${count < 10000
          ? (count / 1000).toFixed(1).replace(/\.0$/, '')
          : Math.round(count / 1000)}K`;
      }
      return `${count < 1e7
        ? (count / 1e6).toFixed(1).replace(/\.0$/, '')
        : Math.round(count / 1e6)}M`;
    },
    tapLimitStep(eventsPerSecond) {
      if (!Number.isFinite(eventsPerSecond) || eventsPerSecond <= 3) return 0;
      return eventsPerSecond > 10 ? 100 : 50;
    },
    inactivityTimeoutMs(progress, interactionCount) {
      return Number.isFinite(progress)
        && progress >= 80
        && Number.isFinite(interactionCount)
        && interactionCount > 1000
        ? 120000
        : 60000;
    },
    shouldFinishForInactivity(idleMs, timeoutMs) {
      return Number.isFinite(idleMs)
        && Number.isFinite(timeoutMs)
        && idleMs >= timeoutMs;
    },
    inactivityRemainingSeconds(idleMs, timeoutMs) {
      if (!Number.isFinite(idleMs) || !Number.isFinite(timeoutMs)) return 0;
      return Math.max(0, Math.ceil((timeoutMs - Math.max(0, idleMs)) / 1000));
    },
    shouldAwardCup(isFinal, timedOut) {
      return isFinal === true && timedOut !== true;
    },
    selectFreeTournamentPair(registeredIds, allTeamIds, random = Math.random) {
      const pair = Array.isArray(registeredIds) ? registeredIds.slice(0, 2) : [];
      const available = [...new Set(Array.isArray(allTeamIds) ? allTeamIds : [])]
        .filter((id) => !pair.includes(id));
      while (pair.length < 2 && available.length) {
        const value = random();
        const index = Number.isFinite(value)
          ? Math.max(0, Math.min(available.length - 1, Math.floor(value * available.length)))
          : 0;
        pair.push(available.splice(index, 1)[0]);
      }
      return pair;
    },
    resolveSupportSide(username, teamCount, assignedSide, configuredSide) {
      if (!Number.isInteger(teamCount) || teamCount < 1) return -1;
      const validSide = (side) => Number.isInteger(side) && side >= 0 && side < teamCount;
      if (validSide(assignedSide)) return assignedSide;
      if (validSide(configuredSide)) return configuredSide;
      const name = String(username || '').trim().toLowerCase();
      if (!name) return 0;
      let hash = 0;
      for (const character of name) hash += character.charCodeAt(0);
      return hash % teamCount;
    },
  });
});
