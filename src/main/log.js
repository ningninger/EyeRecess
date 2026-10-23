'use strict';
/**
 * 极简日志：同步写文件，保证「进程突然死掉」时最后一行也已经在磁盘上。
 *
 * 位置：
 *   macOS  ~/Library/Application Support/EyeRest/logs/eyerest.log
 *   Windows %APPDATA%\EyeRest\logs\eyerest.log
 * 超过 1 MB 时把旧文件改名成 eyerest.log.1，只留两代。
 *
 * 这个模块不依赖 electron，因为它可能要在 electron 还没就绪（甚至压根拿不到
 * app 对象）的时候就用。
 */

const fs = require('fs');
const path = require('path');

const MAX_BYTES = 1024 * 1024;

let logFile = null;
let ready = false;

function fallbackDir() {
  // EYEREST_LOG_DIR 给的是「精确目录」，启动器用它把日志直接落到项目里。
  if (process.env.EYEREST_LOG_DIR) return process.env.EYEREST_LOG_DIR;
  const base =
    process.env.APPDATA || // Windows
    process.env.HOME || // macOS / Linux
    process.env.TEMP ||
    '.';
  return path.join(base, 'EyeRest', 'logs');
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

/**
 * 初始化。app 可以传 null —— 那就退回到按环境变量拼出来的目录。
 * 返回日志文件路径（失败返回 null）。
 */
function init(app) {
  const wasReady = ready;
  ready = true;
  try {
    let dir = null;
    // 启动器显式指定了日志目录：一直用它，别在 app ready 之后又挪走。
    if (process.env.EYEREST_LOG_DIR) dir = process.env.EYEREST_LOG_DIR;
    if (!dir && app && typeof app.getPath === 'function') {
      try {
        dir = path.join(app.getPath('userData'), 'logs');
      } catch {
        /* userData 拿不到就用兜底目录 */
      }
    }
    // 已经用兜底目录开过日志、这次也拿不到更好的位置：保持不动
    if (!dir && wasReady) return logFile;
    if (!dir) dir = fallbackDir();
    fs.mkdirSync(dir, { recursive: true });
    const next = path.join(dir, 'eyerest.log');
    if (next === logFile) return logFile;
    logFile = next;
    // 太大就滚动，避免无限增长
    try {
      const st = fs.statSync(logFile);
      if (st.size > MAX_BYTES) fs.renameSync(logFile, logFile + '.1');
    } catch {
      /* 文件还不存在，正常 */
    }
  } catch {
    if (!wasReady) logFile = null;
  }
  return logFile;
}

function write(level, args) {
  const line = `[${stamp()}] ${level} ${args.map(fmt).join(' ')}`;
  // 先写文件（同步，进程下一秒崩溃也不丢）
  if (logFile) {
    try {
      fs.appendFileSync(logFile, line + '\n');
    } catch {
      /* 写不进去就算了，别把程序带崩 */
    }
  }
  // 再照常打到终端
  try {
    if (level === 'ERROR') console.error(line);
    else console.log(line);
  } catch {
    /* 终端已经没了也无所谓 */
  }
}

const log = {
  init,
  path: () => logFile,
  /** 日志所在目录（给托盘菜单的「打开日志文件夹」用） */
  dir: () => (logFile ? path.dirname(logFile) : null),
  boot: (...a) => write('BOOT', a),
  info: (...a) => write('INFO', a),
  warn: (...a) => write('WARN', a),
  error: (...a) => write('ERROR', a),

  /** 挂上全局兜底，把没接住的异常也写进日志 */
  install(extraTags = []) {
    process.on('uncaughtException', (err) => {
      write('FATAL', ['未捕获异常（可能是崩溃原因）', ...extraTags, err]);
    });
    process.on('unhandledRejection', (reason) => {
      write('FATAL', ['未处理的 Promise 拒绝', ...extraTags, reason]);
    });
    process.on('warning', (w) => {
      write('WARN', [w.name, w.message]);
    });
  },
};

module.exports = log;
