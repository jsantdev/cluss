const path = require('node:path');
const express = require('express');

function registerOverlayRoutes(app, { persistence, overlayPath } = {}) {
  const mainOverlayPath = overlayPath || path.join(__dirname, '..', '..', 'v21.html');
  app.get(['/', '/overlay', '/tortugas.html', '/tortugas_tiktok.html', '/v2.0.html'], (request, response) => {
    response.setHeader('Cache-Control', 'no-store, max-age=0');
    response.sendFile(mainOverlayPath);
  });

  app.get('/api/activity-policy.js', (request, response) => {
    response.setHeader('Cache-Control', 'no-store, max-age=0');
    response.type('application/javascript').sendFile(path.join(__dirname, 'public', 'activity-policy.js'));
  });

  app.get('/api/state.js', (request, response) => {
    const state = JSON.stringify(persistence.getBootstrapState())
      .replace(/</g, '\\u003c')
      .replace(/\u2028/g, '\\u2028')
      .replace(/\u2029/g, '\\u2029');
    response.setHeader('Cache-Control', 'no-store, max-age=0');
    response.type('application/javascript').send(`window.CLUSS_STATE = ${state};`);
  });

  app.get('/api/state/:key', (request, response) => {
    if (!persistence.isValidStateKey(request.params.key)) {
      response.status(400).json({ ok: false, message: 'La clave del documento no es válida.' });
      return;
    }
    const document = persistence.readState(request.params.key);
    if (!document.found) {
      response.status(404).json({ ok: false, message: 'Documento no encontrado.' });
      return;
    }
    response.json(document.value);
  });

  app.put('/api/state/:key', (request, response) => {
    if (request.body === undefined) {
      response.status(400).json({ ok: false, message: 'Se requiere un documento JSON.' });
      return;
    }
    if (!persistence.writeState(request.params.key, request.body)) {
      response.status(400).json({ ok: false, message: 'La clave del documento no es válida.' });
      return;
    }
    response.json({ ok: true });
  });

  app.delete('/api/state/:key', (request, response) => {
    if (!persistence.deleteState(request.params.key)) {
      response.status(400).json({ ok: false, message: 'La clave del documento no es válida.' });
      return;
    }
    response.json({ ok: true });
  });

  app.get('/api/log/chat-texts.json', (request, response) => {
    response.attachment('chat-texts.json').json(persistence.getChatRecords());
  });

  app.get('/api/log/chat-texts.txt', (request, response) => {
    response.attachment('chat-texts.txt').type('text/plain').send(persistence.getChatTextExport());
  });

  app.post('/api/log/:flow', (request, response) => {
    const result = persistence.appendLog(request.params.flow, request.body?.records);
    if (!result.ok) {
      response.status(result.status).json(result);
      return;
    }
    response.json(result);
  });

  app.delete('/api/log/:flow', (request, response) => {
    if (request.params.flow !== 'chat-texts') {
      response.status(404).json({ ok: false, message: 'Flujo de registro no encontrado.' });
      return;
    }
    persistence.clearChatLog();
    response.json({ ok: true });
  });

  app.get('/backend', (request, response) => {
    response.sendFile(path.join(__dirname, 'backend.html'));
  });

  app.use(express.static(path.join(__dirname, 'public')));
}

module.exports = { registerOverlayRoutes };
