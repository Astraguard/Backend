import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../../shared/db.js';
import { NotFoundError, ValidationError } from '../../shared/errors.js';
import { runCertificationChecklist } from '../../verification/index.js';
import { recordKycDecision, submitKyc } from '../../verification/kyc/index.js';
import { requireApiKey } from '../middleware/auth.js';

const submitSchema = z.object({
  projectId: z.string().uuid(),
  contractId: z.string().min(1),
  wasmHash: z.string().min(1),
});

const decideSchema = z.object({ status: z.enum(['approved', 'rejected']) });
const idParamsSchema = z.object({ id: z.string().uuid() });

const kycSubmitSchema = z.object({
  teamMemberName: z.string().min(1),
  documentRef: z.string().min(1),
});
const kycDecideSchema = z.object({
  submissionId: z.string().uuid(),
  status: z.enum(['verified', 'rejected']),
});

export function registerCertificationRoutes(app: FastifyInstance): void {
  app.post('/v1/certifications', { preHandler: requireApiKey() }, async (req, reply) => {
    const input = submitSchema.parse(req.body);

    const checklist = await runCertificationChecklist(input);
    const [row] = await db('certifications')
      .insert({
        project_id: input.projectId,
        status: 'pending',
        checklist: JSON.stringify(checklist),
      })
      .returning('*');

    reply.status(201);
    return { certification: row };
  });

  app.get('/v1/certifications/:id', async (req) => {
    const { id } = idParamsSchema.parse(req.params);
    const row = await db('certifications').where({ id }).first();
    if (!row) throw new NotFoundError('Certification');
    return { certification: row };
  });

  app.post(
    '/v1/certifications/:id/decide',
    { preHandler: requireApiKey('certification:decide') },
    async (req) => {
      const { id } = idParamsSchema.parse(req.params);
      const { status } = decideSchema.parse(req.body);

      const [row] = await db('certifications')
        .where({ id })
        .update({ status, decided_by: req.apiKey!.ownerId, decided_at: new Date() })
        .returning('*');

      if (!row) throw new NotFoundError('Certification');
      return { certification: row };
    },
  );

  app.post(
    '/v1/certifications/:id/kyc',
    { preHandler: requireApiKey() },
    async (req, reply) => {
      const { id } = idParamsSchema.parse(req.params);
      const input = kycSubmitSchema.parse(req.body);

      const certification = await db('certifications').where({ id }).first();
      if (!certification) throw new NotFoundError('Certification');

      const record = await submitKyc({ projectId: certification.project_id, ...input });
      reply.status(201);
      return { kyc: record };
    },
  );

  app.post(
    '/v1/certifications/:id/kyc/decide',
    { preHandler: requireApiKey('certification:decide') },
    async (req) => {
      const { id } = idParamsSchema.parse(req.params);
      const { submissionId, status } = kycDecideSchema.parse(req.body);

      const certification = await db('certifications').where({ id }).first();
      if (!certification) throw new NotFoundError('Certification');

      const submission = await db('kyc_submissions').where({ id: submissionId }).first();
      if (!submission || submission.project_id !== certification.project_id) {
        throw new ValidationError('submissionId does not belong to this certification');
      }

      const record = await recordKycDecision(submissionId, status, req.apiKey!.ownerId);
      return { kyc: record };
    },
  );
}
