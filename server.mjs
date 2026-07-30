import { randomUUID } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AuthStore } from './lib/auth-store.mjs';
import { ConsultationStore } from './lib/consultation-store.mjs';
import { decodeImageDataUrl, normalisePng } from './lib/image-utils.mjs';
import { JobStore, publicJob } from './lib/job-store.mjs';
import { PaymentStore } from './lib/payment-store.mjs';
import { PaystackPayments } from './lib/paystack-payments.mjs';
import { TryOnPipeline } from './lib/tryon-pipeline.mjs';

const rootDir = resolve(fileURLToPath(new URL('.', import.meta.url)));

async function loadLocalEnv(filePath) {
  try {
    const source = await readFile(filePath, 'utf8');
    for (const rawLine of source.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const separator = line.indexOf('=');
      if (separator < 1) continue;
      const key = line.slice(0, separator).trim();
      let value = line.slice(separator + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

await loadLocalEnv(join(rootDir, '.env'));
const publicDir = join(rootDir, 'public');
const runtimeDir = resolve(rootDir, process.env.DRESSCODE_DATA_DIR || '.dresscode');
const port = Number.parseInt(process.env.PORT || '4173', 10);
const maxBodyBytes = 22 * 1024 * 1024;
const store = new JobStore(join(runtimeDir, 'jobs'));
const paymentStore = new PaymentStore(join(runtimeDir, 'payments'));
const consultationStore = new ConsultationStore(join(runtimeDir, 'consultations'));
const authStore = new AuthStore(join(runtimeDir, 'auth'));
await Promise.all([store.init(), paymentStore.init(), consultationStore.init(), authStore.init()]);
const pipeline = new TryOnPipeline({ store });
const payments = new PaystackPayments({ store: paymentStore });

const mimeTypes = {
  '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg', '.jpg': 'image/jpeg', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml; charset=utf-8', '.webp': 'image/webp'
};

function allowedOrigins() {
  return (process.env.CORS_ORIGIN || '').split(',').map(value => value.trim()).filter(Boolean);
}

function applyCors(request, response) {
  const origin = request.headers.origin;
  const allowList = allowedOrigins();
  if (origin && (allowList.includes('*') || allowList.includes(origin))) {
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Vary', 'Origin');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  }
}

function securityHeaders(response) {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
}

function sendJson(request, response, statusCode, payload) {
  applyCors(request, response);
  securityHeaders(response);
  response.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(payload));
}

function sendPng(request, response, buffer, cacheControl = 'private, no-store') {
  applyCors(request, response);
  securityHeaders(response);
  response.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': cacheControl });
  response.end(buffer);
}

async function readRawBody(request) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > maxBodyBytes) throw Object.assign(new Error('Request body is too large.'), { statusCode: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJsonBody(request) {
  const raw = await readRawBody(request);
  if (!raw.length) return {};
  try {
    return JSON.parse(raw.toString('utf8'));
  } catch {
    throw Object.assign(new Error('Request body must be valid JSON.'), { statusCode: 400 });
  }
}

function cleanText(value, maxLength = 500) {
  return String(value || '').trim().slice(0, maxLength);
}

function cleanEmail(value) {
  const email = cleanText(value, 160).toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw Object.assign(new Error('Enter a valid email address.'), { statusCode: 400 });
  return email;
}

function cleanColour(value) {
  const colour = cleanText(value, 7).toLowerCase();
  return /^#[0-9a-f]{6}$/.test(colour) ? colour : '#7c5cff';
}

function cleanMoney(value) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount) || amount < 0 || amount > 100_000_000) throw Object.assign(new Error('Enter a valid non-negative amount.'), { statusCode: 400 });
  return Math.round(amount * 100) / 100;
}

function cleanMeasurements(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    const number = Number(item?.value);
    const unit = item?.unit === 'in' ? 'in' : 'cm';
    if (!Number.isFinite(number) || number <= 0 || number > 400) continue;
    result[cleanText(key, 40)] = { label: cleanText(item?.label, 80), value: Math.round(number * 10) / 10, unit };
  }
  return result;
}

async function optionalImage(dataUrl) {
  if (!dataUrl) return null;
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) throw Object.assign(new Error('The uploaded image is invalid.'), { statusCode: 400 });
  try {
    return await normalisePng(decodeImageDataUrl(dataUrl).buffer);
  } catch {
    throw Object.assign(new Error('The uploaded image could not be processed.'), { statusCode: 400 });
  }
}

