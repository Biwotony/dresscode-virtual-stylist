import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const WALLET_ID = /^[a-f0-9-]{36}$/i;
const REFERENCE = /^[A-Za-z0-9.=-]+$/;

function hashSecret(secret) {
  return createHash('sha256').update(String(secret)).digest('hex');
}

function normaliseEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
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

function publicWallet(wallet) {
  return {
    id: wallet.id,
    email: wallet.email || '',
    balance: wallet.balance,
    createdAt: wallet.createdAt,
    updatedAt: wallet.updatedAt,
    ledger: [...(wallet.ledger || [])].slice(-20).reverse()
  };
}

export class PaymentStore {
  constructor(rootDir) {
    this.rootDir = resolve(rootDir);
    this.walletDir = join(this.rootDir, 'wallets');
    this.intentDir = join(this.rootDir, 'intents');
    this.accountDir = join(this.rootDir, 'accounts');
    this.locks = new Map();
  }

  async init() {
    await Promise.all([
      mkdir(this.walletDir, { recursive: true }),
      mkdir(this.intentDir, { recursive: true }),
      mkdir(this.accountDir, { recursive: true })
    ]);
  }

  walletPath(id) {
    if (!WALLET_ID.test(String(id || ''))) throw Object.assign(new Error('Invalid wallet.'), { statusCode: 401 });
    return join(this.walletDir, `${id}.json`);
  }

  intentPath(reference) {
    if (!REFERENCE.test(reference)) throw Object.assign(new Error('Invalid payment reference.'), { statusCode: 400 });
    return join(this.intentDir, `${reference}.json`);
  }

