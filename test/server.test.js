const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { once } = require('node:events');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createWebserver, startServer } = require('../server');

function createMonitorService() {
  let eventListener;
  let statusListener;
  const service = {
    state: { username: '', status: 'idle', isConnected: false, error: '' },
    getStatusPayload: () => ({ ...service.state }),
    subscribeToEvents(listener) {
      eventListener = listener;
      return () => { eventListener = null; };
    },
    subscribeToStatus(listener) {
      statusListener = listener;
      return () => { statusListener = null; };
    },
    connectUser(username) {
      Object.assign(service.state, {
        username,
        status: 'connected',
        isConnected: true,
      });
      statusListener({ ...service.state });
    },
    disconnectUser() {},
    refreshRetryWindow() {},
    emit(entry) {
      eventListener(entry);
    },
  };
  return service;
}

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return `http://127.0.0.1:${server.address().port}`;
}

async function close(server) {
  server.closeAllConnections();
  const closed = once(server, 'close');
  server.close();
  await closed;
}

async function readEvent(reader, eventName) {
  let message = '';
  while (!message.includes(`event: ${eventName}\n`)) {
    const { value, done } = await reader.read();
    assert.equal(done, false, 'SSE stream closed before the expected event');
    message += new TextDecoder().decode(value);
  }
  return message;
}