function sanitizeProfile(input = {}) {
  return {
    businessName: cleanText(input.businessName, 100) || 'Dresscode Studio', tagline: cleanText(input.tagline, 160),
    phone: cleanText(input.phone, 50), email: cleanEmail(input.email), whatsapp: cleanText(input.whatsapp, 50),
    accentColour: cleanColour(input.accentColour),
    logoImage: typeof input.logoImage === 'string' && input.logoImage.startsWith('data:image/') && input.logoImage.length <= 1_500_000 ? input.logoImage : null
  };
}

function sanitizeClient(input = {}) {
  const name = cleanText(input.name, 120);
  if (!name) throw Object.assign(new Error('Client name is required.'), { statusCode: 400 });
  return {
    name, email: cleanEmail(input.email), phone: cleanText(input.phone, 50), notes: cleanText(input.notes, 1500),
    unit: input.unit === 'in' ? 'in' : 'cm', measurements: cleanMeasurements(input.measurements),
    consentConfirmed: input.consentConfirmed === true, consentVersion: cleanText(input.consentVersion, 80) || '2026-07-30-account'
  };
}

function sanitizeConsultation(input = {}) {
  const title = cleanText(input.title, 160);
  if (!title) throw Object.assign(new Error('Consultation title is required.'), { statusCode: 400 });
  return {
    clientId: cleanText(input.clientId, 36), title, eventDate: cleanText(input.eventDate, 20), notes: cleanText(input.notes, 2000),
    brief: input.brief && typeof input.brief === 'object' ? structuredClone(input.brief) : null,
    lastJobId: cleanText(input.lastJobId, 36) || null
  };
}

function sanitizeOrder(input = {}) {
  const allowedDeposit = new Set(['not_recorded', 'pending', 'paid', 'refunded']);
  const allowedOrder = new Set(['consultation', 'design_approved', 'deposit_received', 'in_production', 'ready', 'completed', 'cancelled']);
  return {
    currency: 'KES', quoteAmount: cleanMoney(input.quoteAmount), depositAmount: cleanMoney(input.depositAmount),
    depositMethod: cleanText(input.depositMethod, 60), depositReference: cleanText(input.depositReference, 120),
    depositStatus: allowedDeposit.has(input.depositStatus) ? input.depositStatus : 'not_recorded',
    orderStatus: allowedOrder.has(input.orderStatus) ? input.orderStatus : 'consultation',
    dueDate: cleanText(input.dueDate, 20), notes: cleanText(input.notes, 1500)
  };
}

function validateCreateJob(payload) {
  if (!payload || typeof payload !== 'object') return 'A request payload is required.';
  if (typeof payload.modelImage !== 'string' || !payload.modelImage.startsWith('data:image/')) return 'A model image is required.';
  if (payload.inspirationImage && (typeof payload.inspirationImage !== 'string' || !payload.inspirationImage.startsWith('data:image/'))) return 'The inspiration image is invalid.';
  if (!payload.brief || typeof payload.brief !== 'object') return 'A styling brief is required.';
  const variationCount = Number(payload.variationCount);
  if (!Number.isInteger(variationCount) || variationCount < 1 || variationCount > 3) return 'variationCount must be an integer between 1 and 3.';
  return null;
}

function imageDataUrl(buffer) {
  return buffer ? `data:image/png;base64,${buffer.toString('base64')}` : null;
}

function clientIp(request) {
  return cleanText(String(request.headers['x-forwarded-for'] || request.socket?.remoteAddress || '').split(',')[0], 100);
}

async function requireAccount(request) {
  return (await authStore.authenticateRequest(request)).account;
}

function identity(account) {
  return { accountId: account.id, studioId: account.studioId };
}

