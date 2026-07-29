import { randomUUID } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
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
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
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
await Promise.all([store.init(), paymentStore.init(), consultationStore.init()]);
const pipeline = new TryOnPipeline({ store });
const payments = new PaystackPayments({ store: paymentStore });

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.webp': 'image/webp'
};

function allowedOrigins() {
  return (process.env.CORS_ORIGIN || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
}

function applyCors(request, response) {
  const origin = request.headers.origin;
  const allowList = allowedOrigins();
  if (origin && (allowList.includes('*') || allowList.includes(origin))) {
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Vary', 'Origin');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Dresscode-Studio');
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  }
}

function sendJson(request, response, statusCode, payload) {
  applyCors(request, response);
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  response.end(JSON.stringify(payload));
}

function sendPng(request, response, buffer, cacheControl = 'private, no-store') {
  applyCors(request, response);
  response.writeHead(200, {
    'Content-Type': 'image/png',
    'Cache-Control': cacheControl
  });
  response.end(buffer);
}

async function readRawBody(request) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > maxBodyBytes) {
      throw Object.assign(new Error('Request body is too large.'), { statusCode: 413 });
    }
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
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw Object.assign(new Error('Enter a valid email address.'), { statusCode: 400 });
  }
  return email;
}

function cleanColour(value) {
  const colour = cleanText(value, 7).toLowerCase();
  return /^#[0-9a-f]{6}$/.test(colour) ? colour : '#7c5cff';
}

function cleanMoney(value) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount) || amount < 0 || amount > 100_000_000) {
    throw Object.assign(new Error('Enter a valid non-negative amount.'), { statusCode: 400 });
  }
  return Math.round(amount * 100) / 100;
}

function cleanMeasurements(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    const number = Number(item?.value);
    const unit = item?.unit === 'in' ? 'in' : 'cm';
    if (!Number.isFinite(number) || number <= 0 || number > 400) continue;
    result[cleanText(key, 40)] = {
      label: cleanText(item?.label, 80),
      value: Math.round(number * 10) / 10,
      unit
    };
  }
  return result;
}

async function optionalImage(dataUrl) {
  if (!dataUrl) return null;
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) {
    throw Object.assign(new Error('The uploaded image is invalid.'), { statusCode: 400 });
  }
  try {
    return await normalisePng(decodeImageDataUrl(dataUrl).buffer);
  } catch {
    throw Object.assign(new Error('The uploaded image could not be processed.'), { statusCode: 400 });
  }
}

function studioToken(request) {
  return cleanText(request.headers['x-dresscode-studio'], 200);
}

function sanitizeProfile(input = {}) {
  return {
    businessName: cleanText(input.businessName, 100) || 'Dresscode Studio',
    tagline: cleanText(input.tagline, 160),
    phone: cleanText(input.phone, 50),
    email: cleanEmail(input.email),
    whatsapp: cleanText(input.whatsapp, 50),
    accentColour: cleanColour(input.accentColour),
    logoImage: typeof input.logoImage === 'string' && input.logoImage.startsWith('data:image/') && input.logoImage.length <= 1_500_000
      ? input.logoImage
      : null
  };
}

function sanitizeClient(input = {}) {
  const name = cleanText(input.name, 120);
  if (!name) throw Object.assign(new Error('Client name is required.'), { statusCode: 400 });
  return {
    name,
    email: cleanEmail(input.email),
    phone: cleanText(input.phone, 50),
    notes: cleanText(input.notes, 1500),
    unit: input.unit === 'in' ? 'in' : 'cm',
    measurements: cleanMeasurements(input.measurements)
  };
}

function sanitizeConsultation(input = {}) {
  const title = cleanText(input.title, 160);
  if (!title) throw Object.assign(new Error('Consultation title is required.'), { statusCode: 400 });
  return {
    clientId: cleanText(input.clientId, 36),
    title,
    eventDate: cleanText(input.eventDate, 20),
    notes: cleanText(input.notes, 2000),
    brief: input.brief && typeof input.brief === 'object' ? structuredClone(input.brief) : null,
    lastJobId: cleanText(input.lastJobId, 36) || null
  };
}

