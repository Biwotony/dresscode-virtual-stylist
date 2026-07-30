import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PaymentStore } from '../lib/payment-store.mjs';
import { PaystackPayments } from '../lib/paystack-payments.mjs';

async function storeForTest(t) {
  const root = await mkdtemp(join(tmpdir(), 'dresscode-payments-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new PaymentStore(root);
  await store.init();
  return store;
}

function service(store) {
  return new PaystackPayments({
    store,
    env: {
      PAYSTACK_SECRET_KEY: 'sk_test_example',
      PAYSTACK_CURRENCY: 'KES',
      PAYSTACK_CHANNELS: 'mobile_money,card',
      PAYSTACK_CALLBACK_URL: 'https://example.com/'
    },
    fetchImpl: async (url, options) => {
      if (url.endsWith('/transaction/initialize')) {
        const payload = JSON.parse(options.body);
        return { ok: true, json: async () => ({ status: true, data: { authorization_url: 'https://checkout.example', access_code: 'code', reference: payload.reference } }) };
      }
      const reference = decodeURIComponent(url.split('/').pop());
      const intent = await store.readIntent(reference);
      return { ok: true, json: async () => ({ status: true, data: { status: 'success', reference, amount: intent.amount, currency: intent.currency, channel: 'mobile_money', customer: { email: intent.email } } }) };
    }
  });
}

test('account wallet follows sign-in and payment fulfilment is idempotent', async t => {
  const store = await storeForTest(t);
  const created = await store.createWallet({ ownerAccountId: '11111111-1111-4111-8111-111111111111', email: 'tailor@example.com' });
  const account = { id: '11111111-1111-4111-8111-111111111111', email: 'tailor@example.com', walletId: created.wallet.id };
  const payments = service(store);
  const initialized = await payments.initialize({ account, email: account.email, planId: 'single' });
  const verified = await payments.verify({ account, reference: initialized.reference });
  assert.equal(verified.wallet.balance, 1);
  assert.equal((await payments.verify({ account, reference: initialized.reference })).wallet.balance, 1);
  await store.consumeAccount(account, 1, 'tryon-1');
  assert.equal((await store.getWalletForAccount(account)).balance, 0);
  await store.refundAccount(account, 1, 'tryon-1');
  assert.equal((await store.getWalletForAccount(account)).balance, 1);
});

test('legacy wallet can be claimed into a verified account', async t => {
  const store = await storeForTest(t);
  const legacy = await store.createWallet();
  const legacyWallet = await store.authenticate(legacy.token);
  legacyWallet.balance = 7;
  await store.saveWallet(legacyWallet);
  const claimed = await store.claimWallet(legacy.token, '11111111-1111-4111-8111-111111111111', 'tailor@example.com');
  assert.equal(claimed.balance, 7);
  assert.equal(claimed.ownerAccountId, '11111111-1111-4111-8111-111111111111');
});
