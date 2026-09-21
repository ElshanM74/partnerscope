import { DIMENSIONS } from '@partnerscope/core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool } from '../db/client.js';
import {
  intakeQuestions,
  profiles,
  questionnaireCatalogue,
  validateQuestionnaire,
} from '../services/questionnaire.js';

const idSchema = z.object({ id: z.string().uuid() });
const vendorSelect =
  'SELECT id, legal_name AS "legalName", domain, country, industry FROM vendors WHERE id=$1 AND organization_id=$2';
const monitoringSelect =
  'SELECT m.id, m.vendor_id AS "vendorId", v.legal_name AS "vendorName", m.signal_code AS "signalCode", m.severity, m.payload, m.detected_at AS "detectedAt" FROM monitoring_signals m JOIN vendors v ON v.id=m.vendor_id WHERE v.organization_id=$1';

export async function questionnaireRoutes(app: FastifyInstance) {
  app.addHook('preHandler', async (req, reply) => {
    if (!req.organization) return reply.code(401).send({ error: 'unauthorized' });
    const membership = req.user?.sub
      ? await pool.query('SELECT id, role FROM users WHERE id=$1 AND organization_id=$2', [
          req.user.sub,
          req.organization.id,
        ])
      : await pool.query('SELECT id FROM organizations WHERE id=$1', [req.organization.id]);
    if (!membership.rowCount) return reply.code(401).send({ error: 'unauthorized' });
    if (req.method !== 'GET' && membership.rows[0].role === 'viewer')
      return reply.code(403).send({ error: 'read_only_role' });
  });
  app.get('/v1/questions/intake', async (req) => {
    const query = z.object({ profile: profiles.default('ai') }).parse(req.query);
    return questionnaireCatalogue(query.profile);
  });
  app.post('/v1/vendors/:id/assess', async (req, reply) => {
    const parsed = idSchema.safeParse(req.params);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_id' });
    let result: ReturnType<typeof validateQuestionnaire>;
    try {
      result = validateQuestionnaire(req.body);
    } catch {
      return reply.code(400).send({ error: 'invalid_answers' });
    }
    const org = req.organization?.id;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Lock the tenant-owned vendor until its assessment is persisted.
      const vendor = await client.query(`${vendorSelect} FOR KEY SHARE`, [parsed.data.id, org]);
      if (!vendor.rowCount) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'vendor_not_found' });
      }
      if (req.user?.sub) {
        const member = await client.query(
          'SELECT id, role FROM users WHERE id=$1 AND organization_id=$2 FOR KEY SHARE',
          [req.user.sub, org],
        );
        if (!member.rowCount) {
          await client.query('ROLLBACK');
          return reply.code(401).send({ error: 'unauthorized' });
        }
        if (member.rows[0].role === 'viewer') {
          await client.query('ROLLBACK');
          return reply.code(403).send({ error: 'read_only_role' });
        }
      }
      for (const answer of result.supplied) {
        const q = intakeQuestions.find((q) => q.id === answer.questionId);
        if (!q) throw new Error('question_not_found');
        const pillar = DIMENSIONS.find((d) => d.code === q.dimensionCode)?.pillar;
        const cluster =
          pillar === 'A' ? 'behavioral' : pillar === 'B' ? 'financial' : 'ai_compliance';
        const tierMap = { FS: 'free_snapshot', ST: 'starter', PR: 'pro', EN: 'enterprise' };
        await client.query(
          'INSERT INTO questions (id,dimension_code,cluster,tier_gates,question_type,prompt,evidence_hint,scoring_rubric,is_active,framework_version) VALUES ($1,$2,$3,$4::tier_enum[],$5,$6,$7,$8::jsonb,true,$9) ON CONFLICT (id) DO NOTHING',
          [
            q.id,
            q.dimensionCode,
            cluster,
            q.tierGates.map((t) => tierMap[t]),
            q.type,
            q.prompt,
            q.evidenceHint ?? null,
            JSON.stringify(q.rubric),
            '13.0',
          ],
        );
      }
      const run = await client.query(
        "INSERT INTO runs (vendor_id,organization_id,tier,requested_by,status,composite_score,risk_band,report_json,framework_version,started_at,delivered_at) VALUES ($1,$2,'pro',$3,'delivered',NULL,NULL,$4::jsonb,'13.0',now(),now()) RETURNING id",
        [parsed.data.id, org, req.user?.sub ?? null, JSON.stringify(result.report)],
      );
      const runId = run.rows[0].id;
      for (const answer of result.supplied)
        await client.query(
          'INSERT INTO responses (run_id,question_id,raw_answer,numeric_score) VALUES ($1,$2,$3::jsonb,NULL)',
          [runId, answer.questionId, JSON.stringify(answer.rawAnswer)],
        );
      await client.query('COMMIT');
      return reply.code(201).send({ runId });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  });
  app.get('/v1/vendors/:id/detail', async (req, reply) => {
    const params = idSchema.safeParse(req.params);
    const query = z.object({ runId: z.string().uuid().optional() }).safeParse(req.query);
    if (!params.success || !query.success) return reply.code(400).send({ error: 'invalid_id' });
    const id = params.data.id;
    const org = req.organization?.id;
    const vendor = (await pool.query(vendorSelect, [id, org])).rows[0];
    if (!vendor) return reply.code(404).send({ error: 'vendor_not_found' });
    const run =
      (
        await pool.query(
          'SELECT id,tier,status,composite_score AS "compositeScore",risk_band AS "riskBand",hard_red_flag AS "hardRedFlag",cap_reason AS "capReason",delivered_at AS "deliveredAt",created_at AS "createdAt",report_json AS "reportJson" FROM runs WHERE vendor_id=$1 AND organization_id=$2 AND ($3::uuid IS NULL OR id=$3) ORDER BY created_at DESC LIMIT 1',
          [id, org, query.data.runId ?? null],
        )
      ).rows[0] ?? null;
    if (query.data.runId && !run) return reply.code(404).send({ error: 'run_not_found' });
    const monitoring = (
      await pool.query(
        `${monitoringSelect} AND m.vendor_id=$2 ORDER BY m.detected_at DESC LIMIT 100`,
        [org, id],
      )
    ).rows;
    if (!run) return { vendor, run: null, dimensions: [], redteam: [], evidence: [], monitoring };
    const [dims, redteam, evidence] = await Promise.all([
      pool.query(
        'SELECT dimension_code AS code,score,band,findings FROM dimension_scores WHERE run_id=$1 ORDER BY dimension_code',
        [run.id],
      ),
      pool.query(
        'SELECT payload_id AS "payloadId",category,sub_type AS "subType",outcome,severity,evidence_sanitized AS evidence FROM redteam_results WHERE run_id=$1',
        [run.id],
      ),
      pool.query(
        'SELECT id,doc_type AS "docType",filename,dimension_code AS "dimensionCode",status,reviewer_notes AS "reviewerNotes" FROM evidence_documents WHERE run_id=$1',
        [run.id],
      ),
    ]);
    return {
      vendor,
      run,
      dimensions: dims.rows.map((d) => ({
        ...d,
        label: DIMENSIONS.find((x) => x.code === d.code)?.name ?? d.code,
        findings: d.findings ?? [],
      })),
      redteam: redteam.rows,
      evidence: evidence.rows,
      monitoring,
    };
  });
  app.get('/v1/monitoring/feed', async (req) => ({
    data: (
      await pool.query(`${monitoringSelect} ORDER BY m.detected_at DESC LIMIT 50`, [
        req.organization?.id,
      ])
    ).rows,
  }));
}
