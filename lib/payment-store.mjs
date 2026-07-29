import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const WALLET_ID = /^[a-f0-9-]{36}$/i;
const REFERENCE = /^[A-Za-z0-9.=-]+$/;

function hashSecret(secret) {
  return createHash('sha256').update(secret).digest('hex');
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
}

async function atomicJson(path, value) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

function publicWallet(wallet) {
  return {
    id: wallet.id,
    balance: wallet.balance,
    createdAt: wallet.createdAt,
    updatedAt: wallet.updatedAt,
    ledger: [...wallet.ledger].slice(-20).reverse()
  };
}

export class PaymentStore {
  constructor(rootDir) {
    this.rootDir = resolve(rootDir);
    this.walletDir = join(this.rootDir, 'wallets');
    this.intentDir = join(this.rootDir, 'intents');
    this.locks = new Map();
  }

  async init() {
    await Promise.all([
      mkdir(this.walletDir, { recursive: true }),
      mkdir(this.intentDir, { recursive: true })
    ]);
  }

  walletPath(id) {
    if (!WALLET_ID.test(id)) throw Object.assign(new Error('Invalid wallet.'), { statusCode: 401 });
    return join(this.walletDir, `${id}.json`);
  }

  intentPath(reference) {
    if (!REFERENCE.test(reference)) throw Object.assign(new Error('Invalid payment reference.'), { statusCode: 400 });
    return join(this.intentDir, `${reference}.json`);
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

  async createWallet() {
    const id = randomUUID();
    const secret = randomBytes(32).toString('base64url');
    const now = new Date().toISOString();
    const wallet = {
      id,
      secretHash: hashSecret(secret),
      balance: 0,
      ledger: [],
      createdAt: now,
      updatedAt: now
    };
    await atomicJson(this.walletPath(id), wallet);
    return { token: `${id}.${secret}`, wallet: publicWallet(wallet) };
  }

  parseToken(token) {
    const [id, secret, ...extra] = String(token || '').split('.');
    if (extra.length || !WALLET_ID.test(id || '') || !secret) {
      throw Object.assign(new Error('A valid credit wallet is required.'), { statusCode: 401 });
    }
    return { id, secret };
  }

  async readWallet(id) {
    try {
      return JSON.parse(await readFile(this.walletPath(id), 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') throw Object.assign(new Error('Credit wallet not found.'), { statusCode: 401 });
      throw error;
    }
  }

  async authenticate(token) {
    const { id, secret } = this.parseToken(token);
    const wallet = await this.readWallet(id);
    if (!safeEqual(wallet.secretHash, hashSecret(secret))) {
      throw Object.assign(new Error('Credit wallet authentication failed.'), { statusCode: 401 });
    }
    return wallet;
  }

  async getWallet(token) {
    return publicWallet(await this.authenticate(token));
  }

  async saveWallet(wallet) {
    wallet.updatedAt = new Date().toISOString();
    await atomicJson(this.walletPath(wallet.id), wallet);
    return wallet;
  }

  async createIntent(intent) {
    const now = new Date().toISOString();
    const record = {
      status: 'initializing',
      credited: false,
      createdAt: now,
      updatedAt: now,
      ...intent
    };
    await atomicJson(this.intentPath(record.reference), record);
    return record;
  }

  async readIntent(reference) {
    try {
      return JSON.parse(await readFile(this.intentPath(reference), 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') throw Object.assign(new Error('Payment reference not found.'), { statusCode: 404 });
      throw error;
    }
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
    const intent = await this.readIntent(reference);
    return this.withLock(`wallet:${intent.walletId}`, async () => {
      const freshIntent = await this.readIntent(reference);
      const wallet = await this.readWallet(freshIntent.walletId);
      const ledgerReference = `payment:${reference}`;
      const alreadyCredited = wallet.ledger.some(entry => entry.reference === ledgerReference);

      if (!alreadyCredited) {
        wallet.balance += freshIntent.credits;
        wallet.ledger.push({
          id: randomUUID(),
          type: 'credit',
          amount: freshIntent.credits,
          reference: ledgerReference,
          description: freshIntent.planName,
          paymentChannel: paymentData.channel || null,
          createdAt: new Date().toISOString()
        });
        await this.saveWallet(wallet);
      }

      freshIntent.status = 'success';
      freshIntent.credited = true;
      freshIntent.paidAt = paymentData.paid_at || paymentData.paidAt || new Date().toISOString();
      freshIntent.channel = paymentData.channel || freshIntent.channel || null;
      await this.saveIntent(freshIntent);
      return { wallet: publicWallet(wallet), intent: freshIntent, alreadyCredited };
    });
  }

  async consume(token, amount, reference, description = 'Real try-on') {
    if (!Number.isInteger(amount) || amount < 1) throw new Error('Credit amount must be a positive integer.');
    const authenticated = await this.authenticate(token);
    return this.withLock(`wallet:${authenticated.id}`, async () => {
      const wallet = await this.authenticate(token);
      const ledgerReference = `usage:${reference}`;
      if (wallet.ledger.some(entry => entry.reference === ledgerReference)) return publicWallet(wallet);
      if (wallet.balance < amount) {
        throw Object.assign(new Error('You need at least one try-on credit. Buy credits to continue.'), { statusCode: 402 });
      }
      wallet.balance -= amount;
      wallet.ledger.push({
        id: randomUUID(),
        type: 'debit',
        amount: -amount,
        reference: ledgerReference,
        description,
        createdAt: new Date().toISOString()
      });
      await this.saveWallet(wallet);
      return publicWallet(wallet);
    });
  }

  async refund(token, amount, reference, description = 'Try-on credit restored') {
    if (!Number.isInteger(amount) || amount < 1) throw new Error('Refund amount must be a positive integer.');
    const authenticated = await this.authenticate(token);
    return this.withLock(`wallet:${authenticated.id}`, async () => {
      const wallet = await this.authenticate(token);
      const ledgerReference = `refund:${reference}`;
      if (wallet.ledger.some(entry => entry.reference === ledgerReference)) return publicWallet(wallet);
      wallet.balance += amount;
      wallet.ledger.push({
        id: randomUUID(),
        type: 'credit',
        amount,
        reference: ledgerReference,
        description,
        createdAt: new Date().toISOString()
      });
      await this.saveWallet(wallet);
      return publicWallet(wallet);
    });
  }
}

export { publicWallet };
