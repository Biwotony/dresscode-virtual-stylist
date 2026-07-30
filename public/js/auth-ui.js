import {
  clearLegacyAccess,
  consumeMagicLink,
  deleteAccount,
  getAuthConfig,
  getAuthSession,
  getSessionToken,
  requestMagicLink,
  setSessionToken,
  signOutAllSessions,
  signOutSession
} from './api.js?v=20260730-auth';

const state = { account: null, config: null, busy: false };
const headerMount = document.getElementById('authMount');
const gateMount = document.getElementById('authGateMount');
const privateSections = [document.getElementById('studio'), document.querySelector('.workspace')].filter(Boolean);

if (!headerMount || !gateMount) throw new Error('Authentication mounts are missing.');

headerMount.innerHTML = `<button id="openAccountButton" class="auth-account-button hidden" type="button"></button>`;
gateMount.innerHTML = `
  <section id="authGate" class="auth-gate" aria-labelledby="authTitle">
    <div class="auth-card panel">
      <p class="eyebrow">Secure studio access</p>
      <h1 id="authTitle">Sign in to your Dresscode workspace</h1>
      <p>Your clients, consultations, credits and generated designs follow your verified email across devices.</p>
      <form id="authForm" class="auth-form">
        <label><span>Email address</span><input id="authEmail" type="email" autocomplete="email" required placeholder="tailor@example.com"></label>
        <button id="sendMagicLinkButton" class="button button-primary button-large" type="submit">Email me a secure sign-in link</button>
      </form>
      <p id="authMessage" class="auth-message" role="status" aria-live="polite"></p>
      <p class="auth-fine">The link expires quickly and can be used once. Existing browser clients and paid credits are claimed into the verified account during the first sign-in.</p>
    </div>
  </section>
  <dialog id="accountDialog" class="account-dialog">
    <form method="dialog" class="account-dialog-card">
      <div class="mini-heading"><div><p class="eyebrow">Dresscode account</p><h2 id="accountEmail"></h2></div><button class="text-button" value="cancel">Close</button></div>
      <p>Signing in on another device restores this studio, its clients and the account credit balance.</p>
      <div class="account-actions">
        <button id="signOutButton" class="button button-secondary" type="button">Sign out here</button>
        <button id="signOutAllButton" class="button button-ghost" type="button">Sign out all devices</button>
      </div>
      <details class="danger-zone">
        <summary>Delete account and all data</summary>
        <p>This permanently removes the studio, client records, photos, measurements, consultations, generated files, orders, credits and sessions.</p>
        <label><span>Type DELETE to confirm</span><input id="deleteConfirmation" type="text" autocomplete="off"></label>
        <button id="deleteAccountButton" class="button button-danger" type="button">Permanently delete account</button>
      </details>
      <p id="accountMessage" class="auth-message" role="status"></p>
    </form>
  </dialog>
`;

const $ = id => document.getElementById(id);
const gate = $('authGate');
const message = $('authMessage');
const accountMessage = $('accountMessage');
const accountButton = $('openAccountButton');
const dialog = $('accountDialog');

function magicTokenFromHash() {
  const hash = window.location.hash || '';
  if (!hash.startsWith('#auth=')) return '';
  return decodeURIComponent(hash.slice('#auth='.length));
}

function cleanMagicHash() {
  if (!(window.location.hash || '').startsWith('#auth=')) return;
  window.history.replaceState({}, '', `${window.location.pathname}${window.location.search}#studio`);
}

function showMessage(text, error = false) {
  message.textContent = text || '';
  message.classList.toggle('error-text', error);
}

function setBusy(busy) {
  state.busy = busy;
  $('sendMagicLinkButton').disabled = busy;
  $('authEmail').disabled = busy;
  $('signOutButton').disabled = busy;
  $('signOutAllButton').disabled = busy;
  $('deleteAccountButton').disabled = busy;
}

function lockStudio() {
  document.body.classList.add('auth-locked');
  gate.classList.remove('hidden');
  accountButton.classList.add('hidden');
  privateSections.forEach(section => section.setAttribute('aria-hidden', 'true'));
}

