/**
 * /v1/admin/* — cross-org, read-only endpoints for platform staff.
 *
 * Authorization model:
 *   - None of these routes set `config: { public: true }`, so they run through
 *     the auth plugin's JWT branch (which sets `req.isStaff` on a verified
 *     signed payload whose email matches env.STAFF_EMAILS).
 *   - Every handler calls `requireStaff(req)` first. API-key-authenticated
 *     callers never have `req.isStaff` set, so they get a 403.
 *
 * All list endpoints return at most 500 most-recent rows. Pagination is a
 * deferred follow-up (see plans/.../staff-admin-dashboard).
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '../db/client.js';
import {
  auditLog,
  demoLeads,
  organizations,
  passwordResetTokens,
  runs,
  users,
  vendors,
} from '../db/schema.js';
import { ApiError } from '../plugins/error-handler.js';
import { hashPassword } from '../utils/password.js';

const ROW_LIMIT = 500;

function requireStaff(req: FastifyRequest): void {
  if (req.isStaff !== true) {
    throw new ApiError(403, 'forbidden', 'Staff access required.');
  }
}

export async function adminRoutes(fastify: FastifyInstance): Promise<void> {
  // ── GET /v1/admin/stats ────────────────────────────────────
  // Cheap top-of-page counters. Four count(*) queries — for the platform's
  // current row volumes, a single GIN-less scan per table is trivial.
  fastify.get('/v1/admin/stats', async (req, reply) => {
    requireStaff(req);

    const [orgCount] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(organizations);
    const [userCount] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(users);
    const [runCount] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(runs);
    const [leadCount] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(demoLeads);

    reply.send({
      organizations: orgCount?.n ?? 0,
      users: userCount?.n ?? 0,
      runs: runCount?.n ?? 0,
      demoLeads: leadCount?.n ?? 0,
    });
  });

  // ── GET /v1/admin/users ────────────────────────────────────
  // Most-recent-first, left-joined to organizations so the admin UI can show
  // "which org does this signup belong to" without a second round-trip.
  fastify.get('/v1/admin/users', async (req, reply) => {
    requireStaff(req);

    const rows = await db
      .select({
        id: users.id,
        email: users.email,
        fullName: users.fullName,
        role: users.role,
        lastLoginAt: users.lastLoginAt,
        createdAt: users.createdAt,
        organizationId: users.organizationId,
        organizationName: organizations.legalName,
        organizationCountry: organizations.country,
      })
      .from(users)
      .leftJoin(organizations, eq(users.organizationId, organizations.id))
      .orderBy(desc(users.createdAt))
      .limit(ROW_LIMIT);

    reply.send({ users: rows });
  });

  // ── GET /v1/admin/organizations ────────────────────────────
  // Each row embeds member + run counts via correlated subqueries. At current
  // volume (dozens of orgs) this is fine; if it grows, switch to a GROUP BY
  // over a left-joined users/runs set.
  fastify.get('/v1/admin/organizations', async (req, reply) => {
    requireStaff(req);

    const rows = await db
      .select({
        id: organizations.id,
        legalName: organizations.legalName,
        country: organizations.country,
        billingEmail: organizations.billingEmail,
        createdAt: organizations.createdAt,
        userCount: sql<number>`(select count(*)::int from ${users} where ${users.organizationId} = ${organizations.id})`,
        runCount: sql<number>`(select count(*)::int from ${runs} where ${runs.organizationId} = ${organizations.id})`,
      })
      .from(organizations)
      .orderBy(desc(organizations.createdAt))
      .limit(ROW_LIMIT);

    reply.send({ organizations: rows });
  });

  // ── GET /v1/admin/runs ─────────────────────────────────────
  // All paid assessments across all orgs. Joined to vendors (what's being
  // assessed) and organizations (who requested it).
  fastify.get('/v1/admin/runs', async (req, reply) => {
    requireStaff(req);

    const rows = await db
      .select({
        id: runs.id,
        tier: runs.tier,
        status: runs.status,
        compositeScore: runs.compositeScore,
        riskBand: runs.riskBand,
        createdAt: runs.createdAt,
        deliveredAt: runs.deliveredAt,
        vendorDomain: vendors.domain,
        vendorLegalName: vendors.legalName,
        organizationId: runs.organizationId,
        organizationName: organizations.legalName,
      })
      .from(runs)
      .leftJoin(vendors, eq(runs.vendorId, vendors.id))
      .leftJoin(organizations, eq(runs.organizationId, organizations.id))
      .orderBy(desc(runs.createdAt))
      .limit(ROW_LIMIT);

    reply.send({ runs: rows });
  });

  // ── GET /v1/admin/leads ────────────────────────────────────
  // Free-snapshot (/v1/demo/submit) submissions. These are NOT gated by an
  // org — they're open-funnel leads. Includes UTM and conversion linkage.
  fastify.get('/v1/admin/leads', async (req, reply) => {
    requireStaff(req);

    const rows = await db
      .select({
        id: demoLeads.id,
        email: demoLeads.email,
        company: demoLeads.company,
        vendorDomain: demoLeads.vendorDomain,
        snapshotScore: demoLeads.snapshotScore,
        riskBand: demoLeads.riskBand,
        convertedRunId: demoLeads.convertedRunId,
        utmSource: demoLeads.utmSource,
        utmMedium: demoLeads.utmMedium,
        utmCampaign: demoLeads.utmCampaign,
        createdAt: demoLeads.createdAt,
      })
      .from(demoLeads)
      .orderBy(desc(demoLeads.createdAt))
      .limit(ROW_LIMIT);

    reply.send({ leads: rows });
  });

  // ── POST /v1/admin/users/:userId/password ──────────────────
  //
  // Staff-initiated password set. The admin types the new password directly
  // and shares it with the user out-of-band (Slack, phone, etc.). Intended
  // for the case where a customer can't receive email — the forgot-password
  // flow is always preferred when mail is working.
  //
  // The admin does learn the password in this flow (that's the trade-off
  // for the direct-set design); every use is audit-logged with the actor's
  // user id and IP so there's a record of who set what.
  const SetPasswordSchema = z.object({
    password: z.string().min(8).max(128),
  });
  fastify.post('/v1/admin/users/:userId/password', async (req, reply) => {
    requireStaff(req);

    const params = z.object({ userId: z.string().uuid() }).parse(req.params);
    const body = SetPasswordSchema.parse(req.body);

    const rows = await db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(eq(users.id, params.userId))
      .limit(1);
    const target = rows[0];
    if (!target) {
      throw new ApiError(404, 'user_not_found', 'User not found.');
    }

    const newHash = await hashPassword(body.password);
    const actorId = req.user && typeof req.user === 'object' && 'sub' in req.user
      ? (req.user.sub as string)
      : null;

    await db.transaction(async (tx) => {
      await tx.update(users).set({ passwordHash: newHash }).where(eq(users.id, target.id));
      // An admin reset revokes in-flight forgot-password links too — the
      // account now has a known credential; nothing else should also work.
      await tx
        .update(passwordResetTokens)
        .set({ usedAt: new Date() })
        .where(and(eq(passwordResetTokens.userId, target.id), isNull(passwordResetTokens.usedAt)));
      await tx.insert(auditLog).values({
        actorUserId: actorId,
        actorIp: req.ip,
        action: 'user.password_reset_by_admin',
        resourceType: 'user',
        resourceId: target.id,
        payload: { targetEmail: target.email, at: new Date().toISOString() },
      });
    });

    reply.send({ ok: true });
  });
}
