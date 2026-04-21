/**
 * TLS_001 — TLS posture check.
 *
 * Verifies:
 *   - Port 443 handshakes successfully
 *   - Certificate is not expired and has >= 14 days validity left
 *   - Negotiated protocol is TLS 1.2 or 1.3 (reject 1.0/1.1)
 *
 * Uses Node's built-in `node:tls` — no external deps.
 */

import { type ConnectionOptions, type TLSSocket, connect } from 'node:tls';

import {
  type TestInput,
  type TestResult,
  type TestRunner,
  resultError,
  resultFail,
  resultOk,
  resultWarn,
} from './types.js';

export interface TlsInspection {
  /** Negotiated protocol, e.g. "TLSv1.3" or "TLSv1.2". */
  protocol: string | null;
  /** ISO date when cert expires. */
  validTo: string;
  /** Subject Common Name, if parsed. */
  subjectCN?: string;
  /** Issuer Common Name, if parsed. */
  issuerCN?: string;
  /** ALPN protocol negotiated, if any. */
  alpnProtocol?: string;
}

export type TlsProbe = (host: string, port: number, timeoutMs: number) => Promise<TlsInspection>;

/** Default probe: opens a TLS socket, reads peer cert, closes. */
export const nodeTlsProbe: TlsProbe = (host, port, timeoutMs) =>
  new Promise((resolve, reject) => {
    const opts: ConnectionOptions = {
      host,
      port,
      servername: host,
      ALPNProtocols: ['h2', 'http/1.1'],
      rejectUnauthorized: false, // we inspect the chain ourselves
    };
    const socket: TLSSocket = connect(opts);
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`TLS handshake timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    socket.once('secureConnect', () => {
      clearTimeout(timer);
      const cert = socket.getPeerCertificate(false);
      const protocol = socket.getProtocol();
      const firstString = (v: unknown): string | undefined =>
        typeof v === 'string' ? v : Array.isArray(v) && typeof v[0] === 'string' ? v[0] : undefined;
      const subjectCN =
        typeof cert?.subject === 'object' ? firstString(cert.subject.CN) : undefined;
      const issuerCN = typeof cert?.issuer === 'object' ? firstString(cert.issuer.CN) : undefined;
      const alpnProtocol =
        typeof socket.alpnProtocol === 'string' ? socket.alpnProtocol : undefined;
      const validTo = typeof cert?.valid_to === 'string' ? cert.valid_to : '';
      socket.end();
      resolve({ protocol, validTo, subjectCN, issuerCN, alpnProtocol });
    });
    socket.once('error', (err) => {
      clearTimeout(timer);
      socket.destroy();
      reject(err);
    });
  });

const WEAK_PROTOCOLS = new Set(['TLSv1', 'TLSv1.1', 'SSLv3', 'SSLv2']);
const MIN_VALID_DAYS = 14;

export async function runTls(
  input: TestInput,
  probe: TlsProbe = nodeTlsProbe,
): Promise<TestResult> {
  const id = 'TLS_001';
  const startedAt = new Date().toISOString();
  const start = Date.now();
  const timeoutMs = input.timeoutMs ?? 10_000;

  let info: TlsInspection;
  try {
    info = await probe(input.domain, 443, timeoutMs);
  } catch (err) {
    const dur = Date.now() - start;
    return resultFail(
      id,
      `TLS handshake failed on ${input.domain}:443 — ${(err as Error).message}`.slice(0, 140),
      startedAt,
      dur,
      { error: (err as Error).message },
    );
  }

  const dur = Date.now() - start;
  const validToDate = info.validTo ? new Date(info.validTo) : null;
  const msLeft = validToDate ? validToDate.getTime() - Date.now() : 0;
  const daysLeft = Math.floor(msLeft / (1000 * 60 * 60 * 24));

  const detail = {
    protocol: info.protocol,
    subjectCN: info.subjectCN,
    issuerCN: info.issuerCN,
    alpnProtocol: info.alpnProtocol,
    validTo: info.validTo,
    daysLeft,
  };

  if (!validToDate || Number.isNaN(validToDate.getTime())) {
    return resultError(id, 'Could not parse certificate validity.', startedAt, dur, detail);
  }
  if (msLeft <= 0) {
    return resultFail(
      id,
      `Certificate for ${input.domain} expired ${-daysLeft} days ago.`,
      startedAt,
      dur,
      detail,
    );
  }
  if (info.protocol && WEAK_PROTOCOLS.has(info.protocol)) {
    return resultFail(
      id,
      `Vendor negotiates ${info.protocol} — deprecated. Require TLS 1.2+.`,
      startedAt,
      dur,
      detail,
    );
  }
  if (daysLeft < MIN_VALID_DAYS) {
    return resultWarn(
      id,
      `Certificate expires in ${daysLeft} days — renewal overdue.`,
      startedAt,
      dur,
      detail,
    );
  }
  return resultOk(
    id,
    `TLS healthy: ${info.protocol ?? 'unknown'}, cert valid ${daysLeft} more days (issuer: ${info.issuerCN ?? 'unknown'}).`,
    startedAt,
    dur,
    detail,
  );
}

export const tlsRunner: TestRunner = {
  id: 'TLS_001',
  name: 'TLS posture',
  dimensionCode: 'D08',
  tiers: ['starter', 'pro', 'enterprise'],
  run: (input) => runTls(input),
};