function unlockStudio(account) {
  state.account = account;
  document.body.classList.remove('auth-locked');
  gate.classList.add('hidden');
  accountButton.classList.remove('hidden');
  accountButton.textContent = account.email;
  $('accountEmail').textContent = account.email;
  privateSections.forEach(section => section.removeAttribute('aria-hidden'));
  window.dispatchEvent(new CustomEvent('dresscode:authenticated', { detail: { account } }));
}

async function validateSession() {
  if (!getSessionToken()) return false;
  try {
    const result = await getAuthSession();
    unlockStudio(result.account);
    return true;
  } catch {
    setSessionToken('');
    return false;
  }
}

async function consumeLink(token) {
  lockStudio();
  setBusy(true);
  showMessage('Verifying your secure sign-in link…');
  try {
    const result = await consumeMagicLink(token);
    setSessionToken(result.token);
    clearLegacyAccess();
    cleanMagicHash();
    window.location.reload();
  } catch (error) {
    cleanMagicHash();
    showMessage(error.message, true);
  } finally {
    setBusy(false);
  }
}

$('authForm').addEventListener('submit', async event => {
  event.preventDefault();
  if (state.busy) return;
  const email = $('authEmail').value.trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    showMessage('Enter a valid email address.', true);
    return;
  }
  setBusy(true);
  showMessage('Sending your secure sign-in link…');
  try {
    const result = await requestMagicLink(email);
    if (result.debugLink) {
      message.innerHTML = `Development link: <a href="${result.debugLink}">open Dresscode</a>`;
    } else {
      showMessage('Check your email. The sign-in link expires in a few minutes and can be used once.');
    }
  } catch (error) {
    showMessage(error.message, true);
  } finally {
    setBusy(false);
  }
});

accountButton.addEventListener('click', () => dialog.showModal());

$('signOutButton').addEventListener('click', async () => {
  setBusy(true);
  try {
    await signOutSession();
  } catch {
    // Clear the local session even when the backend is unavailable.
  }
  setSessionToken('');
  state.account = null;
  dialog.close();
  window.location.reload();
});

$('signOutAllButton').addEventListener('click', async () => {
  setBusy(true);
  accountMessage.textContent = 'Revoking all sessions…';
  try {
    await signOutAllSessions();
    setSessionToken('');
    dialog.close();
    window.location.reload();
  } catch (error) {
    accountMessage.textContent = error.message;
  } finally {
    setBusy(false);
  }
});

$('deleteAccountButton').addEventListener('click', async () => {
  const confirmation = $('deleteConfirmation').value.trim();
  if (confirmation !== 'DELETE') {
    accountMessage.textContent = 'Type DELETE exactly to confirm.';
    return;
  }
  setBusy(true);
  accountMessage.textContent = 'Permanently deleting the account and stored files…';
  try {
    await deleteAccount(confirmation);
    setSessionToken('');
    clearLegacyAccess();
    localStorage.removeItem('dresscode-payment-email');
    localStorage.removeItem('dresscode-last-payment-reference');
    dialog.close();
    window.location.reload();
  } catch (error) {
    accountMessage.textContent = error.message;
  } finally {
    setBusy(false);
  }
});

window.addEventListener('dresscode:auth-required', () => {
  const hadAccount = Boolean(state.account);
  setSessionToken('');
  if (hadAccount) {
    window.location.reload();
    return;
  }
  lockStudio();
  showMessage('Your session expired or was revoked. Sign in again.', true);
});

async function initialise() {
  lockStudio();
  try {
    state.config = await getAuthConfig();
    if (!state.config.emailConfigured && !state.config.developmentLinks) {
      showMessage('Email sign-in is not configured on the backend yet.', true);
    }
  } catch (error) {
    showMessage(`${error.message} Check the backend connection.`, true);
  }
  const token = magicTokenFromHash();
  if (token) {
    await consumeLink(token);
    return;
  }
  await validateSession();
}

initialise();
