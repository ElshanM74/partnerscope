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