function sanitizeOrder(input = {}) {
  const allowedDeposit = new Set(['not_recorded', 'pending', 'paid', 'refunded']);
  const allowedOrder = new Set(['consultation', 'design_approved', 'deposit_received', 'in_production', 'ready', 'completed', 'cancelled']);
  return {
    currency: 'KES',
    quoteAmount: cleanMoney(input.quoteAmount),
    depositAmount: cleanMoney(input.depositAmount),
    depositMethod: cleanText(input.depositMethod, 60),
    depositReference: cleanText(input.depositReference, 120),
    depositStatus: allowedDeposit.has(input.depositStatus) ? input.depositStatus : 'not_recorded',
    orderStatus: allowedOrder.has(input.orderStatus) ? input.orderStatus : 'consultation',
    dueDate: cleanText(input.dueDate, 20),
    notes: cleanText(input.notes, 1500)
  };
}

function validateCreateJob(payload) {
  if (!payload || typeof payload !== 'object') return 'A request payload is required.';
  if (typeof payload.modelImage !== 'string' || !payload.modelImage.startsWith('data:image/')) {
    return 'A model image is required.';
  }
  if (payload.inspirationImage && (
    typeof payload.inspirationImage !== 'string' || !payload.inspirationImage.startsWith('data:image/')
  )) {
    return 'The inspiration image is invalid.';
  }
  if (!payload.brief || typeof payload.brief !== 'object') return 'A styling brief is required.';
  const variationCount = Number(payload.variationCount);
  if (!Number.isInteger(variationCount) || variationCount < 1 || variationCount > 3) {
    return 'variationCount must be an integer between 1 and 3.';
  }
  return null;
}

function imageDataUrl(buffer) {
  return buffer ? `data:image/png;base64,${buffer.toString('base64')}` : null;
}

async function hydratedClient(token, client) {
  return {
    ...client,
    modelImage: imageDataUrl(await consultationStore.readClientModel(token, client.id))
  };
}

async function hydratedConsultation(token, consultation) {
  const [inspiration, versions] = await Promise.all([
    consultationStore.readConsultationInspiration(token, consultation.id),
    Promise.all((consultation.versions || []).map(async version => ({
      ...version,
      imageDataUrl: imageDataUrl(await consultationStore.readPrivateVersion(token, consultation.id, version.id))
    })))
  ]);
  const clone = structuredClone(consultation);
  delete clone.shareHash;
  return { ...clone, inspirationImage: imageDataUrl(inspiration), versions };
}

async function handlePaymentApi(request, response, url) {
  if (request.method === 'GET' && url.pathname === '/api/payments/config') {
    sendJson(request, response, 200, payments.config);
    return true;
  }
  if (request.method === 'POST' && url.pathname === '/api/payments/wallets') {
    const created = await paymentStore.createWallet();
    sendJson(request, response, 201, created);
    return true;
  }
  if (request.method === 'GET' && url.pathname === '/api/payments/wallet') {
    const wallet = await paymentStore.getWallet(payments.walletToken(request));
    sendJson(request, response, 200, wallet);
    return true;
  }
  if (request.method === 'POST' && url.pathname === '/api/payments/initialize') {
    const input = await readJsonBody(request);
    const result = await payments.initialize({ token: payments.walletToken(request), email: input.email, planId: input.planId });
    sendJson(request, response, 200, result);
    return true;
  }
  const verifyMatch = url.pathname.match(/^\/api\/payments\/verify\/([A-Za-z0-9.=-]+)$/);
  if (request.method === 'GET' && verifyMatch) {
    const result = await payments.verify({ token: payments.walletToken(request), reference: verifyMatch[1] });
    sendJson(request, response, 200, result);
    return true;
  }
  if (request.method === 'POST' && url.pathname === '/api/payments/webhook') {
    const rawBody = await readRawBody(request);
    const result = await payments.handleWebhook(rawBody, request.headers['x-paystack-signature']);
    sendJson(request, response, 200, result);
    return true;
  }
  return false;
}

