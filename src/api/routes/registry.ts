import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { fileReport, listReportsForAddress } from '../../registry/reports.js';
import { confirmReport, endorseReport, rejectReport } from '../../registry/review.js';
import { requireApiKey } from '../middleware/auth.js';

const fileReportSchema = z.object({
  targetAddress: z.string().min(1),
  category: z.enum(['phishing', 'rug_pull', 'honeypot', 'impersonation', 'other']),
  evidence: z.record(z.string(), z.unknown()).default({}),
});

const listQuerySchema = z.object({ address: z.string().min(1) });
const idParamsSchema = z.object({ id: z.string().uuid() });

export function registerRegistryRoutes(app: FastifyInstance): void {
  app.get('/v1/registry', async (req) => {
    const { address } = listQuerySchema.parse(req.query);
    // Evidence is intentionally omitted from the public list response — see reports.ts.
    const reports = await listReportsForAddress(address);
    return { reports };
  });

  app.post('/v1/registry', { preHandler: requireApiKey() }, async (req, reply) => {
    const input = fileReportSchema.parse(req.body);
    const report = await fileReport({
      ...input,
      ...(req.apiKey?.ownerId ? { reporterId: req.apiKey.ownerId } : {}),
    });
    reply.status(201);
    return { report };
  });

  app.post(
    '/v1/registry/:id/endorse',
    { preHandler: requireApiKey('registry:review') },
    async (req) => {
      const { id } = idParamsSchema.parse(req.params);
      const report = await endorseReport(id, req.apiKey!.ownerId);
      return { report };
    },
  );

  app.post(
    '/v1/registry/:id/confirm',
    { preHandler: requireApiKey('registry:review') },
    async (req) => {
      const { id } = idParamsSchema.parse(req.params);
      const report = await confirmReport(id, req.apiKey!.ownerId);
      return { report };
    },
  );

  app.post(
    '/v1/registry/:id/reject',
    { preHandler: requireApiKey('registry:review') },
    async (req) => {
      const { id } = idParamsSchema.parse(req.params);
      const report = await rejectReport(id, req.apiKey!.ownerId);
      return { report };
    },
  );
}
