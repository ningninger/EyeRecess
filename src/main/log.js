'use strict';
// Local startup and error logging, available before Electron initializes.

const fs = require('fs');
const path = require('path');

const MAX_BYTES = 1024 * 1024;

let logFile = null;
let ready = false;

function fallbackDir() {
  if (process.env.EYERECESS_LOG_DIR) return process.env.EYERECESS_LOG_DIR;
  const base =
    process.env.APPDATA || // Windows
    process.env.HOME || // macOS / Linux
    process.env.TEMP ||
    '.';
  return path.join(base, 'EyeRecess', 'logs');
}

function stamp() {
  const d = new Date();
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`
  );
}

function fmt(v) {
  if (typeof v === 'string') return v;
  if (v instanceof Error) return `${v.name}: ${v.message}\n${v.stack || ''}`;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function init(app) {
  const wasReady = ready;
  ready = true;
  try {
    let dir = null;

    if (process.env.EYERECESS_LOG_DIR) dir = process.env.EYERECESS_LOG_DIR;
    if (!dir && app && typeof app.getPath === 'function') {
      try {
        dir = path.join(app.getPath('userData'), 'logs');
      } catch {
      }
    }

    if (!dir && wasReady) return logFile;
    if (!dir) dir = fallbackDir();
    fs.mkdirSync(dir, { recursive: true });
    const next = path.join(dir, 'eyerecess.log');
    if (next === logFile) return logFile;
    logFile = next;

    try {
      const st = fs.statSync(logFile);
      if (st.size > MAX_BYTES) fs.renameSync(logFile, logFile + '.1');
    } catch {
    }
  } catch {
    if (!wasReady) logFile = null;
  }
  return logFile;
}

function write(level, args) {
  const line = `[${stamp()}] ${level} ${args.map(fmt).join(' ')}`;

  if (logFile) {
    try {
      fs.appendFileSync(logFile, line + '\n');
    } catch {
    }
  }

  try {
    if (level === 'ERROR') console.error(line);
    else console.log(line);
  } catch {
  }
}

const log = {
  init,
  path: () => logFile,

  dir: () => (logFile ? path.dirname(logFile) : null),
  boot: (...a) => write('BOOT', a),
  info: (...a) => write('INFO', a),
  warn: (...a) => write('WARN', a),
  error: (...a) => write('ERROR', a),

  install(extraTags = []) {
    process.on('uncaughtException', (err) => {
      write('FATAL', ['Uncaught exception', ...extraTags, err]);
    });
    process.on('unhandledRejection', (reason) => {
      write('FATAL', ['Unhandled promise rejection', ...extraTags, reason]);
    });
    process.on('warning', (w) => {
      write('WARN', [w.name, w.message]);
    });
  },
};

module.exports = log;
