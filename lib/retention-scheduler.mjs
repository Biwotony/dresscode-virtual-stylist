import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const dataRoot = resolve(projectRoot, process.env.DRESSCODE_DATA_DIR || '.dresscode');
const retentionDays = Math.max(1, Number.parseInt(process.env.DRESSCODE_RETENTION_DAYS || '7', 10) || 7);
const sweepIntervalMs = 6 * 60 * 60 * 1000;

function cutoffTime() {
  return Date.now() - retentionDays * 24 * 60 * 60 * 1000;
}

function isExpired(value, cutoff) {
  const time = Date.parse(value || '');
  return Number.isFinite(time) && time <= cutoff;
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function writeJson(path, value) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporary, path);
}

async function directories(path) {
  try {
    return (await readdir(path, { withFileTypes: true }))
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function purgeJobs(cutoff) {
  const jobsRoot = join(dataRoot, 'jobs');
  let removed = 0;
  for (const jobId of await directories(jobsRoot)) {
    const dir = join(jobsRoot, jobId);
    const job = await readJson(join(dir, 'job.json'));
    if (!job || !isExpired(job.updatedAt || job.createdAt, cutoff)) continue;
    await rm(dir, { recursive: true, force: true });
    removed += 1;
  }
  return removed;
}

function clearMeasurements(brief) {
  if (!brief || typeof brief !== 'object' || Array.isArray(brief)) return brief;
  const clone = structuredClone(brief);
  if ('measurements' in clone) clone.measurements = {};
  return clone;
}

async function purgeStudio(studioId, cutoff) {
  const studioRoot = join(dataRoot, 'consultations', 'studios', studioId);
  const clientsRoot = join(studioRoot, 'clients');
  const consultationsRoot = join(studioRoot, 'consultations');
  let clientsPurged = 0;
  let consultationsPurged = 0;

  const clientIndexPath = join(studioRoot, 'clients.json');
  const clientIndex = await readJson(clientIndexPath) || [];
  const clientIndexById = new Map(clientIndex.map(entry => [entry.id, entry]));

  for (const clientId of await directories(clientsRoot)) {
    const dir = join(clientsRoot, clientId);
    const path = join(dir, 'client.json');
    const client = await readJson(path);
    if (!client || !isExpired(client.updatedAt || client.createdAt, cutoff)) continue;

    const hadSensitiveData = Boolean(client.modelFile) || Object.keys(client.measurements || {}).length > 0;
    if (!hadSensitiveData) continue;

    if (client.modelFile) await rm(join(dir, client.modelFile), { force: true });
    client.modelFile = null;
    client.measurements = {};
    client.privacyPurgedAt = new Date().toISOString();
    await writeJson(path, client);

    const summary = clientIndexById.get(clientId);
    if (summary) {
      summary.hasModelPhoto = false;
      summary.measurementCount = 0;
      summary.privacyPurgedAt = client.privacyPurgedAt;
    }
    clientsPurged += 1;
  }

  if (clientIndex.length) await writeJson(clientIndexPath, [...clientIndexById.values()]);

  const consultationIndexPath = join(studioRoot, 'consultations.json');
  const consultationIndex = await readJson(consultationIndexPath) || [];
  const consultationIndexById = new Map(consultationIndex.map(entry => [entry.id, entry]));

  for (const consultationId of await directories(consultationsRoot)) {
    const dir = join(consultationsRoot, consultationId);
    const path = join(dir, 'consultation.json');
    const consultation = await readJson(path);
    if (!consultation || !isExpired(consultation.updatedAt || consultation.createdAt, cutoff)) continue;

    const hadSensitiveData = Boolean(consultation.inspirationFile)
      || Boolean(consultation.versions?.length)
      || Boolean(consultation.lastJobId)
      || Boolean(consultation.brief?.measurements && Object.keys(consultation.brief.measurements).length);
    if (!hadSensitiveData) continue;

    if (consultation.inspirationFile) await rm(join(dir, consultation.inspirationFile), { force: true });
    await rm(join(dir, 'versions'), { recursive: true, force: true });
    await mkdir(join(dir, 'versions'), { recursive: true });

    consultation.inspirationFile = null;
    consultation.versions = [];
    consultation.lastJobId = null;
    consultation.shareHash = null;
    consultation.brief = clearMeasurements(consultation.brief);
    consultation.approval = {
      status: 'not_shared',
      versionId: null,
      comment: '',
      decidedAt: null,
      clientName: ''
    };
    consultation.privacyPurgedAt = new Date().toISOString();
    await writeJson(path, consultation);

    const summary = consultationIndexById.get(consultationId);
    if (summary) {
      summary.versionCount = 0;
      summary.approvalStatus = 'not_shared';
      summary.privacyPurgedAt = consultation.privacyPurgedAt;
    }
    consultationsPurged += 1;
  }

  if (consultationIndex.length) await writeJson(consultationIndexPath, [...consultationIndexById.values()]);
  return { clientsPurged, consultationsPurged };
}

async function purgeConsultations(cutoff) {
  const studiosRoot = join(dataRoot, 'consultations', 'studios');
  let clientsPurged = 0;
  let consultationsPurged = 0;
  for (const studioId of await directories(studiosRoot)) {
    const result = await purgeStudio(studioId, cutoff);
    clientsPurged += result.clientsPurged;
    consultationsPurged += result.consultationsPurged;
  }
  return { clientsPurged, consultationsPurged };
}

export async function runRetentionSweep() {
  const cutoff = cutoffTime();
  const [jobsRemoved, consultationResult] = await Promise.all([
    purgeJobs(cutoff),
    purgeConsultations(cutoff)
  ]);
  const total = jobsRemoved + consultationResult.clientsPurged + consultationResult.consultationsPurged;
  if (total > 0) {
    console.log(`Privacy retention sweep: removed ${jobsRemoved} expired jobs; purged ${consultationResult.clientsPurged} client records and ${consultationResult.consultationsPurged} consultations.`);
  }
  return { retentionDays, jobsRemoved, ...consultationResult };
}

runRetentionSweep().catch(error => {
  console.error('Privacy retention sweep failed:', error.message);
});

const timer = setInterval(() => {
  runRetentionSweep().catch(error => {
    console.error('Privacy retention sweep failed:', error.message);
  });
}, sweepIntervalMs);

timer.unref?.();
