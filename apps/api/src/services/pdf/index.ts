/**
 * PDF renderer — Puppeteer + Handlebars.
 *
 * Starter report renders HTML → A4 PDF. Headless Chrome is launched per
 * render call for simplicity; for throughput we'd pool a shared browser
 * instance (later wave).
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Handlebars from 'handlebars';
import puppeteer, { type Browser } from 'puppeteer';

import type { ScoringResult } from '@partnerscope/core';

// ────────────────────────────────────────────────────────────────
// Inputs
// ────────────────────────────────────────────────────────────────

export interface StarterReportInput {
  reportId: string;
  issueDate: string; // YYYY-MM-DD
  validUntil: string; // YYYY-MM-DD
  tierName: string; // e.g. "Starter"
  vendor: {
    legalName: string;
    domain: string;
    country?: string | null;
  };
  buyer: {
    name?: string | null;
    company: string;
    email?: string | null;
  };
  scoring: ScoringResult;
  /** Automated tests surfaced in the report (id / status / 1-line finding). */
  tests?: Array<{ id: string; status: 'pass' | 'warn' | 'fail' | 'error'; finding: string }>;
  /** Optional question-level data gaps. */
  dataGaps?: Array<{ questionId: string; dimensionCode: string; upgradeCta: string }>;
  /** CTA URL for "upgrade to Pro". */
  upgradeUrl: string;
}

// ────────────────────────────────────────────────────────────────
// Template loading
// ────────────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = path.join(__dirname, 'templates', 'starter_report.hbs');

let _tpl: HandlebarsTemplateDelegate | null = null;
async function getTemplate(): Promise<HandlebarsTemplateDelegate> {
  if (_tpl) return _tpl;
  const raw = await readFile(TEMPLATE_PATH, 'utf8');
  _tpl = Handlebars.compile(raw);
  return _tpl;
}

// ────────────────────────────────────────────────────────────────
// View-model construction
// ────────────────────────────────────────────────────────────────

const PILLAR_NAMES: Record<'A' | 'B' | 'C', string> = {
  A: 'Behavioral',
  B: 'Financial',
  C: 'AI & Compliance',
};

function verdictFor(scoring: ScoringResult): { label: string; paragraph: string } {
  const s = scoring.compositeScore;
  const hardFlag = scoring.hardRedFlag;

  if (hardFlag) {
    return {
      label: 'DECLINE',
      paragraph:
        'A hard red flag was identified. We recommend declining engagement until the underlying issue is remediated and re-tested.',
    };
  }
  if (s >= 66) {
    return {
      label: 'PROCEED',
      paragraph:
        'The vendor demonstrates acceptable controls across all 13 dimensions. Residual risks, where present, can be addressed in contract language.',
    };
  }
  if (s >= 41) {
    return {
      label: 'PROCEED WITH CONDITIONS',
      paragraph:
        'Moderate risk detected. Proceed only after the buyer-side conditions in the Red flags and Data gaps sections are satisfied or contractually mitigated.',
    };
  }
  return {
    label: 'HOLD',
    paragraph:
      'High residual risk across multiple pillars. Hold commercial engagement until the top-priority remediation items are closed or the vendor is upgraded to a Pro assessment.',
  };
}

function deriveStrengths(scoring: ScoringResult): string[] {
  return [...scoring.dimensionScores]
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((d) => `${d.dimensionName} — score ${d.score}/100 (${d.band})`);
}

function deriveConcerns(scoring: ScoringResult): string[] {
  return [...scoring.dimensionScores]
    .sort((a, b) => a.score - b.score)
    .slice(0, 3)
    .map((d) => `${d.dimensionName} — score ${d.score}/100 (${d.band})`);
}

