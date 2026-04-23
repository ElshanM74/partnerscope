/**
 * POST   /v1/auth/register  — create org + admin user, return JWT
 * POST   /v1/auth/login     — email + password → JWT (7-day expiry)
 * GET    /v1/auth/me        — current user (requires JWT)
 * DELETE /v1/auth/me        — self-service account deletion (requires JWT)
 *
 * Public routes use `config: { public: true }` to skip the auth hook.
 * `/me` is NOT public — the auth plugin verifies the JWT and attaches
 * `req.user` before the handler runs.
 */

import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import type { AuthUser } from '@partnerscope/core';

import { env } from '../config/env.js';
import { db } from '../db/client.js';
import {
  auditLog,
  evidenceDocuments,
  monitoringSignals,
  organizations,
  redteamResults,
  runs,
  users,
} from '../db/schema.js';
import { ApiError } from '../plugins/error-handler.js';
import { cancelOrgSubscriptions } from '../services/stripe/index.js';
import { hashPassword, verifyPassword } from '../utils/password.js';

/** True when the given (case-insensitive) email is in the staff allowlist. */
function isStaffEmail(email: string): boolean {
  return env.STAFF_EMAILS.includes(email.toLowerCase());
}

const RegisterSchema = z.object({
  email: z.string().email().max(254).transform((s) => s.toLowerCase()),
  password: z.string().min(8).max(128),
  fullName: z.string().min(1).max(200).optional(),
  organizationName: z.string().min(1).max(200),
  country: z
    .string()
    .length(2)
    .transform((s) => s.toUpperCase()),
});

const LoginSchema = z.object({
  email: z.string().email().max(254).transform((s) => s.toLowerCase()),
  password: z.string().min(1).max(128),
});

// Dummy hash used on unknown-email login to equalise timing (prevents
// email-existence enumeration via response-time side channel).
const DUMMY_HASH =
  'scrypt$16384$00000000000000000000000000000000$' +
  '0'.repeat(128);

function toPublicUser(u: typeof users.$inferSelect): AuthUser {
  return {
    id: u.id,
    organizationId: u.organizationId,
    email: u.email,
    fullName: u.fullName,
    role: u.role,
    isStaff: isStaffEmail(u.email),
  };
}

