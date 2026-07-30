const CONSENT_VERSION = '2026-07-30-account';
window.DRESSCODE_CONSENT_VERSION = CONSENT_VERSION;
let activeClientId = null;
let draftConfirmed = false;

function checkbox() {
  return document.getElementById('clientUploadConsent');
}

function errorMessage(text = '') {
  const element = document.getElementById('privacyConsentError');
  if (element) element.textContent = text;
}

function setConsent(confirmed) {
  const input = checkbox();
  if (input) input.checked = Boolean(confirmed);
  draftConfirmed = Boolean(confirmed);
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
  checkbox().checked = draftConfirmed;
  checkbox().addEventListener('change', () => {
    draftConfirmed = checkbox().checked;
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
  const client = event.detail?.client || null;
  activeClientId = client?.id || null;
  setConsent(Boolean(client?.consent?.confirmed) || (!client && draftConfirmed));
});

window.addEventListener('dresscode:set-active-consultation', event => {
  if (!event.detail?.clientId) {
    activeClientId = null;
    setConsent(false);
  }
});

mountPrivacyNotice();
