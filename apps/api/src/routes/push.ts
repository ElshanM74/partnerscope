/**
 * POST /v1/push/register — iOS app registers its APNs device token.
 *
 * Called by the Capacitor client after the user grants notification
 * permission. Upserts (user_id, device_token) and refreshes last_seen_at
 * so we can age-out inactive devices later.
 *
 * JWT-authed; requires `req.user.sub` (user UUID) to associate the device
 * with the right account. API-key-only callers (organization-level auth
 * without a user context) are rejected.
 */

import { and, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { db } from '../db/client.js';
import { pushDevices } from '../db/schema.js';
import { ApiError } from '../plugins/error-handler.js';

const RegisterSchema = z.object({
  device_token: z
    .string()
    .min(16)
    .max(200)
    // APNs tokens are hex; FCM tokens are URL-safe base64. Accept both shapes.
    .regex(/^[A-Za-z0-9:_\-+/=]+$/, 'device_token contains invalid characters'),
  platform: z.enum(['ios', 'android']),
});

export async function pushRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post('/v1/push/register', async (req, reply) => {
    if (!req.user?.sub) {
      throw new ApiError(
        401,
        'unauthorized',
        'Push registration requires a user session (JWT). API-key auth is not sufficient.',
      );
    }

    const body = RegisterSchema.parse(req.body);
    const userId = req.user.sub;

    await db
      .insert(pushDevices)
      .values({
        userId,
        deviceToken: body.device_token,
        platform: body.platform,
      })
      .onConflictDoUpdate({
        target: [pushDevices.userId, pushDevices.deviceToken],
        set: {
          platform: body.platform,
          lastSeenAt: sql`now()`,
        },
      });

    reply.code(204);
    return reply.send();
  });

  // Convenience: let the client drop its token on explicit sign-out.
  fastify.delete('/v1/push/register', async (req, reply) => {
    if (!req.user?.sub) {
      throw new ApiError(401, 'unauthorized', 'Sign-out requires a user session.');
    }

    const body = z.object({ device_token: z.string().min(16).max(200) }).parse(req.body);
    await db
      .delete(pushDevices)
      .where(
        and(eq(pushDevices.userId, req.user.sub), eq(pushDevices.deviceToken, body.device_token)),
      );

    reply.code(204);
    return reply.send();
  });
}