function deriveExecutiveSummary(scoring: ScoringResult, vendorName: string): string {
  const band = scoring.riskBand;
  const score = scoring.compositeScore;
  const flagClause = scoring.hardRedFlag ? ' A hard red flag was raised during scoring.' : '';
  const capClause = scoring.capReason ? ` ${scoring.capReason}` : '';
  return `${vendorName} received a composite score of ${score}/100 (${band}) across PartnerScope's 13-dimension framework.${flagClause}${capClause} This summary reflects the Starter scope — automated tests + buyer questionnaire — and should be read alongside the data-gaps and red-flags sections.`;
}

function toViewModel(input: StarterReportInput): Record<string, unknown> {
  const dims = input.scoring.dimensionScores.map((d) => ({
    code: d.dimensionCode,
    name: d.dimensionName,
    pillarName: PILLAR_NAMES[d.pillar],
    weight: d.weight,
    score: d.score,
    band: d.band,
  }));

  return {
    reportId: input.reportId,
    issueDate: input.issueDate,
    validUntil: input.validUntil,
    tierName: input.tierName,
    vendor: input.vendor,
    buyer: input.buyer,
    composite: { score: input.scoring.compositeScore, band: input.scoring.riskBand },
    capReason: input.scoring.capReason,
    hardRedFlag: input.scoring.hardRedFlag,
    verdict: verdictFor(input.scoring),
    executiveSummary: deriveExecutiveSummary(input.scoring, input.vendor.legalName),
    strengths: deriveStrengths(input.scoring),
    concerns: deriveConcerns(input.scoring),
    dimensions: dims,
    tests: input.tests ?? [],
    redFlags: input.scoring.redFlags,
    dataGaps: input.dataGaps ?? [],
    upgrade: { url: input.upgradeUrl },
    frameworkVersion: input.scoring.frameworkVersion,
    scoringVersion: input.scoring.scoringVersion,
  };
}

// ────────────────────────────────────────────────────────────────
// HTML render (exposed for tests — no Chromium dependency)
// ────────────────────────────────────────────────────────────────

export async function renderStarterReportHtml(input: StarterReportInput): Promise<string> {
  const tpl = await getTemplate();
  return tpl(toViewModel(input));
}

// ────────────────────────────────────────────────────────────────
// PDF render (Puppeteer)
// ────────────────────────────────────────────────────────────────

let _browser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (_browser?.connected) return _browser;
  _browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  return _browser;
}

export async function closePdfBrowser(): Promise<void> {
  if (_browser) {
    await _browser.close().catch(() => {});
    _browser = null;
  }
}

export async function renderStarterReportPdf(input: StarterReportInput): Promise<Buffer> {
  const html = await renderStarterReportHtml(input);
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30_000 });
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
    });
    return Buffer.from(pdf);
  } finally {
    await page.close().catch(() => {});
  }
}

// ────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────

/** Build the human-readable report id (PS-YYYY-STA-<6-char suffix>). */
export function buildReportId(tier: string, runId: string, year: number): string {
  const tierCode =
    tier === 'free_snapshot' ? 'FSN' : tier === 'starter' ? 'STA' : tier === 'pro' ? 'PRO' : 'ENT';
  const suffix = runId.replace(/-/g, '').slice(0, 6).toUpperCase();
  return `PS-${year}-${tierCode}-${suffix}`;
}

/** Evidence-only output: automated observations and optional named human review. */
export interface EvidenceReportInput {
  scopeApproval?: {
    staffUserId: string;
    contractReference: string;
    scope: string;
    approvedAt: string;
  };
  reportId: string;
  preparedAt: string;
  scope: string;
  context?: { task: string; criteria: string; country: string; defaulted?: boolean };
  vendor: { legalName: string; domain: string; country?: string | null };
  tests: Array<{
    id: string;
    status: string;
    finding: string;
    startedAt: string;
    durationMs: number;
  }>;
  research?: { report: string; sources: Array<{ title: string; url: string }> };
  limitations: string[];
  review?: { analystName: string; recommendation: string; conditions: string; reviewedAt: string };
}

