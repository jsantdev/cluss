function registerTikTokRoutes(app, {
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
}) {
  app.get('/api/status', (request, response) => {
    response.json(getStatus());
  });

  app.get('/api/config', (request, response) => {
    response.json(getConfiguration());
  });

  app.get('/api/comment-stats', (request, response) => {
    response.json(getCommentStats());
  });

  app.get('/api/cup-stats', (request, response) => {
    response.json(getCupStats());
  });

  app.get('/api/recent-users', (request, response) => {
    response.json(getRecentUsers());
  });

  app.get('/api/free-tournament/stats', (request, response) => {
    response.json(getFreeTournamentStats());
  });

  app.get('/api/comment-archive/stats', (request, response) => {
    response.json(getCommentArchiveSummary());
  });

  app.get('/api/comment-archive', (request, response) => {
    response.attachment('comentarios.json').json(getCommentArchive());
  });

  app.get('/api/comment-archive.txt', (request, response) => {
    response.attachment('comentarios.txt').type('text/plain').send(getCommentArchiveText());
  });

  app.post('/api/comment-archive/reset', (request, response) => {
    if (request.body?.confirm !== true) {
      response.status(400).json({ ok: false, message: 'Confirma que quieres borrar el archivo.' });
      return;
    }
    response.json({ ok: true, ...resetCommentArchive() });
  });

  app.put('/api/free-tournament/mode', (request, response) => {
    const result = setFreeTournamentMode(request.body?.enabled);
    if (!result.ok) {
      response.status(400).json(result);
      return;
    }
    response.json(result);
  });

  app.post('/api/cup-stats', (request, response) => {
    const stats = recordCup(request.body?.code);
    if (!stats) {
      response.status(400).json({ ok: false, message: 'El código de país no es válido.' });
      return;
    }
    response.json(stats);
  });

  app.put('/api/config', (request, response) => {
    const result = saveConfiguration(request.body);
    if (!result.ok) {
      response.status(400).json(result);
      return;
    }
    response.json(result);
  });

  app.post('/api/connect', (request, response) => {
    const result = connectToUser(request.body?.username);
    if (!result.ok) {
      response.status(400).json(result);
      return;
    }
    response.json(result);
  });

  app.post('/api/round/complete', (request, response) => {
    response.json(completeRound());
  });

  app.post('/api/reconnect', (request, response) => {
    const result = reconnect();
    if (!result.ok) {
      response.status(result.status).json({ ok: false, message: result.message });
      return;
    }
    response.json(result);
  });

  app.get('/api/events', (request, response) => {
    openEventStream(response);
  });
}

module.exports = { registerTikTokRoutes };
