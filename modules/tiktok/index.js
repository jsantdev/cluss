const fs = require('node:fs');
const path = require('node:path');
const { registerTikTokRoutes } = require('./routes');
const { createTikTokMonitorService } = require('./tiktokMonitorService');
const { createCommentStatsService } = require('./commentStatsService');
const { createRecentUsersService } = require('./recentUsersService');
const { createFreeTournamentService } = require('./freeTournamentService');
const { createCommentArchiveService } = require('./commentArchiveService');

const maxEvents = 100;

function createTikTokModule({
  stream,
  monitorService = createTikTokMonitorService(),
  configurationPath = process.env.TIKTOK_CONFIG_PATH
    || path.join(__dirname, '..', '..', 'data', 'tiktok', 'config.json'),
  commentStatsPath = process.env.TIKTOK_COMMENT_STATS_PATH,
  recentUsersPath = process.env.TIKTOK_RECENT_USERS_PATH,
  freeTournamentPath = process.env.TIKTOK_FREE_TOURNAMENT_PATH,
  commentArchivePath = process.env.TIKTOK_COMMENT_ARCHIVE_PATH,
  defaultUsername = process.env.TIKTOK_USERNAME || '',
} = {}) {
  if (!stream || typeof stream.attach !== 'function' || typeof stream.broadcast !== 'function') {
    throw new Error('El módulo TikTok necesita su canal de eventos.');
  }

  const environmentUsername = String(defaultUsername).trim().replace(/^@+/, '');
  const commentStats = createCommentStatsService({
    filePath: commentStatsPath || path.join(path.dirname(configurationPath), 'comment-stats.json'),
  });
  const recentUsers = createRecentUsersService({
    filePath: recentUsersPath || path.join(path.dirname(configurationPath), 'recent-users.json'),
  });
  const freeTournament = createFreeTournamentService({
    filePath: freeTournamentPath || path.join(path.dirname(configurationPath), 'free-tournament.json'),
  });
  const commentArchive = createCommentArchiveService({
    filePath: commentArchivePath || path.join(path.dirname(configurationPath), 'comments-archive.json'),
  });
  let username = environmentUsername;
  const events = [];
  const pendingCommentEvents = [];
  const state = {
    connected: Boolean(monitorService.state.isConnected),
    status: monitorService.state.status,
    error: monitorService.state.error || '',
    username,
    lastEventAt: null,
  };

  try {
    const saved = JSON.parse(fs.readFileSync(configurationPath, 'utf8'));
    if (!saved || typeof saved.username !== 'string') {
      throw new Error('La configuración guardada de TikTok no es válida.');
    }
    if (!environmentUsername) username = saved.username.trim().replace(/^@+/, '');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (!username) username = 'd4n1el325';
  state.username = username;

  function publish(event, payload) {
    if (event === 'status' || event === 'update') stream.broadcast(event, payload);
  }

  function handleEvent(entry) {
    if (!entry || typeof entry !== 'object' || typeof entry.type !== 'string') return;
    const eventEntry = {
      ...entry,
      lifecycle: [
        ...(Array.isArray(entry.lifecycle) ? entry.lifecycle : []),
        { stage: 'backend_received', time: new Date().toISOString() },
      ],
    };
    events.unshift(eventEntry);
    events.length = Math.min(events.length, maxEvents);
    state.lastEventAt = eventEntry.time || new Date().toISOString();
    if (eventEntry.type === 'member') {
      recentUsers.rememberConnectedUser(eventEntry);
    } else if (eventEntry.avatar) {
      recentUsers.updateRecentUserAvatar(eventEntry);
    }
    if (eventEntry.type === 'chat') {
      pendingCommentEvents.push({
        entry: eventEntry,
        freeVotingEnabled: freeTournament.getStats().enabled,
      });
    }
    eventEntry.lifecycle.push({ stage: 'sse_published', time: new Date().toISOString() });
    publish('update', { entry: eventEntry });
  }

  function getCommentStats() {
    return commentStats.getStats();
  }

  function getCupStats() {
    return commentStats.getCupStats();
  }

  function getRecentUsers() {
    return recentUsers.getRecentUsers();
  }

  function getFreeTournamentStats() {
    return freeTournament.getStats();
  }

  function setFreeTournamentMode(enabled) {
    const stats = freeTournament.setEnabled(enabled);
    if (!stats) return { ok: false, message: 'El estado del torneo libre no es válido.' };
    publish('free-tournament-stats', stats);
    return { ok: true, enabled, stats };
  }

  function getCommentArchive() {
    return commentArchive.getArchive();
  }

  function getCommentArchiveSummary() {
    return commentArchive.getSummary();
  }

  function getCommentArchiveText() {
    return commentArchive.getTextExport();
  }

  function completeRound() {
    const stored = pendingCommentEvents.length;
    let stats = null;
    let archive = null;
    let freeStats = null;
    for (const { entry, freeVotingEnabled } of pendingCommentEvents) {
      stats = commentStats.recordComment(entry.content);
      archive = commentArchive.recordComment(entry.content, entry.time);
      const recordedFreeStats = freeTournament.recordComment(entry, freeVotingEnabled);
      if (recordedFreeStats) freeStats = recordedFreeStats;
    }
    if (pendingCommentEvents.length) {
      commentArchive.flush();
      pendingCommentEvents.length = 0;
      publish('comment-stats', stats);
      publish('comment-archive-stats', archive);
      if (freeStats) publish('free-tournament-stats', freeStats);
    }
    return {
      ok: true,
      stored,
      stats: getCommentStats(),
    };
  }

  function resetCommentArchive() {
    const summary = commentArchive.reset();
    publish('comment-archive-stats', summary);
    return summary;
  }

  function recordCup(code) {
    const stats = commentStats.recordCup(code);
    if (stats) publish('cup-stats', stats);
    return stats;
  }

  const unsubscribeEvents = monitorService.subscribeToEvents(handleEvent);
  const unsubscribeStatus = monitorService.subscribeToStatus((status) => {
    state.connected = Boolean(status.isConnected);
    state.status = status.status;
    state.error = status.error || '';
    state.username = status.username || username;
    publish('status', { ...state });
  });

  function getStatus() {
    return { ...state, eventCount: events.length, connector: monitorService.getStatusPayload() };
  }

  function getConfiguration() {
    return { username };
  }

  function saveConfiguration(body) {
    const nextUsername = typeof body?.username === 'string'
      ? body.username.trim().replace(/^@+/, '')
      : '';
    if (!nextUsername) {
      return { ok: false, message: 'Ingresa un usuario de TikTok válido.' };
    }
    fs.mkdirSync(path.dirname(configurationPath), { recursive: true });
    fs.writeFileSync(configurationPath, JSON.stringify({ username: nextUsername }, null, 2));
    monitorService.disconnectUser();
    username = nextUsername;
    state.username = nextUsername;
    state.connected = false;
    state.status = 'disconnected';
    state.error = '';
    publish('status', { ...state });
    return { ok: true, username };
  }

  function connectToUser(value) {
    const nextUsername = typeof value === 'string' ? value.trim().replace(/^@+/, '') : '';
    if (!nextUsername) {
      return { ok: false, message: 'Ingresa un usuario de TikTok válido.' };
    }
    monitorService.connectUser(nextUsername);
    username = nextUsername;
    state.username = nextUsername;
    return { ok: true, username: nextUsername };
  }

  function reconnect() {
    if (!username) {
      return { ok: false, status: 409, message: 'Primero configura un usuario de TikTok.' };
    }
    if (monitorService.state.isConnected) {
      return { ok: false, status: 409, message: 'La conexión ya está activa.' };
    }
    if (['connecting', 'reconnecting'].includes(monitorService.state.status)) {
      monitorService.refreshRetryWindow();
      return { ok: true, username };
    }
    monitorService.connectUser(username);
    return { ok: true, username };
  }

  function openEventStream(response) {
    stream.attach(response, [['status', { ...state }]]);
  }

  function registerRoutes(app) {
    registerTikTokRoutes(app, {
      getStatus,
      getConfiguration,
      getCommentStats,
      getCupStats,
      getRecentUsers,
      getFreeTournamentStats,
      setFreeTournamentMode,
      getCommentArchive,
      getCommentArchiveSummary,
      getCommentArchiveText,
      resetCommentArchive,
      recordCup,
      saveConfiguration,
      connectToUser,
      completeRound,
      reconnect,
      openEventStream,
    });
  }

  return {
    monitorService,
    registerRoutes,
    close() {
      unsubscribeEvents();
      unsubscribeStatus();
      try {
        commentArchive.close();
      } finally {
        monitorService.disconnectUser();
      }
    },
  };
}

module.exports = {
  createTikTokModule,
  createTikTokMonitorService,
};
