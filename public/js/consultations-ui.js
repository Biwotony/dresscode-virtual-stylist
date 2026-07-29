import {
  createApprovalShare,
  createClient,
  createConsultation,
  ensureConsultationStudio,
  getApiBaseUrl,
  getClient,
  getConsultation,
  listClients,
  listConsultations,
  saveConsultationVersion,
  updateClient,
  updateConsultation,
  updateConsultationOrder,
  updateConsultationStudio
} from './api.js';

const state = {
  studio: null,
  clients: [],
  consultations: [],
  activeClient: null,
  activeConsultation: null,
  app: null,
  lastChangeSummary: '',
  shareUrl: '',
  busy: false
};

const setupMount = document.getElementById('consultationSetupMount');
const toolsMount = document.getElementById('consultationToolsMount');

if (!setupMount || !toolsMount) throw new Error('Consultation workspace mounts are missing.');

setupMount.innerHTML = `
  <section class="panel consultation-panel">
    <div class="mini-heading">
      <div><p class="eyebrow">Tailor workspace</p><h2>Client consultation</h2></div>
      <span id="consultationStatus" class="status-badge">Starting</span>
    </div>
    <div class="consultation-grid">
      <label><span>Saved client</span><select id="clientSelect"><option value="">New client</option></select></label>
      <label><span>Client name</span><input id="clientName" type="text" maxlength="120" placeholder="Client full name"></label>
      <label><span>Email</span><input id="clientEmail" type="email" maxlength="160" placeholder="client@example.com"></label>
      <label><span>Phone</span><input id="clientPhone" type="tel" maxlength="50" placeholder="+254 …"></label>
    </div>
    <label><span>Client notes</span><textarea id="clientNotes" rows="2" placeholder="Preferences, fitting notes or communication details"></textarea></label>
    <div class="consultation-actions">
      <button id="saveClientButton" class="button button-primary" type="button">Save client photo & measurements</button>
      <button id="newClientButton" class="button button-ghost" type="button">New client</button>
    </div>
    <p id="clientMessage" class="inline-message" role="status"></p>

    <hr class="panel-divider">

    <div class="consultation-grid">
      <label><span>Saved consultation</span><select id="consultationSelect"><option value="">New consultation</option></select></label>
      <label><span>Consultation title</span><input id="consultationTitle" type="text" maxlength="160" placeholder="Wedding gown consultation"></label>
      <label><span>Event / delivery date</span><input id="consultationDate" type="date"></label>
    </div>
    <label><span>Consultation notes</span><textarea id="consultationNotes" rows="2" placeholder="Design goals, budget notes or fitting considerations"></textarea></label>
    <div class="consultation-actions">
      <button id="saveConsultationButton" class="button button-secondary" type="button">Save consultation</button>
      <button id="newConsultationButton" class="button button-ghost" type="button">New consultation</button>
    </div>
    <p id="consultationMessage" class="inline-message" role="status"></p>
  </section>

  <details class="panel studio-profile">
    <summary>Studio branding</summary>
    <p>These details appear on the client approval page.</p>
    <div class="consultation-grid">
      <label><span>Business name</span><input id="businessName" type="text" maxlength="100"></label>
      <label><span>Tagline</span><input id="businessTagline" type="text" maxlength="160"></label>
      <label><span>Phone</span><input id="businessPhone" type="tel" maxlength="50"></label>
      <label><span>Email</span><input id="businessEmail" type="email" maxlength="160"></label>
      <label><span>WhatsApp</span><input id="businessWhatsapp" type="tel" maxlength="50"></label>
      <label><span>Brand colour</span><input id="businessColour" type="color" value="#7c5cff"></label>
      <label class="full-row"><span>Logo</span><input id="businessLogo" type="file" accept="image/jpeg,image/png,image/webp"></label>
    </div>
    <div class="brand-preview"><img id="businessLogoPreview" class="hidden" alt="Business logo"><strong id="businessNamePreview">Dresscode Studio</strong></div>
    <button id="saveProfileButton" class="button button-secondary" type="button">Save studio branding</button>
    <p id="profileMessage" class="inline-message" role="status"></p>
  </details>
`;

