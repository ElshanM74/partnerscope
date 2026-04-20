/**
 * Uniform error shape for the API. Any route throwing a
 * ZodError → 422, ApiError → mapped code, else → 500.
 */

import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { ZodError } from 'zod';

export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

async function errorHandlerPlugin(fastify: FastifyInstance): Promise<void> {
  fastify.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) {
      reply.code(422).send({
        error: 'validation_error',
        message: 'Request failed validation.',
        issues: err.issues,
      });
      return;
    }

    if (err instanceof ApiError) {
      reply.code(err.statusCode).send({
        error: err.code,
        message: err.message,
        ...(err.details !== undefined ? { details: err.details } : {}),
      });
      return;
    }

    const maybeFastifyErr = err as { statusCode?: number; message?: string };
    // Fastify validation (ajv / schema)
    if (maybeFastifyErr.statusCode === 400) {
      reply.code(400).send({
        error: 'bad_request',
        message: maybeFastifyErr.message ?? 'Bad request.',
      });
      return;
    }

    req.log.error({ err }, 'Unhandled route error');
    reply.code(500).send({
      error: 'internal_error',
      message: 'Something went wrong.',
    });
  });
}

export default fp(errorHandlerPlugin, { name: 'error-handler' });
