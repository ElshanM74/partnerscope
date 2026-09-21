/** Real routes + PostgreSQL + Chrome PDF. Only runs against a guarded disposable database. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { access, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import pg from 'pg';

const databaseName = process.env.TEST_DATABASE_NAME ?? '';
const connectionString = process.env.DATABASE_URL ?? '';
let actualName = '';
try {
  actualName = decodeURIComponent(new URL(connectionString).pathname.slice(1));
} catch {
  /* Guard below. */
}
if (!/^ps_release_test_[a-z0-9_]+$/.test(databaseName) || actualName !== databaseName) {
  console.error('Refusing integration run: disposable ps_release_test_ database required.');
  process.exit(2);
}
if (!process.env.PUPPETEER_EXECUTABLE_PATH && process.platform === 'darwin') {
  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  try {
    await access(chrome);
    process.env.PUPPETEER_EXECUTABLE_PATH = chrome;
  } catch {
    /* Puppeteer's installed browser fallback. */
  }
}
const storageRoot = await mkdtemp(path.join(os.tmpdir(), 'ps-release-fulfillment-'));
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';
process.env.STORAGE_DRIVER = 'local';
process.env.STORAGE_LOCAL_DIR = storageRoot;
// This test intentionally never calls paid AI, email or Stripe providers.
process.env.OPENAI_API_KEY = '';
process.env.RESEND_API_KEY = '';
process.env.STRIPE_SECRET_KEY = '';
const { runRoutes } = await import('../dist/routes/runs.js');
const { questionnaireRoutes } = await import('../dist/routes/questionnaire.js');
const { fulfillmentRoutes } = await import('../dist/routes/fulfillment.js');
const { default: errorHandler } = await import('../dist/plugins/error-handler.js');
const { prepareAssessment } = await import('../dist/services/fulfillment.js');
const { renderEvidenceReportPdf, closePdfBrowser } = await import('../dist/services/pdf/index.js');
const { getStorage } = await import('../dist/services/storage.js');
const { pool: appPool } = await import('../dist/db/client.js');
const pool = new pg.Pool({ connectionString, max: 6 });
const app = Fastify({ logger: false });
const actors = new Map();
const checks = [];
let currentCheck = 'initialize';
let technicalStatuses = [];
async function check(name, action) {
  currentCheck = name;
  await action();
  checks.push({ name, passed: true });
}
async function actor(label, role = 'admin') {
  const org = randomUUID();
  const user = randomUUID();
  const name = label === 'staff' ? 'Verified integration analyst' : `Integration ${label}`;
  await pool.query(
    'INSERT INTO organizations (id,legal_name,country,billing_email) VALUES ($1,$2,$3,$4)',
    [org, `Integration ${label}`, 'AZ', `${org}@integration.invalid`],
  );
  await pool.query(
    'INSERT INTO users (id,organization_id,email,full_name,role) VALUES ($1,$2,$3,$4,$5)',
    [user, org, `${user}@integration.invalid`, name, role],
  );
  const result = { org, user, name, role, isStaff: label === 'staff' };
  actors.set(label, result);
  return result;
}
async function vendor(owner, domain = 'partnerscope.eu') {
  const id = randomUUID();
  await pool.query(
    'INSERT INTO vendors (id,organization_id,legal_name,domain,country) VALUES ($1,$2,$3,$4,$5)',
    [id, owner.org, 'PartnerScope integration fixture', domain, 'AZ'],
  );
  return id;
}
async function request(label, method, url, payload) {
  return app.inject({
    method,
    url,
    headers: { 'x-test-actor': label },
    ...(payload ? { payload } : {}),
  });
}
async function createRun(vendorId, tier, label = 'client') {
  const response = await request(label, 'POST', '/v1/runs', {
    vendorId,
    tier,
    context: {
      task: 'Controlled integration test of a supplier service.',
      criteria: 'Record observations and information gaps',
      country: 'Azerbaijan',
    },
  });
  assert.equal(response.statusCode, 201, `Create ${tier} run`);
  return response.json().id;
}
async function storedRun(id) {
  return (await pool.query('SELECT * FROM runs WHERE id=$1', [id])).rows[0];
}
function isPdf(response) {
  assert.equal(response.statusCode, 200);
  assert.equal(response.rawPayload.subarray(0, 5).toString(), '%PDF-');
  assert.ok(response.rawPayload.length > 1000);
}
try {
  assert.equal((await pool.query('SELECT current_database() AS name')).rows[0].name, databaseName);
  const client = await actor('client');
  const staff = await actor('staff');
  await actor('foreign');
  const deleted = await actor('deleted');
  const viewer = await actor('viewer', 'viewer');
  const clientVendor = await vendor(client);
  const viewerVendor = await vendor(viewer);
  app.addHook('onRequest', async (req, reply) => {
    const identity = actors.get(req.headers['x-test-actor']);
    if (!identity) return reply.code(401).send({ error: 'unauthorized' });
    req.organization = { id: identity.org, legalName: 'Integration organization' };
    req.user = {
      sub: identity.user,
      org: identity.org,
      email: `${identity.user}@integration.invalid`,
      role: identity.role,
    };
    req.isStaff = identity.isStaff;
  });
  await app.register(errorHandler);
  await app.register(runRoutes);
  await app.register(questionnaireRoutes);
  await app.register(fulfillmentRoutes);
  await app.ready();
  let starter;
  await check('real run route creates owned draft; unpaid submit returns402', async () => {
    starter = await createRun(clientVendor, 'starter');
    const submit = await request('client', 'POST', `/v1/runs/${starter}/submit`, {});
    assert.equal(submit.statusCode, 402);
    assert.equal((await storedRun(starter)).status, 'draft');
  });
  await check('foreign tenant run returns404 and viewer cannot mutate runs', async () => {
    assert.equal((await request('foreign', 'GET', `/v1/runs/${starter}`)).statusCode, 404);
    assert.equal(
      (
        await request('viewer', 'POST', `/v1/vendors/${viewerVendor}/assess`, {
          profile: 'general',
          answers: [],
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (await request('viewer', 'POST', '/v1/runs', { vendorId: viewerVendor, tier: 'starter' }))
        .statusCode,
      403,
    );
  });
  await check('deleted member token labels cannot access restored routes', async () => {
    await pool.query('DELETE FROM users WHERE id=$1', [deleted.user]);
    for (const url of ['/v1/runs', '/v1/questions/intake?profile=general'])
      assert.equal((await request('deleted', 'GET', url)).statusCode, 401);
  });
  let general;
  let ai;
  let question;
  let aiOnly;
  let savedQuestionnaire;
  await check('general and AI catalogues differ and expose exact counts', async () => {
    const g = await request('client', 'GET', '/v1/questions/intake?profile=general');
    const a = await request('client', 'GET', '/v1/questions/intake?profile=ai');
    assert.equal(g.statusCode, 200);
    assert.equal(a.statusCode, 200);
    general = g.json();
    ai = a.json();
    assert.equal(general.questions.length, 25);
    assert.equal(ai.questions.length, 44);
    assert.ok(general.questions.length > 0 && general.questions.length < ai.questions.length);
    assert.ok(general.questions.every((q) => Number(q.dimensionCode.slice(1)) <= 10));
    question = general.questions.find((q) => q.type === 'likert');
    const allowed = new Set(general.questions.map((q) => q.id));
    aiOnly = ai.questions.find((q) => !allowed.has(q.id));
    assert.ok(question && aiOnly);
  });
  await check('general profile rejects AI-only question; duplicate answers rejected', async () => {
    assert.equal(
      (
        await request('client', 'POST', `/v1/vendors/${clientVendor}/assess`, {
          profile: 'general',
          answers: [{ questionId: aiOnly.id, unknown: true }],
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (
        await request('client', 'POST', `/v1/vendors/${clientVendor}/assess`, {
          profile: 'general',
          answers: [
            { questionId: question.id, unknown: true },
            { questionId: question.id, unknown: true },
          ],
        })
      ).statusCode,
      400,
    );
  });
  await check(
    'questionnaire persists unknown with null score and exact profile catalogue count',
    async () => {
      const result = await request('client', 'POST', `/v1/vendors/${clientVendor}/assess`, {
        profile: 'general',
        answers: [{ questionId: question.id, unknown: true }],
        context: { task: 'Test task supplied by buyer', criteria: 'Team and delivery' },
      });
      assert.equal(result.statusCode, 201);
      savedQuestionnaire = result.json().runId;
      const record = await storedRun(savedQuestionnaire);
      assert.equal(record.composite_score, null);
      assert.equal(record.risk_band, null);
      assert.equal(record.report_json.source, 'questionnaire');
      assert.equal(record.report_json.profile, 'general');
      assert.equal(record.report_json.totalCount, general.questions.length);
      assert.equal(record.report_json.unknownCount, 1);
      const response = (
        await pool.query('SELECT numeric_score,raw_answer FROM responses WHERE run_id=$1', [
          savedQuestionnaire,
        ])
      ).rows[0];
      assert.equal(response.numeric_score, null);
      assert.deepEqual(response.raw_answer, { unknown: true });
    },
  );
  await check(
    'new questionnaire version does not overwrite saved unknown or cross tenant',
    async () => {
      const newer = await request('client', 'POST', `/v1/vendors/${clientVendor}/assess`, {
        profile: 'general',
        answers: [{ questionId: question.id, value: 3 }],
      });
      assert.equal(newer.statusCode, 201);
      assert.notEqual(newer.json().runId, savedQuestionnaire);
      const previous = await request(
        'client',
        'GET',
        `/v1/vendors/${clientVendor}/detail?runId=${savedQuestionnaire}`,
      );
      assert.equal(previous.statusCode, 200);
      assert.equal(previous.json().run.reportJson.answers[0].status, 'unknown');
      assert.equal(
        (
          await request(
            'foreign',
            'GET',
            `/v1/vendors/${clientVendor}/detail?runId=${savedQuestionnaire}`,
          )
        ).statusCode,
        404,
      );
    },
  );
  await check('temporary paid-order fixture enables submit without payment call', async () => {
    await pool.query(
      "INSERT INTO billing_orders (organization_id,vendor_id,run_id,tier,stripe_session_id,stripe_payment_intent,status,amount_total,currency) VALUES ($1,$2,$3,'starter',$4,$5,'paid',9900,'eur')",
      [
        client.org,
        clientVendor,
        starter,
        `cs_fixture_${randomUUID()}`,
        `pi_fixture_${randomUUID()}`,
      ],
    );
    const response = await request('client', 'POST', `/v1/runs/${starter}/submit`, {});
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().status, 'queued');
  });
  await check(
    'real Starter domain suite and Chrome PDF deliver once without composite',
    async () => {
      const attempts = await Promise.all([prepareAssessment(starter), prepareAssessment(starter)]);
      assert.equal(attempts.filter((r) => r.claimed).length, 1);
      assert.equal(attempts.find((r) => r.claimed)?.status, 'delivered');
      const record = await storedRun(starter);
      assert.equal(record.status, 'delivered');
      assert.equal(record.composite_score, null);
      assert.equal(record.risk_band, null);
      assert.equal(record.report_json.tests.length, 4);
      assert.equal(record.report_json.source, 'assessment');
      technicalStatuses = record.report_json.tests.map((t) => ({ id: t.id, status: t.status }));
      assert.deepEqual(await prepareAssessment(starter), { claimed: false });
      isPdf(await request('client', 'GET', `/v1/runs/${starter}/report.pdf`));
    },
  );
  const pro = await createRun(clientVendor, 'pro');
  const attempt = randomUUID();
  const pdfKey = `runs/${pro}/attempt-${attempt}.pdf`;
  const draftReport = {
    source: 'assessment',
    attemptToken: attempt,
    pdfKey,
    scope: 'Controlled integration fixture. Draft pending named analyst review.',
    tests: [],
    research: {
      report: 'Controlled test fixture. No real company findings or external verification.',
      sources: [],
      citations: [],
    },
    limitations: [
      'Research is a fixture awaiting analyst review.',
      'Disposable integration data only.',
    ],
    preparedAt: new Date().toISOString(),
    context: {
      task: 'Controlled test review workflow.',
      criteria: 'Verify persistence and reviewer identity',
      country: 'AZ',
      defaulted: false,
    },
  };
  await getStorage().put(
    pdfKey,
    await renderEvidenceReportPdf({
      reportId: `TEST-${pro}`,
      vendor: { legalName: 'Integration fixture only', domain: 'partnerscope.eu', country: 'AZ' },
      ...draftReport,
    }),
    'application/pdf',
  );
  await pool.query("UPDATE runs SET status='analyst_review',report_json=$2::jsonb WHERE id=$1", [
    pro,
    JSON.stringify(draftReport),
  ]);
  await check('draft PDF is restricted: client409, staff preview is realPDF', async () => {
    assert.equal((await request('client', 'GET', `/v1/runs/${pro}/report.pdf`)).statusCode, 409);
    assert.equal(
      (await request('client', 'GET', `/v1/admin/assessments/${pro}/report.pdf`)).statusCode,
      403,
    );
    isPdf(await request('staff', 'GET', `/v1/admin/assessments/${pro}/report.pdf`));
  });
  const review = {
    recommendation: 'This controlled fixture is approved solely for integration workflow testing.',
    conditions: 'Do not treat this fixture as a supplier assessment.',
    confirmed: true,
    analystName: 'Spoofed reviewer name',
  };
  await check('only staff can review and explicit confirmation is required', async () => {
    assert.equal(
      (await request('client', 'POST', `/v1/admin/assessments/${pro}/review`, review)).statusCode,
      403,
    );
    assert.equal(
      (
        await request('staff', 'POST', `/v1/admin/assessments/${pro}/review`, {
          ...review,
          confirmed: false,
        })
      ).statusCode,
      422,
    );
    assert.equal((await storedRun(pro)).status, 'analyst_review');
  });
  await check(
    'staff publishes real final PDF with actual reviewer identity; repeat409',
    async () => {
      const result = await request('staff', 'POST', `/v1/admin/assessments/${pro}/review`, review);
      assert.equal(result.statusCode, 200);
      assert.equal(result.json().status, 'delivered');
      assert.equal(result.json().review.analystName, staff.name);
      const saved = await storedRun(pro);
      assert.equal(saved.report_json.reviewerId, staff.user);
      assert.notEqual(saved.report_json.pdfKey, pdfKey);
      assert.equal(saved.composite_score, null);
      isPdf(await request('client', 'GET', `/v1/runs/${pro}/report.pdf`));
      assert.equal(
        (await request('staff', 'POST', `/v1/admin/assessments/${pro}/review`, review)).statusCode,
        409,
      );
    },
  );
  await check('Enterprise contract scope approval records actual staff identity', async () => {
    const enterprise = await createRun(clientVendor, 'enterprise');
    const approval = {
      contractReference: 'INTEGRATION-ONLY-2026',
      scope: 'Controlled portfolio contract scope for disposable integration testing only.',
      confirmed: true,
      staffUserId: client.user,
    };
    assert.equal(
      (await request('client', 'POST', `/v1/admin/assessments/${enterprise}/scope`, approval))
        .statusCode,
      403,
    );
    const response = await request(
      'staff',
      'POST',
      `/v1/admin/assessments/${enterprise}/scope`,
      approval,
    );
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().reportJson.enterpriseScopeApproved, true);
    assert.equal(response.json().reportJson.scopeApproval.staffUserId, staff.user);
    assert.equal(
      response.json().reportJson.scopeApproval.contractReference,
      approval.contractReference,
    );
  });
  console.log(
    JSON.stringify(
      {
        ok: true,
        database: databaseName,
        checksPassed: checks.length,
        checks,
        questionCounts: { general: general.questions.length, ai: ai.questions.length },
        technicalStatuses,
        providers:
          'Real domain technical checks + real Chrome PDF; no AI, email, Stripe or payments',
        auth: 'Fastify inject test headers with actual temporary database users; not a JWT verification test',
        cleanup: 'Temporary PDF directory removed; drop disposable database after run',
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(
    JSON.stringify({
      ok: false,
      check: currentCheck,
      checksPassed: checks.length,
      error: error?.code ?? error?.name ?? 'integration_failure',
    }),
  );
  process.exitCode = 1;
} finally {
  await app.close();
  await closePdfBrowser();
  await pool.end();
  await appPool.end();
  await rm(storageRoot, { recursive: true, force: true });
}