toolsMount.innerHTML = `
  <section class="panel consultation-tools">
    <div class="mini-heading">
      <div><p class="eyebrow">Active consultation</p><h2 id="activeConsultationTitle">No consultation selected</h2></div>
      <span id="approvalBadge" class="status-badge">Draft</span>
    </div>
    <p id="activeConsultationCopy" class="muted-copy">Create a client and consultation to save versions, share approvals and record an order.</p>

    <div class="tool-section">
      <div class="mini-heading"><h3>Design versions</h3><span id="versionCount" class="status-badge">0 versions</span></div>
      <div id="versionGallery" class="version-gallery"><p class="muted-copy">Generated looks saved to this consultation appear here.</p></div>
      <label><span>Version note</span><input id="versionNote" type="text" maxlength="1000" placeholder="Example: Full sleeves and reduced train"></label>
      <button id="saveVersionButton" class="button button-primary" disabled type="button">Save current result as version</button>
      <p id="versionMessage" class="inline-message" role="status"></p>
    </div>

    <div class="tool-section">
      <h3>Simple fashion changes</h3>
      <div class="consultation-grid compact-grid">
        <label><span>Neckline</span><select id="changeNeckline"><option value="">Keep current</option><option>High neck</option><option>Round neck</option><option>V-neck</option><option>Sweetheart</option><option>Off shoulder</option><option>One shoulder</option></select></label>
        <label><span>Sleeves</span><select id="changeSleeves"><option value="">Keep current</option><option>Sleeveless</option><option>Short sleeves</option><option>Three-quarter sleeves</option><option>Full-length sleeves</option><option>Puff sleeves</option><option>Bell sleeves</option></select></label>
        <label><span>Length</span><select id="changeLength"><option value="">Keep current</option><option>Mini length</option><option>Knee length</option><option>Midi length</option><option>Floor length</option><option>Short train</option><option>Long train</option></select></label>
        <label><span>Fit</span><select id="changeFit"><option value="">Keep current</option><option>More fitted</option><option>More relaxed</option><option>More structured</option><option>More flowing</option><option>Higher waist</option><option>Lower waist</option></select></label>
        <label><span>Colour</span><input id="changeColour" type="text" maxlength="80" placeholder="Keep current"></label>
      </div>
      <label><span>Other change</span><textarea id="changeNotes" rows="2" placeholder="Embroidery placement, modesty, hem, buttons or another precise change"></textarea></label>
      <button id="applyChangesButton" class="button button-secondary" disabled type="button">Apply changes to current result</button>
      <p class="muted-copy small-copy">Applying a change regenerates the current try-on image. Save the result as a new version after reviewing it.</p>
      <p id="changeMessage" class="inline-message" role="status"></p>
    </div>

    <div class="tool-section">
      <h3>Client approval</h3>
      <button id="shareButton" class="button button-secondary" disabled type="button">Create branded approval link</button>
      <div id="shareRow" class="share-row hidden"><input id="shareUrl" type="url" readonly><button id="copyShareButton" class="button button-ghost" type="button">Copy</button><a id="openShareLink" class="button button-ghost" target="_blank" rel="noopener">Open</a></div>
      <p id="shareMessage" class="inline-message" role="status"></p>
    </div>

    <div class="tool-section">
      <h3>Deposit & tailoring order</h3>
      <div class="consultation-grid compact-grid">
        <label><span>Quote (KES)</span><input id="quoteAmount" type="number" min="0" step="1"></label>
        <label><span>Deposit (KES)</span><input id="depositAmount" type="number" min="0" step="1"></label>
        <label><span>Deposit method</span><select id="depositMethod"><option value="">Not recorded</option><option>M-PESA</option><option>Card</option><option>Cash</option><option>Bank transfer</option><option>Other</option></select></label>
        <label><span>Deposit status</span><select id="depositStatus"><option value="not_recorded">Not recorded</option><option value="pending">Pending</option><option value="paid">Paid</option><option value="refunded">Refunded</option></select></label>
        <label><span>Reference</span><input id="depositReference" type="text" maxlength="120"></label>
        <label><span>Order status</span><select id="orderStatus"><option value="consultation">Consultation</option><option value="design_approved">Design approved</option><option value="deposit_received">Deposit received</option><option value="in_production">In production</option><option value="ready">Ready</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></select></label>
        <label><span>Due date</span><input id="orderDueDate" type="date"></label>
      </div>
      <label><span>Order notes</span><textarea id="orderNotes" rows="2" placeholder="Fabric, fittings, balance due or production details"></textarea></label>
      <button id="saveOrderButton" class="button button-secondary" disabled type="button">Save order record</button>
      <p id="orderMessage" class="inline-message" role="status"></p>
    </div>
  </section>
`;

