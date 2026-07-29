import { randomUUID } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
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
await Promise.all([store.init(), paymentStore.init()]);
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
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
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
    const result = await payments.initialize({
      token: payments.walletToken(request),
      email: input.email,
      planId: input.planId
    });
    sendJson(request, response, 200, result);
    return true;
  }

  const verifyMatch = url.pathname.match(/^\/api\/payments\/verify\/([A-Za-z0-9.=-]+)$/);
  if (request.method === 'GET' && verifyMatch) {
    const result = await payments.verify({
      token: payments.walletToken(request),
      reference: verifyMatch[1]
    });
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

async function createPaidTryOn(request, payload) {
  if (!payments.config.required) return pipeline.create(payload);
  if (!payments.config.enabled) {
    throw Object.assign(new Error('Payments are required but Paystack is not configured.'), { statusCode: 503 });
  }

  const token = payments.walletToken(request);
  const usageReference = `tryon-${randomUUID()}`;
  await paymentStore.consume(token, 1, usageReference, 'Realistic Virtual Try-On');
  try {
    const job = await pipeline.create(payload);
    job.billing = { creditCharged: true, usageReference };
    await store.save(job);
    return job;
  } catch (error) {
    await paymentStore.refund(token, 1, usageReference, 'Try-on could not start');
    throw error;
  }
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
      payments: {
        enabled: payments.config.enabled,
        required: payments.config.required,
        currency: payments.config.currency
      }
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
    applyCors(request, response);
    response.writeHead(200, {
      'Content-Type': 'image/png',
      'Cache-Control': 'private, no-store'
    });
    response.end(await readFile(store.assetPath(id, fileName)));
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
    if (await handleTryOnApi(request, response, url)) return;
    sendJson(request, response, 404, { error: 'API route not found.' });
  } catch (error) {
    const statusCode = Number.isInteger(error.statusCode) ? error.statusCode : 500;
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
});
