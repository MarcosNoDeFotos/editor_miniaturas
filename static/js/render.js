// Renderizado del lienzo (DOM + CSS en línea) y de la capa de superposición del editor.
// Todos los estilos se aplican en línea para que la exportación sea autocontenida.
import { S } from './state.js';
import { layoutText, regionPolygons, borderW, fontStack } from './layout.js';
import { rgba, textShadowCss, boxShadowCss, dropShadowCss, sanitizeCss, rotatePoint } from './util.js';

export const stage = document.getElementById('stage');
const overlay = document.getElementById('overlay');
const svg = document.getElementById('ovSvg');
const selbox = document.getElementById('selbox');
const nodes = new Map();

export function bgCss(c) {
  if (c.bgType === 'gradient') {
    const g = c.bgGradient || {};
    return `linear-gradient(${g.angle ?? 135}deg, ${g.c1 || '#000000'}, ${g.c2 || '#ffffff'})`;
  }
  if (c.bgType === 'transparent') return 'transparent';
  return c.bgColor || '#000000';
}

function containerBase(L) {
  return `position:absolute;left:${L.x}px;top:${L.y}px;width:${L.w}px;height:${L.h}px;`
    + `transform:rotate(${+L.rotation || 0}deg);transform-origin:50% 50%;`
    + `opacity:${L.opacity ?? 1};mix-blend-mode:${L.blend || 'normal'};`
    + (L.visible === false ? 'display:none;' : '')
    + (L.locked ? 'pointer-events:none;' : '');
}

export function borderCss(B) {
  if (!B) return '';
  const w = +B.width || 0;
  const sides = ['top', 'right', 'bottom', 'left'].map((s) => (B[s] !== false ? w : 0) + 'px');
  return `border-style:${B.style || 'solid'};border-color:${rgba(B.color || '#ffffff', B.alpha ?? 1)};`
    + `border-width:${sides.join(' ')};border-radius:${+B.radius || 0}px;`;
}

function fillCss(L, sg, line, lay) {
  if (L.fillType !== 'gradient') return `color:${L.color || '#ffffff'};`;
  const g = L.gradient || {};
  // Relleno extra para que el degradado no se recorte en glifos que sobresalen de la línea
  const E = Math.ceil((+L.fontSize || 16) * 0.5);
  const bx = -(sg.x + sg.offset) + E, by = -line.top + E;
  return `padding:${E}px;margin-left:${-E}px;margin-top:${-E}px;`
    + `background-image:linear-gradient(${g.angle ?? 90}deg, ${g.c1 || '#ffffff'}, ${g.c2 || '#000000'});`
    + `background-size:${lay.cw}px ${lay.height}px;background-position:${bx}px ${by}px;background-repeat:no-repeat;`
    + `-webkit-background-clip:text;background-clip:text;color:transparent;-webkit-text-fill-color:transparent;`;
}

/**
 * Construye una capa de texto dentro de `node`. Se usa para el lienzo y para las
 * vistas previas de las plantillas.
 * Contornos: se apilan copias del texto con -webkit-text-stroke (de fuera a dentro)
 * detrás del relleno, así el contorno queda por fuera de la letra.
 */