const $ = id => document.getElementById(id);
const elements = {
  status: $('consultationStatus'), clientSelect: $('clientSelect'), clientName: $('clientName'), clientEmail: $('clientEmail'), clientPhone: $('clientPhone'), clientNotes: $('clientNotes'), saveClient: $('saveClientButton'), newClient: $('newClientButton'), clientMessage: $('clientMessage'),
  consultationSelect: $('consultationSelect'), consultationTitle: $('consultationTitle'), consultationDate: $('consultationDate'), consultationNotes: $('consultationNotes'), saveConsultation: $('saveConsultationButton'), newConsultation: $('newConsultationButton'), consultationMessage: $('consultationMessage'),
  businessName: $('businessName'), businessTagline: $('businessTagline'), businessPhone: $('businessPhone'), businessEmail: $('businessEmail'), businessWhatsapp: $('businessWhatsapp'), businessColour: $('businessColour'), businessLogo: $('businessLogo'), businessLogoPreview: $('businessLogoPreview'), businessNamePreview: $('businessNamePreview'), saveProfile: $('saveProfileButton'), profileMessage: $('profileMessage'),
  activeTitle: $('activeConsultationTitle'), activeCopy: $('activeConsultationCopy'), approvalBadge: $('approvalBadge'), versionCount: $('versionCount'), versionGallery: $('versionGallery'), versionNote: $('versionNote'), saveVersion: $('saveVersionButton'), versionMessage: $('versionMessage'),
  changeNeckline: $('changeNeckline'), changeSleeves: $('changeSleeves'), changeLength: $('changeLength'), changeFit: $('changeFit'), changeColour: $('changeColour'), changeNotes: $('changeNotes'), applyChanges: $('applyChangesButton'), changeMessage: $('changeMessage'),
  shareButton: $('shareButton'), shareRow: $('shareRow'), shareUrl: $('shareUrl'), copyShare: $('copyShareButton'), openShare: $('openShareLink'), shareMessage: $('shareMessage'),
  quoteAmount: $('quoteAmount'), depositAmount: $('depositAmount'), depositMethod: $('depositMethod'), depositStatus: $('depositStatus'), depositReference: $('depositReference'), orderStatus: $('orderStatus'), orderDueDate: $('orderDueDate'), orderNotes: $('orderNotes'), saveOrder: $('saveOrderButton'), orderMessage: $('orderMessage')
};

function message(element, text, error = false) {
  element.textContent = text || '';
  element.classList.toggle('error-text', error);
}

function setBusy(busy) {
  state.busy = busy;
  [elements.saveClient, elements.saveConsultation, elements.saveProfile, elements.saveVersion, elements.applyChanges, elements.shareButton, elements.saveOrder]
    .forEach(button => { button.disabled = busy || button.dataset.unavailable === 'true'; });
}

function fileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!file) return resolve(null);
    if (file.size > 1_000_000) return reject(new Error('Choose a logo smaller than 1 MB.'));
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read the logo.'));
    reader.readAsDataURL(file);
  });
}

function money(value) {
  return new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', maximumFractionDigits: 0 }).format(Number(value || 0));
}

function option(select, value, label) {
  const item = document.createElement('option');
  item.value = value;
  item.textContent = label;
  select.appendChild(item);
}

function renderClientOptions() {
  const selected = state.activeClient?.id || '';
  elements.clientSelect.replaceChildren();
  option(elements.clientSelect, '', 'New client');
  state.clients.forEach(client => option(elements.clientSelect, client.id, `${client.name}${client.measurementCount ? ` · ${client.measurementCount} measurements` : ''}`));
  elements.clientSelect.value = selected;
}

function filteredConsultations() {
  return state.activeClient ? state.consultations.filter(item => item.clientId === state.activeClient.id) : state.consultations;
}

function renderConsultationOptions() {
  const selected = state.activeConsultation?.id || '';
  elements.consultationSelect.replaceChildren();
  option(elements.consultationSelect, '', 'New consultation');
  filteredConsultations().forEach(item => option(elements.consultationSelect, item.id, `${item.title} · ${item.versionCount} version${item.versionCount === 1 ? '' : 's'}`));
  elements.consultationSelect.value = selected;
}

function fillClient(client) {
  elements.clientName.value = client?.name || '';
  elements.clientEmail.value = client?.email || '';
  elements.clientPhone.value = client?.phone || '';
  elements.clientNotes.value = client?.notes || '';
}

