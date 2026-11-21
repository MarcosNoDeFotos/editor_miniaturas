// Estado global, valores por defecto, eventos e historial (deshacer / rehacer)
import { uid, deepClone } from './util.js';

export const TEXT_STYLE_KEYS = [
  'fontFamily', 'fontSize', 'fontWeight', 'italic', 'fillType', 'color', 'gradient',
  'align', 'lineHeight', 'letterSpacing', 'uppercase', 'strokes', 'shadows',
  'bgColor', 'bgAlpha', 'padX', 'padY', 'border', 'boxShadows', 'opacity', 'blend',
  'customCss', 'customTextCss',
];

export function newDoc() {
  return {
    app: 'editor-miniaturas',
    version: 1,
    canvas: {
      width: 1280, height: 720,
      bgType: 'color', bgColor: '#20232a',
      bgGradient: { angle: 135, c1: '#1e3c72', c2: '#e94057' },
    },
    layers: [],
    assets: {},
    fonts: [],
  };
}

export const S = {
  doc: newDoc(),
  selectedId: null,
  tool: 'select',
  zoom: 1,
  autoFit: true,
  showRegions: true,
  lasso: null,
  guides: [],
  fileHandle: null,
  fileName: 'proyecto',
  dirty: false,
  templates: [],
};

// ------------------------------------------------------------ Valores por defecto
export const defaultBorder = () => ({
  width: 0, style: 'solid', color: '#ffffff', alpha: 1, radius: 0,
  top: true, right: true, bottom: true, left: true,
});
export const defaultStroke = () => ({ enabled: true, width: 5, color: '#000000', alpha: 1 });
export const defaultShadow = (extra = {}) => ({
  enabled: true, angle: 45, distance: 6, blur: 4, spread: 0, color: '#000000', alpha: 0.8, inset: false, ...extra,
});

export function defaultText(over = {}) {
  return {
    id: uid('t'), type: 'text', name: 'Texto', visible: true, locked: false,
    x: 100, y: 100, w: 700, h: 100, rotation: 0, opacity: 1, blend: 'normal',
    text: 'Escribe tu texto',
    fontFamily: 'Impact', fontSize: 96, fontWeight: '400', italic: false,
    fillType: 'color', color: '#ffffff', gradient: { angle: 90, c1: '#ffe600', c2: '#ff5e00' },
    align: 'left', lineHeight: 1.1, letterSpacing: 0, uppercase: false,
    strokes: [defaultStroke()],
    shadows: [defaultShadow({ distance: 6, blur: 0, alpha: 0.9 })],
    bgColor: '#000000', bgAlpha: 0, padX: 0, padY: 0,
    border: defaultBorder(), boxShadows: [],
    wrapRegions: true, customCss: '', customTextCss: '',
    ...over,
  };
}

export function defaultImage(assetId, over = {}) {
  return {
    id: uid('i'), type: 'image', name: 'Imagen', visible: true, locked: false,
    x: 0, y: 0, w: 200, h: 200, rotation: 0, opacity: 1, blend: 'normal',
    assetId, natW: 0, natH: 0, fit: 'fill', flipH: false, flipV: false,
    border: defaultBorder(), outline: { width: 0, color: '#ffffff', alpha: 1 },
    shadows: [],
    filters: { brightness: 100, contrast: 100, saturate: 100, grayscale: 0, sepia: 0, invert: 0, hueRotate: 0, blur: 0 },
    asRegion: false, regionMargin: 10, customCss: '',
    ...over,
  };
}

export function defaultRegion(points, over = {}) {
  return {
    id: uid('r'), type: 'region', name: 'Región', visible: true, locked: false,
    points, margin: 12, color: '#ff3b6b', ...over,
  };
}

/** Completa con valores por defecto un documento cargado de disco. */
export function migrateDoc(obj) {
  const base = newDoc();
  const doc = { ...base, ...obj };
  doc.canvas = { ...base.canvas, ...(obj.canvas || {}) };
  doc.canvas.bgGradient = { ...base.canvas.bgGradient, ...(obj.canvas?.bgGradient || {}) };
  doc.assets = obj.assets || {};
  doc.fonts = Array.isArray(obj.fonts) ? obj.fonts : [];
  doc.layers = (obj.layers || []).filter((l) => l && l.type).map((l) => {
    if (l.type === 'text') {
      const d = defaultText();
      return { ...d, ...l, border: { ...d.border, ...(l.border || {}) }, gradient: { ...d.gradient, ...(l.gradient || {}) } };
    }
    if (l.type === 'image') {
      const d = defaultImage(l.assetId);
      return { ...d, ...l, border: { ...d.border, ...(l.border || {}) }, filters: { ...d.filters, ...(l.filters || {}) }, outline: { ...d.outline, ...(l.outline || {}) } };
    }
    if (l.type === 'region') return { ...defaultRegion([]), ...l };
    return l;
  });
  return doc;
}

