import pino from 'pino';
import { config } from './config.js';

const prettyTransport = {
  target: 'pino-pretty',
  options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
};

export const logger = config.isProduction
  ? pino({ level: config.logLevel })
  : pino({ level: config.logLevel, transport: prettyTransport });

export function childLogger(scope: string) {
  return logger.child({ scope });
}
