import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
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
    const createdAt = new Date().toISOString();
    const job = { id, createdAt, updatedAt: createdAt, ...seed };
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
    const existing = await this.read(job.id);
    if (existing?.ownerAccountId && !job.ownerAccountId) job.ownerAccountId = existing.ownerAccountId;
    if (existing?.studioId && !job.studioId) job.studioId = existing.studioId;
    job.updatedAt = new Date().toISOString();
    const path = join(this.jobDir(job.id), 'job.json');
    const temporary = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(job, null, 2)}\n`);
    await rename(temporary, path);
    return job;
  }

  async assignOwner(id, accountId, studioId) {
    const job = await this.read(id);
    if (!job) throw Object.assign(new Error('Try-on job not found.'), { statusCode: 404 });
    if (job.ownerAccountId && job.ownerAccountId !== accountId) {
      throw Object.assign(new Error('This try-on job belongs to another account.'), { statusCode: 409 });
    }
    job.ownerAccountId = accountId;
    job.studioId = studioId;
    return this.save(job);
  }

  async assertOwned(id, accountId) {
    const job = await this.read(id);
    if (!job) throw Object.assign(new Error('Try-on job not found.'), { statusCode: 404 });
    if (!job.ownerAccountId || job.ownerAccountId !== accountId) {
      throw Object.assign(new Error('This try-on job does not belong to the signed-in account.'), { statusCode: 403 });
    }
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

  async removeOwned(id, accountId) {
    await this.assertOwned(id, accountId);
    await this.remove(id);
  }

  async claimByConsultationIds(accountId, studioId, consultationIds = []) {
    const allowed = new Set(consultationIds);
    let claimed = 0;
    for (const entry of await readdir(this.rootDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^[a-f0-9-]{36}$/i.test(entry.name)) continue;
      const job = await this.read(entry.name);
      if (!job || job.ownerAccountId) continue;
      const consultationId = job.brief?.consultationId;
      if (!consultationId || !allowed.has(consultationId)) continue;
      job.ownerAccountId = accountId;
      job.studioId = studioId;
      await this.save(job);
      claimed += 1;
    }
    return claimed;
  }

  async removeAccountJobs(accountId) {
    let removed = 0;
    for (const entry of await readdir(this.rootDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^[a-f0-9-]{36}$/i.test(entry.name)) continue;
      const job = await this.read(entry.name);
      if (job?.ownerAccountId !== accountId) continue;
      await this.remove(entry.name);
      removed += 1;
    }
    return removed;
  }
}

export function publicJob(job) {
  if (!job) return null;
  const clone = structuredClone(job);
  delete clone.internal;
  delete clone.ownerAccountId;
  delete clone.studioId;
  return clone;
}
