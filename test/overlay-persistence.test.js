const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { once } = require('node:events');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createWebserver } = require('../server');

function createMonitorService() {
  return {
    state: { isConnected: false, status: 'idle', error: '' },
    getStatusPayload: () => ({ username: '', status: 'idle', isConnected: false, error: '' }),
    subscribeToEvents: () => () => {},
    subscribeToStatus: () => () => {},
    connectUser() {},
    disconnectUser() {},
    refreshRetryWindow() {},
  };
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

function makeServer(directory) {
  return createWebserver({
    configurationPath: path.join(directory, 'config.json'),
    commentArchivePath: path.join(directory, 'comments-archive.json'),
    overlayDataPath: path.join(directory, 'overlay'),
    monitorService: createMonitorService(),
  }).server;
}

test('persists overlay state and bootstraps only small documents', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tortu-state-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const server = makeServer(directory);
  const baseUrl = await listen(server);

  try {
    assert.equal((await fetch(`${baseUrl}/api/state/cluss.missing`)).status, 404);
    const saved = await fetch(`${baseUrl}/api/state/cluss.v1`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wins: ['ol'], tournamentMode: 'libre' }),
    });
    assert.deepEqual(await saved.json(), { ok: true });

    await fetch(`${baseUrl}/api/state/cluss.log.round-1`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat: ['large history'] }),
    });
    await fetch(`${baseUrl}/api/state/cluss.crest.ol`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify('https://example.test/crest.png'),
    });

    const bootstrapResponse = await fetch(`${baseUrl}/api/state.js`);
    assert.equal(bootstrapResponse.status, 200);
    assert.match(bootstrapResponse.headers.get('content-type'), /application\/javascript/);
    assert.match(bootstrapResponse.headers.get('cache-control'), /no-store/);
    const context = { window: {} };
    vm.runInNewContext(await bootstrapResponse.text(), context);
    assert.deepEqual(JSON.parse(JSON.stringify(context.window.CLUSS_STATE['cluss.v1'])), {
      wins: ['ol'],
      tournamentMode: 'libre',
    });
    assert.equal(context.window.CLUSS_STATE['cluss.crest.ol'], 'https://example.test/crest.png');
    assert.equal(context.window.CLUSS_STATE['cluss.log.round-1'], undefined);
    assert.equal(context.window.CLUSS_STATE['cluss.chatArchive'].count, 0);

    const loadedLog = await fetch(`${baseUrl}/api/state/cluss.log.round-1`).then((response) => response.json());
    assert.deepEqual(loadedLog, { chat: ['large history'] });
    await fetch(`${baseUrl}/api/state/cluss.v1`, { method: 'DELETE' });
    assert.equal((await fetch(`${baseUrl}/api/state/cluss.v1`)).status, 404);

    const invalidKey = await fetch(`${baseUrl}/api/state/bad%20key`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify('x'),
    });
    assert.equal(invalidKey.status, 400);
  } finally {
    await close(server);
  }
});

test('appends, downloads, and clears anonymous chat-text records', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tortu-chat-log-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const server = makeServer(directory);
  const baseUrl = await listen(server);

  try {
    const timestamp = Date.now();
    const appended = await fetch(`${baseUrl}/api/log/chat-texts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ records: [[timestamp, 'Hola mundo'], [timestamp + 1, 'Otro texto']] }),
    });
    assert.deepEqual(await appended.json(), { ok: true, stored: 2 });

    const jsonResponse = await fetch(`${baseUrl}/api/log/chat-texts.json`);
    assert.match(jsonResponse.headers.get('content-disposition'), /attachment/);
    assert.deepEqual(await jsonResponse.json(), [[timestamp, 'Hola mundo'], [timestamp + 1, 'Otro texto']]);
    const textResponse = await fetch(`${baseUrl}/api/log/chat-texts.txt`);
    assert.match(textResponse.headers.get('content-disposition'), /attachment/);
    assert.equal(await textResponse.text(), 'Hola mundo\nOtro texto');

    const bootstrap = await fetch(`${baseUrl}/api/state.js`).then((response) => response.text());
    const context = { window: {} };
    vm.runInNewContext(bootstrap, context);
    assert.equal(context.window.CLUSS_STATE['cluss.chatArchive'].count, 2);

    const invalidBatch = await fetch(`${baseUrl}/api/log/chat-texts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ records: [[timestamp, 'texto', 'autor']] }),
    });
    assert.equal(invalidBatch.status, 400);

    const cleared = await fetch(`${baseUrl}/api/log/chat-texts`, { method: 'DELETE' });
    assert.deepEqual(await cleared.json(), { ok: true });
    assert.deepEqual(await fetch(`${baseUrl}/api/log/chat-texts.json`).then((response) => response.json()), []);
    const clearedState = await fetch(`${baseUrl}/api/state.js`).then((response) => response.text());
    const clearedContext = { window: {} };
    vm.runInNewContext(clearedState, clearedContext);
    assert.equal(clearedContext.window.CLUSS_STATE['cluss.chatArchive'].count, 0);
  } finally {
    await close(server);
  }
});

test('retains user-event logs for a limited period without exposing a read endpoint', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tortu-user-events-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const server = makeServer(directory);
  const baseUrl = await listen(server);

  try {
    const now = Date.now();
    const response = await fetch(`${baseUrl}/api/log/user-events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        records: [
          { u: 'ana', name: 'Ana', t: now, type: 'chat', n: 1, text: 'Hola' },
          { u: 'old', name: 'Old', t: now - 91 * 24 * 60 * 60 * 1000, type: 'follow', n: 1 },
        ],
      }),
    });
    assert.deepEqual(await response.json(), { ok: true, stored: 1, expired: 1 });
    assert.equal((await fetch(`${baseUrl}/api/log/user-events.json`)).status, 404);
    assert.equal((await fetch(`${baseUrl}/api/log/user-events`, { method: 'DELETE' })).status, 404);
    assert.equal((await fetch(`${baseUrl}/api/log/user-events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ records: [{ username: 'invented', type: 'chat' }] }),
    })).status, 400);
  } finally {
    await close(server);
  }
});

test('migrates the existing anonymous comment archive once', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tortu-chat-migration-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const legacyComments = [
    { time: '2025-01-02T03:04:05.000Z', text: 'Comentario anterior' },
    { time: '2025-01-03T03:04:05.000Z', text: 'Otro comentario' },
  ];
  fs.writeFileSync(path.join(directory, 'comments-archive.json'), JSON.stringify({
    updatedAt: null,
    comments: legacyComments,
  }));
  const server = makeServer(directory);
  const baseUrl = await listen(server);

  try {
    const records = await fetch(`${baseUrl}/api/log/chat-texts.json`).then((response) => response.json());
    assert.deepEqual(records, legacyComments.map((comment) => [Date.parse(comment.time), comment.text]));
  } finally {
    await close(server);
  }
});
