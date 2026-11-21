// Plantillas de estilo de texto (guardadas en el servidor Flask)
import { S, emit, TEXT_STYLE_KEYS } from './state.js';
import { deepClone } from './util.js';

async function call(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* sin cuerpo */ }
  if (!res.ok) throw new Error(data?.error || `Error ${res.status}`);
  return data;
}

export async function loadTemplates() {
  S.templates = await call('GET', '/api/templates');
  emit('templates');
}

export async function createTemplate(name, style) {
  const t = await call('POST', '/api/templates', { name, style });
  await loadTemplates();
  return t;
}

export async function updateTemplate(id, patch) {
  const t = await call('PUT', `/api/templates/${encodeURIComponent(id)}`, patch);
  await loadTemplates();
  return t;
}

export async function deleteTemplate(id) {
  await call('DELETE', `/api/templates/${encodeURIComponent(id)}`);
  await loadTemplates();
}

export function styleFromLayer(L) {
  const st = {};
  for (const k of TEXT_STYLE_KEYS) if (k in L) st[k] = deepClone(L[k]);
  return st;
}