test('serves v21 as the main Cluss TikTok overlay', async (t) => {
  const root = path.join(__dirname, '..');
  const dockerfile = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');
  assert.match(dockerfile, /COPY v21\.html \.\//);
  assert.equal(fs.existsSync(path.join(root, 'v21.html')), true);
  assert.equal(fs.existsSync(path.join(root, 'v21 (1).html')), false);
  assert.equal(fs.existsSync(path.join(root, 'v10.html')), false);
  assert.equal(fs.existsSync(path.join(root, 'cluss.html')), false);
  assert.equal(fs.existsSync(path.join(root, 'tortugas_tiktok.html')), false);
  assert.equal(fs.existsSync(path.join(root, 'tortugas.html')), false);

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tortu-overlay-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const monitorService = createMonitorService();
  const { server } = createWebserver({
    configurationPath: path.join(directory, 'config.json'),
    overlayDataPath: path.join(directory, 'overlay'),
    monitorService,
  });
  const baseUrl = await listen(server);

  try {
    const backendResponse = await fetch(`${baseUrl}/backend`);
    assert.equal(backendResponse.status, 200);
    assert.match(await backendResponse.text(), /fetch\('\/api\/reconnect', \{ method: 'POST' \}\)/);
    assert.equal(monitorService.state.isConnected, false, 'opening the backend must not connect TikTok');

    const rootResponse = await fetch(baseUrl);
    assert.equal(rootResponse.status, 200);
    assert.equal(monitorService.state.isConnected, false, 'serving the overlay must not connect TikTok');
    assert.match(rootResponse.headers.get('cache-control'), /no-store/);
    const servedHtml = await rootResponse.text();
    assert.equal(servedHtml, fs.readFileSync(path.join(root, 'v21.html'), 'utf8'));
    assert.match(servedHtml, /new EventSource\('\/api\/events'\)/);
    assert.match(servedHtml, /source\.addEventListener\('status'/);
    assert.match(servedHtml, /source\.addEventListener\('update'/);
    assert.match(servedHtml, /<script src="\/api\/state\.js"><\/script>/);
    assert.match(servedHtml, /window\.SRV=/);
    assert.match(servedHtml, /SRV\.log\('user-events'/);
    assert.match(servedHtml, /SRV\.log\('chat-texts'/);
    assert.match(servedHtml, /SRVCHAT_JSON='\/api\/log\/chat-texts\.json'/);
    assert.match(servedHtml, /<script src="\/activity-policy\.js"><\/script>/);
    assert.match(servedHtml, /@keyframes gmGift/);
    assert.match(servedHtml, /@keyframes gmHeart/);
    assert.match(servedHtml, /function sincro\(\)/);
    assert.doesNotMatch(servedHtml, /(?:localStorage|sessionStorage|indexedDB)\.(?:getItem|setItem|open)/);
    assert.deepEqual(await fetch(`${baseUrl}/api/config`).then((response) => response.json()), {
      username: 'd4n1el325',
    });

    for (const route of ['/overlay', '/tortugas.html', '/tortugas_tiktok.html', '/v2.0.html']) {
      const response = await fetch(`${baseUrl}${route}`);
      assert.equal(response.status, 200);
      assert.equal(await response.text(), servedHtml);
    }
    assert.equal((await fetch(`${baseUrl}/v1.3.html`)).status, 404);
    assert.equal((await fetch(`${baseUrl}/v68.html`)).status, 404);
    assert.equal((await fetch(`${baseUrl}/v60.html`)).status, 404);
    assert.equal((await fetch(`${baseUrl}/v45.html`)).status, 404);
    const serviceWorker = await fetch(`${baseUrl}/sw.js`);
    assert.equal(serviceWorker.status, 200);
    assert.match(await serviceWorker.text(), /tortu-shell-v13/);
    assert.equal((await fetch(`${baseUrl}/activity-policy.js`)).status, 200);
    assert.equal((await fetch(`${baseUrl}/api/activity-policy.js`)).status, 200);
    const manifest = await fetch(`${baseUrl}/manifest.webmanifest`);
    assert.equal(manifest.status, 200);
    const appManifest = await manifest.json();
    assert.equal(appManifest.name, 'TortuWorld');
    assert.equal(appManifest.short_name, 'TortuWorld');
    assert.equal(appManifest.display, 'fullscreen');
    assert.deepEqual(await fetch(`${baseUrl}/health`).then((response) => response.json()), {
      ok: true,
    });
  } finally {
    await close(server);
  }
});

test('forwards normalized TikTok updates in the shape consumed by v21', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tortu-test-'));
  const monitorService = createMonitorService();
  const { server } = createWebserver({
    configurationPath: path.join(directory, 'config.json'),
    commentStatsPath: path.join(directory, 'comment-stats.json'),
    recentUsersPath: path.join(directory, 'recent-users.json'),
    monitorService,
  });

  test('archives real comment text and tracks free-tournament votes without user names', async (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tortu-free-mode-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const monitorService = createMonitorService();
    const { server } = createWebserver({
      configurationPath: path.join(directory, 'config.json'),
      commentStatsPath: path.join(directory, 'comment-stats.json'),
      recentUsersPath: path.join(directory, 'recent-users.json'),
      freeTournamentPath: path.join(directory, 'free-tournament.json'),
      commentArchivePath: path.join(directory, 'comments-archive.json'),
      monitorService,
    });
    const baseUrl = await listen(server);

    try {
      monitorService.emit({ type: 'chat', username: 'ana', content: 'Cerro Porteño' });
      const initialStats = await fetch(`${baseUrl}/api/free-tournament/stats`).then((response) => response.json());
      assert.equal(initialStats.enabled, true, 'free voting is enabled by default');
      assert.equal(initialStats.teams[0].votes, 1);

      const disabled = await fetch(`${baseUrl}/api/free-tournament/mode`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      }).then((response) => response.json());
      assert.equal(disabled.enabled, false);
      monitorService.emit({ type: 'chat', username: 'ana', content: 'Cerro Porteño' });

      const enabled = await fetch(`${baseUrl}/api/free-tournament/mode`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true }),
      }).then((response) => response.json());
      assert.equal(enabled.enabled, true);
      monitorService.emit({ type: 'chat', username: 'ana', content: 'Vamos Cerro Porteño hoy' });

      const votes = await fetch(`${baseUrl}/api/free-tournament/stats`).then((response) => response.json());
      assert.deepEqual(votes.teams.map(({ name, votes: total, users }) => ({ name, votes: total, users })), [
        { name: 'Cerro Porteño', votes: 2, users: 1 },
      ]);

      const archive = await fetch(`${baseUrl}/api/comment-archive`).then((response) => response.json());
      assert.deepEqual(archive.comments.map((comment) => comment.text), [
        'Cerro Porteño', 'Cerro Porteño', 'Vamos Cerro Porteño hoy',
      ]);
      assert.equal('username' in archive.comments[0], false);
      const textExport = await fetch(`${baseUrl}/api/comment-archive.txt`).then((response) => response.text());
      assert.equal(textExport, 'Cerro Porteño\nCerro Porteño\nVamos Cerro Porteño hoy');
      const savedVotes = fs.readFileSync(path.join(directory, 'free-tournament.json'), 'utf8');
      assert.doesNotMatch(savedVotes, /ana/);

      const deniedReset = await fetch(`${baseUrl}/api/comment-archive/reset`, { method: 'POST' });
      assert.equal(deniedReset.status, 400);
      const reset = await fetch(`${baseUrl}/api/comment-archive/reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true }),
      }).then((response) => response.json());
      assert.equal(reset.count, 0);
      assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory, 'comments-archive.json'), 'utf8')).comments, []);
    } finally {
      await close(server);
    }
  });
  const baseUrl = await listen(server);
  let reader;

  try {
    const stream = await fetch(`${baseUrl}/api/events`);
    reader = stream.body.getReader();
    const initialStatus = await readEvent(reader, 'status');
    assert.doesNotMatch(initialStatus, /event: snapshot/);

    const configResponse = await fetch(`${baseUrl}/api/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: '@race-host' }),
    });
    assert.deepEqual(await configResponse.json(), { ok: true, username: 'race-host' });
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory, 'config.json'), 'utf8')), {
      username: 'race-host',
    });
    assert.equal(monitorService.state.status, 'idle', 'saving configuration must not connect TikTok');
    const reconnectResponse = await fetch(`${baseUrl}/api/reconnect`, { method: 'POST' });
    assert.deepEqual(await reconnectResponse.json(), { ok: true, username: 'race-host' });
    assert.equal(monitorService.state.isConnected, true);

    const entry = {
      type: 'chat',
      username: 'viewer',
      content: 'Argentina',
      time: '2026-11-08T12:00:00.000Z',
    };
    monitorService.emit(entry);
    const update = await readEvent(reader, 'update');
    const payload = JSON.parse(update.match(/event: update\ndata: (.+)\n/)[1]);
    assert.deepEqual(payload, { entry });

    const stats = await fetch(`${baseUrl}/api/comment-stats`).then((response) => response.json());
    assert.equal(stats.total, 1);
    assert.equal(stats.teams.find((team) => team.code === 'AR').comments, 1);

    monitorService.emit({
      type: 'member',
      username: 'new-viewer',
      avatar: 'https://example.com/new-viewer.png',
    });
    const savedRecentUsers = await fetch(`${baseUrl}/api/recent-users`).then((response) => response.json());
    assert.equal(savedRecentUsers.users[0].username, 'new-viewer');
    assert.equal(savedRecentUsers.users[0].avatar, 'https://example.com/new-viewer.png');
    assert.deepEqual(
      JSON.parse(fs.readFileSync(path.join(directory, 'recent-users.json'), 'utf8')).users,
      savedRecentUsers.users,
    );

    const savedUsersResponse = await fetch(`${baseUrl}/api/recent-users`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        users: [{ username: 'fabricated-user', avatar: '', t: 1 }],
      }),
    });
    assert.equal(savedUsersResponse.status, 404);
    assert.deepEqual(
      (await fetch(`${baseUrl}/api/recent-users`).then((response) => response.json()))
        .users.map((user) => user.username),
      ['new-viewer'],
    );
  } finally {
    if (reader) await reader.cancel();
    await close(server);
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('server starts on the requested port and logs its address', async () => {
  const messages = [];
  const server = startServer({
    port: 0,
    host: '127.0.0.1',
    createWebserver: () => createWebserver({ monitorService: createMonitorService() }),
    logger: { log: (message) => messages.push(message), error() {} },
  });
  await once(server, 'listening');
  assert.match(messages[0], /http:\/\/localhost:\d+/);
  await close(server);
});
