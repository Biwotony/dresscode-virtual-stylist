import { requestGeneratedLook, resolveProviderImage } from './api.js';
import { buildStylingBrief, formatBriefAsText } from './brief.js';
import { renderConceptPreview } from './canvas.js';
import { convertMeasurement, measurementFields, readMeasurements } from './measurements.js';

const state = {
  unit: 'cm',
  modelImage: null,
  modelFileName: '',
  inspirationImage: null,
  inspirationFileName: '',
  generatedImage: null,
  brief: null,
  providerConfigured: false
};

const elements = {
  modelInput: document.getElementById('modelUpload'),
  modelChooseButton: document.getElementById('modelChooseButton'),
  modelDropzone: document.getElementById('modelDropzone'),
  modelFileName: document.getElementById('modelFileName'),
  inspirationInput: document.getElementById('inspirationUpload'),
  inspirationChooseButton: document.getElementById('inspirationChooseButton'),
  inspirationDropzone: document.getElementById('inspirationDropzone'),
  inspirationFileName: document.getElementById('inspirationFileName'),
  inspirationPreviewPanel: document.getElementById('inspirationPreviewPanel'),
  inspirationPreview: document.getElementById('inspirationPreview'),
  removeInspirationButton: document.getElementById('removeInspirationButton'),
  unitCm: document.getElementById('unitCm'),
  unitIn: document.getElementById('unitIn'),
  idea: document.getElementById('idea'),
  event: document.getElementById('event'),
  garment: document.getElementById('garment'),
  fit: document.getElementById('fit'),
  fabric: document.getElementById('fabric'),
  colour: document.getElementById('colour'),
  colourText: document.getElementById('colourText'),
  generateButton: document.getElementById('generateButton'),
  resetButton: document.getElementById('resetButton'),
  formMessage: document.getElementById('formMessage'),
  providerBadge: document.getElementById('providerBadge'),
  previewTitle: document.getElementById('previewTitle'),
  previewMode: document.getElementById('previewMode'),
  previewStage: document.getElementById('previewStage'),
  emptyPreview: document.getElementById('emptyPreview'),
  beforeImage: document.getElementById('beforeImage'),
  afterImage: document.getElementById('afterImage'),
  afterLayer: document.getElementById('afterLayer'),
  splitHandle: document.getElementById('splitHandle'),
  compareControl: document.getElementById('compareControl'),
  compareRange: document.getElementById('compareRange'),
  downloadImageButton: document.getElementById('downloadImageButton'),
  downloadBriefButton: document.getElementById('downloadBriefButton'),
  measurementCount: document.getElementById('measurementCount'),
  briefSummary: document.getElementById('briefSummary'),
  briefInstructions: document.getElementById('briefInstructions'),
  renderCanvas: document.getElementById('renderCanvas')
};

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Unable to read the selected file.'));
    reader.readAsDataURL(file);
  });
}

function validateImageFile(file) {
  const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
  if (!allowedTypes.has(file.type)) {
    throw new Error('Please choose a JPG, PNG or WEBP image.');
  }
  if (file.size > 7 * 1024 * 1024) {
    throw new Error('Please choose an image smaller than 7 MB.');
  }
}

async function setModelFile(file) {
  validateImageFile(file);
  const dataUrl = await readFileAsDataUrl(file);
  state.modelImage = dataUrl;
  state.modelFileName = file.name;
  state.generatedImage = null;
  elements.modelFileName.textContent = file.name;
  elements.beforeImage.src = dataUrl;
  elements.previewTitle.textContent = 'Model ready for styling';
  elements.previewMode.textContent = 'Photo added';
  elements.previewStage.classList.remove('empty');
  elements.emptyPreview.classList.add('hidden');
  elements.beforeImage.classList.remove('hidden');
  elements.afterLayer.classList.add('hidden');
  elements.splitHandle.classList.add('hidden');
  elements.compareControl.classList.add('hidden');
  elements.downloadImageButton.disabled = true;
  clearMessage();
}

async function setInspirationFile(file) {
  validateImageFile(file);
  const dataUrl = await readFileAsDataUrl(file);
  state.inspirationImage = dataUrl;
  state.inspirationFileName = file.name;
  elements.inspirationFileName.textContent = file.name;
  elements.inspirationPreview.src = dataUrl;
  elements.inspirationPreviewPanel.classList.remove('hidden');
  clearMessage();
}

function clearInspiration() {
  state.inspirationImage = null;
  state.inspirationFileName = '';
  elements.inspirationInput.value = '';
  elements.inspirationFileName.textContent = '';
  elements.inspirationPreview.removeAttribute('src');
  elements.inspirationPreviewPanel.classList.add('hidden');
}