export function buildTextInto(node, L, polys) {
  let lay = layoutText(L, polys);
  const bw = borderW(L);
  const px = +L.padX || 0, py = +L.padY || 0;
  let hgt = lay.height + bw.t + bw.b + 2 * py;
  if ((+L.rotation || 0) && polys.length && Math.abs(hgt - (L.h || 0)) > 0.5) {
    L.h = hgt;
    lay = layoutText(L, polys);
    hgt = lay.height + bw.t + bw.b + 2 * py;
  }
  L.h = Math.round(hgt * 100) / 100;

  node.style.cssText = containerBase(L)
    + `box-sizing:border-box;margin:0;padding:0;background:${rgba(L.bgColor || '#000000', +L.bgAlpha || 0)};`
    + borderCss(L.border)
    + `box-shadow:${boxShadowCss(L.boxShadows)};`
    + sanitizeCss(L.customCss);

  node.textContent = '';
  const frag = document.createDocumentFragment();
  const strokes = (L.strokes || []).filter((s) => s.enabled !== false && +s.width > 0);
  const grad = L.fillType === 'gradient';
  const shadow = textShadowCss(L.shadows);
  const base = `position:absolute;white-space:pre;margin:0;padding:0;`
    + `font-family:${fontStack(L.fontFamily)};font-size:${L.fontSize}px;font-weight:${L.fontWeight || 400};`
    + `font-style:${L.italic ? 'italic' : 'normal'};line-height:${lay.lh}px;letter-spacing:${+L.letterSpacing || 0}px;`;
  const extra = sanitizeCss(L.customTextCss);
  const add = (css, txt) => {
    const sp = document.createElement('span');
    sp.style.cssText = css;
    sp.textContent = txt;
    frag.appendChild(sp);
  };

  for (const line of lay.lines) {
    for (const sg of line.segs) {
      const pos = `left:${px + sg.x + sg.offset}px;top:${py + line.top}px;`
        + (sg.wordSpacing ? `word-spacing:${sg.wordSpacing}px;` : '');
      if (strokes.length || grad) {
        let cum = strokes.reduce((a, s) => a + (+s.width), 0);
        for (let i = strokes.length - 1; i >= 0; i--) {
          const s = strokes[i];
          const col = rgba(s.color, s.alpha ?? 1);
          const sh = i === strokes.length - 1 && shadow !== 'none' ? `text-shadow:${shadow};` : '';
          add(base + pos + `color:${col};-webkit-text-fill-color:${col};-webkit-text-stroke:${cum * 2}px ${col};${sh}`, sg.text);
          cum -= +s.width;
        }
        if (!strokes.length && shadow !== 'none') {
          add(base + pos + `color:transparent;-webkit-text-fill-color:transparent;text-shadow:${shadow};`, sg.text);
        }
        add(base + pos + fillCss(L, sg, line, lay) + extra, sg.text);
      } else {
        add(base + pos + fillCss(L, sg, line, lay) + `text-shadow:${shadow};` + extra, sg.text);
      }
    }
  }
  node.appendChild(frag);
  return lay;
}

function renderImage(node, L) {
  const img = node.firstChild;
  const f = L.filters || {};
  const filt = [];
  if ((f.brightness ?? 100) !== 100) filt.push(`brightness(${f.brightness}%)`);
  if ((f.contrast ?? 100) !== 100) filt.push(`contrast(${f.contrast}%)`);
  if ((f.saturate ?? 100) !== 100) filt.push(`saturate(${f.saturate}%)`);
  if (+f.grayscale) filt.push(`grayscale(${f.grayscale}%)`);
  if (+f.sepia) filt.push(`sepia(${f.sepia}%)`);
  if (+f.invert) filt.push(`invert(${f.invert}%)`);
  if (+f.hueRotate) filt.push(`hue-rotate(${f.hueRotate}deg)`);
  if (+f.blur) filt.push(`blur(${f.blur}px)`);

  // Contorno de la silueta (útil con PNG recortados) mediante drop-shadows encadenados
  const wrapF = [];
  const o = L.outline || {};
  const ow = +o.width || 0;
  if (ow > 0) {
    const c = rgba(o.color || '#ffffff', o.alpha ?? 1);
    wrapF.push(`drop-shadow(${ow}px 0 0 ${c})`, `drop-shadow(-${ow}px 0 0 ${c})`,
      `drop-shadow(0 ${ow}px 0 ${c})`, `drop-shadow(0 -${ow}px 0 ${c})`);
  }
  const list = (L.shadows || []).filter((s) => s.enabled !== false);
  const drops = dropShadowCss(list.filter((s) => (s.type || 'drop') === 'drop'));
  if (drops) wrapF.push(drops);
  const boxes = list.filter((s) => s.type === 'box');

  node.style.cssText = containerBase(L) + `margin:0;padding:0;filter:${wrapF.join(' ') || 'none'};`;
  img.style.cssText = `display:block;width:100%;height:100%;box-sizing:border-box;margin:0;`
    + `object-fit:${L.fit || 'fill'};object-position:center;`
    + borderCss(L.border)
    + `box-shadow:${boxShadowCss(boxes)};filter:${filt.join(' ') || 'none'};`
    + `transform:scale(${L.flipH ? -1 : 1},${L.flipV ? -1 : 1});`
    + sanitizeCss(L.customCss);
  const a = S.doc.assets[L.assetId];
  if (a && img.dataset.asset !== L.assetId) {
    img.src = a.data;
    img.dataset.asset = L.assetId;
  }
}

function createNode(L) {
  const n = document.createElement('div');
  n.className = 'layer';
  n.dataset.id = L.id;
  n.dataset.type = L.type;
  if (L.type === 'image') {
    const img = document.createElement('img');
    img.draggable = false;
    img.alt = '';
    n.appendChild(img);
  }
  return n;
}

