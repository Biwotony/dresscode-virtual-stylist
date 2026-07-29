import {
  actOnTryOnStage,
  createTryOnJob,
  deleteTryOnJob,
  getApiBaseUrl,
  getHealth,
  getTryOnJob,
  resolveAssetUrl,
  setApiBaseUrl
} from './api.js';
import { buildStylingBrief } from './brief.js';
import { convertMeasurement, measurementFields, readMeasurements } from './measurements.js';

const state = {
  unit: 'cm',
  modelImage: null,
  inspirationImage: null,
  generatedImage: null,
  brief: null,
  health: null,
  job: null,
  pollTimer: null,
  reviewStage: null,
  selectedVariation: 0
};

const $ = id => document.getElementById(id);
const elements = {
  modelInput: $('modelUpload'),
  modelChooseButton: $('modelChooseButton'),
  modelDropzone: $('modelDropzone'),
  modelFileName: $('modelFileName'),
  inspirationInput: $('inspirationUpload'),
  inspirationChooseButton: $('inspirationChooseButton'),
  inspirationDropzone: $('inspirationDropzone'),
  inspirationFileName: $('inspirationFileName'),
  inspirationPreviewPanel: $('inspirationPreviewPanel'),
  inspirationPreview: $('inspirationPreview'),
  removeInspirationButton: $('removeInspirationButton'),
  unitCm: $('unitCm'),
  unitIn: $('unitIn'),
  idea: $('idea'),
  event: $('event'),
  garment: $('garment'),
  fit: $('fit'),
  fabric: $('fabric'),
  colour: $('colour'),
  colourText: $('colourText'),
  variations: $('variations'),
  generateButton: $('generateButton'),
  resetButton: $('resetButton'),
  formMessage: $('formMessage'),
  providerBadge: $('providerBadge'),
  backendUrl: $('backendUrl'),
  saveBackendButton: $('saveBackendButton'),
  previewTitle: $('previewTitle'),
  previewMode: $('previewMode'),
  previewStage: $('previewStage'),
  emptyPreview: $('emptyPreview'),
  beforeImage: $('beforeImage'),
  afterImage: $('afterImage'),
  afterLayer: $('afterLayer'),
  splitHandle: $('splitHandle'),
  compareControl: $('compareControl'),
  compareRange: $('compareRange'),
  variationList: $('variationList'),
  downloadImageButton: $('downloadImageButton'),
  jobPanel: $('jobPanel'),
  jobTitle: $('jobTitle'),
  jobStatus: $('jobStatus'),
  timeline: $('timeline'),
  reviewArea: $('reviewArea'),
  reviewImage: $('reviewImage'),
  reviewTitle: $('reviewTitle'),
  reviewCopy: $('reviewCopy'),
  correctionPrompt: $('correctionPrompt'),
  approveButton: $('approveButton'),
  regenerateButton: $('regenerateButton'),
  rejectButton: $('rejectButton')
};

function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read that image.'));
    reader.readAsDataURL(file);
  });
}

function validateFile(file) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    throw new Error('Choose a JPG, PNG or WEBP image.');
  }
  if (file.size > 8 * 1024 * 1024) throw new Error('Choose an image smaller than 8 MB.');
}

function setupPicker(input, button, zone, onFile) {
  button.addEventListener('click', () => input.click());
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (file) await handleFile(file, onFile, input);
  });
  ['dragenter', 'dragover'].forEach(name => zone.addEventListener(name, event => {
    event.preventDefault();
    zone.classList.add('dragging');
  }));
  ['dragleave', 'drop'].forEach(name => zone.addEventListener(name, event => {
    event.preventDefault();
    zone.classList.remove('dragging');
  }));
  zone.addEventListener('drop', async event => {
    const file = event.dataTransfer?.files?.[0];
    if (file) await handleFile(file, onFile);
  });
}

async function handleFile(file, onFile, input) {
  try {
    validateFile(file);
    await onFile(file);
    clearMessage();
  } catch (error) {
    showMessage(error.message);
    if (input) input.value = '';
  }
}

async function setModel(file) {
  state.modelImage = await readFile(file);
  elements.modelFileName.textContent = file.name;
  elements.beforeImage.src = state.modelImage;
  elements.previewStage.classList.remove('empty');
  elements.emptyPreview.classList.add('hidden');
  elements.previewTitle.textContent = 'Model ready';
  elements.previewMode.textContent = 'Original photo';
}

async function setInspiration(file) {
  state.inspirationImage = await readFile(file);
  elements.inspirationFileName.textContent = file.name;
  elements.inspirationPreview.src = state.inspirationImage;
  elements.inspirationPreviewPanel.classList.remove('hidden');
}

