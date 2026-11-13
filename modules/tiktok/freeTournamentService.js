const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const MAX_TEAM_NAME_LENGTH = 40;

function normalizeText(value) {
  if (typeof value !== 'string') return '';
  return value.normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function normalizeTeamName(value) {
  if (typeof value !== 'string') return null;
  const name = value.trim().replace(/\s+/g, ' ');
  const key = normalizeText(name);
  if (name.length < 2 || name.length > MAX_TEAM_NAME_LENGTH || key.length < 2) return null;
  return {
    id: `free-${crypto.createHash('sha256').update(key).digest('hex').slice(0, 12)}`,
    key,
    name,
  };
}

function mentionMatches(comment, teamName) {
  const normalizedComment = normalizeText(comment);
  return Boolean(normalizedComment && (` ${normalizedComment} `).includes(` ${teamName} `));
}

function createFreeTournamentService({ filePath }) {
  if (typeof filePath !== 'string' || !filePath) {
    throw new Error('La ruta de los votos del torneo libre es obligatoria.');
  }

  const teams = new Map();
  let updatedAt = null;
  let enabled = true;

  function save() {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify({
      updatedAt,
      enabled,
      teams: [...teams.values()].map((team) => ({
        id: team.id,
        name: team.name,
        votes: team.votes,
        userHashes: team.userHashes,
      })),
    }, null, 2));
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    if (raw.includes('\0')) throw new SyntaxError('El archivo del torneo libre está corrupto.');
    const saved = JSON.parse(raw);
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)
      || !Array.isArray(saved.teams)
      || (saved.updatedAt !== null && typeof saved.updatedAt !== 'string')
      || (saved.enabled !== undefined && typeof saved.enabled !== 'boolean')) {
      throw new Error('El archivo del torneo libre no es válido.');
    }
    if (typeof saved.enabled === 'boolean') enabled = saved.enabled;
    for (const savedTeam of saved.teams) {
      const team = normalizeTeamName(savedTeam?.name);
      if (!team || !Number.isSafeInteger(savedTeam.votes) || savedTeam.votes < 0
        || !Array.isArray(savedTeam.userHashes)
        || savedTeam.userHashes.some((hash) => typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash))) {
        throw new Error('Un equipo guardado del torneo libre no es válido.');
      }
      teams.set(team.key, {
        ...team,
        votes: savedTeam.votes,
        userHashes: [...new Set(savedTeam.userHashes)],
      });
    }
    updatedAt = saved.updatedAt || null;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  function getStats() {
    return {
      updatedAt,
      enabled,
      teams: [...teams.values()]
        .map((team) => ({
          id: team.id,
          name: team.name,
          votes: team.votes,
          users: team.userHashes.length,
        }))
        .sort((first, second) => second.votes - first.votes
          || first.name.localeCompare(second.name)),
    };
  }

  function setEnabled(value) {
    if (typeof value !== 'boolean') return null;
    enabled = value;
    save();
    return getStats();
  }

  function recordComment(entry, enabledAtReceipt = enabled) {
    if (!enabledAtReceipt || !entry || entry.type !== 'chat'
      || typeof entry.username !== 'string' || !entry.username.trim()
      || typeof entry.content !== 'string') return null;
    const text = entry.content.trim().replace(/\s+/g, ' ');
    if (!text) return null;

    const matched = [...teams.values()]
      .filter((team) => mentionMatches(text, team.key))
      .sort((first, second) => second.key.length - first.key.length)[0];
    const normalized = matched || normalizeTeamName(text);
    if (!normalized) return null;

    const team = teams.get(normalized.key) || {
      ...normalized,
      votes: 0,
      userHashes: [],
    };
    team.votes++;
    const userHash = crypto.createHash('sha256')
      .update(entry.username.trim().toLocaleLowerCase())
      .digest('hex');
    if (!team.userHashes.includes(userHash)) team.userHashes.push(userHash);
    teams.set(team.key, team);
    updatedAt = new Date().toISOString();
    save();
    return getStats();
  }

  return { getStats, setEnabled, recordComment };
}

module.exports = { createFreeTournamentService, normalizeTeamName };
