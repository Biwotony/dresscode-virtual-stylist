import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConsultationStore } from '../lib/consultation-store.mjs';

async function storeForTest(t) {
  const root = await mkdtemp(join(tmpdir(), 'dresscode-consultations-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new ConsultationStore(root);
  await store.init();
  return store;
}

test('creates a studio, client and consultation with saved assets', async t => {
  const store = await storeForTest(t);
  const created = await store.createStudio();
  assert.ok(created.token);
  assert.equal(created.studio.profile.businessName, 'Dresscode Studio');

  const studio = await store.updateStudio(created.token, {
    businessName: 'Amani Bridal',
    tagline: 'Made for your moment',
    phone: '+254700000000',
    email: 'hello@example.com',
    whatsapp: '+254700000000',
    accentColour: '#17634e',
    logoImage: null
  });
  assert.equal(studio.profile.businessName, 'Amani Bridal');

  const model = Buffer.from('model-image');
  const client = await store.createClient(created.token, {
    name: 'Jane Client',
    email: 'jane@example.com',
    phone: '+254711111111',
    notes: 'Prefers full sleeves',
    unit: 'cm',
    measurements: {
      waist: { label: 'Waist', value: 74, unit: 'cm' }
    }
  }, model);
  assert.equal(client.name, 'Jane Client');
  assert.deepEqual(await store.readClientModel(created.token, client.id), model);

  const inspiration = Buffer.from('inspiration-image');
  const consultation = await store.createConsultation(created.token, {
    clientId: client.id,
    title: 'Wedding gown consultation',
    eventDate: '2026-12-12',
    notes: 'Outdoor ceremony',
    brief: { garment: 'Gown', colour: '#17634e' }
  }, inspiration);
  assert.equal(consultation.clientId, client.id);
  assert.deepEqual(await store.readConsultationInspiration(created.token, consultation.id), inspiration);

  const clients = await store.listClients(created.token);
  const consultations = await store.listConsultations(created.token);
  assert.equal(clients.length, 1);
  assert.equal(consultations.length, 1);
  assert.equal(consultations[0].clientName, 'Jane Client');
});

test('saves versions, creates a branded share and records client approval', async t => {
  const store = await storeForTest(t);
  const { token } = await store.createStudio();
  await store.updateStudio(token, {
    businessName: 'Kito Studio',
    tagline: 'See it before it is sewn',
    phone: '',
    email: '',
    whatsapp: '',
    accentColour: '#7c5cff',
    logoImage: null
  });
  const client = await store.createClient(token, {
    name: 'Alex Client', email: '', phone: '', notes: '', unit: 'cm', measurements: {}
  }, Buffer.from('model'));
  const consultation = await store.createConsultation(token, {
    clientId: client.id,
    title: 'Gala suit',
    eventDate: '',
    notes: '',
    brief: { garment: 'Suit' }
  });

  const version = await store.addVersion(token, consultation.id, {
    label: 'Version 1',
    changeSummary: 'Longer jacket',
    jobId: 'job-1',
    brief: { garment: 'Suit' }
  }, Buffer.from('generated-image'));
  assert.equal(version.number, 1);

  const shared = await store.createShare(token, consultation.id);
  const publicRecord = await store.publicShare(shared.token);
  assert.equal(publicRecord.brand.businessName, 'Kito Studio');
  assert.equal(publicRecord.client.name, 'Alex Client');
  assert.equal(publicRecord.consultation.versions.length, 1);
  assert.equal('measurements' in (publicRecord.consultation.brief || {}), false);
  assert.equal('depositReference' in publicRecord.consultation.order, false);
  assert.equal('notes' in publicRecord.consultation, false);
  assert.match(publicRecord.consultation.versions[0].imageUrl, /share-assets/);
  assert.deepEqual(await store.readSharedAsset(shared.token, version.fileName), Buffer.from('generated-image'));

  const approval = await store.recordDecision(shared.token, {
    decision: 'approve',
    versionId: version.id,
    comment: 'Approved',
    clientName: 'Alex Client'
  });
  assert.equal(approval.status, 'approved');

  const privateRecord = await store.getConsultation(token, consultation.id);
  assert.equal(privateRecord.order.orderStatus, 'design_approved');
});

test('records quote, deposit and tailoring order status', async t => {
  const store = await storeForTest(t);
  const { token } = await store.createStudio();
  const client = await store.createClient(token, {
    name: 'Order Client', email: '', phone: '', notes: '', unit: 'cm', measurements: {}
  });
  const consultation = await store.createConsultation(token, {
    clientId: client.id,
    title: 'Traditional ceremony look',
    eventDate: '',
    notes: '',
    brief: null
  });
  const order = await store.updateOrder(token, consultation.id, {
    currency: 'KES',
    quoteAmount: 45000,
    depositAmount: 15000,
    depositMethod: 'M-PESA',
    depositReference: 'MPESA123',
    depositStatus: 'paid',
    orderStatus: 'deposit_received',
    dueDate: '2026-11-01',
    notes: 'First fitting in October'
  });
  assert.equal(order.quoteAmount, 45000);
  assert.equal(order.depositStatus, 'paid');
  assert.equal(order.orderStatus, 'deposit_received');
});

test('rejects invalid studio and rotated approval tokens', async t => {
  const store = await storeForTest(t);
  const { token } = await store.createStudio();
  await assert.rejects(() => store.authenticate(`${token}broken`), /invalid/i);

  const client = await store.createClient(token, {
    name: 'Token Client', email: '', phone: '', notes: '', unit: 'cm', measurements: {}
  });
  const consultation = await store.createConsultation(token, {
    clientId: client.id, title: 'Token test', eventDate: '', notes: '', brief: null
  });
  await store.addVersion(token, consultation.id, { label: 'Version 1' }, Buffer.from('v1'));
  const first = await store.createShare(token, consultation.id);
  const second = await store.createShare(token, consultation.id);
  await assert.rejects(() => store.publicShare(first.token), /expired/i);
  assert.equal((await store.publicShare(second.token)).consultation.title, 'Token test');
});