async function provisionAccount(account, input = {}) {
  const legacyStudioToken = cleanText(input.legacyStudioToken, 240);
  const legacyWalletToken = cleanText(input.legacyWalletToken, 300);

  if (account.studioId) {
    await consultationStore.ensureOwnedStudio(account.id, account.studioId);
  } else if (legacyStudioToken) {
    const studio = await consultationStore.claimStudio(legacyStudioToken, account.id);
    account.studioId = studio.id;
  } else {
    const created = await consultationStore.createStudio(account.id);
    account.studioId = created.studio.id;
  }

  const emailWalletId = await paymentStore.accountWalletId(account.email);
  if (account.walletId) {
    await paymentStore.claimWalletById(account.walletId, account.id, account.email);
    if (legacyWalletToken) await paymentStore.mergeLegacyWallet(legacyWalletToken, account.walletId, account.id, account.email);
  } else if (emailWalletId) {
    await paymentStore.claimWalletById(emailWalletId, account.id, account.email);
    account.walletId = emailWalletId;
    if (legacyWalletToken) await paymentStore.mergeLegacyWallet(legacyWalletToken, account.walletId, account.id, account.email);
  } else if (legacyWalletToken) {
    const wallet = await paymentStore.claimWallet(legacyWalletToken, account.id, account.email);
    account.walletId = wallet.id;
  } else {
    const created = await paymentStore.createWallet({ ownerAccountId: account.id, email: account.email });
    account.walletId = created.wallet.id;
  }

  const consultationIds = await consultationStore.consultationIds(identity(account));
  await store.claimByConsultationIds(account.id, account.studioId, consultationIds);
  return account;
}

async function hydratedClient(account, client) {
  return { ...client, modelImage: imageDataUrl(await consultationStore.readClientModel(identity(account), client.id)) };
}

async function hydratedConsultation(account, consultation) {
  const accountIdentity = identity(account);
  const [inspiration, versions] = await Promise.all([
    consultationStore.readConsultationInspiration(accountIdentity, consultation.id),
    Promise.all((consultation.versions || []).map(async version => ({
      ...version,
      imageDataUrl: imageDataUrl(await consultationStore.readPrivateVersion(accountIdentity, consultation.id, version.id))
    })))
  ]);
  const clone = structuredClone(consultation);
  delete clone.shareHash;
  return { ...clone, inspirationImage: imageDataUrl(inspiration), versions };
}

function signedJob(job, accountId) {
  const clone = publicJob(job);
  for (const stage of Object.values(clone.stages || {})) {
    for (const asset of stage.assets || []) {
      if (asset?.url?.startsWith('/api/try-on/assets/')) asset.url = authStore.signAssetUrl(accountId, asset.url);
    }
  }
  return clone;
}

async function handleAuthApi(request, response, url) {
  if (request.method === 'GET' && url.pathname === '/api/auth/config') {
    sendJson(request, response, 200, authStore.config);
    return true;
  }
  if (request.method === 'POST' && url.pathname === '/api/auth/magic-links') {
    const input = await readJsonBody(request);
    const result = await authStore.requestMagicLink(input.email, { ip: clientIp(request) });
    sendJson(request, response, 202, { sent: true, debugLink: result.debugLink });
    return true;
  }
  if (request.method === 'POST' && url.pathname === '/api/auth/sessions') {
    const input = await readJsonBody(request);
    const result = await authStore.consumeMagicLink(
      cleanText(input.token, 300),
      account => provisionAccount(account, input),
      { ip: clientIp(request), userAgent: request.headers['user-agent'] }
    );
    sendJson(request, response, 201, { token: result.token, account: result.account });
    return true;
  }
  if (request.method === 'GET' && url.pathname === '/api/auth/session') {
    const authenticated = await authStore.authenticateRequest(request);
    sendJson(request, response, 200, { account: authStore.publicAccount(authenticated.account), session: { expiresAt: authenticated.session.expiresAt } });
    return true;
  }
  if (request.method === 'DELETE' && url.pathname === '/api/auth/session') {
    await authStore.revokeSession(authStore.bearerToken(request));
    sendJson(request, response, 200, { signedOut: true });
    return true;
  }
  if (request.method === 'POST' && url.pathname === '/api/auth/logout-all') {
    const account = await requireAccount(request);
    const revoked = await authStore.revokeAllSessions(account.id);
    sendJson(request, response, 200, { signedOut: true, revoked });
    return true;
  }
  if (request.method === 'DELETE' && url.pathname === '/api/auth/account') {
    const account = await requireAccount(request);
    const input = await readJsonBody(request);
    if (input.confirmation !== 'DELETE') throw Object.assign(new Error('Type DELETE to confirm permanent account deletion.'), { statusCode: 400 });
    await Promise.all([
      store.removeAccountJobs(account.id),
      consultationStore.deleteStudio(identity(account)),
      paymentStore.deleteAccountData(account)
    ]);
    await authStore.deleteAccountRecord(account.id);
    sendJson(request, response, 200, { deleted: true });
    return true;
  }
  return false;
}

