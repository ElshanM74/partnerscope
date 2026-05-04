/**
 * Dual-mode Bearer auth:
 *   1. JWT path — tokens that look like JWTs (`ey*.*.*`) are verified via
 *      @fastify/jwt and attach both `req.user` and a minimal `req.organization`.
 *   2. API-key path — opaque tokens are SHA-256-hashed and matched against
 *      `organizations.api_key_hash`, attaching `req.organization` only.
 *
 * Routes can opt out with `{ config: { public: true } }`.
 */

import { createHash } from 'node:crypto';

import { eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

import type { JWTPayload } from '@partnerscope/core';

import { env } from '../config/env.js';
import { db } from '../db/client.js';
import { organizations } from '../db/schema.js';

// Tell @fastify/jwt what we put inside the token (for sign) and what
// req.user looks like after jwtVerify(). Keep them aligned so we don't
// need to reshape after verification.
type JWTClaims = Omit<JWTPayload, 'iat' | 'exp'>;

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: JWTClaims;
    user: JWTClaims;
  }
}

declare module 'fastify' {
  interface FastifyRequest {
    organization?: {
      id: string;
      legalName: string;
    };
    // Platform-staff flag (set only on the JWT auth path when the token's
    // email is in env.STAFF_EMAILS). API-key callers are never staff.
    isStaff?: boolean;
  }
  interface FastifyContextConfig {
    public?: boolean;
  }
}

function hash(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/** Cheap heuristic: JWTs are three base64url segments separated by dots. */
function looksLikeJwt(token: string): boolean {
  if (!token.startsWith('ey')) return false;
  // exactly 2 dots
  let dots = 0;
  for (let i = 0; i < token.length; i++) {
    if (token[i] === '.') dots++;
    if (dots > 2) return false;
  }
  return dots === 2;
}

async function authPlugin(fastify: FastifyInstance): Promise<void> {
  fastify.addHook('onRequest', async (req: FastifyRequest, reply) => {
    // Public routes (health, /v1/demo/submit, /v1/auth/register, /v1/auth/login,
    // /webhooks/*, openapi.json) skip auth.
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

    // ── JWT path ────────────────────────────────────────────────
    if (looksLikeJwt(token)) {
      try {
        // jwtVerify() attaches the decoded payload to req.user (shape declared
        // above: { sub, org, email, role }).
        const payload = await req.jwtVerify<JWTClaims>();
        // Minimal org attachment — handlers that need legalName should
        // re-fetch. Most JWT-authed routes only need req.user.org.
        req.organization = { id: payload.org, legalName: '' };
        // Server-side staff check. STAFF_EMAILS is a pre-lowercased array
        // (see config/env.ts); payload.email is lowercased at register/login.
        req.isStaff = env.STAFF_EMAILS.includes(payload.email.toLowerCase());
        return;
      } catch {
        // Fall through to API-key path (the JWT might have been a stale one;
        // but more importantly a random opaque key can start with `ey`).
      }
    }

    // ── API-key path ────────────────────────────────────────────
    const tokenHash = hash(token);
    const [org] = await db
      .select({ id: organizations.id, legalName: organizations.legalName })
      .from(organizations)
      .where(eq(organizations.apiKeyHash, tokenHash))
      .limit(1);

    if (!org) {
      reply.code(401).send({ error: 'unauthorized', message: 'Invalid or expired credentials.' });
      return;
    }

    req.organization = org;
  });
}

export default fp(authPlugin, { name: 'auth' });