const evidenceTemplate =
  Handlebars.compile(`<!doctype html><html><head><meta charset="utf-8"><style>
@page{size:A4;margin:18mm}body{font:11px Arial,sans-serif;color:#203b30;line-height:1.65}h1{font-size:26px}h2{font-size:16px;margin-top:24px}.meta{color:#627269}.notice{padding:12px;background:#f2f5f2}table{border-collapse:collapse;width:100%;table-layout:fixed}td,th{border-bottom:1px solid #ddd;text-align:left;padding:8px;vertical-align:top;overflow-wrap:anywhere}.prose{white-space:pre-wrap;overflow-wrap:anywhere}a{color:#285b43;overflow-wrap:anywhere}.check{break-inside:avoid}.foot{font-size:9px;color:#627269}
</style></head><body><div class="meta">PARTNERSCOPE · {{reportId}}</div><h1>{{vendor.legalName}}</h1><p>{{vendor.domain}} · {{vendor.country}}</p><p class="meta">Prepared: {{preparedAt}}</p><h2>Scope</h2><p class="prose">{{scope}}</p>
{{#if context}}<h2>Assessment context</h2><p><strong>Country:</strong> {{context.country}}</p><p><strong>Task:</strong></p><div class="prose">{{context.task}}</div><p><strong>Criteria:</strong></p><div class="prose">{{context.criteria}}</div>{{#if context.defaulted}}<p class="notice">Generic supplier-check context was used because the buyer brief was incomplete.</p>{{/if}}{{/if}}
{{#if scopeApproval}}<h2>Agreed Enterprise engagement</h2><p>Contract: {{scopeApproval.contractReference}} · Approved: {{scopeApproval.approvedAt}}</p><div class="prose">{{scopeApproval.scope}}</div><p class="notice">This vendor report is one component of the engagement. Portfolio completion requires separate analyst confirmation against the agreed scope.</p>{{/if}}
{{#if review}}<p class="notice">Reviewed by {{review.analystName}} · {{review.reviewedAt}}</p>{{else}}<p class="notice">Automated observations. No analyst approval or independent confirmation of supplier capability is implied.</p>{{/if}}
<h2>Technical observations</h2>{{#each tests}}<div class="check"><h3>{{id}} · {{status}}</h3><p>{{finding}}</p><p class="meta">Object: {{../vendor.domain}} · Started: {{startedAt}} · Duration: {{durationMs}} ms</p>{{#if isError}}<p>Check could not complete. This is not an adverse finding about the supplier.</p>{{/if}}</div>{{/each}}
{{#if research}}<h2>Public-source research</h2><p class="notice">AI-assisted research; verify material claims against the linked sources.</p><div class="prose">{{research.report}}</div><h3>Sources</h3><ol>{{#each research.sources}}<li><a href="{{url}}">{{title}}</a><br>{{url}}</li>{{/each}}</ol>{{/if}}
{{#if review}}<h2>Analyst recommendation</h2><div class="prose">{{review.recommendation}}</div><h2>Conditions</h2><div class="prose">{{review.conditions}}</div>{{/if}}
<h2>Limitations</h2><ul>{{#each limitations}}<li>{{this}}</li>{{/each}}</ul><p class="foot">This report records observations at the stated times. It does not establish overall supplier reliability, future delivery or absence of undiscovered issues.</p></body></html>`);

export function renderEvidenceReportHtml(input: EvidenceReportInput): string {
  const sources = input.research?.sources.filter((source) => {
    try {
      return ['http:', 'https:'].includes(new URL(source.url).protocol);
    } catch {
      return false;
    }
  });
  return evidenceTemplate({
    ...input,
    tests: input.tests.map((test) => ({ ...test, isError: test.status === 'error' })),
    research: input.research ? { ...input.research, sources } : undefined,
  });
}

export async function renderEvidenceReportPdf(input: EvidenceReportInput): Promise<Buffer> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setJavaScriptEnabled(false);
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      void request.abort();
    });
    await page.setContent(renderEvidenceReportHtml(input), {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    return Buffer.from(
      await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true }),
    );
  } finally {
    await page.close().catch(() => {});
  }
}