function setupFilePicker({ input, button, dropzone, onFile }) {
  button.addEventListener('click', () => input.click());
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      await onFile(file);
    } catch (error) {
      showMessage(error.message);
      input.value = '';
    }
  });

  ['dragenter', 'dragover'].forEach(eventName => {
    dropzone.addEventListener(eventName, event => {
      event.preventDefault();
      dropzone.classList.add('dragging');
    });
  });

  ['dragleave', 'drop'].forEach(eventName => {
    dropzone.addEventListener(eventName, event => {
      event.preventDefault();
      dropzone.classList.remove('dragging');
    });
  });

  dropzone.addEventListener('drop', async event => {
    const file = event.dataTransfer?.files?.[0];
    if (!file) return;
    try {
      await onFile(file);
    } catch (error) {
      showMessage(error.message);
    }
  });
}

function switchUnit(nextUnit) {
  if (nextUnit === state.unit) return;

  for (const field of measurementFields) {
    const input = document.getElementById(field.id);
    if (!input.value) continue;
    input.value = convertMeasurement(input.value, state.unit, nextUnit);
  }

  state.unit = nextUnit;
  elements.unitCm.setAttribute('aria-pressed', String(nextUnit === 'cm'));
  elements.unitIn.setAttribute('aria-pressed', String(nextUnit === 'in'));
  for (const label of document.querySelectorAll('.unit-label')) label.textContent = nextUnit;
}

function normaliseHex(value) {
  const trimmed = value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed.toLowerCase();
  return null;
}

function syncColourFromPicker() {
  elements.colourText.value = elements.colour.value.toLowerCase();
}

function syncColourFromText() {
  const colour = normaliseHex(elements.colourText.value);
  if (colour) {
    elements.colour.value = colour;
    elements.colourText.value = colour;
    clearMessage();
  } else {
    showMessage('Enter a colour as a six-digit hex value, for example #17634e.');
  }
}

function collectBrief() {
  const measurements = readMeasurements(document, state.unit);
  return buildStylingBrief({
    event: elements.event.value,
    garment: elements.garment.value,
    fit: elements.fit.value,
    fabric: elements.fabric.value,
    colour: elements.colour.value,
    idea: elements.idea.value,
    measurements,
    inspirationAdded: Boolean(state.inspirationImage)
  });
}

function renderBrief(brief) {
  const count = Object.keys(brief.measurements).length;
  elements.measurementCount.textContent = `${count} measurement${count === 1 ? '' : 's'}`;
  elements.briefSummary.textContent = brief.idea;
  elements.briefInstructions.replaceChildren(
    ...brief.instructions.map(instruction => {
      const item = document.createElement('li');
      item.textContent = instruction;
      return item;
    })
  );
  elements.downloadBriefButton.disabled = false;
}

function setComparePosition(value) {
  const percentage = Math.min(100, Math.max(0, Number(value)));
  elements.afterLayer.style.clipPath = `inset(0 0 0 ${percentage}%)`;
  elements.splitHandle.style.left = `${percentage}%`;
}

function setLoading(isLoading) {
  elements.generateButton.disabled = isLoading;
  elements.generateButton.textContent = isLoading ? 'Creating look…' : 'Dress the model';
  if (isLoading) {
    elements.previewMode.textContent = 'Generating';
    elements.previewTitle.textContent = 'Preparing your styled look';
  }
}

function showGeneratedImage(source, modeLabel) {
  state.generatedImage = source;
  elements.afterImage.src = source;
  elements.afterLayer.classList.remove('hidden');
  elements.splitHandle.classList.remove('hidden');
  elements.compareControl.classList.remove('hidden');
  elements.previewStage.classList.remove('empty');
  elements.previewMode.textContent = modeLabel;
  elements.previewTitle.textContent = `${elements.event.value} ${elements.garment.value.toLowerCase()} concept`;
  elements.downloadImageButton.disabled = false;
  setComparePosition(elements.compareRange.value);
}

