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

export interface Tx04PasswordReset {
  to: string;
  resetUrl: string;
  expiresInMinutes: number;
}

export interface InternalIntakeNotice {
  to: string; // internal inbox (hello@partnerscope.eu)
  replyTo: string; // buyer's email — so a reply goes back to them
  tier: 'starter' | 'pro' | 'enterprise' | 'free_assessment' | 'pilot_application';
  email: string;
  buyerName: string;
  buyerCompany: string;
  vendorDomain: string;
  vendorLegalName?: string;
  notes?: string;
  utm?: { source?: string; medium?: string; campaign?: string };
  submittedAt: string;
}

export interface Tx05IntakeAck {
  to: string; // buyer's email
  buyerName: string;
  buyerCompany: string;
  tier: 'starter' | 'pro' | 'enterprise' | 'free_assessment' | 'pilot_application';
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

export async function sendTx04PasswordReset(input: Tx04PasswordReset): Promise<SendResult> {
  // `email` is just for the greeting copy; the raw token is already baked
  // into `resetUrl` by the caller.
  const vars = { ...input, email: input.to };
  const [html, text] = await Promise.all([
    loadTemplate('tx04_password_reset.hbs').then((t) => t(vars)),
    loadTemplate('tx04_password_reset.txt.hbs').then((t) => t(vars)),
  ]);
  return sendRaw({
    to: input.to,
    subject: 'Reset your PartnerScope password',
    html,
    text,
    tag: 'tx04_password_reset',
  });
}

/**
 * Auto-acknowledge email — sent to the buyer immediately on intake submission,
 * so they have something in their inbox before the human follow-up arrives.
 * Conditional copy per tier handled in the .hbs template via Handlebars #if.
 */
export async function sendTx05IntakeAck(input: Tx05IntakeAck): Promise<SendResult> {
  const tierLabel =
    input.tier === 'starter'
      ? 'Starter assessment'
      : input.tier === 'pro'
        ? 'Pro assessment'
        : input.tier === 'enterprise'
          ? 'Enterprise enquiry'
          : input.tier === 'free_assessment'
            ? 'Free Partner Stack Assessment'
            : 'Pilot Program 2026 application';

  const vars = {
    buyerName: input.buyerName,
    buyerCompany: input.buyerCompany,
    tierLabel,
    isFreeAssessment: input.tier === 'free_assessment',
    isPilotApplication: input.tier === 'pilot_application',
    isPaidTier: input.tier === 'starter' || input.tier === 'pro' || input.tier === 'enterprise',
  };

  const [html, text] = await Promise.all([
    loadTemplate('tx05_intake_ack.hbs').then((t) => t(vars)),
    loadTemplate('tx05_intake_ack.txt.hbs').then((t) => t(vars)),
  ]);

  // Subjects deliberately avoid the word "free" — it triggers spam filters
  // on cold-recipient flows (we hit Gmail spam on first test). Branded prefix
  // ("PartnerScope") improves recipient recognition; reply-to lands in
  // elshan.musayev@partnerscope.eu so threads route to a verifiable inbox
  // rather than the unverified hello@send.partnerscope.eu sending subdomain.
  const subject =
    input.tier === 'free_assessment'
      ? `PartnerScope: your partner-stack assessment request is in — ${input.buyerCompany}`
      : input.tier === 'pilot_application'
        ? `PartnerScope Pilot 2026: application received — ${input.buyerCompany}`
        : `PartnerScope: your ${tierLabel} request is in — ${input.buyerCompany}`;

  return sendRaw({
    to: input.to,
    subject,
    html,
    text,
    replyTo: 'elshan.musayev@partnerscope.eu',
    tag: 'tx05_intake_ack',
  });
}

/**
 * Internal notice — buyer filled out /get-started, a human needs to confirm
 * scope and issue the Stripe payment link. Plain-text + minimal HTML.
 */
export async function sendInternalIntakeNotice(input: InternalIntakeNotice): Promise<SendResult> {
  const tierLabel =
    input.tier === 'starter'
      ? 'Starter (€99)'
      : input.tier === 'pro'
        ? 'Pro (€299)'
        : input.tier === 'enterprise'
          ? 'Enterprise'
          : input.tier === 'free_assessment'
            ? 'Partner Stack Assessment (2-business-day SLA)'
            : 'Pilot Application 2026 (5 DACH slots)';

  const lines = [
    `New PartnerScope scope request — ${tierLabel}`,
    '',
    `Submitted: ${input.submittedAt}`,
    '',
    'Buyer:',
    `  Name:    ${input.buyerName}`,
    `  Email:   ${input.email}`,
    `  Company: ${input.buyerCompany}`,
    '',
    'Vendor:',
    `  Domain:     ${input.vendorDomain}`,
    input.vendorLegalName ? `  Legal name: ${input.vendorLegalName}` : null,
    '',
    input.notes ? `Notes:\n${input.notes}\n` : null,
    input.utm && (input.utm.source || input.utm.medium || input.utm.campaign)
      ? `UTM: source=${input.utm.source ?? ''} medium=${input.utm.medium ?? ''} campaign=${input.utm.campaign ?? ''}`
      : null,
    '',
    'Reply to this email to reach the buyer directly.',
  ].filter((l) => l !== null);

  const text = lines.join('\n');
  const esc = (s: string): string =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const html = [
    `<h2 style="font-family:system-ui,sans-serif">New scope request — ${esc(tierLabel)}</h2>`,
    `<p style="font-family:system-ui,sans-serif;color:#6b7488">Submitted: ${esc(input.submittedAt)}</p>`,
    '<h3 style="font-family:system-ui,sans-serif">Buyer</h3>',
    '<ul style="font-family:system-ui,sans-serif">',
    `<li>Name: <strong>${esc(input.buyerName)}</strong></li>`,
    `<li>Email: <a href="mailto:${esc(input.email)}">${esc(input.email)}</a></li>`,
    `<li>Company: ${esc(input.buyerCompany)}</li>`,
    '</ul>',
    '<h3 style="font-family:system-ui,sans-serif">Vendor</h3>',
    '<ul style="font-family:system-ui,sans-serif">',
    `<li>Domain: <strong>${esc(input.vendorDomain)}</strong></li>`,
    input.vendorLegalName ? `<li>Legal name: ${esc(input.vendorLegalName)}</li>` : '',
    '</ul>',
    input.notes
      ? `<h3 style="font-family:system-ui,sans-serif">Notes</h3><pre style="font-family:system-ui,sans-serif;white-space:pre-wrap">${esc(input.notes)}</pre>`
      : '',
    '<p style="font-family:system-ui,sans-serif;color:#6b7488">Reply to this email to reach the buyer directly.</p>',
  ].join('');

  // Branded prefix instead of "[intake]" — Gmail "Promotions" sometimes
  // de-prioritizes bracketed subjects. "PartnerScope intake" is identifiable
  // by Elshan + scannable in inbox lists.
  return sendRaw({
    to: input.to,
    subject: `PartnerScope intake — ${tierLabel} — ${input.buyerCompany} → ${input.vendorDomain}`,
    html,
    text,
    replyTo: input.replyTo,
    tag: 'internal_intake',
  });
}

/** Test-only — clears template cache so re-reads pick up edited files. */
export function __resetEmailCaches(): void {
  compiledCache.clear();
  _resend = null;
}
