import {
  ensureCreditWallet,
  getCreditWallet,
  getPaymentConfig,
  getSessionToken,
  initializeCreditPayment,
  verifyCreditPayment
} from './api.js?v=20260730-auth';

const PAYMENT_UI_MOUNT_KEY = '__dresscodePaymentsUiMountedV2';
if (!window[PAYMENT_UI_MOUNT_KEY]) {
  window[PAYMENT_UI_MOUNT_KEY] = true;
  document.querySelectorAll('#paymentPanel, .credit-badge').forEach(element => element.remove());

  const state = { config: null, wallet: null, account: null, busy: false, initialized: false };
  const providerBadge = document.getElementById('providerBadge');
  const generateButton = document.getElementById('generateButton');
  const formMessage = document.getElementById('formMessage');
  const backendSaveButton = document.getElementById('saveBackendButton');

  const styles = document.createElement('style');
  styles.dataset.dresscodePayments = 'true';
  styles.textContent = `
    .credit-badge{margin-left:.2rem}.credit-badge.ready{border-color:rgba(19,185,129,.35);color:#c8f6e4}.payment-panel{display:grid;gap:.9rem}.payment-panel h2,.payment-panel p{margin:0}.payment-panel p{color:var(--muted)}.payment-summary{display:flex;justify-content:space-between;gap:1rem;align-items:center;flex-wrap:wrap}.payment-balance{font-size:1.5rem;font-weight:800}.payment-plans{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.75rem}.payment-plan{text-align:left;border:1px solid var(--border);background:#10151c;color:var(--text);border-radius:15px;padding:.9rem}.payment-plan:hover{border-color:rgba(124,92,255,.7)}.payment-plan strong,.payment-plan span,.payment-plan small{display:block}.payment-plan span{margin-top:.2rem;color:#d9d1ff;font-weight:700}.payment-plan small{margin-top:.25rem;color:var(--muted)}.payment-plan:disabled{opacity:.55;cursor:not-allowed}.payment-status{min-height:1.25rem;color:var(--muted);overflow-wrap:anywhere}.payment-account-note{font-size:.86rem;line-height:1.45}@media(max-width:700px){.payment-plans{grid-template-columns:1fr}}
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
    <div class="payment-summary"><div><p class="eyebrow">Account credits</p><h2>Buy try-on credits</h2></div><div class="payment-balance"><span id="walletBalance">0</span> credits</div></div>
    <p>Pay securely with M-PESA or card through Paystack. One credit starts one realistic try-on session; focused revisions do not use another credit.</p>
    <p class="payment-account-note">Credits belong to your signed-in Dresscode account and are restored automatically when you sign in on another device. Paystack sends the payment receipt to the account email when customer receipts are enabled.</p>
    <div id="paymentPlans" class="payment-plans"></div>
    <p id="paymentStatus" class="payment-status" role="status" aria-live="polite"></p>
  `;
  const developerSettings = document.querySelector('.developer-settings');
  if (developerSettings?.parentNode) developerSettings.parentNode.insertBefore(panel, developerSettings);
  else document.querySelector('.control-column')?.appendChild(panel);

  const balance = panel.querySelector('#walletBalance');
  const plans = panel.querySelector('#paymentPlans');
  const status = panel.querySelector('#paymentStatus');

  function money(value, currency) {
    return new Intl.NumberFormat('en-KE', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value);
  }

  function showStatus(message, error = false) {
    status.textContent = message || '';
    status.style.color = error ? 'var(--danger)' : 'var(--muted)';
  }

  function renderWallet() {
    const amount = state.wallet?.balance || 0;
    balance.textContent = amount;
    creditBadge.textContent = `${amount} credit${amount === 1 ? '' : 's'}`;
    creditBadge.classList.remove('hidden');
    creditBadge.classList.toggle('ready', amount > 0);
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
  }

  async function refreshWallet() {
    state.wallet = await getCreditWallet();
    renderWallet();
    return state.wallet;
  }

  async function buy(planId) {
    if (state.busy || !state.account?.email) return;
    setBusy(true);
    showStatus('Opening secure Paystack checkout…');
    try {
      const payment = await initializeCreditPayment({ email: state.account.email, planId });
      window.location.assign(payment.authorizationUrl);
    } catch (error) {
      showStatus(error.message, true);
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
      showStatus(`Payment confirmed. ${result.wallet.balance} credit${result.wallet.balance === 1 ? '' : 's'} available.`);
      query.delete('reference');
      query.delete('trxref');
      const next = `${window.location.pathname}${query.toString() ? `?${query}` : ''}${window.location.hash}`;
      window.history.replaceState({}, '', next);
    } catch (error) {
      showStatus(error.message, true);
    }
  }

  async function initialisePayments(account = state.account) {
    if (!getSessionToken() || !account) return;
    state.account = account;
    try {
      state.config = await getPaymentConfig();
      if (!state.config.enabled) return;
      panel.classList.remove('hidden');
      await ensureCreditWallet();
      await refreshWallet();
      renderPlans();
      await verifyReturnPayment();
      state.initialized = true;
    } catch (error) {
      panel.classList.remove('hidden');
      showStatus(error.message, true);
    }
  }

  generateButton?.addEventListener('click', event => {
    if (!state.config?.required) return;
    if ((state.wallet?.balance || 0) < 1) {
      event.preventDefault();
      event.stopImmediatePropagation();
      formMessage.textContent = 'Buy at least one try-on credit before starting generation.';
      formMessage.style.color = 'var(--danger)';
      panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    window.setTimeout(() => refreshWallet().catch(() => {}), 1400);
  }, true);

  backendSaveButton?.addEventListener('click', () => window.setTimeout(() => initialisePayments(), 700));
  window.addEventListener('dresscode:authenticated', event => initialisePayments(event.detail?.account));
  window.addEventListener('dresscode:signed-out', () => {
    state.account = null;
    state.wallet = null;
    state.initialized = false;
    panel.classList.add('hidden');
    creditBadge.classList.add('hidden');
  });
}
