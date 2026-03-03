/**
 * Structured logger — replaces raw console.log across all services.
 *
 * Usage:
 *   import { createLogger } from '../logger.js';
 *   const log = createLogger('ServiceName');
 *   log.info('Task completed', { taskId, duration });
 *   log.warn('Retry needed', { attempt: 2 });
 *   log.error('Failed', { error: err.message });
 *   log.debug('Pool state', { slots });  // only shown when LOG_LEVEL=debug
 *
 * Env:
 *   LOG_LEVEL=info  (default) — debug | info | warn | error
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const currentLevel = (): LogLevel => {
  const env = (process.env.LOG_LEVEL || 'info').toLowerCase() as LogLevel;
  return LEVELS[env] !== undefined ? env : 'info';
};

export interface Logger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

export function createLogger(service: string): Logger {
  const emit = (level: LogLevel, msg: string, meta?: Record<string, unknown>) => {
    if (LEVELS[level] < LEVELS[currentLevel()]) return;

    const entry = {
      ts: new Date().toISOString(),
      level,
      service,
      msg,
      ...(meta && Object.keys(meta).length > 0 ? meta : {}),
    };

    const fn =
      level === 'error' ? console.error :
      level === 'warn' ? console.warn :
      console.log;

    try {
      fn(JSON.stringify(entry));
    } catch {
      fn(JSON.stringify({ ...entry, meta: '[unserializable]' }));
    }
  };

  return {
    debug: (msg, meta?) => emit('debug', msg, meta),
    info: (msg, meta?) => emit('info', msg, meta),
    warn: (msg, meta?) => emit('warn', msg, meta),
    error: (msg, meta?) => emit('error', msg, meta),
  };
}