async function handlePaymentApi(request, response, url) {
  if (request.method === 'GET' && url.pathname === '/api/payments/config') {
    sendJson(request, response, 200, payments.config);
    return true;
  }
  if (request.method === 'POST' && url.pathname === '/api/payments/webhook') {
    const rawBody = await readRawBody(request);
    const result = await payments.handleWebhook(rawBody, request.headers['x-paystack-signature']);
    sendJson(request, response, 200, result);
    return true;
  }
  if (!url.pathname.startsWith('/api/payments/')) return false;
  const account = await requireAccount(request);
  if (request.method === 'GET' && url.pathname === '/api/payments/wallet') {
    sendJson(request, response, 200, await paymentStore.getWalletForAccount(account));
    return true;
  }
  if (request.method === 'POST' && url.pathname === '/api/payments/initialize') {
    const input = await readJsonBody(request);
    sendJson(request, response, 200, await payments.initialize({ account, email: input.email, planId: input.planId }));
    return true;
  }
  const verifyMatch = url.pathname.match(/^\/api\/payments\/verify\/([A-Za-z0-9.=-]+)$/);
  if (request.method === 'GET' && verifyMatch) {
    sendJson(request, response, 200, await payments.verify({ account, reference: verifyMatch[1] }));
    return true;
  }
  if (request.method === 'POST' && url.pathname === '/api/payments/wallets') {
    throw Object.assign(new Error('Guest wallets have been replaced by signed-in accounts.'), { statusCode: 410 });
  }
  return false;
}