function fillConsultation(consultation) {
  elements.consultationTitle.value = consultation?.title || '';
  elements.consultationDate.value = consultation?.eventDate || '';
  elements.consultationNotes.value = consultation?.notes || '';
  const order = consultation?.order || {};
  elements.quoteAmount.value = order.quoteAmount || '';
  elements.depositAmount.value = order.depositAmount || '';
  elements.depositMethod.value = order.depositMethod || '';
  elements.depositStatus.value = order.depositStatus || 'not_recorded';
  elements.depositReference.value = order.depositReference || '';
  elements.orderStatus.value = order.orderStatus || 'consultation';
  elements.orderDueDate.value = order.dueDate || '';
  elements.orderNotes.value = order.notes || '';
}

function approvalLabel(status) {
  return ({ not_shared: 'Not shared', draft: 'Draft', pending: 'Awaiting client', approved: 'Approved', changes_requested: 'Changes requested' })[status] || status || 'Draft';
}

function renderVersions() {
  const versions = state.activeConsultation?.versions || [];
  elements.versionCount.textContent = `${versions.length} version${versions.length === 1 ? '' : 's'}`;
  elements.versionGallery.replaceChildren();
  if (!versions.length) {
    const empty = document.createElement('p');
    empty.className = 'muted-copy';
    empty.textContent = 'Generate a look, review it, then save it as the first client version.';
    elements.versionGallery.appendChild(empty);
    return;
  }
  [...versions].reverse().forEach(version => {
    const card = document.createElement('article');
    card.className = 'version-card';
    const image = document.createElement('img');
    image.src = version.imageDataUrl;
    image.alt = version.label;
    const body = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = `${version.label} · ${version.status}`;
    const copy = document.createElement('p');
    copy.textContent = version.changeSummary || 'Saved try-on result';
    body.append(title, copy);
    card.append(image, body);
    elements.versionGallery.appendChild(card);
  });
}

function renderActiveConsultation() {
  const consultation = state.activeConsultation;
  elements.activeTitle.textContent = consultation?.title || 'No consultation selected';
  elements.activeCopy.textContent = consultation
    ? `${state.activeClient?.name || 'Client'} · ${consultation.eventDate || 'No event date'} · ${money(consultation.order?.quoteAmount || 0)} quote`
    : 'Create a client and consultation to save versions, share approvals and record an order.';
  elements.approvalBadge.textContent = approvalLabel(consultation?.approval?.status);
  const hasConsultation = Boolean(consultation);
  const hasResult = Boolean(state.app?.job?.id && state.app?.selectedAsset);
  const hasVersions = Boolean(consultation?.versions?.length);
  elements.saveVersion.dataset.unavailable = String(!hasConsultation || !hasResult);
  elements.applyChanges.dataset.unavailable = String(!hasResult);
  elements.shareButton.dataset.unavailable = String(!hasVersions);
  elements.saveOrder.dataset.unavailable = String(!hasConsultation);
  elements.saveVersion.disabled = state.busy || !hasConsultation || !hasResult;
  elements.applyChanges.disabled = state.busy || !hasResult;
  elements.shareButton.disabled = state.busy || !hasVersions;
  elements.saveOrder.disabled = state.busy || !hasConsultation;
  renderVersions();
}

function renderProfile() {
  const profile = state.studio?.profile || {};
  elements.businessName.value = profile.businessName || '';
  elements.businessTagline.value = profile.tagline || '';
  elements.businessPhone.value = profile.phone || '';
  elements.businessEmail.value = profile.email || '';
  elements.businessWhatsapp.value = profile.whatsapp || '';
  elements.businessColour.value = profile.accentColour || '#7c5cff';
  elements.businessNamePreview.textContent = profile.businessName || 'Dresscode Studio';
  elements.businessLogoPreview.classList.toggle('hidden', !profile.logoImage);
  if (profile.logoImage) elements.businessLogoPreview.src = profile.logoImage;
}

async function refreshLists() {
  const [clientsResult, consultationsResult] = await Promise.all([listClients(), listConsultations()]);
  state.clients = clientsResult.clients || [];
  state.consultations = consultationsResult.consultations || [];
  renderClientOptions();
  renderConsultationOptions();
}

