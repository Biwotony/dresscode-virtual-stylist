import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, join, resolve, sep } from 'node:path';

export class JobStore {
  constructor(rootDir) {
    this.rootDir = resolve(rootDir);
  }

  async init() {
    await mkdir(this.rootDir, { recursive: true });
  }

  jobDir(id) {
    if (!/^[a-f0-9-]{36}$/i.test(id)) throw new Error('Invalid job id.');
    return join(this.rootDir, id);
  }

  async create(seed) {
    const id = randomUUID();
    const dir = this.jobDir(id);
    await mkdir(dir, { recursive: true });
    const now = new Date().toISOString();
    const job = { id, createdAt: now, updatedAt: now, ...seed };
    await this.save(job);
    return job;
  }

  async read(id) {
    try {
      return JSON.parse(await readFile(join(this.jobDir(id), 'job.json'), 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  async save(job) {
    job.updatedAt = new Date().toISOString();
    const path = join(this.jobDir(job.id), 'job.json');
    const temporary = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(job, null, 2)}\n`);
    await rename(temporary, path);
    return job;
  }

  async writeAsset(id, fileName, buffer) {
    const safeName = basename(fileName);
    await writeFile(join(this.jobDir(id), safeName), buffer);
    return `/api/try-on/assets/${id}/${safeName}`;
  }

  assetPath(id, fileName) {
    const dir = this.jobDir(id);
    const file = resolve(dir, basename(fileName));
    if (!file.startsWith(`${dir}${sep}`)) throw new Error('Invalid asset path.');
    return file;
  }

  async assetExists(id, fileName) {
    try {
      return (await stat(this.assetPath(id, fileName))).isFile();
    } catch (error) {
      if (error.code === 'ENOENT') return false;
      throw error;
    }
  }

  async remove(id) {
    await rm(this.jobDir(id), { recursive: true, force: true });
  }
}

export function publicJob(job) {
  if (!job) return null;
  const clone = structuredClone(job);
  delete clone.internal;
  return clone;
}
