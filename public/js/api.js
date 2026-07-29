const API_STORAGE_KEY = 'dresscode-api-base-url';
const WALLET_STORAGE_KEY = 'dresscode-credit-wallet-token';
const STUDIO_STORAGE_KEY = 'dresscode-studio-token';

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

export function getStudioToken() {
  return localStorage.getItem(STUDIO_STORAGE_KEY) || '';
}

export function setStudioToken(token) {
  if (token) localStorage.setItem(STUDIO_STORAGE_KEY, token);
  else localStorage.removeItem(STUDIO_STORAGE_KEY);
}

function apiUrl(path) {
  return `${getApiBaseUrl()}${path}`;
}

async function request(path, options = {}, { wallet = false, studio = false } = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (wallet && getWalletToken()) headers.Authorization = `Bearer ${getWalletToken()}`;
  if (studio && getStudioToken()) headers['X-Dresscode-Studio'] = getStudioToken();
  const response = await fetch(apiUrl(path), { ...options, headers });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(result.error || 'The request failed.');
    error.status = response.status;
    error.detail = result.detail;
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

export function recoverCreditWallet({ email, reference }) {
  return request('/api/payments/initialize', {
    method: 'POST',
    body: JSON.stringify({ email, planId: `recover:${String(reference || '').trim()}` })
  }, { wallet: true });
}

export function verifyCreditPayment(reference) {
  return request(`/api/payments/verify/${encodeURIComponent(reference)}`, { cache: 'no-store' }, { wallet: true });
}

export function createTryOnJob(payload) {
  return request('/api/try-on/jobs', {
    method: 'POST',
    body: JSON.stringify(payload)
  }, { wallet: true, studio: true });
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

export async function ensureConsultationStudio() {
  const existing = getStudioToken();
  if (existing) {
    try {
      return await getConsultationStudio();
    } catch (error) {
      if (error.status !== 401) throw error;
      setStudioToken('');
    }
  }
  const created = await request('/api/consultations/studios', { method: 'POST', body: '{}' });
  setStudioToken(created.token);
  return created.studio;
}

export function getConsultationStudio() {
  return request('/api/consultations/studio', { cache: 'no-store' }, { studio: true });
}

export function updateConsultationStudio(profile) {
  return request('/api/consultations/studio', {
    method: 'PATCH',
    body: JSON.stringify(profile)
  }, { studio: true });
}

export function listClients() {
  return request('/api/consultations/clients', { cache: 'no-store' }, { studio: true });
}

export function createClient(payload) {
  return request('/api/consultations/clients', {
    method: 'POST',
    body: JSON.stringify(payload)
  }, { studio: true });
}

export function getClient(id) {
  return request(`/api/consultations/clients/${id}`, { cache: 'no-store' }, { studio: true });
}

export function updateClient(id, payload) {
  return request(`/api/consultations/clients/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload)
  }, { studio: true });
}

export function listConsultations() {
  return request('/api/consultations', { cache: 'no-store' }, { studio: true });
}

export function createConsultation(payload) {
  return request('/api/consultations', {
    method: 'POST',
    body: JSON.stringify(payload)
  }, { studio: true });
}

export function getConsultation(id) {
  return request(`/api/consultations/${id}`, { cache: 'no-store' }, { studio: true });
}

export function updateConsultation(id, payload) {
  return request(`/api/consultations/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload)
  }, { studio: true });
}

export function saveConsultationVersion(id, payload) {
  return request(`/api/consultations/${id}/versions`, {
    method: 'POST',
    body: JSON.stringify(payload)
  }, { studio: true });
}

export function createApprovalShare(id) {
  return request(`/api/consultations/${id}/share`, {
    method: 'POST',
    body: '{}'
  }, { studio: true });
}

export function updateConsultationOrder(id, payload) {
  return request(`/api/consultations/${id}/order`, {
    method: 'PATCH',
    body: JSON.stringify(payload)
  }, { studio: true });
}

export function getPublicConsultation(token) {
  return request(`/api/consultations/share/${encodeURIComponent(token)}`, { cache: 'no-store' });
}

export function submitApprovalDecision(token, payload) {
  return request(`/api/consultations/share/${encodeURIComponent(token)}/decision`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}
