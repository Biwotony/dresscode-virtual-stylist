import {
  ensureCreditWallet,
  getCreditWallet,
  getPaymentConfig,
  initializeCreditPayment,
  recoverCreditWallet,
  setWalletToken,
  verifyCreditPayment
} from './api.js?v=20260729-2';

const PAYMENT_EMAIL_KEY = 'dresscode-payment-email';
const LAST_REFERENCE_KEY = 'dresscode-last-payment-reference';
const PAYMENT_UI_MOUNT_KEY = '__dresscodePaymentsUiMounted';

if (!window[PAYMENT_UI_MOUNT_KEY]) {
  window[PAYMENT_UI_MOUNT_KEY] = true;

  // Remove any panel or badge left by an older cached copy before mounting once.
  document.querySelectorAll('#paymentPanel, .credit-badge').forEach(element => element.remove());

  const state = { config: null, wallet: null, busy: false };
  const providerBadge = document.getElementById('providerBadge');
  const generateButton = document.getElementById('generateButton');
  const formMessage = document.getElementById('formMessage');
  const backendSaveButton = document.getElementById('saveBackendButton');

  const styles = document.createElement('style');
  styles.dataset.dresscodePayments = 'true';
  styles.textContent = `
    .credit-badge { margin-left: .5rem; }
    .credit-badge.ready { border-color: rgba(19,185,129,.35); color: #c8f6e4; }
    .payment-panel { display: grid; gap: .9rem; }
    .payment-panel h2, .payment-panel p { margin: 0; }
    .payment-panel p { color: var(--muted); }
    .payment-summary { display:flex; justify-content:space-between; gap:1rem; align-items:center; flex-wrap:wrap; }
    .payment-balance { font-size:1.5rem; font-weight:800; }
    .payment-email { width:100%; border:1px solid var(--border); background:#10151c; color:var(--text); border-radius:12px; padding:.8rem .9rem; }
    .payment-plans { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:.75rem; }
    .payment-plan { text-align:left; border:1px solid var(--border); background:#10151c; color:var(--text); border-radius:15px; padding:.9rem; }
    .payment-plan:hover { border-color:rgba(124,92,255,.7); }
    .payment-plan strong, .payment-plan span, .payment-plan small { display:block; }
    .payment-plan span { margin-top:.2rem; color:#d9d1ff; font-weight:700; }
    .payment-plan small { margin-top:.25rem; color:var(--muted); }
    .payment-plan:disabled { opacity:.55; cursor:not-allowed; }
    .payment-status { min-height:1.25rem; color:var(--muted); overflow-wrap:anywhere; }
    .payment-account-note { font-size:.86rem; line-height:1.45; }
    .recovery-panel { border-top:1px solid rgba(255,255,255,.08); padding-top:.8rem; }
    .recovery-panel summary { cursor:pointer; font-weight:750; color:#d9d1ff; }
    .recovery-form { display:grid; grid-template-columns:1fr auto; gap:.65rem; margin-top:.75rem; }
    .recovery-form input { min-width:0; }
    .recovery-help { margin-top:.55rem!important; font-size:.82rem; }
    @media(max-width:700px){ .payment-plans,.recovery-form{grid-template-columns:1fr;} }
  `;
  document.head.querySelectorAll('style[data-dresscode-payments]').forEach(element => element.remove());
  document.head.appendChild(styles);

  const creditBadge = document.createElement('span');
  creditBadge.className = 'status-badge credit-badge hidden';
  creditBadge.textContent = '0 credits';
  providerBadge?.after(creditBadge);

  const panel = document.createElement('section');
  panel.className = 'panel payment-panel hidden';
  panel.id = 'paymentPanel';
  panel.innerHTML = `
    <div class="payment-summary">
      <div><p class="eyebrow">Paystack credits</p><h2>Buy try-on credits</h2></div>
      <div class="payment-balance"><span id="walletBalance">0</span> credits</div>
    </div>
    <p>Pay securely with M-PESA or card through Paystack. One credit starts one realistic try-on session; review and corrective regeneration do not use another credit.</p>
    <label><span>Account & receipt email</span><input id="paymentEmail" class="payment-email" type="email" autocomplete="email" placeholder="you@example.com"></label>
    <p class="payment-account-note">After the first successful payment, credits are linked to this email. Paystack can send the transaction receipt to it when customer receipts are enabled in your Paystack settings.</p>
    <div id="paymentPlans" class="payment-plans"></div>
    <details class="recovery-panel">
      <summary>Recover paid credits on this browser</summary>
      <div class="recovery-form">
        <input id="recoveryReference" type="text" autocomplete="off" placeholder="Paystack receipt reference">
        <button id="recoverCreditsButton" class="button button-secondary" type="button">Recover credits</button>
      </div>
      <p class="recovery-help">Enter the same email used at checkout and the transaction reference shown on the Paystack receipt. Recovery rotates the account token, so an older browser session will be signed out.</p>
    </details>
    <p id="paymentStatus" class="payment-status" role="status" aria-live="polite"></p>
  `;
  const developerSettings = document.querySelector('.developer-settings');
  if (developerSettings?.parentNode) developerSettings.parentNode.insertBefore(panel, developerSettings);
  else document.querySelector('.control-column')?.appendChild(panel);

  const balance = panel.querySelector('#walletBalance');
  const email = panel.querySelector('#paymentEmail');
  const plans = panel.querySelector('#paymentPlans');
  const status = panel.querySelector('#paymentStatus');
  const recoveryReference = panel.querySelector('#recoveryReference');
  const recoverButton = panel.querySelector('#recoverCreditsButton');

  function money(value, currency) {
    return new Intl.NumberFormat('en-KE', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value);
  }

  function showStatus(message, error = false) {
    status.textContent = message || '';
    status.style.color = error ? 'var(--danger)' : 'var(--muted)';
  }

  function rememberEmail(value) {
    const clean = String(value || '').trim().toLowerCase();
    if (clean) localStorage.setItem(PAYMENT_EMAIL_KEY, clean);
  }

  function renderWallet() {
    const amount = state.wallet?.balance || 0;
    balance.textContent = amount;
    creditBadge.textContent = `${amount} credit${amount === 1 ? '' : 's'}`;
    creditBadge.classList.remove('hidden');
    creditBadge.classList.toggle('ready', amount > 0);
    if (state.wallet?.email) {
      email.value = state.wallet.email;
      rememberEmail(state.wallet.email);
    }
  }

  function renderPlans() {
    plans.replaceChildren();
    for (const plan of state.config?.plans || []) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'payment-plan';
      button.innerHTML = `<strong>${plan.name}</strong><span>${money(plan.price, state.config.currency)}</span><small>${plan.credits} credit${plan.credits === 1 ? '' : 's'}${plan.description ? ` · ${plan.description}` : ''}</small>`;
      button.addEventListener('click', () => buy(plan.id));
      plans.appendChild(button);
    }
  }

  function setBusy(busy) {
    state.busy = busy;
    plans.querySelectorAll('button').forEach(button => { button.disabled = busy; });
    recoverButton.disabled = busy;
  }

  async function refreshWallet() {
    state.wallet = await getCreditWallet();
    renderWallet();
    return state.wallet;
  }

  async function buy(planId) {
    if (state.busy) return;
    const receiptEmail = email.value.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(receiptEmail)) {
      showStatus('Enter a valid email address for the Paystack receipt and credit account.', true);
      email.focus();
      return;
    }
    rememberEmail(receiptEmail);
    setBusy(true);
    showStatus('Opening secure Paystack checkout…');
    try {
      const payment = await initializeCreditPayment({ email: receiptEmail, planId });
      localStorage.setItem(LAST_REFERENCE_KEY, payment.reference);
      window.location.assign(payment.authorizationUrl);
    } catch (error) {
      showStatus(error.message, true);
      setBusy(false);
    }
  }

  async function recoverCredits() {
    if (state.busy) return;
    const receiptEmail = email.value.trim().toLowerCase();
    const reference = recoveryReference.value.trim();
    if (!/^\S+@\S+\.\S+$/.test(receiptEmail)) {
      showStatus('Enter the email used for the Paystack payment.', true);
      email.focus();
      return;
    }
    if (!reference) {
      showStatus('Enter the transaction reference from the Paystack receipt.', true);
      recoveryReference.focus();
      return;
    }
    rememberEmail(receiptEmail);
    setBusy(true);
    showStatus('Verifying the receipt and restoring the credit account…');
    try {
      const result = await recoverCreditWallet({ email: receiptEmail, reference });
      setWalletToken(result.token);
      state.wallet = result.wallet;
      renderWallet();
      localStorage.setItem(LAST_REFERENCE_KEY, result.reference);
      recoveryReference.value = '';
      showStatus(`Credit account recovered. ${result.wallet.balance} credit${result.wallet.balance === 1 ? '' : 's'} available.`);
    } catch (error) {
      showStatus(error.message, true);
    } finally {
      setBusy(false);
    }
  }

  async function verifyReturnPayment() {
    const query = new URLSearchParams(window.location.search);
    const reference = query.get('reference') || query.get('trxref');
    if (!reference || !state.config?.enabled) return;
    showStatus('Confirming payment with Paystack…');
    try {
      const result = await verifyCreditPayment(reference);
      state.wallet = result.wallet;
      renderWallet();
      localStorage.setItem(LAST_REFERENCE_KEY, reference);
      showStatus(`Payment confirmed. ${result.wallet.balance} credit${result.wallet.balance === 1 ? '' : 's'} available. Recovery reference: ${reference}`);
      query.delete('reference');
      query.delete('trxref');
      const next = `${window.location.pathname}${query.toString() ? `?${query}` : ''}${window.location.hash}`;
      window.history.replaceState({}, '', next);
    } catch (error) {
      showStatus(error.message, true);
    }
  }

  async function initialisePayments() {
    try {
      state.config = await getPaymentConfig();
      if (!state.config.enabled) return;
      panel.classList.remove('hidden');
      email.value = localStorage.getItem(PAYMENT_EMAIL_KEY) || '';
      recoveryReference.value = localStorage.getItem(LAST_REFERENCE_KEY) || '';
      await ensureCreditWallet();
      await refreshWallet();
      renderPlans();
      await verifyReturnPayment();
    } catch (error) {
      panel.classList.remove('hidden');
      showStatus(error.message, true);
    }
  }

  recoverButton.addEventListener('click', recoverCredits);
  email.addEventListener('change', () => rememberEmail(email.value));

  generateButton?.addEventListener('click', event => {
    if (!state.config?.required) return;
    if ((state.wallet?.balance || 0) < 1) {
      event.preventDefault();
      event.stopImmediatePropagation();
      formMessage.textContent = 'Buy at least one try-on credit before starting Realistic Virtual Try-On.';
      formMessage.style.color = 'var(--danger)';
      panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    window.setTimeout(() => refreshWallet().catch(() => {}), 1400);
  }, true);

  backendSaveButton?.addEventListener('click', () => {
    window.setTimeout(() => initialisePayments(), 700);
  });

  initialisePayments();
}
