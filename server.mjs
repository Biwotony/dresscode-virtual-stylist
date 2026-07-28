import { createReadStream, existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(fileURLToPath(new URL('.', import.meta.url)));
const publicDir = join(rootDir, 'public');
const port = Number.parseInt(process.env.PORT || '4173', 10);
const maxBodyBytes = 12 * 1024 * 1024;

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

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  response.end(JSON.stringify(payload));
}

async function readJsonBody(request) {
  const chunks = [];
  let total = 0;

  for await (const chunk of request) {
    total += chunk.length;
    if (total > maxBodyBytes) {
      const error = new Error('Request body is too large.');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }

  if (!chunks.length) return {};

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    const error = new Error('Request body must be valid JSON.');
    error.statusCode = 400;
    throw error;
  }
}

function validateGenerationPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return 'A request payload is required.';
  }

  if (typeof payload.modelImage !== 'string' || !payload.modelImage.startsWith('data:image/')) {
    return 'A model image is required.';
  }

  if (payload.inspirationImage && (
    typeof payload.inspirationImage !== 'string' ||
    !payload.inspirationImage.startsWith('data:image/')
  )) {
    return 'The inspiration image is invalid.';
  }

  if (!payload.brief || typeof payload.brief !== 'object') {
    return 'A styling brief is required.';
  }

  return null;
}

async function generateLook(payload) {
  const providerUrl = process.env.TRY_ON_API_URL?.trim();
  const providerKey = process.env.TRY_ON_API_KEY?.trim();

  if (!providerUrl) {
    return {
      mode: 'demo',
      message: 'No external try-on provider is configured. A local concept preview was generated instead.',
      imageUrl: null,
      imageBase64: null
    };
  }

  const headers = { 'Content-Type': 'application/json' };
  if (providerKey) headers.Authorization = `Bearer ${providerKey}`;

  const providerResponse = await fetch(providerUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(120_000)
  });

  const raw = await providerResponse.text();
  let result;

  try {
    result = raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error(`The try-on provider returned invalid JSON (${providerResponse.status}).`);
  }

  if (!providerResponse.ok) {
    const message = result?.error || result?.message || `The try-on provider failed with status ${providerResponse.status}.`;
    const error = new Error(message);
    error.statusCode = 502;
    throw error;
  }

  const imageUrl = result.imageUrl || result.output?.imageUrl || null;
  const imageBase64 = result.imageBase64 || result.output?.imageBase64 || null;

  if (!imageUrl && !imageBase64) {
    const error = new Error('The try-on provider did not return an imageUrl or imageBase64 value.');
    error.statusCode = 502;
    throw error;
  }

  return {
    mode: 'provider',
    message: 'The external try-on provider generated the styled image.',
    imageUrl,
    imageBase64
  };
}

async function handleApi(request, response) {
  if (request.method === 'GET' && request.url === '/api/health') {
    sendJson(response, 200, {
      ok: true,
      providerConfigured: Boolean(process.env.TRY_ON_API_URL?.trim())
    });
    return;
  }

  if (request.method === 'POST' && request.url === '/api/generate-look') {
    try {
      const payload = await readJsonBody(request);
      const validationError = validateGenerationPayload(payload);
      if (validationError) {
        sendJson(response, 400, { error: validationError });
        return;
      }

      const result = await generateLook(payload);
      sendJson(response, 200, result);
    } catch (error) {
      const statusCode = Number.isInteger(error.statusCode) ? error.statusCode : 500;
      sendJson(response, statusCode, {
        error: statusCode === 500 ? 'Unable to generate the look.' : error.message,
        detail: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
    return;
  }

  sendJson(response, 404, { error: 'API route not found.' });
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
  if (!existsSync(targetPath)) {
    targetPath = join(publicDir, 'index.html');
  }

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
    sendJson(response, 500, {
      error: 'Unexpected server error.',
      detail: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

server.listen(port, () => {
  console.log(`Dresscode Virtual Stylist running on http://localhost:${port}`);
  console.log(process.env.TRY_ON_API_URL ? 'External try-on provider enabled.' : 'Demo rendering mode enabled.');
});
