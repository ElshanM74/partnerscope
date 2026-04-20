/**
 * POST /v1/vendors        — create a vendor under the authenticated org
 * GET  /v1/vendors        — list vendors for the authenticated org
 */

import { and, desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { db } from '../db/client.js';
import { vendors } from '../db/schema.js';
import { ApiError } from '../plugins/error-handler.js';

const VendorCreateSchema = z.object({
  legalName: z.string().min(1).max(255),
  domain: z
    .string()
    .min(3)
    .max(253)
    .regex(/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/, 'Invalid domain.'),
  country: z.string().length(2).optional(),
  industry: z.string().max(100).optional(),
  externalRef: z.string().max(100).optional(),
});

export async function vendorRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post('/v1/vendors', async (req, reply) => {
    if (!req.organization) throw new ApiError(401, 'unauthorized', 'No organization context.');
    const body = VendorCreateSchema.parse(req.body);

    // Uniqueness is enforced by (organization_id, domain).
    const existing = await db
      .select({ id: vendors.id })
      .from(vendors)
      .where(and(eq(vendors.organizationId, req.organization.id), eq(vendors.domain, body.domain)))
      .limit(1);

    if (existing.length > 0) {
      throw new ApiError(409, 'vendor_exists', `Vendor for domain ${body.domain} already exists.`);
    }

    const [created] = await db
      .insert(vendors)
      .values({
        organizationId: req.organization.id,
        legalName: body.legalName,
        domain: body.domain,
        country: body.country ?? null,
        industry: body.industry ?? null,
        externalRef: body.externalRef ?? null,
      })
      .returning();

    reply.code(201).send(created);
  });

  fastify.get('/v1/vendors', async (req) => {
    if (!req.organization) throw new ApiError(401, 'unauthorized', 'No organization context.');
    const rows = await db
      .select()
      .from(vendors)
      .where(eq(vendors.organizationId, req.organization.id))
      .orderBy(desc(vendors.createdAt))
      .limit(200);
    return { data: rows };
  });
}