// ------------------------------------------------------------ Bus de eventos
const listeners = {};
export const on = (ev, fn) => { (listeners[ev] ||= []).push(fn); };
export const emit = (ev, data) => { (listeners[ev] || []).forEach((fn) => fn(data)); };

export const getLayer = (id) => S.doc.layers.find((l) => l.id === id) || null;
export const selected = () => (S.selectedId ? getLayer(S.selectedId) : null);

export function select(id) {
  S.selectedId = id && getLayer(id) ? id : null;
  emit('select');
  emit('render');
}

export function setTool(t) {
  S.tool = t;
  if (t !== 'lasso') S.lasso = null;
  emit('tool');
  emit('overlay');
}

/**
 * Notifica un cambio del documento.
 * structure: reconstruye el panel de propiedades (añadir/quitar elementos de listas, etc.)
 * commit: guarda un punto en el historial (con retardo para agrupar cambios continuos)
 */
export function changed({ structure = false, commit = true } = {}) {
  S.dirty = true;
  emit('render');
  emit(structure ? 'panel' : 'panel-values');
  emit('layers');
  if (commit) scheduleCommit();
}

// ------------------------------------------------------------ Operaciones con capas
export function addLayer(L) {
  S.doc.layers.push(L);
  S.selectedId = L.id;
  changed({ structure: true });
  emit('select');
  commitNow();
  return L;
}

export function deleteLayer(id) {
  const i = S.doc.layers.findIndex((l) => l.id === id);
  if (i < 0) return;
  S.doc.layers.splice(i, 1);
  if (S.selectedId === id) S.selectedId = null;
  changed({ structure: true });
  emit('select');
  commitNow();
}

export function duplicateLayer(id) {
  const L = getLayer(id);
  if (!L) return null;
  const c = deepClone(L);
  c.id = uid(L.type[0]);
  c.name = L.name + ' copia';
  if (c.type === 'region') c.points = c.points.map(([x, y]) => [x + 20, y + 20]);
  else { c.x += 20; c.y += 20; }
  const i = S.doc.layers.indexOf(L);
  S.doc.layers.splice(i + 1, 0, c);
  S.selectedId = c.id;
  changed({ structure: true });
  emit('select');
  commitNow();
  return c;
}

/** dir: +1 subir, -1 bajar, 'top' al frente, 'bottom' al fondo, o índice absoluto con {to} */
export function moveLayer(id, dir) {
  const arr = S.doc.layers;
  const i = arr.findIndex((l) => l.id === id);
  if (i < 0) return;
  let j;
  if (dir === 'top') j = arr.length - 1;
  else if (dir === 'bottom') j = 0;
  else if (typeof dir === 'object') j = dir.to;
  else j = i + dir;
  j = Math.max(0, Math.min(arr.length - 1, j));
  if (j === i) return;
  const [L] = arr.splice(i, 1);
  arr.splice(j, 0, L);
  changed();
  commitNow();
}

// ------------------------------------------------------------ Historial
let undoStack = [];
let redoStack = [];
let last = null;
let timer = null;

const snapshot = () => JSON.stringify({ canvas: S.doc.canvas, layers: S.doc.layers });

export function resetHistory() {
  clearTimeout(timer);
  undoStack = []; redoStack = [];
  last = snapshot();
  emit('history');
}

export function commitNow() {
  clearTimeout(timer);
  const s = snapshot();
  if (s === last) return;
  if (last !== null) undoStack.push(last);
  if (undoStack.length > 150) undoStack.shift();
  redoStack = [];
  last = s;
  emit('history');
}

export function scheduleCommit() {
  clearTimeout(timer);
  timer = setTimeout(commitNow, 400);
}

export const canUndo = () => undoStack.length > 0;
export const canRedo = () => redoStack.length > 0;

export function undo() {
  commitNow();
  if (!undoStack.length) return;
  redoStack.push(last);
  last = undoStack.pop();
  restore(last);
}

export function redo() {
  if (!redoStack.length) return;
  undoStack.push(last);
  last = redoStack.pop();
  restore(last);
}

function restore(s) {
  const o = JSON.parse(s);
  S.doc.canvas = o.canvas;
  S.doc.layers = o.layers;
  if (!getLayer(S.selectedId)) S.selectedId = null;
  S.dirty = true;
  emit('render');
  emit('panel');
  emit('layers');
  emit('history');
}
