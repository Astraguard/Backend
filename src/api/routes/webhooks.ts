import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../../shared/db.js';
import { NotFoundError } from '../../shared/errors.js';
import { requireApiKey } from '../middleware/auth.js';

const registerSchema = z.object({
  url: z.string().url(),
  events: z.array(z.enum(['score_change', 'registry_flag', 'claim_decision'])).min(1),
});

const idParamsSchema = z.object({ id: z.string().uuid() });

// Columns safe to return on list — secret is shown once, at registration, and never again.
const PUBLIC_COLUMNS = ['id', 'owner_id', 'url', 'events', 'active', 'created_at'];

/** Partner webhook registration — dispatch + HMAC signing lives in the alert-dispatch queue worker (src/workers.ts). */
export function registerWebhookRoutes(app: FastifyInstance): void {
  app.post('/v1/webhooks', { preHandler: requireApiKey() }, async (req, reply) => {
    const input = registerSchema.parse(req.body);
    const secret = randomBytes(32).toString('hex');

    const [row] = await db('partner_webhooks')
      .insert({ owner_id: req.apiKey!.ownerId, url: input.url, events: input.events, secret })
      .returning('*');

    reply.status(201);
    return { webhook: row, secret };
  });

  app.get('/v1/webhooks', { preHandler: requireApiKey() }, async (req) => {
    const webhooks = await db('partner_webhooks')
      .where({ owner_id: req.apiKey!.ownerId })
      .select(PUBLIC_COLUMNS);
    return { webhooks };
  });

  app.delete('/v1/webhooks/:id', { preHandler: requireApiKey() }, async (req) => {
    const { id } = idParamsSchema.parse(req.params);
    const deleted = await db('partner_webhooks')
      .where({ id, owner_id: req.apiKey!.ownerId })
      .del();
    if (!deleted) throw new NotFoundError('Webhook');
    return { deleted: true };
  });
}
