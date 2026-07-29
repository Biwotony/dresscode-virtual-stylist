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

function fakePaystack(store, calls = []) {
  return async (url, options) => {
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
          channel: 'mobile_money',
          customer: { email: intent.email }
        }
      })
    };
  };
}

function paymentService(store, calls = []) {
  return new PaystackPayments({
    store,
    fetchImpl: fakePaystack(store, calls),
    env: {
      PAYSTACK_SECRET_KEY: 'sk_test_example',
      PAYSTACK_CURRENCY: 'KES',
      PAYSTACK_CHANNELS: 'mobile_money,card',
      PAYSTACK_CALLBACK_URL: 'https://example.com/return',
      PAYSTACK_PLANS_JSON: JSON.stringify([
        { id: 'single', name: 'Single Try-On', price: 350, credits: 1 }
      ])
    }
  });
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
    amount: 35000,
    price: 350,
    currency: 'KES',
    credits: 1
  });

  await store.creditPayment('dc-test-payment-1', { channel: 'mobile_money' });
  await store.creditPayment('dc-test-payment-1', { channel: 'mobile_money' });
  assert.equal((await store.getWallet(created.token)).balance, 1);
  assert.equal(await store.accountWalletId('test@example.com'), created.wallet.id);

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
  const payments = paymentService(store, calls);

  const initialized = await payments.initialize({
    token: created.token,
    email: 'buyer@example.com',
    planId: 'single'
  });
  const requestPayload = JSON.parse(calls[0].options.body);
  assert.equal(requestPayload.amount, '35000');
  assert.equal(requestPayload.currency, 'KES');
  assert.deepEqual(requestPayload.channels, ['mobile_money', 'card']);
  assert.equal(requestPayload.callback_url, 'https://example.com/return');

  const verified = await payments.verify({ token: created.token, reference: initialized.reference });
  assert.equal(verified.wallet.balance, 1);
  assert.equal(verified.wallet.email, 'buyer@example.com');
});

test('recovers paid credits on a new browser using receipt email and reference', async t => {
  const store = await temporaryStore(t);
  const firstBrowser = await store.createWallet();
  const payments = paymentService(store);
  const initialized = await payments.initialize({
    token: firstBrowser.token,
    email: 'tailor@example.com',
    planId: 'single'
  });
  await payments.verify({ token: firstBrowser.token, reference: initialized.reference });

  const secondBrowser = await store.createWallet();
  const recovered = await payments.initialize({
    token: secondBrowser.token,
    email: 'tailor@example.com',
    planId: `recover:${initialized.reference}`
  });

  assert.equal(recovered.recovered, true);
  assert.equal(recovered.wallet.balance, 1);
  assert.equal(recovered.wallet.email, 'tailor@example.com');
  await assert.rejects(() => store.getWallet(firstBrowser.token), /authentication failed/i);
  assert.equal((await store.getWallet(recovered.token)).balance, 1);
});

test('rejects recovery when receipt email does not match', async t => {
  const store = await temporaryStore(t);
  const created = await store.createWallet();
  const payments = paymentService(store);
  const initialized = await payments.initialize({
    token: created.token,
    email: 'owner@example.com',
    planId: 'single'
  });
  await payments.verify({ token: created.token, reference: initialized.reference });

  await assert.rejects(
    () => payments.initialize({ token: created.token, email: 'attacker@example.com', planId: `recover:${initialized.reference}` }),
    /do not match/i
  );
});

test('prevents a second browser from creating a separate paid wallet for the same email', async t => {
  const store = await temporaryStore(t);
  const first = await store.createWallet();
  const payments = paymentService(store);
  const initialized = await payments.initialize({ token: first.token, email: 'studio@example.com', planId: 'single' });
  await payments.verify({ token: first.token, reference: initialized.reference });

  const second = await store.createWallet();
  await assert.rejects(
    () => payments.initialize({ token: second.token, email: 'studio@example.com', planId: 'single' }),
    /recover the account/i
  );
});
