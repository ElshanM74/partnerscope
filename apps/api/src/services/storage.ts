/**
 * Storage abstraction.
 *
 * Wave 2.A ships a local-disk driver (good for dev + our small Hetzner box).
 * An S3 driver can be added behind the same interface without touching
 * callers — `pdf.ts`, `runs.ts`, etc. all depend on `StorageDriver` only.
 *
 * Keys are path-like strings: "runs/<uuid>/report.pdf". The driver is
 * responsible for namespacing (e.g. prefixing with S3 bucket / local dir).
 */

import { type ReadStream, createReadStream } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { env } from '../config/env.js';

export interface StoredObject {
  key: string;
  sizeBytes: number;
  contentType: string;
  /** Absolute local path OR S3 URL — consumer shouldn't care which. */
  location: string;
}

export interface StorageDriver {
  /** Persist `body` under `key`. Returns the stored object metadata. */
  put(key: string, body: Buffer, contentType: string): Promise<StoredObject>;

  /** Read the full object back as a Buffer. Throws if missing. */
  get(key: string): Promise<Buffer>;

  /** Stream the object (preferred for large PDFs). Throws if missing. */
  stream(key: string): Promise<{ stream: ReadStream; sizeBytes: number; contentType: string }>;

  /** Return a URL suitable for the API to hand back to clients. */
  url(key: string): string;

  /** True if the object exists. Never throws. */
  exists(key: string): Promise<boolean>;
}

// ────────────────────────────────────────────────────────────────
// Local-disk driver
// ────────────────────────────────────────────────────────────────

class LocalFsDriver implements StorageDriver {
  constructor(private readonly rootDir: string) {}

  private absPath(key: string): string {
    // Prevent accidental traversal outside the storage root.
    const safe = path.normalize(key).replace(/^([./\\])+/, '');
    return path.join(this.rootDir, safe);
  }

  private contentTypeFor(key: string): string {
    const ext = path.extname(key).toLowerCase();
    switch (ext) {
      case '.pdf':
        return 'application/pdf';
      case '.json':
        return 'application/json';
      case '.html':
        return 'text/html; charset=utf-8';
      case '.csv':
        return 'text/csv';
      default:
        return 'application/octet-stream';
    }
  }

  async put(key: string, body: Buffer, contentType: string): Promise<StoredObject> {
    const abs = this.absPath(key);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, body);
    return {
      key,
      sizeBytes: body.byteLength,
      contentType,
      location: abs,
    };
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.absPath(key));
  }

  async stream(
    key: string,
  ): Promise<{ stream: ReadStream; sizeBytes: number; contentType: string }> {
    const abs = this.absPath(key);
    const s = await stat(abs);
    return {
      stream: createReadStream(abs),
      sizeBytes: s.size,
      contentType: this.contentTypeFor(key),
    };
  }

  url(key: string): string {
    // The API streams bytes directly from GET /v1/runs/:id/report.pdf, so
    // the "url" we return here is the API path, not a signed-S3-style link.
    return `${env.API_BASE_URL}/v1/storage/${encodeURIComponent(key)}`;
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.absPath(key));
      return true;
    } catch {
      return false;
    }
  }
}

// ────────────────────────────────────────────────────────────────
// Factory
// ────────────────────────────────────────────────────────────────

function resolveRootDir(): string {
  const dir = env.STORAGE_LOCAL_DIR;
  return path.isAbsolute(dir) ? dir : path.resolve(process.cwd(), dir);
}

let _storage: StorageDriver | null = null;

export function getStorage(): StorageDriver {
  if (_storage) return _storage;
  if (env.STORAGE_DRIVER === 's3') {
    // S3 driver intentionally deferred — spec says local-fs first.
    throw new Error('S3 storage driver not implemented yet — set STORAGE_DRIVER=local.');
  }
  _storage = new LocalFsDriver(resolveRootDir());
  return _storage;
}

/** Deterministic key helpers — centralised so callers don't hand-craft paths. */
export const StorageKeys = {
  runReportPdf: (runId: string): string => `runs/${runId}/report.pdf`,
  runReportJson: (runId: string): string => `runs/${runId}/report.json`,
  runReportHtml: (runId: string): string => `runs/${runId}/report.html`,
};
