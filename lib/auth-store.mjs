import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const UUID = /^[a-f0-9-]{36}$/i;
const TOKEN_ID = /^[a-f0-9-]{36}$/i;

function now() {
  return new Date().toISOString();
}

function hash(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}

function normaliseEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw Object.assign(new Error('Enter a valid email address.'), { statusCode: 400 });
  }
  return email;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

async function atomicJson(path, value) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export class AuthStore {
  constructor(rootDir, { env = process.env, fetchImpl = fetch } = {}) {
    this.rootDir = resolve(rootDir);
    this.accountDir = join(this.rootDir, 'accounts');
    this.emailIndexDir = join(this.rootDir, 'email-index');
    this.sessionDir = join(this.rootDir, 'sessions');
    this.magicDir = join(this.rootDir, 'magic-links');
    this.env = env;
    this.fetch = fetchImpl;
    this.locks = new Map();
    this.rateBuckets = new Map();
    this.assetSecret = this.setting('AUTH_ASSET_SECRET') || randomBytes(32).toString('hex');
  }

  async init() {
    await Promise.all([
      mkdir(this.accountDir, { recursive: true }),
      mkdir(this.emailIndexDir, { recursive: true }),
      mkdir(this.sessionDir, { recursive: true }),
      mkdir(this.magicDir, { recursive: true })
    ]);
    await this.purgeExpired();
  }

  setting(name, fallback = '') {
    return String(this.env[name] ?? fallback).trim();
  }

  integerSetting(name, fallback) {
    const value = Number.parseInt(this.setting(name), 10);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }

  get config() {
    return {
      enabled: true,
      emailConfigured: Boolean(this.setting('RESEND_API_KEY') && this.setting('AUTH_EMAIL_FROM')),
      frontendUrl: this.setting('AUTH_FRONTEND_URL', this.setting('PAYSTACK_CALLBACK_URL', '')),
      magicLinkMinutes: this.integerSetting('AUTH_MAGIC_LINK_MINUTES', 15),
      sessionDays: this.integerSetting('AUTH_SESSION_DAYS', 30),
      developmentLinks: this.setting('NODE_ENV') !== 'production' && ['1', 'true', 'yes'].includes(this.setting('AUTH_DEV_SHOW_MAGIC_LINK').toLowerCase())
    };
  }

  accountPath(id) {
    if (!UUID.test(String(id || ''))) throw Object.assign(new Error('Invalid account.'), { statusCode: 401 });
    return join(this.accountDir, `${id}.json`);
  }

  emailIndexPath(email) {
    return join(this.emailIndexDir, `${hash(normaliseEmail(email))}.json`);
  }

  sessionPath(id) {
    if (!TOKEN_ID.test(String(id || ''))) throw Object.assign(new Error('Invalid session.'), { statusCode: 401 });
    return join(this.sessionDir, `${id}.json`);
  }

  magicPath(id) {
    if (!TOKEN_ID.test(String(id || ''))) throw Object.assign(new Error('Invalid sign-in link.'), { statusCode: 401 });
    return join(this.magicDir, `${id}.json`);
  }

  async purgeExpired() {
    const timestamp = Date.now();
    for (const [dir, expiryField, graceMs] of [
      [this.magicDir, 'expiresAt', 24 * 60 * 60 * 1000],
      [this.sessionDir, 'expiresAt', 7 * 24 * 60 * 60 * 1000]
    ]) {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
        const path = join(dir, entry.name);
        const record = await readJson(path);
        const expiry = Date.parse(record?.[expiryField] || '');
        const revoked = Date.parse(record?.revokedAt || record?.consumedAt || '');
        if ((Number.isFinite(expiry) && expiry + graceMs < timestamp) || (Number.isFinite(revoked) && revoked + graceMs < timestamp)) {
          await rm(path, { force: true });
        }
      }
    }
  }

  async withLock(key, task) {
    const previous = this.locks.get(key) || Promise.resolve();
    let release;
    const current = new Promise(resolve => { release = resolve; });
    const chain = previous.then(() => current);
    this.locks.set(key, chain);
    await previous;
    try {
      return await task();
    } finally {
      release();
      if (this.locks.get(key) === chain) this.locks.delete(key);
    }
  }

  publicAccount(account) {
    return {
      id: account.id,
      email: account.email,
      studioId: account.studioId || null,
      walletId: account.walletId || null,
      createdAt: account.createdAt,
      updatedAt: account.updatedAt
    };
  }

  async readAccount(id) {
    const account = await readJson(this.accountPath(id));
    if (!account || account.deletedAt) throw Object.assign(new Error('Account not found.'), { statusCode: 401 });
    return account;
  }

  async findAccountByEmail(email) {
    const index = await readJson(this.emailIndexPath(email));
    if (!index?.accountId) return null;
    try {
      return await this.readAccount(index.accountId);
    } catch (error) {
      if (error.statusCode === 401) return null;
      throw error;
    }
  }

  async ensureAccount(email) {
    const cleanEmail = normaliseEmail(email);
    const key = hash(cleanEmail);
    return this.withLock(`account-email:${key}`, async () => {
      const existing = await this.findAccountByEmail(cleanEmail);
      if (existing) return existing;
      const createdAt = now();
      const account = {
        id: randomUUID(),
        email: cleanEmail,
        emailHash: key,
        studioId: null,
        walletId: null,
        createdAt,
        updatedAt: createdAt,
        deletedAt: null
      };
      await atomicJson(this.accountPath(account.id), account);
      await atomicJson(this.emailIndexPath(cleanEmail), {
        emailHash: key,
        accountId: account.id,
        createdAt,
        updatedAt: createdAt
      });
      return account;
    });
  }

  async saveAccount(account) {
    account.updatedAt = now();
    await atomicJson(this.accountPath(account.id), account);
    const index = await readJson(this.emailIndexPath(account.email)) || {};
    await atomicJson(this.emailIndexPath(account.email), {
      ...index,
      emailHash: account.emailHash || hash(account.email),
      accountId: account.id,
      createdAt: index.createdAt || account.createdAt,
      updatedAt: account.updatedAt
    });
    return account;
  }

  parseToken(token, label = 'session') {
    const [id, secret, ...extra] = String(token || '').split('.');
    if (extra.length || !TOKEN_ID.test(id || '') || !secret) {
      throw Object.assign(new Error(`A valid ${label} is required.`), { statusCode: 401 });
    }
    return { id, secret };
  }

  bearerToken(request) {
    const authorization = request.headers.authorization || '';
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    return match?.[1]?.trim() || '';
  }

  async createSession(account, metadata = {}) {
    const id = randomUUID();
    const secret = randomBytes(32).toString('base64url');
    const createdAt = now();
    const expiresAt = new Date(Date.now() + this.config.sessionDays * 24 * 60 * 60 * 1000).toISOString();
    const session = {
      id,
      accountId: account.id,
      secretHash: hash(secret),
      createdAt,
      updatedAt: createdAt,
      lastSeenAt: createdAt,
      expiresAt,
      revokedAt: null,
      userAgent: String(metadata.userAgent || '').slice(0, 300),
      ipHash: metadata.ip ? hash(metadata.ip) : ''
    };
    await atomicJson(this.sessionPath(id), session);
    return { token: `${id}.${secret}`, session, account: this.publicAccount(account) };
  }

  async authenticate(token) {
    const { id, secret } = this.parseToken(token, 'session');
    const session = await readJson(this.sessionPath(id));
    if (!session || session.revokedAt || Date.parse(session.expiresAt) <= Date.now() || !safeEqual(session.secretHash, hash(secret))) {
      throw Object.assign(new Error('Your session is invalid or has expired. Sign in again.'), { statusCode: 401 });
    }
    const account = await this.readAccount(session.accountId);
    const lastSeen = Date.parse(session.lastSeenAt || 0);
    if (!Number.isFinite(lastSeen) || Date.now() - lastSeen > 15 * 60 * 1000) {
      session.lastSeenAt = now();
      session.updatedAt = session.lastSeenAt;
      await atomicJson(this.sessionPath(id), session);
    }
    return { account, session };
  }

  async authenticateRequest(request) {
    return this.authenticate(this.bearerToken(request));
  }

  async revokeSession(token) {
    const { id, secret } = this.parseToken(token, 'session');
    const session = await readJson(this.sessionPath(id));
    if (!session || !safeEqual(session.secretHash, hash(secret))) return;
    session.revokedAt = now();
    session.updatedAt = session.revokedAt;
    await atomicJson(this.sessionPath(id), session);
  }

  async revokeAllSessions(accountId) {
    let revoked = 0;
    for (const entry of await readdir(this.sessionDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const path = join(this.sessionDir, entry.name);
      const session = await readJson(path);
      if (!session || session.accountId !== accountId || session.revokedAt) continue;
      session.revokedAt = now();
      session.updatedAt = session.revokedAt;
      await atomicJson(path, session);
      revoked += 1;
    }
    return revoked;
  }

  rateLimit(key, max = 5, windowMs = 15 * 60 * 1000) {
    const cutoff = Date.now() - windowMs;
    const recent = (this.rateBuckets.get(key) || []).filter(value => value > cutoff);
    if (recent.length >= max) throw Object.assign(new Error('Too many sign-in requests. Try again later.'), { statusCode: 429 });
    recent.push(Date.now());
    this.rateBuckets.set(key, recent);
  }

  frontendUrl() {
    const value = this.config.frontendUrl;
    if (!value) throw Object.assign(new Error('AUTH_FRONTEND_URL is not configured.'), { statusCode: 503 });
    return value.replace(/[?#].*$/, '').replace(/\/$/, '/');
  }

  async sendMagicLink(email, link, magicId) {
    if (!this.config.emailConfigured) {
      if (this.config.developmentLinks) return { id: 'development', debugLink: link };
      throw Object.assign(new Error('Email sign-in is not configured yet.'), { statusCode: 503 });
    }
    const response = await this.fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.setting('RESEND_API_KEY')}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `dresscode-magic-${magicId}`
      },
      body: JSON.stringify({
        from: this.setting('AUTH_EMAIL_FROM'),
        to: [email],
        subject: 'Sign in to Dresscode',
        html: `<div style="font-family:Arial,sans-serif;line-height:1.5;color:#17202a"><h1 style="font-size:24px">Sign in to Dresscode</h1><p>Use the secure link below to open your tailoring workspace. It expires in ${this.config.magicLinkMinutes} minutes and can be used once.</p><p><a href="${escapeHtml(link)}" style="display:inline-block;background:#6d55e7;color:white;padding:12px 18px;border-radius:10px;text-decoration:none;font-weight:700">Open Dresscode</a></p><p style="font-size:12px;color:#667085">If you did not request this link, you can ignore this email.</p></div>`,
        text: `Sign in to Dresscode: ${link}\n\nThis one-time link expires in ${this.config.magicLinkMinutes} minutes.`
      }),
      signal: AbortSignal.timeout(30_000)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(result.message || 'Unable to send the sign-in email.'), { statusCode: 502 });
    return result;
  }

  async requestMagicLink(email, metadata = {}) {
    const cleanEmail = normaliseEmail(email);
    const emailKey = hash(cleanEmail);
    const ipKey = metadata.ip ? hash(metadata.ip) : 'unknown';
    this.rateLimit(`email:${emailKey}`);
    this.rateLimit(`ip:${ipKey}`, 12);

    const id = randomUUID();
    const secret = randomBytes(32).toString('base64url');
    const createdAt = now();
    const expiresAt = new Date(Date.now() + this.config.magicLinkMinutes * 60 * 1000).toISOString();
    const record = {
      id,
      email: cleanEmail,
      emailHash: emailKey,
      secretHash: hash(secret),
      createdAt,
      expiresAt,
      consumedAt: null,
      requestedIpHash: ipKey
    };
    await atomicJson(this.magicPath(id), record);
    const token = `${id}.${secret}`;
    const link = `${this.frontendUrl()}#auth=${encodeURIComponent(token)}`;
    const delivery = await this.sendMagicLink(cleanEmail, link, id);
    return { sent: true, debugLink: delivery.debugLink || undefined };
  }

  async consumeMagicLink(token, provision, metadata = {}) {
    const { id, secret } = this.parseToken(token, 'sign-in link');
    return this.withLock(`magic:${id}`, async () => {
      const record = await readJson(this.magicPath(id));
      if (!record || record.consumedAt || Date.parse(record.expiresAt) <= Date.now() || !safeEqual(record.secretHash, hash(secret))) {
        throw Object.assign(new Error('This sign-in link is invalid, expired or already used.'), { statusCode: 401 });
      }
      let account = await this.ensureAccount(record.email);
      account = await provision(account);
      await this.saveAccount(account);
      const created = await this.createSession(account, metadata);
      record.consumedAt = now();
      record.accountId = account.id;
      await atomicJson(this.magicPath(id), record);
      return created;
    });
  }

  signAssetUrl(accountId, path, ttlSeconds = 10 * 60) {
    if (!UUID.test(String(accountId || '')) || !String(path || '').startsWith('/api/try-on/assets/')) return path;
    const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
    const payload = `${accountId}\n${path}\n${expires}`;
    const signature = createHmac('sha256', this.assetSecret).update(payload).digest('base64url');
    const separator = path.includes('?') ? '&' : '?';
    return `${path}${separator}exp=${expires}&sig=${encodeURIComponent(signature)}`;
  }

  verifyAssetSignature(accountId, path, expires, signature) {
    const expiry = Number(expires);
    if (!UUID.test(String(accountId || '')) || !Number.isInteger(expiry) || expiry < Math.floor(Date.now() / 1000) || !signature) return false;
    const payload = `${accountId}\n${path}\n${expiry}`;
    const expected = createHmac('sha256', this.assetSecret).update(payload).digest('base64url');
    return safeEqual(expected, signature);
  }

  async deleteAccountRecord(accountId) {
    const account = await this.readAccount(accountId);
    await this.revokeAllSessions(account.id);
    account.deletedAt = now();
    account.updatedAt = account.deletedAt;
    await atomicJson(this.accountPath(account.id), account);
    await rm(this.emailIndexPath(account.email), { force: true });
    for (const entry of await readdir(this.magicDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const path = join(this.magicDir, entry.name);
      const record = await readJson(path);
      if (record?.emailHash === account.emailHash) await rm(path, { force: true });
    }
  }
}

export { normaliseEmail };