async function handleConsultationApi(request, response, url) {
  const shareAssetMatch = url.pathname.match(/^\/api\/consultations\/share-assets\/([^/]+)\/([^/]+)$/);
  if (request.method === 'GET' && shareAssetMatch) {
    sendPng(request, response, await consultationStore.readSharedAsset(decodeURIComponent(shareAssetMatch[1]), decodeURIComponent(shareAssetMatch[2])), 'private, max-age=300');
    return true;
  }
  const shareMatch = url.pathname.match(/^\/api\/consultations\/share\/([^/]+)(?:\/decision)?$/);
  if (shareMatch) {
    const token = decodeURIComponent(shareMatch[1]);
    if (request.method === 'GET' && !url.pathname.endsWith('/decision')) {
      sendJson(request, response, 200, await consultationStore.publicShare(token));
      return true;
    }
    if (request.method === 'POST' && url.pathname.endsWith('/decision')) {
      const input = await readJsonBody(request);
      if (!['approve', 'request_changes'].includes(input.decision)) throw Object.assign(new Error('Choose approve or request changes.'), { statusCode: 400 });
      const decision = await consultationStore.recordDecision(token, {
        decision: input.decision, versionId: cleanText(input.versionId, 36), comment: cleanText(input.comment, 1500), clientName: cleanText(input.clientName, 120)
      });
      sendJson(request, response, 200, { approval: decision });
      return true;
    }
  }
  if (!url.pathname.startsWith('/api/consultations')) return false;
  const account = await requireAccount(request);
  const accountIdentity = identity(account);

  if (request.method === 'POST' && url.pathname === '/api/consultations/studios') throw Object.assign(new Error('The studio is created automatically with your account.'), { statusCode: 410 });
  if (request.method === 'GET' && url.pathname === '/api/consultations/studio') {
    sendJson(request, response, 200, consultationStore.publicStudio(await consultationStore.authenticate(accountIdentity)));
    return true;
  }
  if (request.method === 'PATCH' && url.pathname === '/api/consultations/studio') {
    sendJson(request, response, 200, await consultationStore.updateStudio(accountIdentity, sanitizeProfile(await readJsonBody(request))));
    return true;
  }
  if (url.pathname === '/api/consultations/clients') {
    if (request.method === 'GET') {
      sendJson(request, response, 200, { clients: await consultationStore.listClients(accountIdentity) });
      return true;
    }
    if (request.method === 'POST') {
      const input = await readJsonBody(request);
      const client = await consultationStore.createClient(accountIdentity, sanitizeClient(input), await optionalImage(input.modelImage));
      sendJson(request, response, 201, await hydratedClient(account, client));
      return true;
    }
  }
  const clientMatch = url.pathname.match(/^\/api\/consultations\/clients\/([a-f0-9-]{36})$/i);
  if (clientMatch) {
    if (request.method === 'GET') {
      sendJson(request, response, 200, await hydratedClient(account, await consultationStore.getClient(accountIdentity, clientMatch[1])));
      return true;
    }
    if (request.method === 'PATCH') {
      const input = await readJsonBody(request);
      const client = await consultationStore.updateClient(accountIdentity, clientMatch[1], sanitizeClient(input), await optionalImage(input.modelImage));
      sendJson(request, response, 200, await hydratedClient(account, client));
      return true;
    }
    if (request.method === 'DELETE') {
      await consultationStore.deleteClient(accountIdentity, clientMatch[1]);
      sendJson(request, response, 200, { deleted: true });
      return true;
    }
  }
  if (url.pathname === '/api/consultations') {
    if (request.method === 'GET') {
      sendJson(request, response, 200, { consultations: await consultationStore.listConsultations(accountIdentity) });
      return true;
    }
    if (request.method === 'POST') {
      const input = await readJsonBody(request);
      const consultation = await consultationStore.createConsultation(accountIdentity, sanitizeConsultation(input), await optionalImage(input.inspirationImage));
      sendJson(request, response, 201, await hydratedConsultation(account, consultation));
      return true;
    }
  }
  const consultationActionMatch = url.pathname.match(/^\/api\/consultations\/([a-f0-9-]{36})(?:\/(versions|share|order))?$/i);
  if (consultationActionMatch) {
    const [, consultationId, action] = consultationActionMatch;
    if (!action && request.method === 'GET') {
      sendJson(request, response, 200, await hydratedConsultation(account, await consultationStore.getConsultation(accountIdentity, consultationId)));
      return true;
    }
    if (!action && request.method === 'PATCH') {
      const input = await readJsonBody(request);
      const consultation = await consultationStore.updateConsultation(accountIdentity, consultationId, sanitizeConsultation(input), await optionalImage(input.inspirationImage));
      sendJson(request, response, 200, await hydratedConsultation(account, consultation));
      return true;
    }
    if (!action && request.method === 'DELETE') {
      await consultationStore.deleteConsultation(accountIdentity, consultationId);
      sendJson(request, response, 200, { deleted: true });
      return true;
    }
    if (action === 'versions' && request.method === 'POST') {
      const input = await readJsonBody(request);
      const job = await store.assertOwned(cleanText(input.jobId, 36), account.id);
      if (job.brief?.consultationId && job.brief.consultationId !== consultationId) throw Object.assign(new Error('This try-on belongs to a different consultation.'), { statusCode: 409 });
      const variationIndex = Number.isInteger(Number(input.variationIndex)) ? Number(input.variationIndex) : 0;
      const fileName = job.internal?.resultFiles?.[variationIndex];
      const asset = job.stages?.tryon?.assets?.[variationIndex];
      if (!fileName || !asset) throw Object.assign(new Error('Choose a generated try-on result first.'), { statusCode: 409 });
      const version = await consultationStore.addVersion(accountIdentity, consultationId, {
        jobId: job.id, label: cleanText(input.label, 120) || asset.label, changeSummary: cleanText(input.changeSummary, 1000), brief: job.brief
      }, await readFile(store.assetPath(job.id, fileName)));
      sendJson(request, response, 201, { version: { ...version, imageDataUrl: imageDataUrl(await consultationStore.readPrivateVersion(accountIdentity, consultationId, version.id)) } });
      return true;
    }
    if (action === 'share' && request.method === 'POST') {
      const shared = await consultationStore.createShare(accountIdentity, consultationId);
      sendJson(request, response, 200, { token: shared.token, approval: shared.consultation.approval });
      return true;
    }
    if (action === 'order' && request.method === 'PATCH') {
      sendJson(request, response, 200, { order: await consultationStore.updateOrder(accountIdentity, consultationId, sanitizeOrder(await readJsonBody(request))) });
      return true;
    }
  }
  return false;
}