export async function authRoutes(fastify: FastifyInstance): Promise<void> {
  // ── POST /v1/auth/register ─────────────────────────────────
  fastify.post('/v1/auth/register', { config: { public: true } }, async (req, reply) => {
    const body = RegisterSchema.parse(req.body);

    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, body.email))
      .limit(1);
    if (existing.length > 0) {
      throw new ApiError(409, 'email_taken', 'An account with this email already exists.');
    }

    const passwordHash = await hashPassword(body.password);

    // Atomic: create org + admin user. On any failure, the whole tx rolls back
    // so we don't end up with orphan organizations.
    const user = await db.transaction(async (tx) => {
      const orgRows = await tx
        .insert(organizations)
        .values({
          legalName: body.organizationName,
          country: body.country,
          billingEmail: body.email,
        })
        .returning({ id: organizations.id });
      const org = orgRows[0];
      if (!org) throw new ApiError(500, 'db_error', 'Failed to create organization.');

      const userRows = await tx
        .insert(users)
        .values({
          organizationId: org.id,
          email: body.email,
          fullName: body.fullName ?? null,
          role: 'admin',
          passwordHash,
          lastLoginAt: new Date(),
        })
        .returning();
      const inserted = userRows[0];
      if (!inserted) throw new ApiError(500, 'db_error', 'Failed to create user.');

      return inserted;
    });

    const token = fastify.jwt.sign({
      sub: user.id,
      org: user.organizationId ?? '',
      email: user.email,
      role: user.role,
    });

    reply.code(201).send({ token, user: toPublicUser(user) });
  });

  // ── POST /v1/auth/login ────────────────────────────────────
  fastify.post('/v1/auth/login', { config: { public: true } }, async (req, reply) => {
    const body = LoginSchema.parse(req.body);

    const rows = await db.select().from(users).where(eq(users.email, body.email)).limit(1);
    const user = rows[0];

    // Always run verifyPassword (even on unknown emails) to keep timings flat.
    const ok = user?.passwordHash
      ? await verifyPassword(body.password, user.passwordHash)
      : ((await verifyPassword(body.password, DUMMY_HASH)), false);

    if (!user || !ok) {
      throw new ApiError(401, 'invalid_credentials', 'Email or password is incorrect.');
    }

    await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));

    const token = fastify.jwt.sign({
      sub: user.id,
      org: user.organizationId ?? '',
      email: user.email,
      role: user.role,
    });

    reply.send({ token, user: toPublicUser(user) });
  });

  // ── GET /v1/auth/me ────────────────────────────────────────
  // Non-public: the auth plugin's JWT branch must have attached req.user.
  // `req.user` is only populated on the JWT auth path; API-key auth doesn't
  // set it, so an API-key caller hitting /me gets a clean 401 here.
  fastify.get('/v1/auth/me', async (req, reply) => {
    if (!req.user || typeof req.user === 'string' || req.user instanceof Buffer) {
      throw new ApiError(401, 'unauthorized', 'Not authenticated.');
    }
    const userId = req.user.sub;
    const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    const u = rows[0];
    if (!u) {
      throw new ApiError(404, 'user_not_found', 'User no longer exists.');
    }
    reply.send({ user: toPublicUser(u) });
  });

  // ── DELETE /v1/auth/me ─────────────────────────────────────
  //
  // Self-service account deletion. Added for Apple Guideline 5.1.1(v): any app
  // that lets users create an account must also let them delete it.
  //
  // Flow (wrapped in a transaction so a mid-flight failure leaves the user
  // row intact and the client can retry):
  //
  //   1. Write an audit_log row BEFORE we mutate anything (actor_user_id = null
  //      — we're about to delete that user, so the FK must already be null to
  //      avoid a self-referential violation, and a null actor is how we
  //      encode "user deleted themselves" anyway).
  //   2. Cancel any Stripe subscriptions the user's org is on the hook for —
  //      right-to-erasure means we stop billing. Per-subscription errors are
  //      logged + swallowed inside cancelOrgSubscriptions so Stripe being
  //      flaky doesn't block the user's deletion.
  //   3. NULL-out the five non-cascading FKs that point at users.id
  //      (runs.requested_by, evidence_documents.uploaded_by,
  //       redteam_results.analyst_id, monitoring_signals.acked_by,
  //       audit_log.actor_user_id) — otherwise the final DELETE trips the
  //      foreign-key constraint.
  //   4. Hard DELETE the users row. push_devices cascades automatically
  //      (onDelete: 'cascade' in schema.ts).
  //
  // The organization row is deliberately retained — the Stripe customer
  // reference and audit trail must survive; cleanup of orphan orgs is an
  // admin/ops concern (out of scope for this endpoint).
  //
  // Returns 204. The client must clear ps_token / ps_user from localStorage
  // and redirect out; we can't invalidate the JWT server-side without a
  // token-denylist, but the user row is gone so any subsequent /me call 404s.
  fastify.delete('/v1/auth/me', async (req, reply) => {
    if (!req.user || typeof req.user === 'string' || req.user instanceof Buffer) {
      throw new ApiError(401, 'unauthorized', 'Not authenticated.');
    }

    const body = z
      .object({
        // Typing-confirmation guard — clients must send { "confirm": "DELETE" }
        // to avoid accidental wipes from a misfiring DELETE call.
        confirm: z.literal('DELETE'),
      })
      .parse(req.body ?? {});
    void body; // parsed only for its side-effect (throws on mismatch)

    const userId = req.user.sub;

    // Snapshot what we need for the audit row + Stripe cancel BEFORE we touch
    // the users table.
    const userRows = await db
      .select({
        id: users.id,
        email: users.email,
        organizationId: users.organizationId,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    const snapshot = userRows[0];
    if (!snapshot) {
      throw new ApiError(404, 'user_not_found', 'User no longer exists.');
    }

    // Cancel Stripe subscriptions OUTSIDE the transaction — a flaky Stripe
    // call must not hold the DB lock, and we don't want tx rollback to
    // silently un-cancel subscriptions (Stripe doesn't support that).
    const stripeResult = snapshot.organizationId
      ? await cancelOrgSubscriptions(snapshot.organizationId)
      : { cancelled: 0, errors: 0 };

    await db.transaction(async (tx) => {
      // (1) Audit row with actorUserId = null (user is deleting themselves).
      await tx.insert(auditLog).values({
        actorUserId: null,
        action: 'user.deleted',
        resourceType: 'user',
        resourceId: snapshot.id,
        payload: {
          email: snapshot.email,
          organizationId: snapshot.organizationId,
          stripe: stripeResult,
          at: new Date().toISOString(),
          // Fastify attaches the caller's IP on the request — stamp it for
          // the trail in case we ever need to repudiate a deletion.
          actorIp: req.ip,
        },
      });

      // (2) NULL-out non-cascading FKs. Five single-column UPDATEs — order
      // doesn't matter, each targets a different table.
      await tx.update(runs).set({ requestedBy: null }).where(eq(runs.requestedBy, userId));
      await tx
        .update(evidenceDocuments)
        .set({ uploadedBy: null })
        .where(eq(evidenceDocuments.uploadedBy, userId));
      await tx
        .update(redteamResults)
        .set({ analystId: null })
        .where(eq(redteamResults.analystId, userId));
      await tx
        .update(monitoringSignals)
        .set({ ackedBy: null })
        .where(eq(monitoringSignals.ackedBy, userId));
      await tx
        .update(auditLog)
        .set({ actorUserId: null })
        .where(eq(auditLog.actorUserId, userId));

      // (3) Hard delete. push_devices cascades automatically.
      await tx.delete(users).where(eq(users.id, userId));
    });

    reply.code(204).send();
  });
}
