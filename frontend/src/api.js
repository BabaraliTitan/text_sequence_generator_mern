const API_ROOT = (import.meta.env.VITE_API_URL || 'http://localhost:5000/api/records').replace(/\/records\/?$/, '');
const API_BASE = `${API_ROOT}/records`;

async function handleResponse(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request failed with status ${res.status}`);
  }
  return data;
}

export async function fetchRecords(after = 0, limit = 100, length = 'all') {
  const params = new URLSearchParams({ after: String(after), limit: String(limit), length: String(length) });
  const res = await fetch(`${API_BASE}?${params}`);
  return handleResponse(res);
}

export async function searchRecords(query) {
  const params = new URLSearchParams({ q: query });
  const res = await fetch(`${API_BASE}/search?${params}`);
  return handleResponse(res);
}

export async function generateRecords(minLength, maxLength) {
  const res = await fetch(`${API_BASE}/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ minLength, maxLength }),
  });
  return handleResponse(res);
}

export async function fetchGenerationJob(jobId) {
  const res = await fetch(`${API_BASE}/generate/${jobId}`);
  return handleResponse(res);
}

export async function fetchActiveGenerationJob() {
  const res = await fetch(`${API_BASE}/generate/active`);
  return handleResponse(res);
}

export async function fetchLatestGenerationJob() {
  const res = await fetch(`${API_BASE}/generate/latest`);
  return handleResponse(res);
}

export async function fetchGenerationHistory(status = 'all', limit = 20) {
  const params = new URLSearchParams({ status, limit: String(limit) });
  const res = await fetch(`${API_BASE}/generate/history?${params}`);
  return handleResponse(res);
}

export async function fetchSystemHealth() {
  const res = await fetch(`${API_ROOT}/health`);
  return handleResponse(res);
}

export async function cancelGenerationJob(jobId) {
  const res = await fetch(`${API_BASE}/generate/${jobId}/cancel`, { method: 'POST' });
  return handleResponse(res);
}

export async function clearRecords() {
  const res = await fetch(API_BASE, { method: 'DELETE' });
  return handleResponse(res);
}
