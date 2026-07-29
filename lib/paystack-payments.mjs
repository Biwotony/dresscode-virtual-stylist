import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const DEFAULT_PLANS = [
  { id: 'single', name: 'Single Try-On', price: 350, credits: 1, description: 'One realistic try-on session' },
  { id: 'event', name: 'Event Pack', price: 1200, credits: 4, description: 'Four try-on sessions' },
  { id: 'style', name: 'Style Pack', price: 2500, credits: 10, description: 'Ten try-on sessions' },
  { id: 'studio', name: 'Studio Pack', price: 11000, credits: 50, description: 'Fifty client try-on sessions' }
];

function booleanSetting(value, fallback = false) {
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function normalisePlan(plan, subunit) {
  const id = String(plan?.id || '').trim().toLowerCase();
  const name = String(plan?.name || '').trim();
  const description = String(plan?.description || '').trim();
  const price = Number(plan?.price);
  const credits = Number(plan?.credits);
  if (!/^[a-z0-9-]{2,40}$/.test(id) || !name || !Number.isFinite(price) || price <= 0 || !Number.isInteger(credits) || credits < 1) {
    throw new Error('Each Paystack plan needs a valid id, name, positive price and positive integer credits.');
  }
  return {
    id,
    name,
    description,
    price,
    amount: Math.round(price * subunit),
    credits
  };
}

export function parsePaymentPlans(env = process.env) {
  const subunit = Math.max(1, Number.parseInt(env.PAYSTACK_SUBUNIT || '100', 10) || 100);
  let source = DEFAULT_PLANS;
  if (env.PAYSTACK_PLANS_JSON?.trim()) {
    const parsed = JSON.parse(env.PAYSTACK_PLANS_JSON);
    if (!Array.isArray(parsed) || !parsed.length) throw new Error('PAYSTACK_PLANS_JSON must be a non-empty JSON array.');
    source = parsed;
  }
  const plans = source.map(plan => normalisePlan(plan, subunit));
  if (new Set(plans.map(plan => plan.id)).size !== plans.length) throw new Error('Paystack plan ids must be unique.');
  return { plans, subunit };
}

function safeSignatureEqual(left, right) {
  const a = Buffer.from(String(left || ''), 'hex');
  const b = Buffer.from(String(right || ''), 'hex');
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}

function getBearerToken(request) {
  const authorization = request.headers.authorization || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || '';
}

export class PaystackPayments {
  constructor({ store, env = process.env, fetchImpl = fetch }) {
    this.store = store;
    this.env = env;
    this.fetch = fetchImpl;
    const parsed = parsePaymentPlans(env);
    this.plans = parsed.plans;
    this.subunit = parsed.subunit;
  }

  setting(name, fallback = '') {
    return this.env[name]?.trim() || fallback;
  }

  get config() {
    const channels = this.setting('PAYSTACK_CHANNELS', 'mobile_money,card')
      .split(',')
      .map(value => value.trim())
      .filter(Boolean);
    return {
      enabled: Boolean(this.setting('PAYSTACK_SECRET_KEY')),
      required: booleanSetting(this.setting('PAYMENTS_REQUIRED'), false),
      currency: this.setting('PAYSTACK_CURRENCY', 'KES').toUpperCase(),
      callbackUrl: this.setting('PAYSTACK_CALLBACK_URL'),
      channels,
      plans: this.plans.map(({ amount, ...plan }) => plan)
    };
  }

  walletToken(request) {
    return getBearerToken(request);
  }

  async paystack(path, options = {}) {
    if (!this.config.enabled) throw Object.assign(new Error('Paystack is not configured on the server.'), { statusCode: 503 });
    const response = await this.fetch(`https://api.paystack.co${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.setting('PAYSTACK_SECRET_KEY')}`,
        'Content-Type': 'application/json',
        ...(options.headers || {})
      },
      signal: AbortSignal.timeout(30_000)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.status !== true) {
      throw Object.assign(new Error(result.message || `Paystack request failed (${response.status}).`), { statusCode: 502 });
    }
    return result;
  }

  planById(id) {
    const plan = this.plans.find(item => item.id === id);
    if (!plan) throw Object.assign(new Error('Unknown credit package.'), { statusCode: 400 });
    return plan;
  }

  async initialize({ token, email, planId }) {
    const cleanEmail = String(email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      throw Object.assign(new Error('Enter a valid email address for the payment receipt.'), { statusCode: 400 });
    }
    const wallet = await this.store.authenticate(token);
    const plan = this.planById(planId);
    const reference = `dc-${wallet.id}-${Date.now()}-${randomBytes(5).toString('hex')}`;
    const intent = await this.store.createIntent({
      reference,
      walletId: wallet.id,
      email: cleanEmail,
      planId: plan.id,
      planName: plan.name,
      amount: plan.amount,
      price: plan.price,
      currency: this.config.currency,
      credits: plan.credits
    });

    try {
      const payload = {
        email: cleanEmail,
        amount: String(plan.amount),
        currency: this.config.currency,
        reference,
        channels: this.config.channels,
        metadata: JSON.stringify({
          product: 'dresscode_tryon_credits',
          wallet_id: wallet.id,
          plan_id: plan.id,
          credits: plan.credits
        })
      };
      if (this.config.callbackUrl) payload.callback_url = this.config.callbackUrl;
      const result = await this.paystack('/transaction/initialize', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      await this.store.markIntent(reference, {
        status: 'initialized',
        accessCode: result.data.access_code,
        authorizationUrl: result.data.authorization_url
      });
      return {
        authorizationUrl: result.data.authorization_url,
        accessCode: result.data.access_code,
        reference: result.data.reference,
        plan: { id: plan.id, name: plan.name, price: plan.price, credits: plan.credits, currency: this.config.currency }
      };
    } catch (error) {
      await this.store.markIntent(intent.reference, { status: 'initialization_failed', error: error.message });
      throw error;
    }
  }

  validateSuccessfulPayment(intent, data) {
    if (!data || data.status !== 'success') {
      throw Object.assign(new Error('The transaction has not completed successfully.'), { statusCode: 409 });
    }
    if (data.reference !== intent.reference) throw Object.assign(new Error('Payment reference mismatch.'), { statusCode: 409 });
    if (Number(data.amount) !== Number(intent.amount)) throw Object.assign(new Error('Payment amount does not match the selected package.'), { statusCode: 409 });
    if (String(data.currency || '').toUpperCase() !== intent.currency) throw Object.assign(new Error('Payment currency does not match the selected package.'), { statusCode: 409 });
  }

  async verify({ token, reference }) {
    const wallet = await this.store.authenticate(token);
    const intent = await this.store.readIntent(reference);
    if (intent.walletId !== wallet.id) throw Object.assign(new Error('This payment belongs to another wallet.'), { statusCode: 403 });
    if (intent.credited) return { status: 'success', wallet: await this.store.getWallet(token), reference };

    const result = await this.paystack(`/transaction/verify/${encodeURIComponent(reference)}`, { method: 'GET' });
    this.validateSuccessfulPayment(intent, result.data);
    const credited = await this.store.creditPayment(reference, result.data);
    return { status: 'success', wallet: credited.wallet, reference, alreadyCredited: credited.alreadyCredited };
  }

  verifyWebhookSignature(rawBody, signature) {
    const expected = createHmac('sha512', this.setting('PAYSTACK_SECRET_KEY')).update(rawBody).digest('hex');
    return safeSignatureEqual(expected, signature);
  }

  async handleWebhook(rawBody, signature) {
    if (!this.config.enabled) throw Object.assign(new Error('Paystack is not configured.'), { statusCode: 503 });
    if (!this.verifyWebhookSignature(rawBody, signature)) {
      throw Object.assign(new Error('Invalid Paystack webhook signature.'), { statusCode: 401 });
    }
    let event;
    try {
      event = JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw Object.assign(new Error('Webhook payload must be valid JSON.'), { statusCode: 400 });
    }
    if (event.event !== 'charge.success') return { received: true, ignored: true };
    const reference = event.data?.reference;
    if (!reference) throw Object.assign(new Error('Webhook payment reference is missing.'), { statusCode: 400 });
    const intent = await this.store.readIntent(reference);
    this.validateSuccessfulPayment(intent, event.data);
    const credited = await this.store.creditPayment(reference, event.data);
    return { received: true, credited: !credited.alreadyCredited };
  }
}

export { getBearerToken };
