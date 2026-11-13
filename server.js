const { createServer } = require('node:http');
const path = require('node:path');
const express = require('express');
const { createSseHub } = require('./modules/realtime/sseHub');
const { createTikTokModule, createTikTokMonitorService } = require('./modules/tiktok');
const { registerOverlayRoutes } = require('./modules/overlay');
const { createOverlayPersistenceService } = require('./modules/overlay/persistenceService');

function createWebserver({
  configurationPath = process.env.TIKTOK_CONFIG_PATH
    || path.join(__dirname, 'data', 'tiktok', 'config.json'),
  commentStatsPath = process.env.TIKTOK_COMMENT_STATS_PATH,
  recentUsersPath = process.env.TIKTOK_RECENT_USERS_PATH,
  freeTournamentPath = process.env.TIKTOK_FREE_TOURNAMENT_PATH,
  commentArchivePath = process.env.TIKTOK_COMMENT_ARCHIVE_PATH,
  overlayDataPath = process.env.TIKTOK_OVERLAY_DATA_PATH,
  defaultUsername = process.env.TIKTOK_USERNAME || '',
  monitorService = createTikTokMonitorService(),
} = {}) {
  const app = express();
  const server = createServer(app);
  const eventStream = createSseHub();
  const savedCommentArchivePath = commentArchivePath
    || path.join(path.dirname(configurationPath), 'comments-archive.json');
  const persistence = createOverlayPersistenceService({
    directoryPath: overlayDataPath || path.join(path.dirname(configurationPath), 'overlay'),
    legacyChatArchivePath: savedCommentArchivePath,
  });
  const tiktok = createTikTokModule({
    stream: eventStream,
    monitorService,
    configurationPath,
    commentStatsPath: commentStatsPath
      || path.join(path.dirname(configurationPath), 'comment-stats.json'),
    recentUsersPath: recentUsersPath
      || path.join(path.dirname(configurationPath), 'recent-users.json'),
    freeTournamentPath: freeTournamentPath
      || path.join(path.dirname(configurationPath), 'free-tournament.json'),
    commentArchivePath: savedCommentArchivePath,
    defaultUsername,
  });

  app.use(express.json({ limit: '1mb', strict: false }));
  registerOverlayRoutes(app, { persistence });
  tiktok.registerRoutes(app);

  app.get('/health', (request, response) => {
    response.json({ ok: true });
  });
  app.use('/api', (request, response) => {
    response.status(404).json({ ok: false, message: 'Ruta API no encontrada.' });
  });
  app.use((error, request, response, next) => {
    if (response.headersSent) {
      next(error);
      return;
    }
    const status = Number(error.status) || 500;
    console.error(
      `Error al procesar ${request.method} ${request.path} (${status}):`,
      status < 500 ? 'solicitud no válida' : error.message,
    );
    response.status(status).json({ ok: false, message: 'No se pudo completar la solicitud.' });
  });

  server.on('close', () => {
    tiktok.close();
    eventStream.close();
  });

  return { server, monitorService };
}

function startServer({
  port = Number(process.env.PORT || 80),
  host = process.env.HOST || '0.0.0.0',
  createWebserver: createServerInstance = createWebserver,
  logger = console,
} = {}) {
  const { server } = createServerInstance();
  server.listen(port, host, () => {
    const address = server.address();
    const listeningPort = address && typeof address === 'object' ? address.port : port;
    logger.log(`Servidor y conector TikTok disponibles en http://localhost:${listeningPort}`);
  });
  server.on('error', (error) => {
    logger.error(`No se pudo iniciar el servidor: ${error.message}`);
    process.exitCode = 1;
  });
  return server;
}

if (require.main === module) startServer();

module.exports = { createWebserver, startServer };
