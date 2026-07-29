import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PaymentStore } from '../lib/payment-store.mjs';
import { parsePaymentPlans, PaystackPayments } from '../lib/paystack-payments.mjs';

async function temporaryStore(t) {
  const root = await mkdtemp(join(tmpdir(), 'dresscode-payments-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new PaymentStore(root);
  await store.init();
  return store;
}

test('parses configurable Paystack credit packages', () => {
  const { plans } = parsePaymentPlans({
    PAYSTACK_SUBUNIT: '100',
    PAYSTACK_PLANS_JSON: JSON.stringify([
      { id: 'starter', name: 'Starter', price: 300, credits: 2, description: 'Two looks' }
    ])
  });
  assert.deepEqual(plans[0], {
    id: 'starter',
    name: 'Starter',
    description: 'Two looks',
    price: 300,
    amount: 30000,
    credits: 2
  });
});

test('credits, consumes and refunds a wallet idempotently', async t => {
  const store = await temporaryStore(t);
  const created = await store.createWallet();
  await store.createIntent({
    reference: 'dc-test-payment-1',
    walletId: created.wallet.id,
    email: 'test@example.com',
    planId: 'single',
    planName: 'Single Try-On',
    amount: 25000,
    price: 250,
    currency: 'KES',
    credits: 1
  });

  await store.creditPayment('dc-test-payment-1', { channel: 'mobile_money' });
  await store.creditPayment('dc-test-payment-1', { channel: 'mobile_money' });
  assert.equal((await store.getWallet(created.token)).balance, 1);

  await store.consume(created.token, 1, 'tryon-test-1');
  await store.consume(created.token, 1, 'tryon-test-1');
  assert.equal((await store.getWallet(created.token)).balance, 0);

  await store.refund(created.token, 1, 'tryon-test-1');
  await store.refund(created.token, 1, 'tryon-test-1');
  assert.equal((await store.getWallet(created.token)).balance, 1);
});

test('initializes and verifies a Paystack transaction using server-controlled pricing', async t => {
  const store = await temporaryStore(t);
  const created = await store.createWallet();
  const calls = [];
  const fakeFetch = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/transaction/initialize')) {
      const payload = JSON.parse(options.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          status: true,
          message: 'Authorization URL created',
          data: {
            authorization_url: 'https://checkout.paystack.com/example',
            access_code: 'access-code',
            reference: payload.reference
          }
        })
      };
    }
    const reference = decodeURIComponent(url.split('/').pop());
    const intent = await store.readIntent(reference);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        status: true,
        message: 'Verification successful',
        data: {
          status: 'success',
          reference,
          amount: intent.amount,
          currency: intent.currency,
          channel: 'mobile_money'
        }
      })
    };
  };

  const payments = new PaystackPayments({
    store,
    fetchImpl: fakeFetch,
    env: {
      PAYSTACK_SECRET_KEY: 'sk_test_example',
      PAYSTACK_CURRENCY: 'KES',
      PAYSTACK_CHANNELS: 'mobile_money,card',
      PAYSTACK_CALLBACK_URL: 'https://example.com/return',
      PAYSTACK_PLANS_JSON: JSON.stringify([
        { id: 'single', name: 'Single Try-On', price: 250, credits: 1 }
      ])
    }
  });

  const initialized = await payments.initialize({
    token: created.token,
    email: 'buyer@example.com',
    planId: 'single'
  });
  const requestPayload = JSON.parse(calls[0].options.body);
  assert.equal(requestPayload.amount, '25000');
  assert.equal(requestPayload.currency, 'KES');
  assert.deepEqual(requestPayload.channels, ['mobile_money', 'card']);
  assert.equal(requestPayload.callback_url, 'https://example.com/return');

  const verified = await payments.verify({ token: created.token, reference: initialized.reference });
  assert.equal(verified.wallet.balance, 1);
});
