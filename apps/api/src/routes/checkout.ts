/** Run-scoped paid services; research beta remains available independently. */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { env } from '../config/env.js';
import { pool } from '../db/client.js';
import { ApiError } from '../plugins/error-handler.js';
import { billingEntitlements } from '../services/billing.js';
import { checkoutRedirect, createCheckoutSession } from '../services/stripe/index.js';

const CheckoutCreateSchema = z
  .object({
    tier: z.enum(['starter', 'pro', 'enterprise']),
    vendorId: z.string().uuid(),
    buyerEmail: z.string().email(),
    runId: z.string().uuid().optional(),
    successUrl: z.string().url().optional(),
    cancelUrl: z.string().url().optional(),
  })
  .strict();

const EnterpriseScopeSchema = z.object({
  enterpriseScopeApproved: z.literal(true),
  scopeApproval: z.object({
    staffUserId: z.string().uuid(),
    contractReference: z.string().trim().min(1).max(500),
  }),
});

export async function checkoutRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.addHook('preHandler', async (req, reply) => {
    if (!req.organization) return reply.code(401).send({ error: 'unauthorized' });
    const member = req.user?.sub
      ? await pool.query('SELECT id FROM users WHERE id=$1 AND organization_id=$2', [
          req.user.sub,
          req.organization.id,
        ])
      : await pool.query('SELECT id FROM organizations WHERE id=$1', [req.organization.id]);
    if (!member.rowCount) return reply.code(401).send({ error: 'unauthorized' });
  });
  fastify.get('/v1/billing/entitlements', async (req) => {
    if (!req.organization) throw new ApiError(401, 'unauthorized', 'No organization context.');
    return billingEntitlements(req.organization.id);
  });
  fastify.post('/v1/checkout/session', async (req) => {
    if (!req.organization) throw new ApiError(401, 'unauthorized', 'No organization context.');
    if (req.user?.sub && req.user.role !== 'admin' && !req.isStaff)
      throw new ApiError(
        403,
        'billing_admin_required',
        'An organization administrator must request payment.',
      );
    const body = CheckoutCreateSchema.parse(req.body);
    if (body.tier === 'enterprise' && !body.runId)
      throw new ApiError(
        409,
        'enterprise_scope_required',
        'Enterprise scope and contract must be approved before payment.',
      );
    try {
      checkoutRedirect(body.successUrl, 'success');
      checkoutRedirect(body.cancelUrl, 'cancel');
    } catch {
      throw new ApiError(
        400,
        'invalid_checkout_redirect',
        'Use a checkout return page on this application.',
      );
    }
    const client = await pool.connect();
    let runId = body.runId;
    try {
      await client.query('BEGIN');
      const vendor = await client.query(
        'SELECT id FROM vendors WHERE id=$1 AND organization_id=$2 FOR KEY SHARE',
        [body.vendorId, req.organization.id],
      );
      if (!vendor.rowCount)
        throw new ApiError(404, 'vendor_not_found', 'Vendor not found for this organization.');
      if (runId) {
        const run = (
          await client.query(
            'SELECT id,tier,status,report_json AS "reportJson" FROM runs WHERE id=$1 AND organization_id=$2 AND vendor_id=$3 FOR UPDATE',
            [runId, req.organization.id, body.vendorId],
          )
        ).rows[0];
        if (!run)
          throw new ApiError(
            404,
            'run_not_found',
            'Run not found for this vendor and organization.',
          );
        if (run.tier !== body.tier || run.status !== 'draft')
          throw new ApiError(
            409,
            'run_not_purchasable',
            'Only a matching draft run can be purchased.',
          );
        if (body.tier === 'enterprise') {
          const scope = EnterpriseScopeSchema.safeParse(run.reportJson);
          if (!scope.success)
            throw new ApiError(
              409,
              'enterprise_scope_required',
              'Enterprise scope and contract must be approved before payment.',
            );
          const staff = await client.query(
            'SELECT id FROM users WHERE id=$1 AND lower(email::text)=ANY($2::text[])',
            [scope.data.scopeApproval.staffUserId, env.STAFF_EMAILS],
          );
          if (!staff.rowCount)
            throw new ApiError(
              409,
              'enterprise_scope_required',
              'The Enterprise scope approval must identify an authorized analyst.',
            );
        }
        if ((await client.query('SELECT id FROM billing_orders WHERE run_id=$1', [runId])).rowCount)
          throw new ApiError(409, 'run_already_purchased', 'This run already has a purchase.');
      } else {
        runId = (
          await client.query(
            "INSERT INTO runs (vendor_id,organization_id,tier,status,requested_by) VALUES ($1,$2,$3,'draft',$4) RETURNING id",
            [body.vendorId, req.organization.id, body.tier, req.user?.sub ?? null],
          )
        ).rows[0].id;
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
    const session = await createCheckoutSession({
      ...body,
      organizationId: req.organization.id,
      runId,
    });
    if (!session.url)
      throw new ApiError(502, 'stripe_session_failed', 'Stripe did not return a checkout URL.');
    return { id: session.id, url: session.url, runId };
  });
}
