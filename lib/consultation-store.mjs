import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, join, resolve, sep } from 'node:path';

const CONSENT_STATEMENT = "I confirm I have my client's permission to upload and store their photo for this consultation.";

function hash(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function safeHashEqual(left, right) {
  const a = Buffer.from(String(left || ''), 'hex');
  const b = Buffer.from(String(right || ''), 'hex');
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}

function validId(value) {
  return /^[a-f0-9-]{36}$/i.test(String(value || ''));
}

function now() {
  return new Date().toISOString();
}

function publicVersion(version, token = '') {
  const clone = structuredClone(version);
  delete clone.fileName;
  if (token && version.fileName) {
    clone.imageUrl = `/api/consultations/share-assets/${encodeURIComponent(token)}/${encodeURIComponent(version.fileName)}`;
  }
  return clone;
}

export class ConsultationStore {
  constructor(rootDir) {
    this.rootDir = resolve(rootDir);
  }

  async init() {
    await mkdir(join(this.rootDir, 'studios'), { recursive: true });
  }

  studioDir(studioId) {
    if (!validId(studioId)) throw Object.assign(new Error('Invalid studio id.'), { statusCode: 400 });
    return join(this.rootDir, 'studios', studioId);
  }

  clientDir(studioId, clientId) {
    if (!validId(clientId)) throw Object.assign(new Error('Invalid client id.'), { statusCode: 400 });
    return join(this.studioDir(studioId), 'clients', clientId);
  }

  consultationDir(studioId, consultationId) {
    if (!validId(consultationId)) throw Object.assign(new Error('Invalid consultation id.'), { statusCode: 400 });
    return join(this.studioDir(studioId), 'consultations', consultationId);
  }

  async writeJson(path, value) {
    const temporary = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await rename(temporary, path);
    return value;
  }

  async readJson(path) {
    try {
      return JSON.parse(await readFile(path, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  async createStudio(ownerAccountId = '') {
    const id = randomUUID();
    const secret = randomBytes(24).toString('base64url');
    const token = `${id}.${secret}`;
    const createdAt = now();
    const studio = {
      id,
      ownerAccountId: ownerAccountId || null,
      tokenHash: hash(token),
      profile: {
        businessName: 'Dresscode Studio',
        tagline: 'See it before it is sewn',
        phone: '',
        email: '',
        whatsapp: '',
        accentColour: '#7c5cff',
        logoImage: null
      },
      createdAt,
      updatedAt: createdAt
    };
    const dir = this.studioDir(id);
    await Promise.all([
      mkdir(join(dir, 'clients'), { recursive: true }),
      mkdir(join(dir, 'consultations'), { recursive: true })
    ]);
    await this.writeJson(join(dir, 'studio.json'), studio);
    return { token, studio: this.publicStudio(studio) };
  }

  parseStudioToken(token) {
    const [studioId, secret, ...rest] = String(token || '').split('.');
    if (!validId(studioId) || !secret || rest.length) {
      throw Object.assign(new Error('Studio access is missing or invalid.'), { statusCode: 401 });
    }
    return studioId;
  }

  async authenticate(identity) {
    if (typeof identity === 'string') {
      const studioId = this.parseStudioToken(identity);
      const studio = await this.readJson(join(this.studioDir(studioId), 'studio.json'));
      if (!studio || !safeHashEqual(studio.tokenHash, hash(identity))) {
        throw Object.assign(new Error('Studio access is missing or invalid.'), { statusCode: 401 });
      }
      return studio;
    }
    const accountId = identity?.accountId;
    const studioId = identity?.studioId;
    if (!validId(accountId) || !validId(studioId)) {
      throw Object.assign(new Error('A signed-in studio account is required.'), { statusCode: 401 });
    }
    const studio = await this.readJson(join(this.studioDir(studioId), 'studio.json'));
    if (!studio || studio.ownerAccountId !== accountId) {
      throw Object.assign(new Error('This studio does not belong to the signed-in account.'), { statusCode: 403 });
    }
    return studio;
  }

  async claimStudio(token, accountId) {
    if (!validId(accountId)) throw Object.assign(new Error('Invalid account.'), { statusCode: 400 });
    const studio = await this.authenticate(token);
    if (studio.ownerAccountId && studio.ownerAccountId !== accountId) {
      throw Object.assign(new Error('This studio is already linked to another account.'), { statusCode: 409 });
    }
    studio.ownerAccountId = accountId;
    studio.updatedAt = now();
    await this.writeJson(join(this.studioDir(studio.id), 'studio.json'), studio);
    return studio;
  }

  async ensureOwnedStudio(accountId, studioId) {
    return this.authenticate({ accountId, studioId });
  }

  publicStudio(studio) {
    return {
      id: studio.id,
      profile: structuredClone(studio.profile),
      createdAt: studio.createdAt,
      updatedAt: studio.updatedAt
    };
  }

  async updateStudio(identity, profile) {
    const studio = await this.authenticate(identity);
    studio.profile = { ...studio.profile, ...structuredClone(profile) };
    studio.updatedAt = now();
    await this.writeJson(join(this.studioDir(studio.id), 'studio.json'), studio);
    return this.publicStudio(studio);
  }

  async listClients(identity) {
    const studio = await this.authenticate(identity);
    const index = await this.readJson(join(this.studioDir(studio.id), 'clients.json')) || [];
    return index.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  async saveClientIndex(studioId, entry) {
    const path = join(this.studioDir(studioId), 'clients.json');
    const index = await this.readJson(path) || [];
    const next = index.filter(item => item.id !== entry.id);
    next.push(entry);
    await this.writeJson(path, next);
  }

  consentRecord(input, accountId) {
    return {
      confirmed: true,
      version: input.consentVersion || '2026-07-30-account',
      statement: CONSENT_STATEMENT,
      confirmedAt: now(),
      confirmedByAccountId: accountId || null,
      source: 'tailor_attestation'
    };
  }

  validateConsent(input, hasSensitiveData, existing = null) {
    if (!hasSensitiveData) return;
    if (input.consentConfirmed || existing?.consent?.confirmed) return;
    throw Object.assign(new Error('Confirm the client permission checkbox before saving photos or measurements.'), { statusCode: 400 });
  }

  async createClient(identity, input, modelBuffer = null) {
    const studio = await this.authenticate(identity);
    const measurements = structuredClone(input.measurements || {});
    const hasSensitiveData = Boolean(modelBuffer) || Object.keys(measurements).length > 0;
    this.validateConsent(input, hasSensitiveData && typeof identity !== 'string');
    const id = randomUUID();
    const createdAt = now();
    const consent = input.consentConfirmed ? this.consentRecord(input, identity?.accountId || studio.ownerAccountId) : null;
    const client = {
      id,
      studioId: studio.id,
      name: input.name,
      email: input.email || '',
      phone: input.phone || '',
      notes: input.notes || '',
      unit: input.unit || 'cm',
      measurements,
      modelFile: modelBuffer ? 'model.png' : null,
      consent,
      consentHistory: consent ? [consent] : [],
      createdAt,
      updatedAt: createdAt
    };
    const dir = this.clientDir(studio.id, id);
    await mkdir(dir, { recursive: true });
    if (modelBuffer) await writeFile(join(dir, 'model.png'), modelBuffer);
    await this.writeJson(join(dir, 'client.json'), client);
    await this.saveClientIndex(studio.id, this.clientSummary(client));
    return client;
  }

  async getClient(identity, clientId) {
    const studio = await this.authenticate(identity);
    const client = await this.readJson(join(this.clientDir(studio.id, clientId), 'client.json'));
    if (!client) throw Object.assign(new Error('Client not found.'), { statusCode: 404 });
    return client;
  }

  async updateClient(identity, clientId, input, modelBuffer = null) {
    const studio = await this.authenticate(identity);
    const client = await this.getClient(identity, clientId);
    const measurements = structuredClone(input.measurements || {});
    const hasSensitiveData = Boolean(modelBuffer) || Object.keys(measurements).length > 0;
    this.validateConsent(input, hasSensitiveData && typeof identity !== 'string', client);
    const { consentConfirmed, consentVersion, ...fields } = input;
    Object.assign(client, structuredClone(fields), { updatedAt: now() });
    if (modelBuffer) {
      client.modelFile = 'model.png';
      await writeFile(join(this.clientDir(studio.id, clientId), 'model.png'), modelBuffer);
    }
    if (consentConfirmed && (!client.consent?.confirmed || client.consent.version !== consentVersion)) {
      const record = this.consentRecord(input, identity?.accountId || studio.ownerAccountId);
      client.consent = record;
      client.consentHistory = [...(client.consentHistory || []), record];
    }
    await this.writeJson(join(this.clientDir(studio.id, clientId), 'client.json'), client);
    await this.saveClientIndex(studio.id, this.clientSummary(client));
    return client;
  }

  clientSummary(client) {
    return {
      id: client.id,
      name: client.name,
      email: client.email,
      phone: client.phone,
      hasModelPhoto: Boolean(client.modelFile),
      measurementCount: Object.keys(client.measurements || {}).length,
      consentConfirmed: Boolean(client.consent?.confirmed),
      createdAt: client.createdAt,
      updatedAt: client.updatedAt
    };
  }

  async readClientModel(identity, clientId) {
    const studio = await this.authenticate(identity);
    const client = await this.getClient(identity, clientId);
    if (!client.modelFile) return null;
    try {
      return await readFile(join(this.clientDir(studio.id, clientId), client.modelFile));
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  async deleteClient(identity, clientId) {
    const studio = await this.authenticate(identity);
    const consultations = await this.listConsultations(identity);
    if (consultations.some(item => item.clientId === clientId)) {
      throw Object.assign(new Error('Delete this client’s consultations first.'), { statusCode: 409 });
    }
    await rm(this.clientDir(studio.id, clientId), { recursive: true, force: true });
    const path = join(this.studioDir(studio.id), 'clients.json');
    const index = await this.readJson(path) || [];
    await this.writeJson(path, index.filter(item => item.id !== clientId));
  }

  async listConsultations(identity) {
    const studio = await this.authenticate(identity);
    const index = await this.readJson(join(this.studioDir(studio.id), 'consultations.json')) || [];
    return index.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  async consultationIds(identity) {
    return (await this.listConsultations(identity)).map(item => item.id);
  }

  async saveConsultationIndex(studioId, entry) {
    const path = join(this.studioDir(studioId), 'consultations.json');
    const index = await this.readJson(path) || [];
    const next = index.filter(item => item.id !== entry.id);
    next.push(entry);
    await this.writeJson(path, next);
  }

  async createConsultation(identity, input, inspirationBuffer = null) {
    const studio = await this.authenticate(identity);
    const client = await this.getClient(identity, input.clientId);
    const id = randomUUID();
    const createdAt = now();
    const consultation = {
      id,
      studioId: studio.id,
      clientId: client.id,
      title: input.title,
      eventDate: input.eventDate || '',
      notes: input.notes || '',
      brief: structuredClone(input.brief || null),
      inspirationFile: inspirationBuffer ? 'inspiration.png' : null,
      lastJobId: null,
      versions: [],
      approval: { status: 'not_shared', versionId: null, comment: '', decidedAt: null, clientName: '' },
      order: {
        currency: 'KES', quoteAmount: 0, depositAmount: 0, depositMethod: '', depositReference: '',
        depositStatus: 'not_recorded', orderStatus: 'consultation', dueDate: '', notes: ''
      },
      shareHash: null,
      createdAt,
      updatedAt: createdAt
    };
    const dir = this.consultationDir(studio.id, id);
    await mkdir(join(dir, 'versions'), { recursive: true });
    if (inspirationBuffer) await writeFile(join(dir, 'inspiration.png'), inspirationBuffer);
    await this.writeJson(join(dir, 'consultation.json'), consultation);
    await this.saveConsultationIndex(studio.id, this.consultationSummary(consultation, client));
    return consultation;
  }

  async getConsultation(identity, consultationId) {
    const studio = await this.authenticate(identity);
    const consultation = await this.readJson(join(this.consultationDir(studio.id, consultationId), 'consultation.json'));
    if (!consultation) throw Object.assign(new Error('Consultation not found.'), { statusCode: 404 });
    return consultation;
  }

  async updateConsultation(identity, consultationId, input, inspirationBuffer = null) {
    const studio = await this.authenticate(identity);
    const consultation = await this.getConsultation(identity, consultationId);
    if (input.clientId && input.clientId !== consultation.clientId) await this.getClient(identity, input.clientId);
    Object.assign(consultation, structuredClone(input), { updatedAt: now() });
    if (inspirationBuffer) {
      consultation.inspirationFile = 'inspiration.png';
      await writeFile(join(this.consultationDir(studio.id, consultationId), 'inspiration.png'), inspirationBuffer);
    }
    await this.writeJson(join(this.consultationDir(studio.id, consultationId), 'consultation.json'), consultation);
    const client = await this.getClient(identity, consultation.clientId);
    await this.saveConsultationIndex(studio.id, this.consultationSummary(consultation, client));
    return consultation;
  }

  consultationSummary(consultation, client = null) {
    return {
      id: consultation.id,
      clientId: consultation.clientId,
      clientName: client?.name || '',
      title: consultation.title,
      eventDate: consultation.eventDate,
      versionCount: consultation.versions?.length || 0,
      approvalStatus: consultation.approval?.status || 'not_shared',
      orderStatus: consultation.order?.orderStatus || 'consultation',
      createdAt: consultation.createdAt,
      updatedAt: consultation.updatedAt
    };
  }

  async readConsultationInspiration(identity, consultationId) {
    const studio = await this.authenticate(identity);
    const consultation = await this.getConsultation(identity, consultationId);
    if (!consultation.inspirationFile) return null;
    try {
      return await readFile(join(this.consultationDir(studio.id, consultationId), consultation.inspirationFile));
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  async addVersion(identity, consultationId, input, imageBuffer) {
    const studio = await this.authenticate(identity);
    const consultation = await this.getConsultation(identity, consultationId);
    const id = randomUUID();
    const fileName = `version-${String((consultation.versions?.length || 0) + 1).padStart(3, '0')}-${id}.png`;
    await writeFile(join(this.consultationDir(studio.id, consultationId), 'versions', fileName), imageBuffer);
    const version = {
      id,
      number: (consultation.versions?.length || 0) + 1,
      label: input.label || `Version ${(consultation.versions?.length || 0) + 1}`,
      changeSummary: input.changeSummary || '',
      jobId: input.jobId || null,
      brief: structuredClone(input.brief || consultation.brief || null),
      fileName,
      status: 'draft',
      createdAt: now()
    };
    consultation.versions = [...(consultation.versions || []), version];
    consultation.approval = { status: 'draft', versionId: version.id, comment: '', decidedAt: null, clientName: '' };
    consultation.updatedAt = now();
    await this.writeJson(join(this.consultationDir(studio.id, consultationId), 'consultation.json'), consultation);
    const client = await this.getClient(identity, consultation.clientId);
    await this.saveConsultationIndex(studio.id, this.consultationSummary(consultation, client));
    return version;
  }

  async readPrivateVersion(identity, consultationId, versionId) {
    const studio = await this.authenticate(identity);
    const consultation = await this.getConsultation(identity, consultationId);
    const version = consultation.versions?.find(item => item.id === versionId);
    if (!version) throw Object.assign(new Error('Design version not found.'), { statusCode: 404 });
    return readFile(join(this.consultationDir(studio.id, consultationId), 'versions', version.fileName));
  }

  async createShare(identity, consultationId) {
    const studio = await this.authenticate(identity);
    const consultation = await this.getConsultation(identity, consultationId);
    if (!consultation.versions?.length) throw Object.assign(new Error('Save at least one design version before sharing.'), { statusCode: 409 });
    const shareToken = `${studio.id}.${consultation.id}.${randomBytes(24).toString('base64url')}`;
    consultation.shareHash = hash(shareToken);
    consultation.approval = { status: 'pending', versionId: consultation.versions.at(-1).id, comment: '', decidedAt: null, clientName: '' };
    consultation.updatedAt = now();
    await this.writeJson(join(this.consultationDir(studio.id, consultation.id), 'consultation.json'), consultation);
    const client = await this.getClient(identity, consultation.clientId);
    await this.saveConsultationIndex(studio.id, this.consultationSummary(consultation, client));
    return { token: shareToken, consultation };
  }

  parseShareToken(token) {
    const [studioId, consultationId, secret, ...rest] = String(token || '').split('.');
    if (!validId(studioId) || !validId(consultationId) || !secret || rest.length) {
      throw Object.assign(new Error('This approval link is invalid.'), { statusCode: 404 });
    }
    return { studioId, consultationId };
  }

  async sharedRecord(token) {
    const { studioId, consultationId } = this.parseShareToken(token);
    const [studio, consultation] = await Promise.all([
      this.readJson(join(this.studioDir(studioId), 'studio.json')),
      this.readJson(join(this.consultationDir(studioId, consultationId), 'consultation.json'))
    ]);
    if (!studio || !consultation || !safeHashEqual(consultation.shareHash, hash(token))) {
      throw Object.assign(new Error('This approval link is invalid or has expired.'), { statusCode: 404 });
    }
    const client = await this.readJson(join(this.clientDir(studioId, consultation.clientId), 'client.json'));
    if (!client) throw Object.assign(new Error('Client record is unavailable.'), { statusCode: 404 });
    return { studio, consultation, client };
  }

  async publicShare(token) {
    const { studio, consultation, client } = await this.sharedRecord(token);
    return {
      brand: structuredClone(studio.profile),
      client: { name: client.name },
      consultation: {
        id: consultation.id,
        title: consultation.title,
        eventDate: consultation.eventDate,
        brief: consultation.brief ? {
          event: consultation.brief.event || '', garment: consultation.brief.garment || '', fit: consultation.brief.fit || '',
          fabric: consultation.brief.fabric || '', colour: consultation.brief.colour || '', idea: consultation.brief.idea || ''
        } : null,
        approval: structuredClone(consultation.approval),
        order: {
          currency: consultation.order?.currency || 'KES', quoteAmount: consultation.order?.quoteAmount || 0,
          depositAmount: consultation.order?.depositAmount || 0, depositStatus: consultation.order?.depositStatus || 'not_recorded',
          orderStatus: consultation.order?.orderStatus || 'consultation', dueDate: consultation.order?.dueDate || ''
        },
        versions: (consultation.versions || []).map(version => publicVersion(version, token))
      }
    };
  }

  async readSharedAsset(token, fileName) {
    const { studio, consultation } = await this.sharedRecord(token);
    const safeName = basename(fileName);
    const version = consultation.versions?.find(item => item.fileName === safeName);
    if (!version) throw Object.assign(new Error('Shared image not found.'), { statusCode: 404 });
    const root = join(this.consultationDir(studio.id, consultation.id), 'versions');
    const file = resolve(root, safeName);
    if (!file.startsWith(`${root}${sep}`)) throw Object.assign(new Error('Invalid image path.'), { statusCode: 400 });
    try {
      if (!(await stat(file)).isFile()) throw new Error('Not a file.');
      return readFile(file);
    } catch (error) {
      if (error.code === 'ENOENT') throw Object.assign(new Error('Shared image not found.'), { statusCode: 404 });
      throw error;
    }
  }

  async recordDecision(token, input) {
    const { studio, consultation, client } = await this.sharedRecord(token);
    const version = consultation.versions?.find(item => item.id === input.versionId);
    if (!version) throw Object.assign(new Error('Choose a valid design version.'), { statusCode: 400 });
    const status = input.decision === 'approve' ? 'approved' : 'changes_requested';
    consultation.versions = consultation.versions.map(item => ({
      ...item,
      status: item.id === version.id ? status : item.status === 'approved' ? 'superseded' : item.status
    }));
    consultation.approval = {
      status, versionId: version.id, comment: input.comment || '', decidedAt: now(), clientName: input.clientName || client.name
    };
    if (status === 'approved' && consultation.order.orderStatus === 'consultation') consultation.order.orderStatus = 'design_approved';
    consultation.updatedAt = now();
    await this.writeJson(join(this.consultationDir(studio.id, consultation.id), 'consultation.json'), consultation);
    await this.saveConsultationIndex(studio.id, this.consultationSummary(consultation, client));
    return structuredClone(consultation.approval);
  }

  async updateOrder(identity, consultationId, order) {
    const studio = await this.authenticate(identity);
    const consultation = await this.getConsultation(identity, consultationId);
    consultation.order = { ...consultation.order, ...structuredClone(order) };
    consultation.updatedAt = now();
    await this.writeJson(join(this.consultationDir(studio.id, consultationId), 'consultation.json'), consultation);
    const client = await this.getClient(identity, consultation.clientId);
    await this.saveConsultationIndex(studio.id, this.consultationSummary(consultation, client));
    return structuredClone(consultation.order);
  }

  async deleteConsultation(identity, consultationId) {
    const studio = await this.authenticate(identity);
    await this.getConsultation(identity, consultationId);
    await rm(this.consultationDir(studio.id, consultationId), { recursive: true, force: true });
    const path = join(this.studioDir(studio.id), 'consultations.json');
    const index = await this.readJson(path) || [];
    await this.writeJson(path, index.filter(item => item.id !== consultationId));
  }

  async deleteStudio(identity) {
    const studio = await this.authenticate(identity);
    await rm(this.studioDir(studio.id), { recursive: true, force: true });
  }
}

export { CONSENT_STATEMENT };
