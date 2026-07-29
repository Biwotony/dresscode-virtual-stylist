const CONSENT_VERSION = '2026-07-29-compact';
const STORAGE_PREFIX = 'dresscode-client-consent:';
let activeClientId = null;

function consentKey(clientId) {
  return `${STORAGE_PREFIX}${clientId || 'draft'}`;
}

function readConsent(clientId) {
  try {
    const value = JSON.parse(localStorage.getItem(consentKey(clientId)) || 'null');
    return Boolean(value?.confirmed && value?.version === CONSENT_VERSION);
  } catch {
    return false;
  }
}

function writeConsent(clientId, confirmed) {
  try {
    if (!confirmed) {
      localStorage.removeItem(consentKey(clientId));
      return;
    }
    localStorage.setItem(consentKey(clientId), JSON.stringify({
      confirmed: true,
      confirmedAt: new Date().toISOString(),
      version: CONSENT_VERSION
    }));
  } catch {
    // Consent still applies for this page when browser storage is unavailable.
  }
}

function checkbox() {
  return document.getElementById('clientUploadConsent');
}

function errorMessage(text = '') {
  const element = document.getElementById('privacyConsentError');
  if (element) element.textContent = text;
}

function setConsentForClient(clientId) {
  activeClientId = clientId || null;
  const input = checkbox();
  if (!input) return;
  input.checked = readConsent(activeClientId);
  errorMessage('');
}

function mountPrivacyNotice() {
  const panel = document.querySelector('#consultationSetupMount .consultation-panel');
  if (!panel) {
    requestAnimationFrame(mountPrivacyNotice);
    return;
  }
  if (document.getElementById('clientUploadConsent')) return;

  const notice = document.createElement('section');
  notice.className = 'privacy-consent-card';
  notice.innerHTML = `
    <label class="consent-check">
      <input id="clientUploadConsent" type="checkbox">
      <span>I confirm I have my client's permission to upload and store their photo for this consultation.</span>
    </label>
    <details class="privacy-fine-print">
      <summary>See how we handle this data</summary>
      <p>Client photos, measurements, inspiration images and generated try-ons are automatically deleted from Dresscode after 7 days. Try-on images are processed through the OpenAI API; API inputs and outputs are not used to train models by default and may be kept for up to 30 days in safety and abuse-monitoring logs, unless approved retention controls apply.</p>
    </details>
    <p id="privacyConsentError" class="privacy-consent-error" role="alert" aria-live="polite"></p>
  `;

  const clientMessage = panel.querySelector('#clientMessage');
  if (clientMessage) panel.insertBefore(notice, clientMessage);
  else panel.appendChild(notice);

  const input = checkbox();
  input.checked = readConsent(activeClientId);
  input.addEventListener('change', () => {
    writeConsent(activeClientId, input.checked);
    errorMessage('');
  });
}

function requireConsent(event) {
  const action = event.target.closest?.('#saveClientButton, #generateButton');
  if (!action) return;
  const input = checkbox();
  if (input?.checked) return;

  event.preventDefault();
  event.stopImmediatePropagation();
  errorMessage('Confirm client permission before saving the photo or starting generation.');
  input?.focus();
  document.querySelector('.privacy-consent-card')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

document.addEventListener('click', requireConsent, true);

window.addEventListener('dresscode:load-client', event => {
  const clientId = event.detail?.client?.id || null;
  const draftConfirmed = readConsent(null);
  activeClientId = clientId;
  if (clientId && draftConfirmed && !readConsent(clientId)) {
    writeConsent(clientId, true);
    writeConsent(null, false);
  }
  setConsentForClient(clientId);
});

window.addEventListener('dresscode:set-active-consultation', event => {
  if ('clientId' in (event.detail || {})) setConsentForClient(event.detail.clientId || null);
});

mountPrivacyNotice();
