/**
 * Transactional email service (Resend).
 *
 * In dev (or any environment without RESEND_API_KEY) the service runs in
 * "log-only" mode: it renders the templates and writes the result to the
 * Fastify logger / stdout. Nothing is sent. This keeps tests and local
 * dev cheap while still exercising the full render path.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Handlebars from 'handlebars';
import { Resend } from 'resend';

import { env } from '../../config/env.js';

// ────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────

export interface SendResult {
  id: string | null;
  delivered: boolean;
  dryRun: boolean;
}

export interface Tx02ReportReady {
  to: string;
  buyerName: string;
  tierName: string;
  vendorLegalName: string;
  compositeScore: number;
  riskBand: 'HIGH' | 'MEDIUM' | 'LOW' | 'MINIMAL';
  hardRedFlag: boolean;
  reportPdfUrl: string;
  dashboardUrl: string;
  validUntil: string; // ISO date, 90d after delivery
}

export interface Tx03FreeSnapshot {
  to: string;
  vendorDomain: string;
  snapshotScore: number;
  riskBand: 'HIGH' | 'MEDIUM' | 'LOW' | 'MINIMAL';
  concerns: string[];
  upgradeUrl: string;
}

// ────────────────────────────────────────────────────────────────
// Template loading (cached after first read)
// ────────────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DIR = path.join(__dirname, 'templates');

const compiledCache = new Map<string, HandlebarsTemplateDelegate>();

async function loadTemplate(name: string): Promise<HandlebarsTemplateDelegate> {
  const cached = compiledCache.get(name);
  if (cached) return cached;
  const raw = await readFile(path.join(TEMPLATE_DIR, name), 'utf8');
  const compiled = Handlebars.compile(raw, { noEscape: false });
  compiledCache.set(name, compiled);
  return compiled;
}

// ────────────────────────────────────────────────────────────────
// Resend client (lazy)
// ────────────────────────────────────────────────────────────────

let _resend: Resend | null = null;
function resendClient(): Resend | null {
  if (!env.RESEND_API_KEY) return null;
  if (_resend) return _resend;
  _resend = new Resend(env.RESEND_API_KEY);
  return _resend;
}

// ────────────────────────────────────────────────────────────────
// Low-level send
// ────────────────────────────────────────────────────────────────

interface RawSendInput {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
  tag?: string;
}

async function sendRaw(input: RawSendInput): Promise<SendResult> {
  const client = resendClient();
  if (!client) {
    // Dry-run path — print a terse summary so devs can see what would ship.
    console.info('[email:dry-run]', {
      to: input.to,
      subject: input.subject,
      tag: input.tag,
      textPreview: input.text.slice(0, 160),
    });
    return { id: null, delivered: false, dryRun: true };
  }

  const { data, error } = await client.emails.send({
    from: env.RESEND_FROM_EMAIL,
    to: input.to,
    subject: input.subject,
    html: input.html,
    text: input.text,
    replyTo: input.replyTo ?? env.RESEND_REPLY_TO,
    tags: input.tag ? [{ name: 'type', value: input.tag }] : undefined,
  });

  if (error) {
    throw new Error(`Resend error: ${error.name ?? 'unknown'} — ${error.message ?? ''}`);
  }
  return { id: data?.id ?? null, delivered: true, dryRun: false };
}

// ────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────

export async function sendTx02ReportReady(input: Tx02ReportReady): Promise<SendResult> {
  const [html, text] = await Promise.all([
    loadTemplate('tx02_report_ready.hbs').then((t) => t(input)),
    loadTemplate('tx02_report_ready.txt.hbs').then((t) => t(input)),
  ]);
  return sendRaw({
    to: input.to,
    subject: `Your PartnerScope report is ready — ${input.vendorLegalName}`,
    html,
    text,
    tag: 'tx02_report_ready',
  });
}

export async function sendTx03FreeSnapshot(input: Tx03FreeSnapshot): Promise<SendResult> {
  const [html, text] = await Promise.all([
    loadTemplate('tx03_free_snapshot.hbs').then((t) => t(input)),
    loadTemplate('tx03_free_snapshot.txt.hbs').then((t) => t(input)),
  ]);
  return sendRaw({
    to: input.to,
    subject: `Your 60-second snapshot for ${input.vendorDomain}`,
    html,
    text,
    tag: 'tx03_free_snapshot',
  });
}

/** Test-only — clears template cache so re-reads pick up edited files. */
export function __resetEmailCaches(): void {
  compiledCache.clear();
  _resend = null;
}