function clearInspiration() {
  state.inspirationImage = null;
  elements.inspirationInput.value = '';
  elements.inspirationFileName.textContent = '';
  elements.inspirationPreview.removeAttribute('src');
  elements.inspirationPreviewPanel.classList.add('hidden');
}

function switchUnit(next) {
  if (next === state.unit) return;
  for (const field of measurementFields) {
    const input = $(field.id);
    if (input.value) input.value = convertMeasurement(input.value, state.unit, next);
  }
  state.unit = next;
  elements.unitCm.setAttribute('aria-pressed', String(next === 'cm'));
  elements.unitIn.setAttribute('aria-pressed', String(next === 'in'));
  document.querySelectorAll('.unit-label').forEach(label => { label.textContent = next; });
}

function normaliseHex(value) {
  return /^#[0-9a-f]{6}$/i.test(value.trim()) ? value.trim().toLowerCase() : null;
}

function collectBrief() {
  return buildStylingBrief({
    event: elements.event.value,
    garment: elements.garment.value,
    fit: elements.fit.value,
    fabric: elements.fabric.value,
    colour: elements.colour.value,
    idea: elements.idea.value,
    measurements: readMeasurements(document, state.unit),
    inspirationAdded: Boolean(state.inspirationImage),
    variationCount: Number(elements.variations.value)
  });
}

function showImage(source, label = 'Real try-on') {
  state.generatedImage = source;
  elements.afterImage.src = source;
  elements.afterLayer.classList.remove('hidden');
  elements.splitHandle.classList.remove('hidden');
  elements.compareControl.classList.remove('hidden');
  elements.previewStage.classList.remove('empty');
  elements.previewMode.textContent = label;
  elements.downloadImageButton.disabled = false;
  setCompare(elements.compareRange.value);
}

function setCompare(value) {
  const percent = Math.max(0, Math.min(100, Number(value)));
  elements.afterLayer.style.clipPath = `inset(0 0 0 ${percent}%)`;
  elements.splitHandle.style.left = `${percent}%`;
}

function showMessage(text, error = true) {
  elements.formMessage.textContent = text;
  elements.formMessage.style.color = error ? 'var(--danger)' : 'var(--muted)';
}

function clearMessage() {
  elements.formMessage.textContent = '';
}

function setBusy(busy) {
  elements.generateButton.disabled = busy || !state.health?.realTryOnReady;
  elements.generateButton.textContent = busy ? 'Starting real try-on…' : 'Generate real try-on';
}

async function refreshHealth() {
  elements.backendUrl.value = getApiBaseUrl();
  try {
    state.health = await getHealth();
    if (state.health?.ok !== true) throw new Error('Not a Dresscode backend.');
    elements.providerBadge.textContent = state.health.realTryOnReady ? 'Real try-on ready' : 'Backend needs API key';
    elements.providerBadge.className = `status-badge ${state.health.realTryOnReady ? 'ready' : 'error'}`;
  } catch {
    state.health = { realTryOnReady: false };
    elements.providerBadge.textContent = getApiBaseUrl() ? 'Backend unavailable' : 'Static frontend only';
    elements.providerBadge.className = 'status-badge error';
  }
  setBusy(false);
}