async function saveClientRecord() {
  message(elements.clientMessage, '');
  const payload = {
    name: elements.clientName.value.trim(),
    email: elements.clientEmail.value.trim(),
    phone: elements.clientPhone.value.trim(),
    notes: elements.clientNotes.value.trim(),
    unit: state.app?.unit || 'cm',
    measurements: state.app?.measurements || {},
    modelImage: state.app?.modelImage || null
  };
  if (!payload.name) return message(elements.clientMessage, 'Enter the client name.', true);
  if (!payload.modelImage && !state.activeClient?.modelImage) return message(elements.clientMessage, 'Upload the client model photo first.', true);
  setBusy(true);
  try {
    const client = state.activeClient
      ? await updateClient(state.activeClient.id, payload)
      : await createClient(payload);
    state.activeClient = client;
    await refreshLists();
    renderClientOptions();
    renderConsultationOptions();
    window.dispatchEvent(new CustomEvent('dresscode:load-client', { detail: { client } }));
    message(elements.clientMessage, `Saved ${client.name}'s photo and ${Object.keys(client.measurements || {}).length} measurements.`);
  } catch (error) {
    message(elements.clientMessage, error.message, true);
  } finally {
    setBusy(false);
    renderActiveConsultation();
  }
}

async function selectClient(clientId) {
  state.activeConsultation = null;
  state.shareUrl = '';
  elements.shareRow.classList.add('hidden');
  if (!clientId) {
    state.activeClient = null;
    fillClient(null);
    fillConsultation(null);
    renderClientOptions();
    renderConsultationOptions();
    renderActiveConsultation();
    return;
  }
  setBusy(true);
  try {
    state.activeClient = await getClient(clientId);
    fillClient(state.activeClient);
    renderClientOptions();
    renderConsultationOptions();
    window.dispatchEvent(new CustomEvent('dresscode:load-client', { detail: { client: state.activeClient } }));
    message(elements.clientMessage, `Loaded ${state.activeClient.name}.`);
  } catch (error) {
    message(elements.clientMessage, error.message, true);
  } finally {
    setBusy(false);
    renderActiveConsultation();
  }
}

async function saveConsultationRecord() {
  message(elements.consultationMessage, '');
  if (!state.activeClient) return message(elements.consultationMessage, 'Save or select a client first.', true);
  const payload = {
    clientId: state.activeClient.id,
    title: elements.consultationTitle.value.trim(),
    eventDate: elements.consultationDate.value,
    notes: elements.consultationNotes.value.trim(),
    brief: state.app?.brief || null,
    inspirationImage: state.app?.inspirationImage || null,
    lastJobId: state.app?.job?.id || state.activeConsultation?.lastJobId || null
  };
  if (!payload.title) return message(elements.consultationMessage, 'Enter a consultation title.', true);
  setBusy(true);
  try {
    const consultation = state.activeConsultation
      ? await updateConsultation(state.activeConsultation.id, payload)
      : await createConsultation(payload);
    state.activeConsultation = consultation;
    await refreshLists();
    renderConsultationOptions();
    fillConsultation(consultation);
    window.dispatchEvent(new CustomEvent('dresscode:set-active-consultation', { detail: { consultationId: consultation.id, clientId: consultation.clientId } }));
    message(elements.consultationMessage, `Consultation saved for ${state.activeClient.name}.`);
  } catch (error) {
    message(elements.consultationMessage, error.message, true);
  } finally {
    setBusy(false);
    renderActiveConsultation();
  }
}

async function selectConsultation(consultationId) {
  if (!consultationId) {
    state.activeConsultation = null;
    state.shareUrl = '';
    fillConsultation(null);
    elements.shareRow.classList.add('hidden');
    renderConsultationOptions();
    renderActiveConsultation();
    window.dispatchEvent(new CustomEvent('dresscode:set-active-consultation', { detail: { consultationId: null, clientId: state.activeClient?.id } }));
    return;
  }
  setBusy(true);
  try {
    const consultation = await getConsultation(consultationId);
    const client = state.activeClient?.id === consultation.clientId ? state.activeClient : await getClient(consultation.clientId);
    state.activeClient = client;
    state.activeConsultation = consultation;
    fillClient(client);
    fillConsultation(consultation);
    renderClientOptions();
    renderConsultationOptions();
    window.dispatchEvent(new CustomEvent('dresscode:load-consultation', { detail: { consultation, client } }));
    message(elements.consultationMessage, `Loaded ${consultation.title}.`);
  } catch (error) {
    message(elements.consultationMessage, error.message, true);
  } finally {
    setBusy(false);
    renderActiveConsultation();
  }
}

