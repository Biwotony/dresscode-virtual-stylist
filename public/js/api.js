const STORAGE_KEY = 'dresscode-api-base-url';

export function getApiBaseUrl() {
  const saved = localStorage.getItem(STORAGE_KEY);
  const configured = window.DRESSCODE_CONFIG?.apiBaseUrl;
  return (saved || configured || '').replace(/\/$/, '');
}

export function setApiBaseUrl(value) {
  const normalised = String(value || '').trim().replace(/\/$/, '');
  if (normalised) localStorage.setItem(STORAGE_KEY, normalised);
  else localStorage.removeItem(STORAGE_KEY);
  return normalised;
}

function apiUrl(path) {
  return `${getApiBaseUrl()}${path}`;
}

async function request(path, options) {
  const response = await fetch(apiUrl(path), {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options?.headers || {}) }
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'The try-on request failed.');
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

export function createTryOnJob(payload) {
  return request('/api/try-on/jobs', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
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
