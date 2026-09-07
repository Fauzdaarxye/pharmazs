import pino from 'pino';
import { config } from './config';

function prettyTransport(): pino.TransportSingleOptions | undefined {
  if (config.env !== 'development') return undefined;
  try {
    require.resolve('pino-pretty');
    return { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } };
  } catch {
    return undefined; // pretty printer not installed — fall back to JSON logs
  }
}

// Redact anything that could carry a secret so tokens/passwords never hit logs.
export const logger = pino({
  level: config.logLevel,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'password',
      '*.password',
      'accessToken',
      '*.accessToken',
      'refreshToken',
      '*.refreshToken',
      'token',
      '*.token',
      'passwordHash',
      '*.passwordHash',
    ],
    censor: '[REDACTED]',
  },
  transport: prettyTransport(),
});