async function handleConsultationApi(request, response, url) {
  if (request.method === 'POST' && url.pathname === '/api/consultations/studios') {
    sendJson(request, response, 201, await consultationStore.createStudio());
    return true;
  }

  const shareAssetMatch = url.pathname.match(/^\/api\/consultations\/share-assets\/([^/]+)\/([^/]+)$/);
  if (request.method === 'GET' && shareAssetMatch) {
    const token = decodeURIComponent(shareAssetMatch[1]);
    const fileName = decodeURIComponent(shareAssetMatch[2]);
    sendPng(request, response, await consultationStore.readSharedAsset(token, fileName), 'private, max-age=300');
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
      if (!['approve', 'request_changes'].includes(input.decision)) {
        throw Object.assign(new Error('Choose approve or request changes.'), { statusCode: 400 });
      }
      const decision = await consultationStore.recordDecision(token, {
        decision: input.decision,
        versionId: cleanText(input.versionId, 36),
        comment: cleanText(input.comment, 1500),
        clientName: cleanText(input.clientName, 120)
      });
      sendJson(request, response, 200, { approval: decision });
      return true;
    }
  }

  const token = studioToken(request);
  if (request.method === 'GET' && url.pathname === '/api/consultations/studio') {
    sendJson(request, response, 200, consultationStore.publicStudio(await consultationStore.authenticate(token)));
    return true;
  }
  if (request.method === 'PATCH' && url.pathname === '/api/consultations/studio') {
    const input = await readJsonBody(request);
    sendJson(request, response, 200, await consultationStore.updateStudio(token, sanitizeProfile(input)));
    return true;
  }

  if (url.pathname === '/api/consultations/clients') {
    if (request.method === 'GET') {
      sendJson(request, response, 200, { clients: await consultationStore.listClients(token) });
      return true;
    }
    if (request.method === 'POST') {
      const input = await readJsonBody(request);
      const client = await consultationStore.createClient(token, sanitizeClient(input), await optionalImage(input.modelImage));
      sendJson(request, response, 201, await hydratedClient(token, client));
      return true;
    }
  }

  const clientMatch = url.pathname.match(/^\/api\/consultations\/clients\/([a-f0-9-]{36})$/i);
  if (clientMatch) {
    if (request.method === 'GET') {
      sendJson(request, response, 200, await hydratedClient(token, await consultationStore.getClient(token, clientMatch[1])));
      return true;
    }
    if (request.method === 'PATCH') {
      const input = await readJsonBody(request);
      const client = await consultationStore.updateClient(token, clientMatch[1], sanitizeClient(input), await optionalImage(input.modelImage));
      sendJson(request, response, 200, await hydratedClient(token, client));
      return true;
    }
  }

  if (url.pathname === '/api/consultations') {
    if (request.method === 'GET') {
      sendJson(request, response, 200, { consultations: await consultationStore.listConsultations(token) });
      return true;
    }
    if (request.method === 'POST') {
      const input = await readJsonBody(request);
      const consultation = await consultationStore.createConsultation(token, sanitizeConsultation(input), await optionalImage(input.inspirationImage));
      sendJson(request, response, 201, await hydratedConsultation(token, consultation));
      return true;
    }
  }

  const consultationActionMatch = url.pathname.match(/^\/api\/consultations\/([a-f0-9-]{36})(?:\/(versions|share|order))?$/i);
  if (consultationActionMatch) {
    const [, consultationId, action] = consultationActionMatch;
    if (!action && request.method === 'GET') {
      sendJson(request, response, 200, await hydratedConsultation(token, await consultationStore.getConsultation(token, consultationId)));
      return true;
    }
    if (!action && request.method === 'PATCH') {
      const input = await readJsonBody(request);
      const consultation = await consultationStore.updateConsultation(token, consultationId, sanitizeConsultation(input), await optionalImage(input.inspirationImage));
      sendJson(request, response, 200, await hydratedConsultation(token, consultation));
      return true;
    }
    if (action === 'versions' && request.method === 'POST') {
      const input = await readJsonBody(request);
      const job = await store.read(cleanText(input.jobId, 36));
      if (!job) throw Object.assign(new Error('The try-on job is unavailable.'), { statusCode: 404 });
      if (job.brief?.consultationId && job.brief.consultationId !== consultationId) {
        throw Object.assign(new Error('This try-on belongs to a different consultation.'), { statusCode: 409 });
      }
      const variationIndex = Number.isInteger(Number(input.variationIndex)) ? Number(input.variationIndex) : 0;
      const fileName = job.internal?.resultFiles?.[variationIndex];
      const asset = job.stages?.tryon?.assets?.[variationIndex];
      if (!fileName || !asset) throw Object.assign(new Error('Choose a generated try-on result first.'), { statusCode: 409 });
      const version = await consultationStore.addVersion(token, consultationId, {
        jobId: job.id,
        label: cleanText(input.label, 120) || asset.label,
        changeSummary: cleanText(input.changeSummary, 1000),
        brief: job.brief
      }, await readFile(store.assetPath(job.id, fileName)));
      sendJson(request, response, 201, { version: { ...version, imageDataUrl: imageDataUrl(await consultationStore.readPrivateVersion(token, consultationId, version.id)) } });
      return true;
    }
    if (action === 'share' && request.method === 'POST') {
      const shared = await consultationStore.createShare(token, consultationId);
      sendJson(request, response, 200, { token: shared.token, approval: shared.consultation.approval });
      return true;
    }
    if (action === 'order' && request.method === 'PATCH') {
      sendJson(request, response, 200, { order: await consultationStore.updateOrder(token, consultationId, sanitizeOrder(await readJsonBody(request))) });
      return true;
    }
  }

  return false;
}

