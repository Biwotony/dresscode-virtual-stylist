import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuthStore } from '../lib/auth-store.mjs';

async function authForTest(t) {
  const root = await mkdtemp(join(tmpdir(), 'dresscode-auth-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const auth = new AuthStore(root, {
    env: {
      NODE_ENV: 'development',
      AUTH_DEV_SHOW_MAGIC_LINK: 'true',
      AUTH_FRONTEND_URL: 'https://example.com/',
      AUTH_MAGIC_LINK_MINUTES: '15',
      AUTH_SESSION_DAYS: '30'
    }
  });
  await auth.init();
  return auth;
}

test('creates a one-time magic link and a revocable account session', async t => {
  const auth = await authForTest(t);
  const requested = await auth.requestMagicLink('Tailor@Example.com', { ip: '127.0.0.1' });
  assert.match(requested.debugLink, /#auth=/);
  const token = decodeURIComponent(requested.debugLink.split('#auth=')[1]);
  const result = await auth.consumeMagicLink(token, async account => {
    account.studioId = '11111111-1111-4111-8111-111111111111';
    account.walletId = '22222222-2222-4222-8222-222222222222';
    return account;
  });
  assert.equal(result.account.email, 'tailor@example.com');
  assert.equal((await auth.authenticate(result.token)).account.id, result.account.id);
  await assert.rejects(() => auth.consumeMagicLink(token, async account => account), /already used/i);
  await auth.revokeSession(result.token);
  await assert.rejects(() => auth.authenticate(result.token), /invalid or has expired/i);
});

test('logout all revokes every active session', async t => {
  const auth = await authForTest(t);
  const account = await auth.ensureAccount('studio@example.com');
  const first = await auth.createSession(account);
  const second = await auth.createSession(account);
  assert.equal(await auth.revokeAllSessions(account.id), 2);
  await assert.rejects(() => auth.authenticate(first.token), /invalid or has expired/i);
  await assert.rejects(() => auth.authenticate(second.token), /invalid or has expired/i);
});

test('signed asset URLs expire and cannot be used for another account', async t => {
  const auth = await authForTest(t);
  const accountId = '11111111-1111-4111-8111-111111111111';
  const path = '/api/try-on/assets/22222222-2222-4222-8222-222222222222/result.png';
  const signed = new URL(auth.signAssetUrl(accountId, path, 60), 'https://example.com');
  assert.equal(auth.verifyAssetSignature(accountId, path, signed.searchParams.get('exp'), signed.searchParams.get('sig')), true);
  assert.equal(auth.verifyAssetSignature('33333333-3333-4333-8333-333333333333', path, signed.searchParams.get('exp'), signed.searchParams.get('sig')), false);
});
