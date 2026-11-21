// Maquetación de texto con regiones de exclusión.
//
// El texto se reparte línea a línea. Para cada línea se calcula la banda vertical
// que ocupa y se intersecta con los polígonos de las regiones (dibujadas con el
// lazo o imágenes marcadas como región). Lo que queda libre se divide en
// segmentos horizontales y las palabras se van colocando en ellos: si una
// palabra no cabe en el segmento, pasa al siguiente segmento o a la siguiente
// línea. Así el texto "salta" la región y continúa después de ella.
import { rotatePoint } from './util.js';

const ctx = document.createElement('canvas').getContext('2d');

export function fontStack(family) {
  const f = String(family || 'sans-serif').replace(/["'<>;{}]/g, '').trim() || 'sans-serif';
  return `"${f}", sans-serif`;
}

export function fontString(L) {
  return `${L.italic ? 'italic ' : ''}${L.fontWeight || 400} ${Math.max(1, +L.fontSize || 1)}px ${fontStack(L.fontFamily)}`;
}

export function borderW(L) {
  const b = L.border || {};
  const w = +b.width || 0;
  return {
    t: b.top !== false ? w : 0, r: b.right !== false ? w : 0,
    b: b.bottom !== false ? w : 0, l: b.left !== false ? w : 0,
  };
}

/** Escala proporcionalmente un estilo de texto (tamaños, contornos, sombras, bordes…). */
export function scaleTextStyle(st, k) {
  const s = JSON.parse(JSON.stringify(st));
  const r = (v) => Math.round((+v || 0) * k * 100) / 100;
  if (s.fontSize != null) s.fontSize = Math.max(1, r(s.fontSize));
  if (s.letterSpacing) s.letterSpacing = r(s.letterSpacing);
  if (s.padX) s.padX = r(s.padX);
  if (s.padY) s.padY = r(s.padY);
  (s.strokes || []).forEach((x) => { x.width = r(x.width); });
  (s.shadows || []).forEach((x) => { x.distance = r(x.distance); x.blur = r(x.blur); });
  (s.boxShadows || []).forEach((x) => { x.distance = r(x.distance); x.blur = r(x.blur); x.spread = r(x.spread); });
  if (s.border) { s.border.width = r(s.border.width); s.border.radius = r(s.border.radius); }
  return s;
}

/** Polígonos (coordenadas del lienzo) que bloquean el texto. */
export function regionPolygons(doc) {
  const out = [];
  for (const L of doc.layers) {
    if (L.visible === false) continue;
    if (L.type === 'region' && L.points && L.points.length >= 3) {
      out.push({ id: L.id, pts: L.points, margin: +L.margin || 0 });
    } else if (L.type === 'image' && L.asRegion) {
      const c = [L.x + L.w / 2, L.y + L.h / 2];
      const pts = [[L.x, L.y], [L.x + L.w, L.y], [L.x + L.w, L.y + L.h], [L.x, L.y + L.h]]
        .map((p) => (L.rotation ? rotatePoint(p, c, L.rotation) : p));
      out.push({ id: L.id, pts, margin: +L.regionMargin || 0 });
    }
  }
  return out;
}

// Intersecciones de una línea horizontal con el polígono (regla par-impar)
function scan(pts, y) {
  const xs = [];
  for (let i = 0, n = pts.length; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) {
      xs.push(a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
    }
  }
  return xs.sort((p, q) => p - q);
}

/** Segmentos horizontales libres de una línea [top, top+lh] dentro de [0, cw]. */
function freeSegments(polys, top, lh, cw, minW) {
  if (!polys.length) return [{ x: 0, w: cw }];
  const blocked = [];
  for (const p of polys) {
    const y0 = top - p.m, y1 = top + lh + p.m;
    if (p.maxY < y0 || p.minY > y1) continue;
    const N = 12;
    for (let k = 0; k <= N; k++) {
      const xs = scan(p.pts, y0 + ((y1 - y0) * k) / N);
      for (let i = 0; i + 1 < xs.length; i += 2) blocked.push([xs[i] - p.m, xs[i + 1] + p.m]);
    }
    for (const [x, y] of p.pts) if (y >= y0 && y <= y1) blocked.push([x - p.m, x + p.m]);
  }
  if (!blocked.length) return [{ x: 0, w: cw }];
  blocked.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const iv of blocked) {
    const l = merged[merged.length - 1];
    if (l && iv[0] <= l[1]) l[1] = Math.max(l[1], iv[1]);
    else merged.push([iv[0], iv[1]]);
  }
  const segs = [];
  let cur = 0;
  for (const [a, b] of merged) {
    if (a > cur) segs.push({ x: cur, w: Math.min(a, cw) - cur });
    cur = Math.max(cur, b);
    if (cur >= cw) break;
  }
  if (cur < cw) segs.push({ x: cur, w: cw - cur });
  return segs.filter((s) => s.w >= minW);
}

/**
 * Calcula la disposición del texto de la capa L.
 * Devuelve { lines: [{ top, segs: [{ x, w, text, textW, offset, wordSpacing }] }], height, cw, lh }
 * Las coordenadas son relativas a la caja de contenido (dentro de borde y relleno).
 */
export function layoutText(L, polysWorld = []) {
  const raw = String(L.text ?? '');
  const text = L.uppercase ? raw.toLocaleUpperCase() : raw;
  const fs = Math.max(1, +L.fontSize || 1);
  const lh = Math.max(1, fs * (+L.lineHeight || 1));
  const bw = borderW(L);
  const px = +L.padX || 0, py = +L.padY || 0;
  const cw = Math.max(1, (+L.w || 1) - bw.l - bw.r - 2 * px);

  ctx.font = fontString(L);
  const ls = +L.letterSpacing || 0;
  const cache = new Map();
  const meas = (s) => {
    let v = cache.get(s);
    if (v === undefined) { v = ctx.measureText(s).width + ls * [...s].length; cache.set(s, v); }
    return v;
  };
  const spaceW = meas(' ');

  // Regiones pasadas a coordenadas locales de la caja de contenido
  const polys = [];
  if (L.wrapRegions !== false && polysWorld.length) {
    const ox = L.x + bw.l + px, oy = L.y + bw.t + py;
    const c = [L.x + L.w / 2, L.y + (L.h || lh) / 2];
    const rot = +L.rotation || 0;
    for (const p of polysWorld) {
      const pts = p.pts.map((pt) => {
        const q = rot ? rotatePoint(pt, c, -rot) : pt;
        return [q[0] - ox, q[1] - oy];
      });
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const [x, y] of pts) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
      const m = Math.max(0, +p.margin || 0);
      if (maxX + m < 0 || minX - m > cw || maxY + m < 0) continue;
      polys.push({ pts, m, minY, maxY });
    }
  }

  const minSeg = Math.max(fs * 0.6, spaceW * 2);
  const lines = [];
  let li = 0;

  for (const para of text.split(/\r?\n/)) {
    const words = para.split(/[ \t]+/).filter(Boolean);
    if (!words.length) { lines.push({ top: li * lh, segs: [] }); li++; continue; }
    let wi = 0;
    while (wi < words.length && li < 3000) {
      const top = li * lh;
      const segs = freeSegments(polys, top, lh, cw, minSeg);
      const out = [];
      for (const seg of segs) {
        if (wi >= words.length) break;
        const ws = [];
        let used = 0;
        while (wi < words.length) {
          const ww = meas(words[wi]);
          const add = ws.length ? spaceW + ww : ww;
          if (used + add <= seg.w + 0.01) { ws.push(words[wi]); used += add; wi++; } else break;
        }
        if (ws.length) out.push({ x: seg.x, w: seg.w, words: ws, textW: used });
      }
      if (!out.length) {
        // Ninguna palabra cabe: si la línea está libre (palabra más ancha que la caja)
        // se fuerza; si está ocupada por una región se salta la línea.
        const lineFree = segs.length === 1 && segs[0].x <= 0.5 && segs[0].w >= cw - 0.5;
        if (lineFree || li > 600) {
          const s0 = segs[0] || { x: 0, w: cw };
          out.push({ x: s0.x, w: s0.w, words: [words[wi]], textW: meas(words[wi]) });
          wi++;
        }
      }
      if (out.length && wi >= words.length) out[out.length - 1].last = true;
      lines.push({ top, segs: out });
      li++;
    }
  }

  const align = L.align || 'left';
  for (const line of lines) {
    for (const s of line.segs) {
      s.text = s.words.join(' ');
      s.offset = 0;
      s.wordSpacing = 0;
      const free = s.w - s.textW;
      if (align === 'center') s.offset = free / 2;
      else if (align === 'right') s.offset = free;
      else if (align === 'justify' && !s.last && s.words.length > 1 && free > 0) {
        s.wordSpacing = free / (s.words.length - 1);
      }
    }
  }

  return { lines, height: Math.max(1, li) * lh, cw, lh };
}
