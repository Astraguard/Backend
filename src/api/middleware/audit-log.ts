import type { FastifyInstance } from 'fastify';
import { db } from '../../shared/db.js';
import { childLogger } from '../../shared/logger.js';

const log = childLogger('api:audit-log');
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Logs every mutating request — a full audit log on every API mutation. */
export function registerAuditLog(app: FastifyInstance): void {
  app.addHook('onResponse', async (req, reply) => {
    if (!MUTATING_METHODS.has(req.method)) return;

    try {
      await db('audit_logs').insert({
        method: req.method,
        path: req.routeOptions?.url ?? req.url,
        status_code: reply.statusCode,
        api_key_id: req.apiKey?.id ?? null,
        ip: req.ip,
      });
    } catch (err) {
      log.error({ err }, 'failed to write audit log entry');
    }
  });
}