async function createPaidTryOn(request, payload) {
  const token = studioToken(request);
  if (payload.consultationId) await consultationStore.getConsultation(token, cleanText(payload.consultationId, 36));

  let job;
  if (!payments.config.required) {
    job = await pipeline.create(payload);
  } else {
    if (!payments.config.enabled) {
      throw Object.assign(new Error('Payments are required but Paystack is not configured.'), { statusCode: 503 });
    }
    const usageReference = `tryon-${randomUUID()}`;
    await paymentStore.consume(payments.walletToken(request), 1, usageReference, 'Realistic Virtual Try-On');
    try {
      job = await pipeline.create(payload);
      job.billing = { creditCharged: true, usageReference };
      await store.save(job);
    } catch (error) {
      await paymentStore.refund(payments.walletToken(request), 1, usageReference, 'Try-on could not start');
      throw error;
    }
  }

  if (payload.consultationId) {
    await consultationStore.updateConsultation(token, payload.consultationId, {
      ...(await consultationStore.getConsultation(token, payload.consultationId)),
      brief: payload.brief,
      lastJobId: job.id
    }, await optionalImage(payload.inspirationImage));
  }
  return job;
}

async function handleTryOnApi(request, response, url) {
  if (request.method === 'GET' && url.pathname === '/api/health') {
    const config = pipeline.config;
    sendJson(request, response, 200, {
      ok: true,
      realTryOnReady: config.ready,
      provider: config.ready ? 'openai' : null,
      visionModel: config.visionModel,
      imageModel: config.imageModel,
      consultations: true,
      payments: { enabled: payments.config.enabled, required: payments.config.required, currency: payments.config.currency }
    });
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/try-on/jobs') {
    const payload = await readJsonBody(request);
    const validationError = validateCreateJob(payload);
    if (validationError) {
      sendJson(request, response, 400, { error: validationError });
      return true;
    }
    const job = await createPaidTryOn(request, payload);
    sendJson(request, response, 202, publicJob(job));
    return true;
  }

  const assetMatch = url.pathname.match(/^\/api\/try-on\/assets\/([a-f0-9-]{36})\/([\w.-]+)$/i);
  if (assetMatch && request.method === 'GET') {
    const [, id, fileName] = assetMatch;
    if (!(await store.assetExists(id, fileName))) {
      sendJson(request, response, 404, { error: 'Asset not found.' });
      return true;
    }
    sendPng(request, response, await readFile(store.assetPath(id, fileName)));
    return true;
  }

  const jobMatch = url.pathname.match(/^\/api\/try-on\/jobs\/([a-f0-9-]{36})(?:\/stages\/(reference|garment|tryon)\/(approve|reject|regenerate))?$/i);
  if (jobMatch) {
    const [, id, stageName, action] = jobMatch;
    if (!stageName && request.method === 'GET') {
      const job = await store.read(id);
      if (!job) {
        sendJson(request, response, 404, { error: 'Try-on job not found.' });
        return true;
      }
      sendJson(request, response, 200, publicJob(job));
      return true;
    }
    if (!stageName && request.method === 'DELETE') {
      await store.remove(id);
      sendJson(request, response, 200, { deleted: true, id });
      return true;
    }
    if (stageName && request.method === 'POST') {
      const input = await readJsonBody(request);
      if (stageName === 'tryon' && action === 'regenerate') {
        const existing = await store.read(id);
        if (existing?.status === 'complete') {
          existing.status = 'active';
          await store.save(existing);
        }
      }
      const job = await pipeline.act(id, stageName, action, input);
      sendJson(request, response, 202, publicJob(job));
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
    sendJson(request, response, 500, {
      error: 'Unexpected server error.',
      detail: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

server.listen(port, () => {
  console.log(`Dresscode Real Try-On running on http://localhost:${port}`);
  console.log(pipeline.config.ready ? 'OpenAI real try-on enabled.' : 'OPENAI_API_KEY is missing; real try-on is disabled.');
  console.log(payments.config.enabled ? `Paystack enabled (${payments.config.currency}).` : 'PAYSTACK_SECRET_KEY is missing; payments are disabled.');
  console.log('Tailor consultation workflow enabled.');
});
