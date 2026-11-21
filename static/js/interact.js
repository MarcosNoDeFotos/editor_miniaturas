// Interacción con el ratón sobre el lienzo: selección, mover, redimensionar, girar y lazo.
import { S, getLayer, selected, select, changed, commitNow, emit, defaultRegion, setTool, TEXT_STYLE_KEYS } from './state.js';
import { scaleTextStyle } from './layout.js';
import { rotatePoint } from './util.js';

const vp = document.getElementById('viewport');
const wrap = document.getElementById('stageWrap');
const rd = (v) => Math.round(v * 10) / 10;
let drag = null;

export function toStage(e) {
  const r = wrap.getBoundingClientRect();
  return [(e.clientX - r.left) / S.zoom, (e.clientY - r.top) / S.zoom];
}

// Simplificación Ramer-Douglas-Peucker del trazo del lazo
function simplify(pts, eps) {
  if (pts.length < 3) return pts.slice();
  const d2 = (p, a, b) => {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const l = dx * dx + dy * dy;
    let t = l ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l : 0;
    t = Math.max(0, Math.min(1, t));
    const x = a[0] + t * dx - p[0], y = a[1] + t * dy - p[1];
    return x * x + y * y;
  };
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    let max = 0, idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = d2(pts[i], pts[s], pts[e]);
      if (d > max) { max = d; idx = i; }
    }
    if (idx >= 0 && max > eps * eps) { keep[idx] = 1; stack.push([s, idx], [idx, e]); }
  }
  return pts.filter((_, i) => keep[i]);
}

const area = (pts) => Math.abs(pts.reduce((a, p, i) => {
  const q = pts[(i + 1) % pts.length];
  return a + p[0] * q[1] - q[0] * p[1];
}, 0) / 2);

// Imán al centro y a los bordes del lienzo
function snap(L, nx, ny) {
  const W = S.doc.canvas.width, H = S.doc.canvas.height, th = 6 / S.zoom;
  S.guides = [];
  const tryAxis = (v, size, total, key) => {
    for (const off of [0, size / 2, size]) {
      for (const t of [0, total / 2, total]) {
        if (Math.abs(v + off - t) < th) { S.guides.push({ [key]: t }); return t - off; }
      }
    }
    return v;
  };
  return [tryAxis(nx, L.w, W, 'x'), tryAxis(ny, L.h, H, 'y')];
}

function capture(e) { try { vp.setPointerCapture(e.pointerId); } catch { /* sin captura */ } }

vp.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  const p = toStage(e);

  if (S.tool === 'lasso') {
    drag = { kind: 'lasso' };
    S.lasso = [p];
    capture(e);
    emit('overlay');
    e.preventDefault();
    return;
  }

  const L = selected();
  const hEl = e.target.closest('[data-handle]');
  if (hEl && L && !L.locked) {
    const kind = hEl.dataset.handle;
    const cx = L.x + L.w / 2, cy = L.y + L.h / 2;
    if (kind === 'rot') {
      drag = { kind: 'rot', L, c: [cx, cy] };
    } else {
      const hx = kind.includes('e') ? 1 : kind.includes('w') ? -1 : 0;
      const hy = kind.includes('s') ? 1 : kind.includes('n') ? -1 : 0;
      const anchor = rotatePoint([cx - (hx * L.w) / 2, cy - (hy * L.h) / 2], [cx, cy], +L.rotation || 0);
      const style0 = {};
      if (L.type === 'text') for (const k of TEXT_STYLE_KEYS) style0[k] = L[k];
      drag = { kind: 'resize', L, hx, hy, anchor, w0: L.w, h0: L.h, style0: JSON.parse(JSON.stringify(style0)) };
    }
    capture(e);
    e.preventDefault();
    return;
  }

  const hit = e.target.closest('[data-id]');
  if (hit) {
    const T = getLayer(hit.dataset.id);
    if (T && !T.locked) {
      if (S.selectedId !== T.id) select(T.id);
      drag = {
        kind: 'move', L: T, p0: p, x0: T.x, y0: T.y, moved: false,
        pts0: T.points ? T.points.map((q) => [q[0], q[1]]) : null,
      };
      capture(e);
      e.preventDefault();
      return;
    }
  }
  if (S.selectedId) select(null);
});