async function createPaidTryOn(account, payload) {
  const accountIdentity = identity(account);
  if (payload.consultationId) await consultationStore.getConsultation(accountIdentity, cleanText(payload.consultationId, 36));
  let job;
  if (!payments.config.required) {
    job = await pipeline.create(payload);
  } else {
    if (!payments.config.enabled) throw Object.assign(new Error('Payments are required but Paystack is not configured.'), { statusCode: 503 });
    const usageReference = `tryon-${randomUUID()}`;
    await paymentStore.consumeAccount(account, 1, usageReference, 'Realistic Virtual Try-On');
    try {
      job = await pipeline.create(payload);
      job.billing = { creditCharged: true, usageReference };
      await store.save(job);
    } catch (error) {
      await paymentStore.refundAccount(account, 1, usageReference, 'Try-on could not start');
      throw error;
    }
  }
  job = await store.assignOwner(job.id, account.id, account.studioId);
  if (payload.consultationId) {
    const consultation = await consultationStore.getConsultation(accountIdentity, payload.consultationId);
    await consultationStore.updateConsultation(accountIdentity, payload.consultationId, { ...consultation, brief: payload.brief, lastJobId: job.id }, await optionalImage(payload.inspirationImage));
  }
  return job;
}

async function handleTryOnApi(request, response, url) {
  if (request.method === 'GET' && url.pathname === '/api/health') {
    const config = pipeline.config;
    sendJson(request, response, 200, {
      ok: true, realTryOnReady: config.ready, provider: config.ready ? 'openai' : null,
      visionModel: config.visionModel, imageModel: config.imageModel, consultations: true,
      auth: { enabled: true, emailConfigured: authStore.config.emailConfigured },
      payments: { enabled: payments.config.enabled, required: payments.config.required, currency: payments.config.currency }
    });
    return true;
  }
  if (!url.pathname.startsWith('/api/try-on/')) return false;
  const assetMatch = url.pathname.match(/^\/api\/try-on\/assets\/([a-f0-9-]{36})\/([\w.-]+)$/i);
  if (assetMatch && request.method === 'GET') {
    const [, id, fileName] = assetMatch;
    const job = await store.read(id);
    if (!job || !(await store.assetExists(id, fileName))) throw Object.assign(new Error('Asset not found.'), { statusCode: 404 });
    const signed = authStore.verifyAssetSignature(job.ownerAccountId, url.pathname, url.searchParams.get('exp'), url.searchParams.get('sig'));
    if (!signed) {
      const account = await requireAccount(request);
      if (job.ownerAccountId !== account.id) throw Object.assign(new Error('This asset does not belong to the signed-in account.'), { statusCode: 403 });
    }
    sendPng(request, response, await readFile(store.assetPath(id, fileName)));
    return true;
  }
  const account = await requireAccount(request);
  if (request.method === 'POST' && url.pathname === '/api/try-on/jobs') {
    const payload = await readJsonBody(request);
    const validationError = validateCreateJob(payload);
    if (validationError) throw Object.assign(new Error(validationError), { statusCode: 400 });
    const job = await createPaidTryOn(account, payload);
    sendJson(request, response, 202, signedJob(job, account.id));
    return true;
  }
  const jobMatch = url.pathname.match(/^\/api\/try-on\/jobs\/([a-f0-9-]{36})(?:\/stages\/(reference|garment|tryon)\/(approve|reject|regenerate))?$/i);
  if (jobMatch) {
    const [, id, stageName, action] = jobMatch;
    await store.assertOwned(id, account.id);
    if (!stageName && request.method === 'GET') {
      sendJson(request, response, 200, signedJob(await store.assertOwned(id, account.id), account.id));
      return true;
    }
    if (!stageName && request.method === 'DELETE') {
      await store.removeOwned(id, account.id);
      sendJson(request, response, 200, { deleted: true, id });
      return true;
    }
    if (stageName && request.method === 'POST') {
      const input = await readJsonBody(request);
      if (stageName === 'tryon' && action === 'regenerate') {
        const existing = await store.assertOwned(id, account.id);
        if (existing.status === 'complete') {
          existing.status = 'active';
          await store.save(existing);
        }
      }
      const job = await pipeline.act(id, stageName, action, input);
      sendJson(request, response, 202, signedJob(job, account.id));
      return true;
    }
  }
  return false;
}

