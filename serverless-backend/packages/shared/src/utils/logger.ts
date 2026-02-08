export interface LogMeta {
  [key: string]: unknown;
}

const serviceName = process.env.SERVICE_NAME ?? 'unknown-service';

function emit(level: 'INFO' | 'WARN' | 'ERROR', message: string, meta?: LogMeta): void {
  const payload = {
    level,
    service: serviceName,
    message,
    timestamp: new Date().toISOString(),
    ...meta,
  };

  // eslint-disable-next-line no-console
  console.log(JSON.stringify(payload));
}

export const logger = {
  info: (message: string, meta?: LogMeta) => emit('INFO', message, meta),
  warn: (message: string, meta?: LogMeta) => emit('WARN', message, meta),
  error: (message: string, meta?: LogMeta) => emit('ERROR', message, meta),
};