  accountPath(email) {
    return join(this.accountDir, `${hashSecret(normaliseEmail(email))}.json`);
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

  async createWallet({ ownerAccountId = '', email = '' } = {}) {
    const id = randomUUID();
    const secret = randomBytes(32).toString('base64url');
    const createdAt = new Date().toISOString();
    const wallet = {
      id,
      secretHash: hashSecret(secret),
      ownerAccountId: ownerAccountId || null,
      email: normaliseEmail(email),
      balance: 0,
      ledger: [],
      createdAt,
      updatedAt: createdAt
    };
    await atomicJson(this.walletPath(id), wallet);
    if (wallet.email) await this.saveEmailAccount(wallet.email, id);
    return { token: `${id}.${secret}`, wallet: publicWallet(wallet) };
  }

  parseToken(token) {
    const [id, secret, ...extra] = String(token || '').split('.');
    if (extra.length || !WALLET_ID.test(id || '') || !secret) {
      throw Object.assign(new Error('A valid legacy credit wallet is required.'), { statusCode: 401 });
    }
    return { id, secret };
  }

  async readWallet(id) {
    const wallet = await readJson(this.walletPath(id));
    if (!wallet) throw Object.assign(new Error('Credit wallet not found.'), { statusCode: 401 });
    wallet.ledger ||= [];
    return wallet;
  }

  async saveWallet(wallet) {
    wallet.updatedAt = new Date().toISOString();
    await atomicJson(this.walletPath(wallet.id), wallet);
    return wallet;
  }

  async authenticate(token) {
    const { id, secret } = this.parseToken(token);
    const wallet = await this.readWallet(id);
    if (!safeEqual(wallet.secretHash, hashSecret(secret))) {
      throw Object.assign(new Error('Credit wallet authentication failed.'), { statusCode: 401 });
    }
    return wallet;
  }

  async readEmailAccount(email) {
    return readJson(this.accountPath(email));
  }

  async saveEmailAccount(email, walletId) {
    const cleanEmail = normaliseEmail(email);
    if (!cleanEmail) return;
    const previous = await this.readEmailAccount(cleanEmail);
    const timestamp = new Date().toISOString();
    await atomicJson(this.accountPath(cleanEmail), {
      emailHash: hashSecret(cleanEmail),
      walletId,
      createdAt: previous?.createdAt || timestamp,
      updatedAt: timestamp
    });
  }

  async accountWalletId(email) {
    return (await this.readEmailAccount(email))?.walletId || null;
  }

  async claimWalletById(walletId, accountId, email = '') {
    return this.withLock(`wallet:${walletId}`, async () => {
      const wallet = await this.readWallet(walletId);
      if (wallet.ownerAccountId && wallet.ownerAccountId !== accountId) {
        throw Object.assign(new Error('This credit wallet belongs to another account.'), { statusCode: 409 });
      }
      wallet.ownerAccountId = accountId;
      if (email) wallet.email = normaliseEmail(email);
      await this.saveWallet(wallet);
      if (wallet.email) await this.saveEmailAccount(wallet.email, wallet.id);
      return wallet;
    });
  }

  async claimWallet(token, accountId, email = '') {
    const wallet = await this.authenticate(token);
    return this.claimWalletById(wallet.id, accountId, email);
  }

  async mergeLegacyWallet(token, targetWalletId, accountId, email = '') {
    const source = await this.authenticate(token);
    if (source.id === targetWalletId) return this.claimWalletById(source.id, accountId, email);
    const keys = [source.id, targetWalletId].sort();
    return this.withLock(`wallet-merge:${keys.join(':')}`, async () => {
      const [freshSource, target] = await Promise.all([this.readWallet(source.id), this.readWallet(targetWalletId)]);
      if (freshSource.ownerAccountId && freshSource.ownerAccountId !== accountId) {
        throw Object.assign(new Error('The legacy wallet belongs to another account.'), { statusCode: 409 });
      }
      if (target.ownerAccountId && target.ownerAccountId !== accountId) {
        throw Object.assign(new Error('The account wallet belongs to another account.'), { statusCode: 409 });
      }
      const seen = new Set((target.ledger || []).map(entry => entry.reference));
      for (const entry of freshSource.ledger || []) {
        const reference = seen.has(entry.reference) ? `migrated:${freshSource.id}:${entry.reference}` : entry.reference;
        if (seen.has(reference)) continue;
        target.ledger.push({ ...entry, id: randomUUID(), reference, migratedFromWalletId: freshSource.id });
        seen.add(reference);
      }
      if (freshSource.balance > 0) {
        target.balance += freshSource.balance;
        target.ledger.push({
          id: randomUUID(), type: 'security', amount: 0, reference: `migration:${freshSource.id}:${Date.now()}`,
          description: `Merged ${freshSource.balance} credits from a legacy browser wallet`, createdAt: new Date().toISOString()
        });
      }
      target.ownerAccountId = accountId;
      target.email = normaliseEmail(email) || target.email;
      await this.saveWallet(target);

      for (const entry of await readdir(this.intentDir, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
        const path = join(this.intentDir, entry.name);
        const intent = await readJson(path);
        if (intent?.walletId !== freshSource.id) continue;
        intent.originalWalletId ||= freshSource.id;
        intent.walletId = target.id;
        intent.accountId = accountId;
        await atomicJson(path, intent);
      }
      await rm(this.walletPath(freshSource.id), { force: true });
      if (target.email) await this.saveEmailAccount(target.email, target.id);
      return target;
    });
  }

  async ensureOwnedWallet(account) {
    if (!account?.id || !account?.walletId) throw Object.assign(new Error('This account does not have a credit wallet.'), { statusCode: 409 });
    const wallet = await this.readWallet(account.walletId);
    if (wallet.ownerAccountId !== account.id) throw Object.assign(new Error('This credit wallet does not belong to the signed-in account.'), { statusCode: 403 });
    return wallet;
  }

  async getWalletForAccount(account) {
    return publicWallet(await this.ensureOwnedWallet(account));
  }

  async createIntent(intent) {
    const createdAt = new Date().toISOString();
    const record = { status: 'initializing', credited: false, createdAt, updatedAt: createdAt, ...intent };
    await atomicJson(this.intentPath(record.reference), record);
    return record;
  }

  async readIntent(reference) {
    const intent = await readJson(this.intentPath(reference));
    if (!intent) throw Object.assign(new Error('Payment reference not found.'), { statusCode: 404 });
    return intent;
  }

  async saveIntent(intent) {
    intent.updatedAt = new Date().toISOString();
    await atomicJson(this.intentPath(intent.reference), intent);
    return intent;
  }

  async markIntent(reference, patch) {
    return this.withLock(`intent:${reference}`, async () => {
      const intent = await this.readIntent(reference);
      Object.assign(intent, patch);
      return this.saveIntent(intent);
    });
  }

  async creditPayment(reference, paymentData = {}) {
    const initial = await this.readIntent(reference);
    return this.withLock(`wallet:${initial.walletId}`, async () => {
      const intent = await this.readIntent(reference);
      const wallet = await this.readWallet(intent.walletId);
      if (intent.accountId && wallet.ownerAccountId && intent.accountId !== wallet.ownerAccountId) {
        throw Object.assign(new Error('Payment ownership mismatch.'), { statusCode: 409 });
      }
      const ledgerReference = `payment:${reference}`;
      const alreadyCredited = wallet.ledger.some(entry => entry.reference === ledgerReference);
      if (!alreadyCredited) {
        wallet.balance += intent.credits;
        wallet.ledger.push({
          id: randomUUID(), type: 'credit', amount: intent.credits, reference: ledgerReference,
          description: intent.planName, paymentChannel: paymentData.channel || null, createdAt: new Date().toISOString()
        });
        await this.saveWallet(wallet);
      }
      intent.status = 'success';
      intent.credited = true;
      intent.paidAt = paymentData.paid_at || paymentData.paidAt || new Date().toISOString();
      intent.channel = paymentData.channel || intent.channel || null;
      await this.saveIntent(intent);
      return { wallet: publicWallet(wallet), intent, alreadyCredited };
    });
  }

  async consumeAccount(account, amount, reference, description = 'Real try-on') {
    if (!Number.isInteger(amount) || amount < 1) throw new Error('Credit amount must be a positive integer.');
    const owned = await this.ensureOwnedWallet(account);
    return this.withLock(`wallet:${owned.id}`, async () => {
      const wallet = await this.ensureOwnedWallet(account);
      const ledgerReference = `usage:${reference}`;
      if (wallet.ledger.some(entry => entry.reference === ledgerReference)) return publicWallet(wallet);
      if (wallet.balance < amount) throw Object.assign(new Error('You need at least one try-on credit. Buy credits to continue.'), { statusCode: 402 });
      wallet.balance -= amount;
      wallet.ledger.push({ id: randomUUID(), type: 'debit', amount: -amount, reference: ledgerReference, description, createdAt: new Date().toISOString() });
      await this.saveWallet(wallet);
      return publicWallet(wallet);
    });
  }

  async refundAccount(account, amount, reference, description = 'Try-on credit restored') {
    if (!Number.isInteger(amount) || amount < 1) throw new Error('Refund amount must be a positive integer.');
    const owned = await this.ensureOwnedWallet(account);
    return this.withLock(`wallet:${owned.id}`, async () => {
      const wallet = await this.ensureOwnedWallet(account);
      const ledgerReference = `refund:${reference}`;
      if (wallet.ledger.some(entry => entry.reference === ledgerReference)) return publicWallet(wallet);
      wallet.balance += amount;
      wallet.ledger.push({ id: randomUUID(), type: 'credit', amount, reference: ledgerReference, description, createdAt: new Date().toISOString() });
      await this.saveWallet(wallet);
      return publicWallet(wallet);
    });
  }

  async deleteAccountData(account) {
    if (account?.walletId) await rm(this.walletPath(account.walletId), { force: true });
    if (account?.email) await rm(this.accountPath(account.email), { force: true });
    for (const entry of await readdir(this.intentDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const path = join(this.intentDir, entry.name);
      const intent = await readJson(path);
      if (intent?.accountId === account.id || intent?.walletId === account.walletId || normaliseEmail(intent?.email) === normaliseEmail(account.email)) {
        await rm(path, { force: true });
      }
    }
  }
}

export { publicWallet };
