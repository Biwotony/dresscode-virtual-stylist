import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConsultationStore } from '../lib/consultation-store.mjs';
import { JobStore } from '../lib/job-store.mjs';

async function missing(path) {
  try { await stat(path); return false; } catch (error) { if (error.code === 'ENOENT') return true; throw error; }
}

test('account ownership protects clients and records consent on the server', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dresscode-owner-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new ConsultationStore(join(root, 'consultations'));
  await store.init();
  const accountId = '11111111-1111-4111-8111-111111111111';
  const otherId = '22222222-2222-4222-8222-222222222222';
  const created = await store.createStudio(accountId);
  const identity = { accountId, studioId: created.studio.id };
  const client = await store.createClient(identity, {
    name: 'Protected Client', unit: 'cm', measurements: { waist: { label: 'Waist', value: 72, unit: 'cm' } },
    consentConfirmed: true, consentVersion: 'test-v1'
  }, Buffer.from('photo'));
  assert.equal(client.consent.confirmedByAccountId, accountId);
  assert.equal(client.consent.version, 'test-v1');
  await assert.rejects(() => store.getClient({ accountId: otherId, studioId: created.studio.id }, client.id), /does not belong/i);
  await store.deleteStudio(identity);
  assert.equal(await missing(store.studioDir(created.studio.id)), true);
});

test('try-on jobs cannot be read or deleted by another account', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dresscode-job-owner-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new JobStore(root);
  await store.init();
  const job = await store.create({ status: 'active', stages: {}, internal: {} });
  await store.assignOwner(job.id, '11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333');
  await assert.rejects(() => store.assertOwned(job.id, '22222222-2222-4222-8222-222222222222'), /does not belong/i);
  await assert.rejects(() => store.removeOwned(job.id, '22222222-2222-4222-8222-222222222222'), /does not belong/i);
  assert.equal((await store.assertOwned(job.id, '11111111-1111-4111-8111-111111111111')).id, job.id);
});