async function generateLook() {
  clearMessage();
  if (!state.modelImage) {
    showMessage('Choose a model photo before generating a look.');
    elements.modelChooseButton.focus();
    return;
  }

  const colour = normaliseHex(elements.colourText.value);
  if (!colour) {
    showMessage('Enter a valid six-digit colour value.');
    elements.colourText.focus();
    return;
  }

  elements.colour.value = colour;
  const brief = collectBrief();
  state.brief = brief;
  renderBrief(brief);
  setLoading(true);

  try {
    const conceptPreview = await renderConceptPreview({
      canvas: elements.renderCanvas,
      modelImage: state.modelImage,
      garment: brief.garment,
      fit: brief.fit,
      fabric: brief.fabric,
      colour: brief.colour,
      measurements: brief.measurements
    });

    showGeneratedImage(conceptPreview, 'Concept preview');

    try {
      const result = await requestGeneratedLook({
        modelImage: state.modelImage,
        inspirationImage: state.inspirationImage,
        brief
      });
      const providerImage = resolveProviderImage(result);
      if (providerImage) {
        showGeneratedImage(providerImage, 'AI provider');
      } else if (result.mode === 'demo') {
        elements.previewMode.textContent = 'Concept preview';
      }
    } catch (apiError) {
      elements.previewMode.textContent = 'Local preview';
      showMessage(`${apiError.message} The local concept preview is still available.`, false);
    }
  } catch (error) {
    showMessage(error.message || 'Unable to create the preview.');
  } finally {
    setLoading(false);
  }
}

function downloadDataUrl(dataUrl, fileName) {
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function downloadText(text, fileName) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function resetApp() {
  state.unit = 'cm';
  state.modelImage = null;
  state.modelFileName = '';
  state.generatedImage = null;
  state.brief = null;
  clearInspiration();

  elements.modelInput.value = '';
  elements.modelFileName.textContent = '';
  elements.idea.value = '';
  elements.event.value = 'Wedding';
  elements.garment.value = 'Gown';
  elements.fit.value = 'Balanced';
  elements.fabric.value = 'Silk';
  elements.colour.value = '#17634e';
  elements.colourText.value = '#17634e';
  elements.compareRange.value = '55';

  for (const field of measurementFields) {
    document.getElementById(field.id).value = '';
  }

  switchUnit('cm');
  elements.unitCm.setAttribute('aria-pressed', 'true');
  elements.unitIn.setAttribute('aria-pressed', 'false');
  for (const label of document.querySelectorAll('.unit-label')) label.textContent = 'cm';

  elements.previewTitle.textContent = 'Upload a model to begin';
  elements.previewMode.textContent = 'Waiting';
  elements.previewStage.classList.add('empty');
  elements.emptyPreview.classList.remove('hidden');
  elements.beforeImage.removeAttribute('src');
  elements.afterImage.removeAttribute('src');
  elements.afterLayer.classList.add('hidden');
  elements.splitHandle.classList.add('hidden');
  elements.compareControl.classList.add('hidden');
  elements.downloadImageButton.disabled = true;
  elements.downloadBriefButton.disabled = true;
  elements.measurementCount.textContent = '0 measurements';
  elements.briefSummary.textContent = 'Your structured styling instructions will appear after generation.';
  elements.briefInstructions.replaceChildren();
  clearMessage();
}

function showMessage(message, isError = true) {
  elements.formMessage.textContent = message;
  elements.formMessage.style.color = isError ? 'var(--danger)' : 'var(--muted)';
}

function clearMessage() {
  elements.formMessage.textContent = '';
}

async function checkProviderMode() {
  try {
    const response = await fetch('./api/health', { cache: 'no-store' });
    if (!response.ok) throw new Error('Health check failed.');
    const result = await response.json();
    state.providerConfigured = Boolean(result.providerConfigured);
    elements.providerBadge.textContent = state.providerConfigured ? 'AI provider connected' : 'Local concept mode';
  } catch {
    elements.providerBadge.textContent = 'Static demo mode';
  }
}

setupFilePicker({
  input: elements.modelInput,
  button: elements.modelChooseButton,
  dropzone: elements.modelDropzone,
  onFile: setModelFile
});

setupFilePicker({
  input: elements.inspirationInput,
  button: elements.inspirationChooseButton,
  dropzone: elements.inspirationDropzone,
  onFile: setInspirationFile
});

elements.removeInspirationButton.addEventListener('click', clearInspiration);
elements.unitCm.addEventListener('click', () => switchUnit('cm'));
elements.unitIn.addEventListener('click', () => switchUnit('in'));
elements.colour.addEventListener('input', syncColourFromPicker);
elements.colourText.addEventListener('change', syncColourFromText);
elements.colourText.addEventListener('blur', syncColourFromText);
elements.generateButton.addEventListener('click', generateLook);
elements.resetButton.addEventListener('click', resetApp);
elements.compareRange.addEventListener('input', event => setComparePosition(event.target.value));
elements.downloadImageButton.addEventListener('click', () => {
  if (state.generatedImage) downloadDataUrl(state.generatedImage, 'dresscode-look.png');
});
elements.downloadBriefButton.addEventListener('click', () => {
  if (state.brief) downloadText(formatBriefAsText(state.brief), 'dresscode-styling-brief.txt');
});

checkProviderMode();