async function saveVersion() {
  message(elements.versionMessage, '');
  if (!state.activeConsultation) return message(elements.versionMessage, 'Select a consultation first.', true);
  if (!state.app?.job?.id || !state.app.selectedAsset) return message(elements.versionMessage, 'Generate a try-on result first.', true);
  setBusy(true);
  try {
    await saveConsultationVersion(state.activeConsultation.id, {
      jobId: state.app.job.id,
      variationIndex: state.app.selectedVariation,
      label: `Version ${(state.activeConsultation.versions?.length || 0) + 1}`,
      changeSummary: elements.versionNote.value.trim() || state.lastChangeSummary
    });
    state.activeConsultation = await getConsultation(state.activeConsultation.id);
    elements.versionNote.value = '';
    await refreshLists();
    message(elements.versionMessage, 'Current try-on saved as a new client version.');
  } catch (error) {
    message(elements.versionMessage, error.message, true);
  } finally {
    setBusy(false);
    renderActiveConsultation();
  }
}

function buildChangePrompt() {
  const changes = [];
  if (elements.changeNeckline.value) changes.push(`change the neckline to ${elements.changeNeckline.value}`);
  if (elements.changeSleeves.value) changes.push(`change the sleeves to ${elements.changeSleeves.value}`);
  if (elements.changeLength.value) changes.push(`change the garment length to ${elements.changeLength.value}`);
  if (elements.changeFit.value) changes.push(`make the fit ${elements.changeFit.value}`);
  if (elements.changeColour.value.trim()) changes.push(`change the main garment colour to ${elements.changeColour.value.trim()}`);
  if (elements.changeNotes.value.trim()) changes.push(elements.changeNotes.value.trim());
  if (!changes.length) return '';
  return `Preserve the exact original person, face, hair, hands, body proportions, pose, camera, lighting and background. Preserve every successful garment detail not named below. ${changes.join('; ')}. Keep the result photorealistic with natural drape, seams, shadows and occlusion.`;
}

function applyChanges() {
  message(elements.changeMessage, '');
  const prompt = buildChangePrompt();
  if (!prompt) return message(elements.changeMessage, 'Choose or describe at least one fashion change.', true);
  state.lastChangeSummary = [elements.changeNeckline.value, elements.changeSleeves.value, elements.changeLength.value, elements.changeFit.value, elements.changeColour.value.trim(), elements.changeNotes.value.trim()].filter(Boolean).join(' · ');
  window.dispatchEvent(new CustomEvent('dresscode:apply-change', { detail: { prompt } }));
  message(elements.changeMessage, 'Change submitted. Review the regenerated result, then save it as a new version.');
}

async function createShareLink() {
  message(elements.shareMessage, '');
  if (!state.activeConsultation) return;
  setBusy(true);
  try {
    const result = await createApprovalShare(state.activeConsultation.id);
    const url = new URL('./approval.html', window.location.href);
    url.searchParams.set('token', result.token);
    if (getApiBaseUrl()) url.searchParams.set('api', getApiBaseUrl());
    state.shareUrl = url.toString();
    elements.shareUrl.value = state.shareUrl;
    elements.openShare.href = state.shareUrl;
    elements.shareRow.classList.remove('hidden');
    state.activeConsultation = await getConsultation(state.activeConsultation.id);
    await refreshLists();
    message(elements.shareMessage, 'Approval link created. Creating another link later will replace this one.');
  } catch (error) {
    message(elements.shareMessage, error.message, true);
  } finally {
    setBusy(false);
    renderActiveConsultation();
  }
}

async function copyShareLink() {
  if (!state.shareUrl) return;
  try {
    await navigator.clipboard.writeText(state.shareUrl);
    message(elements.shareMessage, 'Approval link copied.');
  } catch {
    elements.shareUrl.select();
    document.execCommand('copy');
    message(elements.shareMessage, 'Approval link copied.');
  }
}