vp.addEventListener('pointermove', (e) => {
  const p = toStage(e);
  emit('cursor', p);
  if (!drag) return;

  if (drag.kind === 'lasso') {
    const last = S.lasso[S.lasso.length - 1];
    if (Math.hypot(p[0] - last[0], p[1] - last[1]) >= 2 / S.zoom) {
      S.lasso.push(p);
      emit('overlay');
    }
    return;
  }

  const L = drag.L;
  if (drag.kind === 'move') {
    let dx = p[0] - drag.p0[0], dy = p[1] - drag.p0[1];
    if (!drag.moved && Math.hypot(dx, dy) * S.zoom < 3) return;
    drag.moved = true;
    if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
    if (L.type === 'region') {
      L.points = drag.pts0.map(([x, y]) => [rd(x + dx), rd(y + dy)]);
    } else {
      let nx = drag.x0 + dx, ny = drag.y0 + dy;
      if (!e.altKey) [nx, ny] = snap(L, nx, ny); else S.guides = [];
      L.x = rd(nx); L.y = rd(ny);
    }
    changed({ commit: false });
  } else if (drag.kind === 'rot') {
    let a = (Math.atan2(p[1] - drag.c[1], p[0] - drag.c[0]) * 180) / Math.PI + 90;
    if (e.shiftKey) a = Math.round(a / 15) * 15;
    else for (const t of [0, 90, 180, 270, 360]) if (Math.abs(a - t) < 2.5) a = t;
    a = ((((a + 180) % 360) + 360) % 360) - 180;
    L.rotation = rd(a);
    changed({ commit: false });
  } else if (drag.kind === 'resize') {
    const th = ((+L.rotation || 0) * Math.PI) / 180, cos = Math.cos(th), sin = Math.sin(th);
    const vx = p[0] - drag.anchor[0], vy = p[1] - drag.anchor[1];
    const lx = vx * cos + vy * sin, ly = -vx * sin + vy * cos;
    let nw = drag.hx ? Math.max(10, drag.hx * lx) : drag.w0;
    let nh = drag.hy ? Math.max(10, drag.hy * ly) : drag.h0;
    const corner = drag.hx && drag.hy;
    if (L.type === 'text') {
      if (corner) {
        // Esquinas de un texto: escala todo el estilo (tamaño, contornos, sombras…)
        const k = Math.max(0.05, Math.max(nw / drag.w0, nh / drag.h0));
        Object.assign(L, scaleTextStyle(drag.style0, k));
        nw = drag.w0 * k; nh = drag.h0 * k;
      } else nh = drag.h0;
    } else if (corner && !e.shiftKey) {
      const k = Math.max(nw / drag.w0, nh / drag.h0);
      nw = drag.w0 * k; nh = drag.h0 * k;
    }
    const ox = (drag.hx * nw) / 2, oy = (drag.hy * nh) / 2;
    const cx = drag.anchor[0] + ox * cos - oy * sin;
    const cy = drag.anchor[1] + ox * sin + oy * cos;
    L.w = rd(nw);
    L.h = rd(nh);
    L.x = rd(cx - nw / 2);
    L.y = rd(cy - nh / 2);
    changed({ commit: false });
  }
});

function finishLasso() {
  const raw = S.lasso || [];
  S.lasso = null;
  const pts = simplify(raw, 1.5).map(([x, y]) => [rd(x), rd(y)]);
  if (pts.length >= 3 && area(pts) > 80) {
    const n = S.doc.layers.filter((l) => l.type === 'region').length + 1;
    const R = defaultRegion(pts, { name: 'Región ' + n });
    S.doc.layers.push(R);
    S.selectedId = R.id;
    setTool('select');
    changed({ structure: true });
    emit('select');
    commitNow();
  } else {
    emit('overlay');
  }
}

function end() {
  if (!drag) return;
  if (drag.kind === 'lasso') finishLasso();
  else {
    S.guides = [];
    if (drag.kind !== 'move' || drag.moved) commitNow();
    emit('render');
  }
  drag = null;
}
vp.addEventListener('pointerup', end);
vp.addEventListener('pointercancel', end);

vp.addEventListener('dblclick', (e) => {
  const hit = e.target.closest('[data-id]');
  const L = hit ? getLayer(hit.dataset.id) : selected();
  if (L && L.type === 'text') {
    if (S.selectedId !== L.id) select(L.id);
    emit('focus-text');
  }
});

// Zoom con Ctrl + rueda
vp.addEventListener('wheel', (e) => {
  if (!e.ctrlKey) return;
  e.preventDefault();
  emit('zoom', { factor: e.deltaY < 0 ? 1.1 : 1 / 1.1, clientX: e.clientX, clientY: e.clientY });
}, { passive: false });
