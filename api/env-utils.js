const fs = require('fs');
const path = require('path');

const LOCAL_ENV_FILES = Object.freeze([
  '.env.secrets.local',
  '.env.local',
  '.env'
]);

let localEnvCache = null;

function parseEnvValue(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return '';

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseEnvContent(content) {
  const out = {};
  const lines = String(content || '').split(/\r?\n/);

  for (const line of lines) {
    const raw = line.trim();
    if (!raw || raw.startsWith('#')) continue;

    const normalized = raw.startsWith('export ') ? raw.slice(7).trim() : raw;
    const eqIndex = normalized.indexOf('=');
    if (eqIndex <= 0) continue;

    const key = normalized.slice(0, eqIndex).trim();
    const value = parseEnvValue(normalized.slice(eqIndex + 1));
    if (!key) continue;
    out[key] = value;
  }

  return out;
}

function loadLocalEnvFallbacks() {
  if (localEnvCache) return localEnvCache;

  const values = {};
  for (const filename of LOCAL_ENV_FILES) {
    const fullPath = path.join(process.cwd(), filename);
    if (!fs.existsSync(fullPath)) continue;

    try {
      const content = fs.readFileSync(fullPath, 'utf8');
      Object.assign(values, parseEnvContent(content));
    } catch (_) {
      // Ignore local env read failures and fall back to process.env only.
    }
  }

  localEnvCache = values;
  return values;
}

function pickFirstDefined(source, names) {
  for (const name of names) {
    const value = source?.[name];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function resolveEnv(names) {
  if (!Array.isArray(names) || names.length === 0) return '';
  const fromProcess = pickFirstDefined(process.env, names);
  if (fromProcess) return fromProcess;
  const localFallbacks = loadLocalEnvFallbacks();
  return pickFirstDefined(localFallbacks, names);
}

module.exports = {
  resolveEnv
};
