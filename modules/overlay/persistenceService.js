const fs = require('node:fs');
const path = require('node:path');

const USER_EVENT_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const MAX_LOG_BATCH_SIZE = 200;
const CHAT_TEXT_LIMIT = 500;
const USER_EVENT_TYPES = new Set(['chat', 'like', 'gift', 'follow', 'share', 'member']);
const BOOTSTRAP_KEYS = new Set([
  'cluss.v1',
  'cluss.torneoLock',
  'cluss.ctaCalm',
  'cluss.lang',
  'cluss.stats',
  'cluss.libreVotes',
]);

function isValidStateKey(key) {
  return typeof key === 'string'
    && key.length <= 256
    && /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(key);
}

function isValidTimestamp(timestamp) {
  return Number.isSafeInteger(timestamp) && Math.abs(timestamp) <= 8.64e15;
}

function stateFileName(key) {
  return `${Buffer.from(key, 'utf8').toString('base64url')}.json`;
}

function isBootstrapKey(key) {
  return BOOTSTRAP_KEYS.has(key)
    || (key.startsWith('cluss.crest.') && key.length > 'cluss.crest.'.length);
}

function validateChatRecord(record) {
  return Array.isArray(record)
    && record.length === 2
    && isValidTimestamp(record[0])
    && typeof record[1] === 'string'
    && record[1].length > 0
    && record[1].length <= CHAT_TEXT_LIMIT;
}

function validateUserEvent(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return false;
  const allowedFields = new Set(['u', 'name', 't', 'type', 'n', 'text', 'gift']);
  if (Object.keys(record).some((key) => !allowedFields.has(key))) return false;
  return typeof record.u === 'string'
    && record.u.length > 0
    && record.u.length <= 120
    && record.u === record.u.toLowerCase()
    && typeof record.name === 'string'
    && record.name.length > 0
    && record.name.length <= 120
    && isValidTimestamp(record.t)
    && USER_EVENT_TYPES.has(record.type)
    && Number.isFinite(record.n)
    && record.n > 0
    && (!Object.hasOwn(record, 'text')
      || (record.type === 'chat' && typeof record.text === 'string' && record.text.length <= 200))
    && (!Object.hasOwn(record, 'gift')
      || (record.type === 'gift' && typeof record.gift === 'string' && record.gift.length <= 80));
}