export function renderStage() {
  const doc = S.doc, c = doc.canvas;
  stage.style.cssText = `position:relative;overflow:hidden;margin:0;padding:0;width:${c.width}px;height:${c.height}px;background:${bgCss(c)};`;
  const polys = regionPolygons(doc);
  const keep = new Set();
  let prev = null;
  for (const L of doc.layers) {
    if (L.type === 'region') continue;
    let node = nodes.get(L.id);
    if (!node || node.dataset.type !== L.type) {
      node?.remove();
      node = createNode(L);
      nodes.set(L.id, node);
    }
    if (L.type === 'text') buildTextInto(node, L, polys);
    else if (L.type === 'image') renderImage(node, L);
    const want = prev ? prev.nextSibling : stage.firstChild;
    if (want !== node) stage.insertBefore(node, want);
    prev = node;
    keep.add(L.id);
  }
  for (const [id, n] of nodes) if (!keep.has(id)) { n.remove(); nodes.delete(id); }
  renderOverlay();
}

export function renderOverlay() {
  const c = S.doc.canvas, z = S.zoom || 1, sw = 1.5 / z;
  overlay.style.width = c.width + 'px';
  overlay.style.height = c.height + 'px';
  overlay.style.setProperty('--inv', String(1 / z));
  document.getElementById('sizer').style.setProperty('--inv', String(1 / z));
  svg.setAttribute('width', c.width);
  svg.setAttribute('height', c.height);
  svg.setAttribute('viewBox', `0 0 ${c.width} ${c.height}`);

  let s = '';
  const dash = `${6 / z} ${4 / z}`;
  for (const L of S.doc.layers) {
    const sel = L.id === S.selectedId;
    if (L.type === 'region') {
      if (!sel && (!S.showRegions || L.visible === false)) continue;
      const pts = L.points.map((p) => p.join(',')).join(' ');
      const faded = L.visible === false ? 0.08 : 0.22;
      s += `<polygon class="region${L.locked ? ' locked' : ''}" data-id="${L.id}" points="${pts}" `
        + `fill="${rgba(L.color, faded)}" stroke="${L.color}" stroke-width="${sel ? sw * 2.2 : sw}" `
        + `stroke-dasharray="${sel ? 'none' : dash}" stroke-linejoin="round"/>`;
    } else if (L.type === 'image' && L.asRegion && L.visible !== false && S.showRegions) {
      const cc = [L.x + L.w / 2, L.y + L.h / 2];
      const pts = [[L.x, L.y], [L.x + L.w, L.y], [L.x + L.w, L.y + L.h], [L.x, L.y + L.h]]
        .map((p) => rotatePoint(p, cc, +L.rotation || 0).join(',')).join(' ');
      s += `<polygon points="${pts}" fill="none" stroke="#ff3b6b" stroke-width="${sw}" stroke-dasharray="${dash}" pointer-events="none"/>`;
    }
  }
  if (S.lasso && S.lasso.length) {
    s += `<polyline points="${S.lasso.map((p) => p.join(',')).join(' ')}" fill="rgba(255,59,107,.15)" `
      + `stroke="#ff3b6b" stroke-width="${sw * 1.5}" stroke-linejoin="round" pointer-events="none"/>`;
  }
  for (const g of S.guides || []) {
    s += g.x != null
      ? `<line x1="${g.x}" y1="0" x2="${g.x}" y2="${c.height}" stroke="#00d1ff" stroke-width="${sw}" pointer-events="none"/>`
      : `<line x1="0" y1="${g.y}" x2="${c.width}" y2="${g.y}" stroke="#00d1ff" stroke-width="${sw}" pointer-events="none"/>`;
  }
  svg.innerHTML = s;

  const L = S.selectedId ? S.doc.layers.find((l) => l.id === S.selectedId) : null;
  if (L && L.type !== 'region' && L.visible !== false) {
    selbox.style.display = 'block';
    selbox.style.left = L.x + 'px';
    selbox.style.top = L.y + 'px';
    selbox.style.width = L.w + 'px';
    selbox.style.height = L.h + 'px';
    selbox.style.transform = `rotate(${+L.rotation || 0}deg)`;
    selbox.className = `t-${L.type}${L.locked ? ' locked' : ''}`;
  } else {
    selbox.style.display = 'none';
  }
}
