import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { ResearchReport } from './index.js';

const uuid = z.string().uuid();
export class ResearchStore {
  constructor(private readonly root: string) {}
  private directory(org: string): string {
    return path.join(this.root, 'research', uuid.parse(org));
  }
  async save(org: string, report: ResearchReport): Promise<void> {
    const dir = this.directory(org);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const target = path.join(dir, `${uuid.parse(report.id)}.json`);
    const temp = `${target}.${randomUUID()}.tmp`;
    await writeFile(temp, JSON.stringify(report), { mode: 0o600 });
    await rename(temp, target);
  }
  async get(org: string, id: string): Promise<ResearchReport | null> {
    try {
      return JSON.parse(
        await readFile(path.join(this.directory(org), `${uuid.parse(id)}.json`), 'utf8'),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }
  async list(org: string): Promise<Pick<ResearchReport, 'id' | 'createdAt' | 'request'>[]> {
    let files: string[];
    try {
      files = await readdir(this.directory(org));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const reports = [];
    for (const file of files.filter((f) => f.endsWith('.json'))) {
      const record = await this.get(org, file.slice(0, -5));
      if (record)
        reports.push({ id: record.id, createdAt: record.createdAt, request: record.request });
    }
    return reports.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100);
  }
}