async function handleApi(request, response) {
  applyCors(request, response);
  if (request.method === 'OPTIONS') {
    response.writeHead(204);
    response.end();
    return;
  }
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  try {
    if (await handleAuthApi(request, response, url)) return;
    if (await handlePaymentApi(request, response, url)) return;
    if (await handleConsultationApi(request, response, url)) return;
    if (await handleTryOnApi(request, response, url)) return;
    sendJson(request, response, 404, { error: 'API route not found.' });
  } catch (error) {
    const statusCode = Number.isInteger(error.statusCode) ? error.statusCode : 500;
    console.error(error);
    sendJson(request, response, statusCode, {
      error: statusCode === 500 ? 'Unable to process the request.' : error.message,
      detail: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}

async function serveStatic(request, response) {
  const requestUrl = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  const requestedPath = requestUrl.pathname === '/' ? '/index.html' : requestUrl.pathname;
  const decodedPath = decodeURIComponent(requestedPath);
  const safeRelativePath = normalize(decodedPath).replace(/^([/\\])+/, '');
  const filePath = resolve(publicDir, safeRelativePath);
  if (filePath !== publicDir && !filePath.startsWith(`${publicDir}${sep}`)) {
    response.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Forbidden');
    return;
  }
  let targetPath = filePath;
  if (!existsSync(targetPath)) targetPath = join(publicDir, 'index.html');
  const fileStats = await stat(targetPath);
  if (!fileStats.isFile()) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found');
    return;
  }
  const extension = extname(targetPath).toLowerCase();
  securityHeaders(response);
  response.writeHead(200, {
    'Content-Type': mimeTypes[extension] || 'application/octet-stream',
    'Cache-Control': extension === '.html' ? 'no-cache' : 'public, max-age=3600'
  });
  createReadStream(targetPath).pipe(response);
}

const server = createServer(async (request, response) => {
  try {
    if (request.url?.startsWith('/api/')) {
      await handleApi(request, response);
      return;
    }
    await serveStatic(request, response);
  } catch (error) {
    console.error(error);
    sendJson(request, response, 500, { error: 'Unexpected server error.', detail: process.env.NODE_ENV === 'development' ? error.message : undefined });
  }
});

server.listen(port, () => {
  console.log(`Dresscode running on http://localhost:${port}`);
  console.log(authStore.config.emailConfigured ? 'Email magic-link authentication enabled.' : 'Authentication enabled; configure RESEND_API_KEY and AUTH_EMAIL_FROM for email delivery.');
  console.log(pipeline.config.ready ? 'OpenAI real try-on enabled.' : 'OPENAI_API_KEY is missing; real try-on is disabled.');
  console.log(payments.config.enabled ? `Paystack enabled (${payments.config.currency}).` : 'PAYSTACK_SECRET_KEY is missing; payments are disabled.');
});