function createOverlayPersistenceService({ directoryPath, legacyChatArchivePath } = {}) {
  if (typeof directoryPath !== 'string' || !directoryPath) {
    throw new Error('La ruta de persistencia del overlay es obligatoria.');
  }

  const stateDirectory = path.join(directoryPath, 'state');
  const logsDirectory = path.join(directoryPath, 'logs');
  const chatLogPath = path.join(logsDirectory, 'chat-texts.jsonl');
  const userEventsDirectory = path.join(logsDirectory, 'user-events');
  const chatMetaPath = path.join(directoryPath, 'chat-archive-meta.json');

  fs.mkdirSync(stateDirectory, { recursive: true, mode: 0o700 });
  fs.mkdirSync(userEventsDirectory, { recursive: true, mode: 0o700 });
  fs.mkdirSync(logsDirectory, { recursive: true, mode: 0o700 });

  function writeJson(filePath, value) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(filePath, JSON.stringify(value), { mode: 0o600 });
  }

  function readChatRecords() {
    const raw = fs.readFileSync(chatLogPath, 'utf8');
    return raw.split(/\r?\n/).filter(Boolean).map((line) => {
      const record = JSON.parse(line);
      if (!validateChatRecord(record)) {
        throw new Error('El archivo de textos del chat contiene un registro no válido.');
      }
      return record;
    });
  }

  function freshChatMeta(now = Date.now()) {
    return { v: 1, created: now, updated: now, trimmed: 0, count: 0, size: 0 };
  }

  function rebuildChatMeta() {
    const records = readChatRecords();
    const stat = fs.statSync(chatLogPath);
    const now = Date.now();
    return {
      v: 1,
      created: records.length ? records[0][0] : now,
      updated: records.length ? records[records.length - 1][0] : now,
      trimmed: 0,
      count: records.length,
      size: stat.size,
    };
  }

  function migrateLegacyChatArchive() {
    if (fs.existsSync(chatLogPath) || fs.existsSync(chatMetaPath)
      || !legacyChatArchivePath || !fs.existsSync(legacyChatArchivePath)) return;

    const saved = JSON.parse(fs.readFileSync(legacyChatArchivePath, 'utf8'));
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)
      || !Array.isArray(saved.comments)
      || saved.comments.some((comment) => !comment || typeof comment.text !== 'string'
        || typeof comment.time !== 'string')) {
      throw new Error('El archivo anterior de comentarios no es válido y no se pudo migrar.');
    }

    const records = saved.comments.map((comment) => {
      const timestamp = Date.parse(comment.time);
      if (!Number.isSafeInteger(timestamp)) {
        throw new Error('El archivo anterior de comentarios tiene una fecha no válida.');
      }
      return [timestamp, comment.text];
    });
    const content = records.map((record) => JSON.stringify(record)).join('\n');
    fs.writeFileSync(chatLogPath, content ? `${content}\n` : '', { mode: 0o600 });
    const now = Date.now();
    const stat = fs.statSync(chatLogPath);
    writeJson(chatMetaPath, {
      v: 1,
      created: records.length ? records[0][0] : now,
      updated: records.length ? records[records.length - 1][0] : now,
      trimmed: 0,
      count: records.length,
      size: stat.size,
    });
  }

  migrateLegacyChatArchive();
  if (!fs.existsSync(chatLogPath)) fs.writeFileSync(chatLogPath, '', { mode: 0o600 });

  let chatMeta;
  if (fs.existsSync(chatMetaPath)) {
    chatMeta = JSON.parse(fs.readFileSync(chatMetaPath, 'utf8'));
  }
  const actualSize = fs.statSync(chatLogPath).size;
  if (!chatMeta || chatMeta.v !== 1 || chatMeta.size !== actualSize
    || !Number.isSafeInteger(chatMeta.count) || chatMeta.count < 0) {
    chatMeta = rebuildChatMeta();
    writeJson(chatMetaPath, chatMeta);
  }

  function readState(key) {
    if (!isValidStateKey(key)) return { found: false };
    if (key === 'cluss.chatArchive') {
      return {
        found: true,
        value: {
          v: chatMeta.v,
          created: chatMeta.created,
          updated: chatMeta.updated,
          trimmed: chatMeta.trimmed,
          count: chatMeta.count,
        },
      };
    }
    const filePath = path.join(stateDirectory, stateFileName(key));
    if (!fs.existsSync(filePath)) return { found: false };
    return { found: true, value: JSON.parse(fs.readFileSync(filePath, 'utf8')) };
  }

  function writeState(key, value) {
    if (!isValidStateKey(key) || key === 'cluss.chatArchive') return false;
    writeJson(path.join(stateDirectory, stateFileName(key)), value);
    return true;
  }

  function deleteState(key) {
    if (!isValidStateKey(key) || key === 'cluss.chatArchive') return false;
    const filePath = path.join(stateDirectory, stateFileName(key));
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    return true;
  }

  function getBootstrapState() {
    const result = {};
    for (const fileName of fs.readdirSync(stateDirectory)) {
      if (!fileName.endsWith('.json')) continue;
      const encodedKey = fileName.slice(0, -'.json'.length);
      const key = Buffer.from(encodedKey, 'base64url').toString('utf8');
      if (isBootstrapKey(key)) result[key] = readState(key).value;
    }
    result['cluss.chatArchive'] = {
      v: chatMeta.v,
      created: chatMeta.created,
      updated: chatMeta.updated,
      trimmed: chatMeta.trimmed,
      count: chatMeta.count,
    };
    return result;
  }

  function pruneUserEvents(now) {
    const cutoff = now - USER_EVENT_RETENTION_MS;
    const cutoffDay = new Date(cutoff).toISOString().slice(0, 10);
    for (const fileName of fs.readdirSync(userEventsDirectory)) {
      const match = /^(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(fileName);
      if (match && match[1] < cutoffDay) {
        fs.unlinkSync(path.join(userEventsDirectory, fileName));
      }
    }
  }

  pruneUserEvents(Date.now());

  function appendLog(flow, records) {
    if (flow !== 'chat-texts' && flow !== 'user-events') {
      return { ok: false, status: 404, message: 'Flujo de registro no encontrado.' };
    }
    if (!Array.isArray(records) || records.length < 1 || records.length > MAX_LOG_BATCH_SIZE) {
      return { ok: false, status: 400, message: `El lote debe contener de 1 a ${MAX_LOG_BATCH_SIZE} registros.` };
    }
    const valid = flow === 'chat-texts'
      ? records.every(validateChatRecord)
      : records.every(validateUserEvent);
    if (!valid) {
      return { ok: false, status: 400, message: 'El lote contiene registros no válidos.' };
    }

    if (flow === 'chat-texts') {
      const content = `${records.map((record) => JSON.stringify(record)).join('\n')}\n`;
      fs.appendFileSync(chatLogPath, content, { encoding: 'utf8', mode: 0o600 });
      const now = Date.now();
      chatMeta = {
        ...chatMeta,
        created: chatMeta.count ? chatMeta.created : records[0][0],
        updated: now,
        count: chatMeta.count + records.length,
        size: chatMeta.size + Buffer.byteLength(content),
      };
      writeJson(chatMetaPath, chatMeta);
      return { ok: true, stored: records.length };
    }

    const now = Date.now();
    pruneUserEvents(now);
    const retained = records.filter((record) => record.t >= now - USER_EVENT_RETENTION_MS);
    const byDay = new Map();
    for (const record of retained) {
      const day = new Date(record.t).toISOString().slice(0, 10);
      if (!byDay.has(day)) byDay.set(day, []);
      byDay.get(day).push(record);
    }
    for (const [day, batch] of byDay) {
      const content = `${batch.map((record) => JSON.stringify(record)).join('\n')}\n`;
      fs.appendFileSync(path.join(userEventsDirectory, `${day}.jsonl`), content, {
        encoding: 'utf8',
        mode: 0o600,
      });
    }
    return { ok: true, stored: retained.length, expired: records.length - retained.length };
  }

  function clearChatLog() {
    fs.writeFileSync(chatLogPath, '', { mode: 0o600 });
    const now = Date.now();
    chatMeta = { ...freshChatMeta(now), size: 0 };
    writeJson(chatMetaPath, chatMeta);
  }

  function getChatTextExport() {
    return readChatRecords().map((record) => record[1].replace(/\r\n?|\n/g, ' ')).join('\n');
  }

  return {
    appendLog,
    clearChatLog,
    deleteState,
    getBootstrapState,
    getChatRecords: readChatRecords,
    getChatTextExport,
    isValidStateKey,
    readState,
    writeState,
  };
}

module.exports = { createOverlayPersistenceService, isValidStateKey };
