/**
 * PartnerScope API — Fastify 5 entrypoint.
 */

import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import fastifyJwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import Fastify from 'fastify';

import { env } from './config/env.js';
import { pool } from './db/client.js';
import authPlugin from './plugins/auth.js';
import errorHandlerPlugin from './plugins/error-handler.js';
import { adminRoutes } from './routes/admin.js';
import { authRoutes } from './routes/auth.js';
import { checkoutRoutes } from './routes/checkout.js';
import { demoRoutes } from './routes/demo.js';
import { healthRoutes } from './routes/health.js';
import { intakeRoutes } from './routes/intake.js';
import { pushRoutes } from './routes/push.js';
import { runRoutes } from './routes/runs.js';
import { vendorRoutes } from './routes/vendors.js';
import { webhookRoutes } from './routes/webhooks.js';
import { closePdfBrowser } from './services/pdf/index.js';
import { closePushProvider } from './services/push.js';

export async function buildServer(): Promise<ReturnType<typeof Fastify>> {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      ...(env.NODE_ENV === 'development'
        ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
        : {}),
    },
    disableRequestLogging: false,
    trustProxy: true,
  });

  await app.register(helmet, { global: true });
  await app.register(cors, {
    origin: env.API_CORS_ORIGIN.split(',').map((s) => s.trim()),
    credentials: true,
  });
  await app.register(rateLimit, {
    max: 200,
    timeWindow: '1 minute',
  });
  await app.register(sensible);
  // @fastify/jwt must be registered BEFORE authPlugin — authPlugin calls
  // req.jwtVerify() on Bearer tokens that look like JWTs.
  await app.register(fastifyJwt, {
    secret: env.JWT_SECRET,
    sign: { expiresIn: '7d' },
  });
  await app.register(errorHandlerPlugin);
  await app.register(authPlugin);

  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(adminRoutes);
  await app.register(demoRoutes);
  await app.register(intakeRoutes);
  await app.register(vendorRoutes);
  await app.register(runRoutes);
  await app.register(checkoutRoutes);
  await app.register(pushRoutes);
  // Webhook routes are encapsulated so the raw-body JSON parser they
  // install doesn't leak to the rest of the API.
  await app.register(webhookRoutes);

  app.addHook('onClose', async () => {
    await closePdfBrowser();
    await closePushProvider();
    await pool.end().catch(() => {});
  });

  return app;
}

async function main(): Promise<void> {
  const app = await buildServer();
  try {
    await app.listen({ host: '0.0.0.0', port: env.API_PORT });
    app.log.info(`PartnerScope API listening on ${env.API_BASE_URL}`);
  } catch (err) {
    app.log.error({ err }, 'Failed to start server');
    process.exit(1);
  }
}

// Only auto-start when invoked directly (not when imported from tests).
const isDirect = import.meta.url === `file://${process.argv[1]}`;
if (isDirect) {
  void main();
}
