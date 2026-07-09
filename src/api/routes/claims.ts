import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { decideClaim, fileClaim, getClaim, moveClaimToReview } from '../../safetynet/claims.js';
import { requireApiKey } from '../middleware/auth.js';

const fileClaimSchema = z.object({
  projectId: z.string().uuid(),
  victimAddress: z.string().min(1),
  amount: z.string().regex(/^\d+(\.\d+)?$/),
  assetCode: z.string().min(1),
  evidenceHash: z.string().min(1),
});

const decideSchema = z.object({ status: z.enum(['approved', 'rejected']) });
const idParamsSchema = z.object({ id: z.string().uuid() });

export function registerClaimRoutes(app: FastifyInstance): void {
  app.post('/v1/claims', { preHandler: requireApiKey() }, async (req, reply) => {
    const input = fileClaimSchema.parse(req.body);
    const claim = await fileClaim(input);
    reply.status(201);
    return { claim };
  });

  app.get('/v1/claims/:id', { preHandler: requireApiKey() }, async (req) => {
    const { id } = idParamsSchema.parse(req.params);
    const claim = await getClaim(id);
    return { claim };
  });

  app.post(
    '/v1/claims/:id/review',
    { preHandler: requireApiKey('claims:review') },
    async (req) => {
      const { id } = idParamsSchema.parse(req.params);
      const claim = await moveClaimToReview(id);
      return { claim };
    },
  );

  app.post(
    '/v1/claims/:id/decide',
    { preHandler: requireApiKey('claims:review') },
    async (req) => {
      const { id } = idParamsSchema.parse(req.params);
      const { status } = decideSchema.parse(req.body);
      const claim = await decideClaim(id, status);
      return { claim };
    },
  );
}