function renderStartingState() {
  elements.jobPanel.classList.remove('hidden');
  elements.jobTitle.textContent = 'Uploading photos';
  elements.jobStatus.textContent = 'Starting';
  elements.reviewArea.classList.add('hidden');
  elements.timeline.replaceChildren(...['Reference crop', 'Clean garment', 'Real try-on'].map((label, index) => {
    const row = document.createElement('div');
    row.className = 'timeline-item';
    row.dataset.status = index === 0 && state.inspirationImage ? 'processing' : 'pending';
    row.innerHTML = `<span class="timeline-dot"></span><strong>${label}</strong><small>${index === 0 && state.inspirationImage ? 'Starting' : 'Waiting'}</small>`;
    return row;
  }));
  elements.previewTitle.textContent = 'Starting real try-on';
  elements.previewMode.textContent = 'Processing';
  elements.jobPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function showStartError(message) {
  elements.jobPanel.classList.remove('hidden');
  elements.jobTitle.textContent = 'Try-on could not start';
  elements.jobStatus.textContent = 'Failed';
  elements.reviewArea.classList.remove('hidden');
  elements.reviewImage.classList.add('hidden');
  elements.reviewTitle.textContent = 'Generation failed';
  elements.reviewCopy.textContent = message;
  elements.approveButton.classList.add('hidden');
  elements.regenerateButton.classList.add('hidden');
  elements.rejectButton.classList.add('hidden');
  elements.correctionPrompt.classList.add('hidden');
  elements.jobPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function startTryOn() {
  clearMessage();
  if (!state.modelImage) return showMessage('Choose a model photo first.');
  if (!state.health?.realTryOnReady) {
    return showMessage('Connect a Node backend with a working OpenAI API key before starting real try-on.');
  }
  const colour = normaliseHex(elements.colourText.value);
  if (!colour) return showMessage('Use a valid six-digit colour such as #17634e.');

  elements.colour.value = colour;
  state.brief = collectBrief();
  state.selectedVariation = 0;
  setBusy(true);
  renderStartingState();
  showMessage('Real generation has started. One high-quality result can take one to three minutes.', false);

  try {
    state.job = await createTryOnJob({
      modelImage: state.modelImage,
      inspirationImage: state.inspirationImage,
      brief: state.brief,
      variationCount: state.brief.variationCount
    });
    renderJob(state.job);
    schedulePoll();
  } catch (error) {
    showMessage(error.message);
    showStartError(error.message);
  } finally {
    setBusy(false);
  }
}

function stageLabel(stage) {
  return ({ reference: 'Reference crop', garment: 'Clean garment', tryon: 'Real try-on' })[stage];
}

function statusLabel(status) {
  return ({ pending: 'Waiting', processing: 'Processing', review: 'Needs review', approved: 'Approved', skipped: 'Skipped', failed: 'Failed', rejected: 'Rejected' })[status] || status;
}

function renderTimeline(job) {
  elements.timeline.replaceChildren(...['reference', 'garment', 'tryon'].map(name => {
    const stage = job.stages[name];
    const row = document.createElement('div');
    row.className = 'timeline-item';
    row.dataset.status = stage.status;
    row.innerHTML = `<span class="timeline-dot"></span><strong>${stageLabel(name)}</strong><small>${statusLabel(stage.status)}</small>`;
    return row;
  }));
}

function renderVariations(assets) {
  elements.variationList.replaceChildren();
  assets.forEach((asset, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `variation${index === state.selectedVariation ? ' active' : ''}`;
    const url = resolveAssetUrl(asset.url);
    button.innerHTML = `<img src="${url}" alt="${asset.label || `Variation ${index + 1}`}"><span>${asset.label || `Variation ${index + 1}`}</span>`;
    button.addEventListener('click', () => {
      state.selectedVariation = index;
      renderVariations(assets);
      showImage(url, 'Real try-on');
      elements.reviewImage.src = url;
    });
    elements.variationList.appendChild(button);
  });
}

function reviewableStage(job) {
  for (const name of ['reference', 'garment', 'tryon']) {
    if (['review', 'failed'].includes(job.stages[name].status)) return name;
  }
  return null;
}

function renderReview(job, stageName) {
  state.reviewStage = stageName;
  elements.correctionPrompt.classList.remove('hidden');
  elements.regenerateButton.classList.remove('hidden');
  elements.rejectButton.classList.remove('hidden');

  if (!stageName) {
    elements.reviewArea.classList.add('hidden');
    return;
  }

  const stage = job.stages[stageName];
  const asset = stage.assets?.[stageName === 'tryon' ? state.selectedVariation : 0];
  elements.reviewArea.classList.remove('hidden');
  elements.reviewImage.classList.toggle('hidden', !asset);
  if (asset) elements.reviewImage.src = resolveAssetUrl(asset.url);
  elements.reviewTitle.textContent = stage.status === 'failed' ? `${stageLabel(stageName)} failed` : `Review ${stageLabel(stageName).toLowerCase()}`;
  elements.reviewCopy.textContent = stage.error || ({
    reference: 'Confirm that the crop contains the intended garment or complete look.',
    garment: 'Confirm that the clean reference preserves the correct construction and details.',
    tryon: 'Confirm that the result preserves the person and applies the requested outfit naturally.'
  })[stageName];
  elements.approveButton.classList.toggle('hidden', stage.status !== 'review');
  elements.approveButton.textContent = stageName === 'tryon' ? 'Approve selected look' : 'Approve and continue';
  elements.correctionPrompt.value = '';
  elements.correctionPrompt.placeholder = stageName === 'tryon' ? 'Example: preserve the original face and hands; correct the left sleeve.' : 'Describe exactly what should be corrected.';
}

function renderJob(job) {
  state.job = job;
  elements.jobPanel.classList.remove('hidden');
  renderTimeline(job);
  const reviewStage = reviewableStage(job);
  const processingEntry = Object.entries(job.stages).find(([, stage]) => stage.status === 'processing');

  elements.jobStatus.textContent = job.status === 'complete' ? 'Complete' : job.status === 'rejected' ? 'Rejected' : reviewStage ? 'Review required' : processingEntry ? 'Processing' : 'Active';
  elements.jobTitle.textContent = job.status === 'complete' ? 'Try-on approved' : reviewStage ? `Review ${stageLabel(reviewStage).toLowerCase()}` : processingEntry ? `Creating ${stageLabel(processingEntry[0]).toLowerCase()}` : 'Preparing try-on';

  if (processingEntry) {
    elements.previewTitle.textContent = `Creating ${stageLabel(processingEntry[0]).toLowerCase()}`;
    elements.previewMode.textContent = 'Processing';
  }

  renderReview(job, reviewStage);
  const assets = job.stages.tryon.assets || [];
  if (assets.length) {
    state.selectedVariation = Math.min(state.selectedVariation, assets.length - 1);
    renderVariations(assets);
    const selected = resolveAssetUrl(assets[state.selectedVariation].url);
    showImage(selected, job.status === 'complete' ? 'Approved try-on' : 'Real try-on');
    elements.previewTitle.textContent = assets[state.selectedVariation].label || 'Real try-on';
    clearMessage();
  }

  if (reviewStage && job.stages[reviewStage].status === 'failed') {
    showMessage(job.stages[reviewStage].error || 'Generation failed. Review the error and retry.');
    elements.jobPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  if (job.status === 'rejected') showMessage('This try-on job was rejected.', false);
}

function schedulePoll() {
  clearTimeout(state.pollTimer);
  const shouldPoll = state.job && state.job.status === 'active' && Object.values(state.job.stages).some(stage => ['pending', 'processing'].includes(stage.status));
  if (!shouldPoll) return;

  state.pollTimer = setTimeout(async () => {
    try {
      state.job = await getTryOnJob(state.job.id);
      renderJob(state.job);
      schedulePoll();
    } catch (error) {
      showMessage(error.message);
      schedulePoll();
    }
  }, 1800);
}

async function stageAction(action) {
  if (!state.job || !state.reviewStage) return;
  const prompt = elements.correctionPrompt.value.trim();
  if (action === 'regenerate' && !prompt) return showMessage('Describe the correction before regenerating.');
  try {
    const payload = { prompt };
    if (state.reviewStage === 'tryon') payload.variationIndex = state.selectedVariation;
    state.job = await actOnTryOnStage(state.job.id, state.reviewStage, action, payload);
    renderJob(state.job);
    schedulePoll();
    clearMessage();
  } catch (error) {
    showMessage(error.message);
  }
}

function download(url, name) {
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

async function reset() {
  clearTimeout(state.pollTimer);
  if (state.job?.id) deleteTryOnJob(state.job.id).catch(() => {});
  state.job = null;
  state.modelImage = null;
  state.generatedImage = null;
  state.brief = null;
  clearInspiration();
  elements.modelInput.value = '';
  elements.modelFileName.textContent = '';
  elements.idea.value = '';
  elements.beforeImage.removeAttribute('src');
  elements.afterImage.removeAttribute('src');
  elements.previewStage.classList.add('empty');
  elements.emptyPreview.classList.remove('hidden');
  elements.afterLayer.classList.add('hidden');
  elements.splitHandle.classList.add('hidden');
  elements.compareControl.classList.add('hidden');
  elements.variationList.replaceChildren();
  elements.jobPanel.classList.add('hidden');
  elements.reviewArea.classList.add('hidden');
  elements.previewTitle.textContent = 'Upload a model to begin';
  elements.previewMode.textContent = 'Waiting';
  elements.downloadImageButton.disabled = true;
  measurementFields.forEach(field => { $(field.id).value = ''; });
  clearMessage();
}

setupPicker(elements.modelInput, elements.modelChooseButton, elements.modelDropzone, setModel);
setupPicker(elements.inspirationInput, elements.inspirationChooseButton, elements.inspirationDropzone, setInspiration);
elements.removeInspirationButton.addEventListener('click', clearInspiration);
elements.unitCm.addEventListener('click', () => switchUnit('cm'));
elements.unitIn.addEventListener('click', () => switchUnit('in'));
elements.colour.addEventListener('input', () => { elements.colourText.value = elements.colour.value; });
elements.colourText.addEventListener('change', () => {
  const value = normaliseHex(elements.colourText.value);
  if (value) elements.colour.value = value;
  else showMessage('Use a valid colour value such as #17634e.');
});
elements.generateButton.addEventListener('click', startTryOn);
elements.resetButton.addEventListener('click', reset);
elements.compareRange.addEventListener('input', event => setCompare(event.target.value));
elements.approveButton.addEventListener('click', () => stageAction('approve'));
elements.regenerateButton.addEventListener('click', () => stageAction('regenerate'));
elements.rejectButton.addEventListener('click', () => stageAction('reject'));
elements.downloadImageButton.addEventListener('click', () => {
  if (state.generatedImage) download(state.generatedImage, 'dresscode-tryon.png');
});
elements.saveBackendButton.addEventListener('click', async () => {
  setApiBaseUrl(elements.backendUrl.value);
  await refreshHealth();
  showMessage('Backend connection saved.', false);
});

refreshHealth();
