// Utilidades generales

export const uid = (p = 'l') =>
  p + '_' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const deepClone = (o) => (o === undefined ? o : JSON.parse(JSON.stringify(o)));
export const num = (v, d = 0) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };
export const r2 = (v) => Math.round(v * 100) / 100;

export function hexToRgb(hex) {
  let h = String(hex || '#000000').replace('#', '').trim();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16);
  if (!Number.isFinite(n)) return [0, 0, 0];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgba(hex, a = 1) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a ?? 1})`;
}

/** Convierte dirección (grados, 0 = derecha, 90 = abajo) y distancia en desplazamiento x/y. */
export function polar(angle, dist) {
  const rad = (num(angle) * Math.PI) / 180;
  return [r2(Math.cos(rad) * num(dist)), r2(Math.sin(rad) * num(dist))];
}

const on = (s) => s && s.enabled !== false;

export function textShadowCss(list) {
  const out = (list || []).filter(on).map((s) => {
    const [x, y] = polar(s.angle, s.distance);
    return `${x}px ${y}px ${num(s.blur)}px ${rgba(s.color, s.alpha)}`;
  });
  return out.length ? out.join(', ') : 'none';
}

export function boxShadowCss(list) {
  const out = (list || []).filter(on).map((s) => {
    const [x, y] = polar(s.angle, s.distance);
    return `${s.inset ? 'inset ' : ''}${x}px ${y}px ${num(s.blur)}px ${num(s.spread)}px ${rgba(s.color, s.alpha)}`;
  });
  return out.length ? out.join(', ') : 'none';
}

export function dropShadowCss(list) {
  return (list || []).filter(on).map((s) => {
    const [x, y] = polar(s.angle, s.distance);
    return `drop-shadow(${x}px ${y}px ${num(s.blur)}px ${rgba(s.color, s.alpha)})`;
  }).join(' ');
}

export function rotatePoint([x, y], [cx, cy], deg) {
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  const dx = x - cx, dy = y - cy;
  return [cx + dx * c - dy * s, cy + dx * s + dy * c];
}

/** CSS libre del usuario: se limpia lo mínimo para no romper el atributo style. */
export function sanitizeCss(str) {
  let s = String(str || '').replace(/[<>{}]/g, '').replace(/\s*\n\s*/g, ' ').trim();
  if (s && !s.endsWith(';')) s += ';';
  return s;
}

export function readAsDataURL(blob) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.onerror = () => rej(fr.error);
    fr.readAsDataURL(blob);
  });
}

export function loadImage(src) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('No se pudo cargar la imagen'));
    img.src = src;
  });
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Pequeño creador de elementos DOM. */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k in el && !k.includes('-') && k !== 'list') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  return el;
}

export function isTyping(target) {
  const t = target || document.activeElement;
  if (!t) return false;
  if (t.isContentEditable) return true;
  if (t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return true;
  if (t.tagName === 'INPUT') {
    return !['checkbox', 'radio', 'button', 'range', 'color', 'file'].includes(t.type);
  }
  return false;
}

// ------------------------------------------------------------ Modal y avisos
export function openModal({ title, body = [], actions = [], width }) {
  const root = document.getElementById('modalRoot');
  const back = h('div', { class: 'modal-back' });
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey, true); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  const btns = actions.map((a) => h('button', {
    class: 'btn' + (a.primary ? ' primary' : '') + (a.danger ? ' danger' : ''),
    onclick: async () => {
      try {
        const res = a.onClick ? await a.onClick() : true;
        if (res !== false) close();
      } catch (err) { toast(err.message || String(err), 'error'); }
    },
  }, a.label));
  const modal = h('div', { class: 'modal', style: width ? `width:min(${width}px,100%)` : '' },
    h('h3', {}, title), h('div', { class: 'm-body' }, body), h('div', { class: 'm-actions' }, btns));
  back.append(modal);
  back.addEventListener('pointerdown', (e) => { if (e.target === back) close(); });
  document.addEventListener('keydown', onKey, true);
  root.append(back);
  const first = modal.querySelector('input, textarea, select');
  if (first) setTimeout(() => first.focus(), 30);
  return close;
}

export function toast(msg, type = 'info', ms = 2600) {
  const t = h('div', { class: 'toast ' + type }, msg);
  document.getElementById('toasts').append(t);
  setTimeout(() => t.remove(), ms);
}
