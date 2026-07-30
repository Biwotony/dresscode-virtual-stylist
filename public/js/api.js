const API_STORAGE_KEY = 'dresscode-api-base-url';
const SESSION_STORAGE_KEY = 'dresscode-account-session';
const LEGACY_WALLET_STORAGE_KEY = 'dresscode-credit-wallet-token';
const LEGACY_STUDIO_STORAGE_KEY = 'dresscode-studio-token';

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

export function getSessionToken() {
  return localStorage.getItem(SESSION_STORAGE_KEY) || '';
}

export function setSessionToken(token) {
  if (token) localStorage.setItem(SESSION_STORAGE_KEY, token);
  else localStorage.removeItem(SESSION_STORAGE_KEY);
}

export function getLegacyAccess() {
  return {
    legacyWalletToken: localStorage.getItem(LEGACY_WALLET_STORAGE_KEY) || '',
    legacyStudioToken: localStorage.getItem(LEGACY_STUDIO_STORAGE_KEY) || ''
  };
}

export function clearLegacyAccess() {
  localStorage.removeItem(LEGACY_WALLET_STORAGE_KEY);
  localStorage.removeItem(LEGACY_STUDIO_STORAGE_KEY);
}

function apiUrl(path) {
  return `${getApiBaseUrl()}${path}`;
}

async function request(path, options = {}, { auth = false } = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (auth) {
    const token = getSessionToken();
    if (!token) {
      const error = new Error('Sign in to continue.');
      error.status = 401;
      window.dispatchEvent(new CustomEvent('dresscode:auth-required'));
      throw error;
    }
    headers.Authorization = `Bearer ${token}`;
  }
  const response = await fetch(apiUrl(path), { ...options, headers });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(result.error || 'The request failed.');
    error.status = response.status;
    error.detail = result.detail;
    if (response.status === 401 && auth) window.dispatchEvent(new CustomEvent('dresscode:auth-required'));
    throw error;
  }
  return result;
}

export function resolveAssetUrl(path) {
  if (!path) return '';
  if (/^https?:\/\//i.test(path) || path.startsWith('data:') || path.startsWith('blob:')) return path;
  return `${getApiBaseUrl()}${path}`;
}

export function getHealth() {
  return request('/api/health', { cache: 'no-store' });
}

export function getAuthConfig() {
  return request('/api/auth/config', { cache: 'no-store' });
}

export function requestMagicLink(email) {
  return request('/api/auth/magic-links', { method: 'POST', body: JSON.stringify({ email }) });
}

export function consumeMagicLink(token) {
  return request('/api/auth/sessions', {
    method: 'POST',
    body: JSON.stringify({ token, ...getLegacyAccess() })
  });
}

export function getAuthSession() {
  return request('/api/auth/session', { cache: 'no-store' }, { auth: true });
}

export function signOutSession() {
  return request('/api/auth/session', { method: 'DELETE', body: '{}' }, { auth: true });
}

export function signOutAllSessions() {
  return request('/api/auth/logout-all', { method: 'POST', body: '{}' }, { auth: true });
}

export function deleteAccount(confirmation) {
  return request('/api/auth/account', { method: 'DELETE', body: JSON.stringify({ confirmation }) }, { auth: true });
}

export function getPaymentConfig() {
  return request('/api/payments/config', { cache: 'no-store' });
}

export function ensureCreditWallet() {
  return request('/api/payments/wallet', { cache: 'no-store' }, { auth: true });
}

export function getCreditWallet() {
  return request('/api/payments/wallet', { cache: 'no-store' }, { auth: true });
}

export function initializeCreditPayment({ email, planId }) {
  return request('/api/payments/initialize', { method: 'POST', body: JSON.stringify({ email, planId }) }, { auth: true });
}

export function verifyCreditPayment(reference) {
  return request(`/api/payments/verify/${encodeURIComponent(reference)}`, { cache: 'no-store' }, { auth: true });
}

export function createTryOnJob(payload) {
  return request('/api/try-on/jobs', { method: 'POST', body: JSON.stringify(payload) }, { auth: true });
}

export function getTryOnJob(id) {
  return request(`/api/try-on/jobs/${id}`, { cache: 'no-store' }, { auth: true });
}

export function actOnTryOnStage(id, stage, action, payload = {}) {
  return request(`/api/try-on/jobs/${id}/stages/${stage}/${action}`, { method: 'POST', body: JSON.stringify(payload) }, { auth: true });
}

export function deleteTryOnJob(id) {
  return request(`/api/try-on/jobs/${id}`, { method: 'DELETE' }, { auth: true });
}

export function ensureConsultationStudio() {
  return request('/api/consultations/studio', { cache: 'no-store' }, { auth: true });
}

export function getConsultationStudio() {
  return request('/api/consultations/studio', { cache: 'no-store' }, { auth: true });
}

export function updateConsultationStudio(profile) {
  return request('/api/consultations/studio', { method: 'PATCH', body: JSON.stringify(profile) }, { auth: true });
}

export function listClients() {
  return request('/api/consultations/clients', { cache: 'no-store' }, { auth: true });
}

function withConsent(payload) {
  const checkbox = document.getElementById('clientUploadConsent');
  return {
    ...payload,
    consentConfirmed: Boolean(checkbox?.checked),
    consentVersion: window.DRESSCODE_CONSENT_VERSION || '2026-07-30-account'
  };
}

export function createClient(payload) {
  return request('/api/consultations/clients', { method: 'POST', body: JSON.stringify(withConsent(payload)) }, { auth: true });
}

export function getClient(id) {
  return request(`/api/consultations/clients/${id}`, { cache: 'no-store' }, { auth: true });
}

export function updateClient(id, payload) {
  return request(`/api/consultations/clients/${id}`, { method: 'PATCH', body: JSON.stringify(withConsent(payload)) }, { auth: true });
}

export function deleteClient(id) {
  return request(`/api/consultations/clients/${id}`, { method: 'DELETE' }, { auth: true });
}

export function listConsultations() {
  return request('/api/consultations', { cache: 'no-store' }, { auth: true });
}

export function createConsultation(payload) {
  return request('/api/consultations', { method: 'POST', body: JSON.stringify(payload) }, { auth: true });
}

export function getConsultation(id) {
  return request(`/api/consultations/${id}`, { cache: 'no-store' }, { auth: true });
}

export function updateConsultation(id, payload) {
  return request(`/api/consultations/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }, { auth: true });
}

export function deleteConsultation(id) {
  return request(`/api/consultations/${id}`, { method: 'DELETE' }, { auth: true });
}

export function saveConsultationVersion(id, payload) {
  return request(`/api/consultations/${id}/versions`, { method: 'POST', body: JSON.stringify(payload) }, { auth: true });
}

export function createApprovalShare(id) {
  return request(`/api/consultations/${id}/share`, { method: 'POST', body: '{}' }, { auth: true });
}

export function updateConsultationOrder(id, payload) {
  return request(`/api/consultations/${id}/order`, { method: 'PATCH', body: JSON.stringify(payload) }, { auth: true });
}

export function getPublicConsultation(token) {
  return request(`/api/consultations/share/${encodeURIComponent(token)}`, { cache: 'no-store' });
}

export function submitApprovalDecision(token, payload) {
  return request(`/api/consultations/share/${encodeURIComponent(token)}/decision`, { method: 'POST', body: JSON.stringify(payload) });
}
