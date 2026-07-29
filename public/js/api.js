const API_STORAGE_KEY = 'dresscode-api-base-url';
const WALLET_STORAGE_KEY = 'dresscode-credit-wallet-token';

export function getApiBaseUrl() {
  const saved = localStorage.getItem(API_STORAGE_KEY);
  const configured = window.DRESSCODE_CONFIG?.apiBaseUrl;
  return (saved || configured || '').replace(/\/$/, '');
}

export function setApiBaseUrl(value) {
  const normalised = String(value || '').trim().replace(/\/$/, '');
  if (normalised) localStorage.setItem(API_STORAGE_KEY, normalised);
  else localStorage.removeItem(API_STORAGE_KEY);
  return normalised;
}

export function getWalletToken() {
  return localStorage.getItem(WALLET_STORAGE_KEY) || '';
}

export function setWalletToken(token) {
  if (token) localStorage.setItem(WALLET_STORAGE_KEY, token);
  else localStorage.removeItem(WALLET_STORAGE_KEY);
}

function apiUrl(path) {
  return `${getApiBaseUrl()}${path}`;
}

async function request(path, options = {}, { wallet = false } = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (wallet && getWalletToken()) headers.Authorization = `Bearer ${getWalletToken()}`;
  const response = await fetch(apiUrl(path), { ...options, headers });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(result.error || 'The request failed.');
    error.status = response.status;
    throw error;
  }
  return result;
}

export function resolveAssetUrl(path) {
  if (!path) return '';
  if (/^https?:\/\//i.test(path) || path.startsWith('data:')) return path;
  return `${getApiBaseUrl()}${path}`;
}

export function getHealth() {
  return request('/api/health', { cache: 'no-store' });
}

export function getPaymentConfig() {
  return request('/api/payments/config', { cache: 'no-store' });
}

export async function ensureCreditWallet() {
  const existing = getWalletToken();
  if (existing) {
    try {
      return await request('/api/payments/wallet', { cache: 'no-store' }, { wallet: true });
    } catch (error) {
      if (error.status !== 401) throw error;
      setWalletToken('');
    }
  }
  const created = await request('/api/payments/wallets', { method: 'POST', body: '{}' });
  setWalletToken(created.token);
  return created.wallet;
}

export function getCreditWallet() {
  return request('/api/payments/wallet', { cache: 'no-store' }, { wallet: true });
}

export function initializeCreditPayment({ email, planId }) {
  return request('/api/payments/initialize', {
    method: 'POST',
    body: JSON.stringify({ email, planId })
  }, { wallet: true });
}

export function verifyCreditPayment(reference) {
  return request(`/api/payments/verify/${encodeURIComponent(reference)}`, { cache: 'no-store' }, { wallet: true });
}

export function createTryOnJob(payload) {
  return request('/api/try-on/jobs', {
    method: 'POST',
    body: JSON.stringify(payload)
  }, { wallet: true });
}

export function getTryOnJob(id) {
  return request(`/api/try-on/jobs/${id}`, { cache: 'no-store' });
}

export function actOnTryOnStage(id, stage, action, payload = {}) {
  return request(`/api/try-on/jobs/${id}/stages/${stage}/${action}`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function deleteTryOnJob(id) {
  return request(`/api/try-on/jobs/${id}`, { method: 'DELETE' });
}
