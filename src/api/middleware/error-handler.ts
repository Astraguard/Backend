import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { AppError } from '../../shared/errors.js';
import { childLogger } from '../../shared/logger.js';

const log = childLogger('api:error-handler');

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      reply.status(err.statusCode).send({ error: err.code, message: err.message });
      return;
    }

    if (err instanceof ZodError) {
      reply.status(400).send({ error: 'VALIDATION_ERROR', message: err.issues });
      return;
    }

    log.error({ err, path: req.url }, 'unhandled error');
    reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Something went wrong' });
  });
}
