const CONSENT_VERSION = '2026-07-29';
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
    // Consent still applies for this page even when browser storage is unavailable.
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
  notice.setAttribute('aria-labelledby', 'privacyConsentTitle');
  notice.innerHTML = `
    <span class="privacy-status-label">Current MVP data handling</span>
    <h3 id="privacyConsentTitle">Privacy, retention and third-party processing</h3>
    <ul>
      <li>Saved client photos, measurements, inspiration images and design versions currently remain on the configured Dresscode backend disk until the underlying records and files are permanently removed. Automatic 30, 60 or 90-day purging is not active yet.</li>
      <li><strong>Reset canvas is not deletion.</strong> A permanent-delete control is not yet available in this screen, so do not use Dresscode for a client who requires immediate self-service deletion.</li>
      <li>When a try-on is generated, the model and inspiration images are sent to the OpenAI API. OpenAI states that API data is not used to train models by default and that image-generation or image-edit content may be retained for up to 30 days in abuse-monitoring logs, unless approved retention controls apply. Legal or safety exceptions may require longer retention.</li>
    </ul>
    <label class="consent-check">
      <input id="clientUploadConsent" type="checkbox">
      <span>I confirm I have my client's permission to upload and store their photo for this consultation.</span>
    </label>
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
