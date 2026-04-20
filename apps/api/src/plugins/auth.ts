/**
 * Bearer-token auth. Looks up `Authorization: Bearer <key>` against
 * `organizations.api_key_hash` (sha256). Attaches `req.organization`.
 *
 * Routes can opt out with `{ config: { public: true } }`.
 */

import { createHash } from 'node:crypto';

import { eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

import { db } from '../db/client.js';
import { organizations } from '../db/schema.js';

declare module 'fastify' {
  interface FastifyRequest {
    organization?: {
      id: string;
      legalName: string;
    };
  }
  interface FastifyContextConfig {
    public?: boolean;
  }
}

function hash(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

async function authPlugin(fastify: FastifyInstance): Promise<void> {
  fastify.addHook('onRequest', async (req: FastifyRequest, reply) => {
    // Public routes (health, /v1/demo/submit, openapi.json) skip auth.
    if (req.routeOptions.config?.public === true) return;

    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      reply.code(401).send({ error: 'unauthorized', message: 'Missing Bearer token.' });
      return;
    }
    const token = header.slice('Bearer '.length).trim();
    if (!token) {
      reply.code(401).send({ error: 'unauthorized', message: 'Empty Bearer token.' });
      return;
    }

    const tokenHash = hash(token);
    const [org] = await db
      .select({ id: organizations.id, legalName: organizations.legalName })
      .from(organizations)
      .where(eq(organizations.apiKeyHash, tokenHash))
      .limit(1);

    if (!org) {
      reply.code(401).send({ error: 'unauthorized', message: 'Invalid API key.' });
      return;
    }

    req.organization = org;
  });
}

export default fp(authPlugin, { name: 'auth' });
