'use strict';

const fs = require('node:fs');
const path = require('node:path');
const util = require('node:util');

function createLogger(userDataPath) {
  const logDirectory = path.join(userDataPath, 'logs');
  fs.mkdirSync(logDirectory, { recursive: true });
  const logPath = path.join(logDirectory, 'cloudberth.log');

  function write(level, message, details) {
    const suffix = details === undefined
      ? ''
      : ` ${typeof details === 'string' ? details : util.inspect(details, {
        depth: 3,
        breakLength: Infinity
      })}`;
    const line = `${new Date().toISOString()} [${level}] ${message}${suffix}`;
    console[level === 'ERROR' ? 'error' : 'log'](line);
    try {
      fs.appendFileSync(logPath, `${line}\n`, 'utf8');
    } catch (error) {
      console.error(`Could not write log file: ${error.message}`);
    }
  }

  return {
    info: (message, details) => write('INFO', message, details),
    warn: (message, details) => write('WARN', message, details),
    error: (message, details) => write('ERROR', message, details),
    path: logPath
  };
}

module.exports = { createLogger };