async function saveOrder() {
  message(elements.orderMessage, '');
  if (!state.activeConsultation) return;
  setBusy(true);
  try {
    const result = await updateConsultationOrder(state.activeConsultation.id, {
      quoteAmount: elements.quoteAmount.value,
      depositAmount: elements.depositAmount.value,
      depositMethod: elements.depositMethod.value,
      depositStatus: elements.depositStatus.value,
      depositReference: elements.depositReference.value.trim(),
      orderStatus: elements.orderStatus.value,
      dueDate: elements.orderDueDate.value,
      notes: elements.orderNotes.value.trim()
    });
    state.activeConsultation.order = result.order;
    await refreshLists();
    message(elements.orderMessage, `Order record saved. Quote ${money(result.order.quoteAmount)}; deposit ${money(result.order.depositAmount)}.`);
  } catch (error) {
    message(elements.orderMessage, error.message, true);
  } finally {
    setBusy(false);
    renderActiveConsultation();
  }
}

async function saveProfile() {
  message(elements.profileMessage, '');
  setBusy(true);
  try {
    const logoImage = elements.businessLogo.files?.[0]
      ? await fileAsDataUrl(elements.businessLogo.files[0])
      : state.studio?.profile?.logoImage || null;
    state.studio = await updateConsultationStudio({
      businessName: elements.businessName.value.trim(),
      tagline: elements.businessTagline.value.trim(),
      phone: elements.businessPhone.value.trim(),
      email: elements.businessEmail.value.trim(),
      whatsapp: elements.businessWhatsapp.value.trim(),
      accentColour: elements.businessColour.value,
      logoImage
    });
    renderProfile();
    message(elements.profileMessage, 'Studio branding saved.');
  } catch (error) {
    message(elements.profileMessage, error.message, true);
  } finally {
    setBusy(false);
    renderActiveConsultation();
  }
}

function newClient() {
  state.activeClient = null;
  state.activeConsultation = null;
  document.getElementById('resetButton')?.click();
  window.dispatchEvent(new CustomEvent('dresscode:set-active-consultation', { detail: { consultationId: null, clientId: null } }));
  fillClient(null);
  fillConsultation(null);
  renderClientOptions();
  renderConsultationOptions();
  renderActiveConsultation();
  message(elements.clientMessage, 'Enter a client name, upload their photo and add measurements.');
}

function newConsultation() {
  state.activeConsultation = null;
  window.dispatchEvent(new CustomEvent('dresscode:new-consultation'));
  fillConsultation(null);
  renderConsultationOptions();
  renderActiveConsultation();
  window.dispatchEvent(new CustomEvent('dresscode:set-active-consultation', { detail: { consultationId: null, clientId: state.activeClient?.id } }));
  message(elements.consultationMessage, state.activeClient ? `Create a new consultation for ${state.activeClient.name}.` : 'Select a client first.');
}

window.addEventListener('dresscode:app-state', event => {
  state.app = event.detail;
  renderActiveConsultation();
});

elements.clientSelect.addEventListener('change', () => selectClient(elements.clientSelect.value));
elements.consultationSelect.addEventListener('change', () => selectConsultation(elements.consultationSelect.value));
elements.saveClient.addEventListener('click', saveClientRecord);
elements.newClient.addEventListener('click', newClient);
elements.saveConsultation.addEventListener('click', saveConsultationRecord);
elements.newConsultation.addEventListener('click', newConsultation);
elements.saveVersion.addEventListener('click', saveVersion);
elements.applyChanges.addEventListener('click', applyChanges);
elements.shareButton.addEventListener('click', createShareLink);
elements.copyShare.addEventListener('click', copyShareLink);
elements.saveOrder.addEventListener('click', saveOrder);
elements.saveProfile.addEventListener('click', saveProfile);
elements.businessLogo.addEventListener('change', async () => {
  try {
    const data = await fileAsDataUrl(elements.businessLogo.files?.[0]);
    elements.businessLogoPreview.src = data;
    elements.businessLogoPreview.classList.toggle('hidden', !data);
  } catch (error) {
    message(elements.profileMessage, error.message, true);
  }
});
elements.businessName.addEventListener('input', () => { elements.businessNamePreview.textContent = elements.businessName.value || 'Dresscode Studio'; });

async function initialise() {
  elements.status.textContent = 'Connecting';
  try {
    state.studio = await ensureConsultationStudio();
    renderProfile();
    await refreshLists();
    elements.status.textContent = 'Studio ready';
    elements.status.classList.add('ready');
    renderActiveConsultation();
  } catch (error) {
    elements.status.textContent = 'Backend required';
    elements.status.classList.add('error');
    message(elements.clientMessage, `${error.message} Save the Render backend URL under Backend connection.`, true);
  }
}

window.dispatchEvent(new CustomEvent('dresscode:request-state'));
initialise();
