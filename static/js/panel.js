// Panel lateral: lista de capas y editor de estilos de la capa activa.
import {
  S, on, getLayer, selected, select, changed, commitNow, deleteLayer, duplicateLayer, moveLayer,
  defaultStroke, defaultShadow, defaultText, defaultBorder,
} from './state.js';
import { h, deepClone, r2, openModal, toast, loadImage } from './util.js';
import { buildTextInto } from './render.js';
import { scaleTextStyle } from './layout.js';
import * as T from './templates.js';
import { fitImage, removeFont } from './io.js';

const props = document.getElementById('props');
const list = document.getElementById('layerList');
const $ = (id) => document.getElementById(id);

export const SYSTEM_FONTS = [
  'Impact', 'Arial', 'Arial Black', 'Bahnschrift', 'Calibri', 'Cambria', 'Candara', 'Comic Sans MS',
  'Consolas', 'Constantia', 'Corbel', 'Courier New', 'Franklin Gothic Medium', 'Gabriola', 'Georgia',
  'Lucida Console', 'Lucida Sans Unicode', 'Palatino Linotype', 'Segoe Print', 'Segoe Script',
  'Segoe UI', 'Segoe UI Black', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana',
];
const WEIGHTS = [['100', '100 · Fina'], ['200', '200 · Extraligera'], ['300', '300 · Ligera'], ['400', '400 · Normal'],
  ['500', '500 · Media'], ['600', '600 · Seminegrita'], ['700', '700 · Negrita'], ['800', '800 · Extranegrita'], ['900', '900 · Black']];
const BLENDS = [['normal', 'Normal'], ['multiply', 'Multiplicar'], ['screen', 'Trama'], ['overlay', 'Superponer'],
  ['darken', 'Oscurecer'], ['lighten', 'Aclarar'], ['color-dodge', 'Sobreexponer color'], ['color-burn', 'Subexponer color'],
  ['hard-light', 'Luz fuerte'], ['soft-light', 'Luz suave'], ['difference', 'Diferencia'], ['exclusion', 'Exclusión'],
  ['hue', 'Tono'], ['saturation', 'Saturación'], ['color', 'Color'], ['luminosity', 'Luminosidad']];
const BORDER_STYLES = [['solid', 'Continuo'], ['dashed', 'Discontinuo'], ['dotted', 'Punteado'], ['double', 'Doble'],
  ['groove', 'Ranura'], ['ridge', 'Cresta'], ['inset', 'Hundido'], ['outset', 'Relieve']];
const PRESETS = [['1280x720', 'YouTube · 1280 × 720'], ['1920x1080', 'Full HD · 1920 × 1080'],
  ['2560x1440', 'QHD · 2560 × 1440'], ['1080x1080', 'Cuadrado · 1080 × 1080'], ['1080x1350', 'Retrato · 1080 × 1350'],
  ['1080x1920', 'Vertical · 1080 × 1920'], ['1500x500', 'Banner · 1500 × 500']];
const TYPE_LABEL = { text: 'Texto', image: 'Imagen', region: 'Región' };

// ------------------------------------------------------------ Enlaces de controles
let binds = [];
const openSecs = new Map();
let keepFontSize = false;
let lastBuiltId = undefined;

const fmt = (v) => (typeof v === 'number' ? String(r2(v)) : v == null ? '' : String(v));

function bind(el, get, prop = 'value') {
  binds.push({ el, get, prop });
  if (prop === 'checked') el.checked = !!get(); else el.value = get();
  return el;
}
function bindFn(fn) { binds.push({ fn }); fn(); }

export function refreshValues() {
  for (const b of binds) {
    if (b.fn) { b.fn(); continue; }
    if (document.activeElement === b.el) continue;
    const v = b.get();
    if (b.prop === 'checked') b.el.checked = !!v;
    else if (b.el.value !== String(v)) b.el.value = v;
  }
}

function normHex(v) {
  v = String(v || '#000000');
  if (/^#[0-9a-f]{6}$/i.test(v)) return v.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(v)) return '#' + v.slice(1).split('').map((c) => c + c).join('').toLowerCase();
  return '#000000';
}

// ------------------------------------------------------------ Controles
function fNum(get, set, o = {}) {
  const el = h('input', { type: 'number', class: 'num', step: o.step ?? 1 });
  if (o.min != null) el.min = o.min;
  if (o.max != null && !o.free) el.max = o.max;
  bind(el, () => fmt(get()));
  el.addEventListener('input', () => {
    if (el.value === '' || Number.isNaN(+el.value)) return;
    set(+el.value); changed(o.opts);
  });
  return el;
}

function fRange(get, set, o = {}) {
  const r = h('input', { type: 'range', min: o.min ?? 0, max: o.max ?? 100, step: o.step ?? 1 });
  bind(r, () => fmt(get()));
  r.addEventListener('input', () => { set(+r.value); changed(o.opts); });
  return h('div', { class: 'range' }, r, fNum(get, set, { ...o, free: true }));
}

function fColor(get, set) {
  const el = h('input', { type: 'color' });
  bind(el, () => normHex(get()));
  el.addEventListener('input', () => { set(el.value); changed(); });
  return el;
}

function fSelect(opts, get, set, { structure = false } = {}) {
  const el = h('select', {}, opts.map((o) => (Array.isArray(o) ? h('option', { value: o[0] }, o[1]) : h('option', { value: o }, o))));
  bind(el, () => String(get()));
  el.addEventListener('change', () => { set(el.value); changed({ structure }); });
  return el;
}

function fCheck(get, set, label, { structure = false } = {}) {
  const el = h('input', { type: 'checkbox' });
  bind(el, () => !!get(), 'checked');
  el.addEventListener('change', () => { set(el.checked); changed({ structure }); });
  return h('label', { class: 'check' }, el, label ? h('span', {}, label) : null);
}

function fText(get, set, ph = '') {
  const el = h('input', { type: 'text', placeholder: ph });
  bind(el, () => get() ?? '');
  el.addEventListener('input', () => { set(el.value); changed(); });
  return el;
}

function fArea(get, set, { rows = 3, code = false, ph = '', id } = {}) {
  const el = h('textarea', { rows, class: code ? 'code' : '', placeholder: ph });
  el.spellcheck = !code;
  if (id) el.id = id;
  bind(el, () => get() ?? '');
  el.addEventListener('input', () => { set(el.value); changed(); });
  return el;
}

function fSeg(opts, get, set, { structure = false } = {}) {
  const btns = opts.map(([v, label, title]) => {
    const b = h('button', { type: 'button', title: title || '', onclick: () => { set(v); changed({ structure }); } }, label);
    b.dataset.v = v;
    return b;
  });
  bindFn(() => btns.forEach((b) => b.classList.toggle('on', String(get()) === b.dataset.v)));
  return h('div', { class: 'seg' }, btns);
}

const row = (label, ...ctrls) => h('div', { class: 'row' }, h('label', {}, label), h('div', { class: 'ctrl' }, ctrls));
const btn = (label, onclick, cls = '', title = '') => h('button', { type: 'button', class: 'btn ' + cls, onclick, title }, label);
const mini = (label, onclick, title = '', cls = '') => h('button', { type: 'button', class: 'mini ' + cls, onclick, title }, label);
const hint = (t) => h('p', { class: 'hint' }, t);

function section(key, title, content, defOpen = true) {
  const d = h('details', { class: 'sec' }, h('summary', {}, title), h('div', { class: 'sec-body' }, content));
  d.open = openSecs.has(key) ? openSecs.get(key) : defOpen;
  d.dataset.key = key;
  d.addEventListener('toggle', () => openSecs.set(key, d.open));
  return d;
}

const done = (opts) => { changed(opts); commitNow(); };

// ------------------------------------------------------------ Componentes compuestos
const DIRS = [[225, '↖'], [270, '↑'], [315, '↗'], [180, '←'], [null, '•'], [0, '→'], [135, '↙'], [90, '↓'], [45, '↘']];

function compass(s) {
  const btns = DIRS.map(([a, ch]) => {
    const b = h('button', {
      type: 'button',
      title: a == null ? 'Sin desplazamiento (resplandor)' : `Dirección ${a}°`,
      onclick: () => {
        if (a == null) s.distance = 0;
        else { s.angle = a; if (!+s.distance) s.distance = 6; }
        changed();
      },
    }, ch);
    b._a = a;
    return b;
  });
  bindFn(() => btns.forEach((b) => b.classList.toggle('on',
    b._a == null ? !+s.distance : +s.distance > 0 && ((Math.round(+s.angle) % 360) + 360) % 360 === b._a)));
  return h('div', { class: 'compass' }, btns);
}

function listHead(title, arr, i, item, { onDup = true } = {}) {
  return h('div', { class: 'card-head' },
    fCheck(() => item.enabled !== false, (v) => { item.enabled = v; }, '', { structure: true }),
    h('span', { class: 'grow' }, title),
    i > 0 && mini('▲', () => { [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]]; done({ structure: true }); }, 'Subir'),
    i < arr.length - 1 && mini('▼', () => { [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]]; done({ structure: true }); }, 'Bajar'),
    onDup && mini('⧉', () => { arr.splice(i + 1, 0, deepClone(item)); done({ structure: true }); }, 'Duplicar'),
    mini('✕', () => { arr.splice(i, 1); done({ structure: true }); }, 'Eliminar', 'danger'));
}

/** kind: 'text' (text-shadow) | 'box' (box-shadow) | 'image' (drop-shadow o box-shadow) */
function shadowList(arr, kind) {
  const out = [];
  arr.forEach((s, i) => {
    const rows = [];
    if (kind === 'image') {
      rows.push(row('Tipo', fSelect([['drop', 'Silueta (drop-shadow)'], ['box', 'Caja (box-shadow)']],
        () => s.type || 'drop', (v) => { s.type = v; }, { structure: true })));
    }
    rows.push(
      row('Color', fColor(() => s.color, (v) => { s.color = v; }),
        h('div', { style: 'flex:1;min-width:110px' }, fRange(() => s.alpha ?? 1, (v) => { s.alpha = v; }, { min: 0, max: 1, step: 0.05 }))),
      row('Dirección', compass(s),
        h('div', { style: 'flex:1;min-width:110px' }, fRange(() => s.angle, (v) => { s.angle = v; }, { min: 0, max: 359 }))),
      row('Distancia', fRange(() => s.distance, (v) => { s.distance = v; }, { min: 0, max: 120 })),
      row('Desenfoque', fRange(() => s.blur, (v) => { s.blur = v; }, { min: 0, max: 120 })),
    );
    if (kind === 'box' || (kind === 'image' && s.type === 'box')) {
      rows.push(
        row('Expansión', fRange(() => s.spread || 0, (v) => { s.spread = v; }, { min: -60, max: 120 })),
        row('', fCheck(() => s.inset, (v) => { s.inset = v; }, 'Sombra interior')),
      );
    }
    out.push(h('div', { class: 'card' + (s.enabled === false ? ' off' : '') }, listHead(`Sombra ${i + 1}`, arr, i, s), rows));
  });
  out.push(btn('+ Añadir sombra', () => {
    const base = kind === 'text' ? { blur: 0, distance: 6 }
      : kind === 'image' ? { type: 'drop', blur: 14, distance: 8, alpha: 0.7 }
        : { blur: 18, distance: 6, alpha: 0.5 };
    arr.push(defaultShadow(base));
    done({ structure: true });
  }, 'add'));
  return out;
}

function strokeList(arr) {
  const out = arr.map((s, i) => h('div', { class: 'card' + (s.enabled === false ? ' off' : '') },
    listHead(`Contorno ${i + 1}${i === 0 && arr.length > 1 ? ' (interior)' : i === arr.length - 1 && arr.length > 1 ? ' (exterior)' : ''}`, arr, i, s),
    row('Color', fColor(() => s.color, (v) => { s.color = v; }),
      h('div', { style: 'flex:1;min-width:110px' }, fRange(() => s.alpha ?? 1, (v) => { s.alpha = v; }, { min: 0, max: 1, step: 0.05 }))),
    row('Grosor', fRange(() => s.width, (v) => { s.width = Math.max(0, v); }, { min: 0, max: 60, step: 0.5 }))));
  out.push(btn('+ Añadir contorno', () => {
    const last = arr[arr.length - 1];
    arr.push(last ? { ...defaultStroke(), color: last.color === '#ffffff' ? '#000000' : '#ffffff' } : defaultStroke());
    done({ structure: true });
  }, 'add'));
  return out;
}

function borderEditor(B) {
  const side = (k, label, title) => {
    const b = h('button', { type: 'button', title, onclick: () => { B[k] = B[k] === false; done(); } }, label);
    bindFn(() => b.classList.toggle('on', B[k] !== false));
    return b;
  };
  const all = h('button', {
    type: 'button', class: 'mid', title: 'Activar / desactivar todos los lados',
    onclick: () => {
      const v = !['top', 'right', 'bottom', 'left'].every((k) => B[k] !== false);
      for (const k of ['top', 'right', 'bottom', 'left']) B[k] = v;
      done();
    },
  }, '□');
  const sides = h('div', { class: 'sides' },
    h('span'), side('top', '↑', 'Borde superior'), h('span'),
    side('left', '←', 'Borde izquierdo'), all, side('right', '→', 'Borde derecho'),
    h('span'), side('bottom', '↓', 'Borde inferior'), h('span'));
  return [
    row('Grosor', fRange(() => B.width, (v) => { B.width = Math.max(0, v); }, { min: 0, max: 40 })),
    row('Lados', sides, h('span', { class: 'hint', style: 'flex:1' }, 'Elige en qué lados se dibuja el borde')),
    row('Estilo', fSelect(BORDER_STYLES, () => B.style || 'solid', (v) => { B.style = v; })),
    row('Color', fColor(() => B.color, (v) => { B.color = v; }),
      h('div', { style: 'flex:1;min-width:110px' }, fRange(() => B.alpha ?? 1, (v) => { B.alpha = v; }, { min: 0, max: 1, step: 0.05 }))),
    row('Esquinas', fRange(() => B.radius, (v) => { B.radius = Math.max(0, v); }, { min: 0, max: 300 })),
  ];
}

function transformSection(L) {
  const W = () => S.doc.canvas.width, H = () => S.doc.canvas.height;
  const isImg = L.type === 'image';
  const setW = (v) => {
    v = Math.max(10, v);
    if (isImg && L.keepRatio !== false && L.w) L.h = r2(L.h * (v / L.w));
    L.w = v;
  };
  const setH = (v) => {
    v = Math.max(10, v);
    if (L.keepRatio !== false && L.h) L.w = r2(L.w * (v / L.h));
    L.h = v;
  };
  return section('transform', 'Posición y transformación', [
    row('Posición', h('span', { class: 'hint' }, 'X'), fNum(() => L.x, (v) => { L.x = v; }),
      h('span', { class: 'hint' }, 'Y'), fNum(() => L.y, (v) => { L.y = v; })),
    row('Tamaño', h('span', { class: 'hint' }, 'An'), fNum(() => L.w, setW, { min: 10 }),
      isImg && h('span', { class: 'hint' }, 'Al'), isImg && fNum(() => L.h, setH, { min: 10 })),
    isImg && row('', fCheck(() => L.keepRatio !== false, (v) => { L.keepRatio = v; }, 'Mantener proporción')),
    row('Rotación', fRange(() => L.rotation || 0, (v) => { L.rotation = v; }, { min: -180, max: 180, step: 0.5 })),
    row('Opacidad', fRange(() => L.opacity ?? 1, (v) => { L.opacity = v; }, { min: 0, max: 1, step: 0.01 })),
    row('Fusión', fSelect(BLENDS, () => L.blend || 'normal', (v) => { L.blend = v; })),
    row('Centrar',
      btn('Horiz.', () => { L.x = r2((W() - L.w) / 2); done(); }),
      btn('Vert.', () => { L.y = r2((H() - L.h) / 2); done(); }),
      btn('Ambos', () => { L.x = r2((W() - L.w) / 2); L.y = r2((H() - L.h) / 2); done(); })),
    row('Orden',
      btn('Al frente', () => moveLayer(L.id, 'top')),
      btn('Al fondo', () => moveLayer(L.id, 'bottom'))),
  ], false);
}

function cssSection(L, isText) {
  return section('css', 'CSS personalizado', [
    hint(isText ? 'CSS extra para la caja del texto (p. ej. «filter: saturate(1.5); outline: 3px solid red»).'
      : 'CSS extra para la imagen (p. ej. «clip-path: circle(45%); filter: contrast(1.2)»).'),
    fArea(() => L.customCss, (v) => { L.customCss = v; }, { rows: 3, code: true, ph: 'propiedad: valor;' }),
    isText && hint('CSS extra para las letras (se aplica al relleno). Evita cambiar aquí el tamaño de fuente para que el ajuste a regiones sea exacto.'),
    isText && fArea(() => L.customTextCss, (v) => { L.customTextCss = v; }, { rows: 2, code: true, ph: 'text-decoration: underline;' }),
  ], false);
}

// ------------------------------------------------------------ Plantillas
function applyTemplate(L, t) {
  let st = deepClone(t.style);
  if (keepFontSize && L.fontSize && st.fontSize) st = scaleTextStyle(st, L.fontSize / st.fontSize);
  Object.assign(L, st);
  done({ structure: true });
  toast(`Plantilla «${t.name}» aplicada`);
}

function newTemplate(L) {
  const name = h('input', { type: 'text', placeholder: 'Nombre de la plantilla' });
  openModal({
    title: 'Nueva plantilla de texto',
    body: [row('Nombre', name), hint('Se guardarán la fuente, colores, contornos, sombras, caja, bordes y CSS de la capa actual.')],
    actions: [
      { label: 'Cancelar' },
      {
        label: 'Guardar plantilla', primary: true,
        onClick: async () => {
          if (!name.value.trim()) { toast('Escribe un nombre', 'error'); return false; }
          await T.createTemplate(name.value.trim(), T.styleFromLayer(L));
          toast('Plantilla guardada');
          return true;
        },
      },
    ],
  });
  name.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.closest('.modal').querySelector('.btn.primary').click(); });
}

function editTemplate(t) {
  const name = h('input', { type: 'text', value: t.name });
  const json = h('textarea', { rows: 14, class: 'code' });
  json.spellcheck = false;
  json.value = JSON.stringify(t.style, null, 2);
  const L = selected();
  const fromLayer = L && L.type === 'text'
    ? btn('Sustituir por el estilo de la capa seleccionada', () => {
      json.value = JSON.stringify(T.styleFromLayer(L), null, 2);
      toast('Estilo copiado de la capa. Pulsa Guardar para confirmar.');
    }, 'block')
    : hint('Consejo: aplica la plantilla a un texto, retócalo con el panel y vuelve aquí para sustituir el estilo por el de la capa.');
  openModal({
    title: 'Editar plantilla',
    width: 560,
    body: [row('Nombre', name), fromLayer, hint('Estilo (JSON avanzado):'), json],
    actions: [
      { label: 'Cancelar' },
      {
        label: 'Guardar cambios', primary: true,
        onClick: async () => {
          let style;
          try { style = JSON.parse(json.value); } catch { toast('El JSON del estilo no es válido', 'error'); return false; }
          if (!name.value.trim()) { toast('Escribe un nombre', 'error'); return false; }
          await T.updateTemplate(t.id, { name: name.value.trim(), style });
          toast('Plantilla actualizada');
          return true;
        },
      },
    ],
  });
}

async function removeTemplate(t) {
  if (!confirm(`¿Eliminar la plantilla «${t.name}»?`)) return;
  try { await T.deleteTemplate(t.id); toast('Plantilla eliminada'); } catch (err) { toast(err.message, 'error'); }
}

function templatePreview(t) {
  const prev = h('div', { class: 'tpl-prev' });
  const node = h('div');
  prev.append(node);
  try {
    const st = t.style || {};
    const k = 30 / (+st.fontSize || 30);
    const fake = {
      ...defaultText(), ...scaleTextStyle(st, k),
      text: t.name, x: 10, y: 0, w: 4000, h: 0, rotation: 0, align: 'left',
      wrapRegions: false, visible: true, locked: false,
    };
    buildTextInto(node, fake, []);
    node.style.top = Math.max(0, (62 - fake.h) / 2) + 'px';
  } catch (err) { console.warn(err); }
  return prev;
}

function templatesSection(L) {
  const grid = h('div', { class: 'tpl-grid' });
  if (!S.templates.length) grid.append(hint('No hay plantillas todavía.'));
  for (const t of S.templates) {
    const prev = templatePreview(t);
    prev.title = L ? 'Clic para aplicar a la capa seleccionada' : 'Selecciona un texto para aplicar la plantilla';
    prev.addEventListener('click', () => {
      if (!L) { toast('Selecciona una capa de texto para aplicar la plantilla'); return; }
      applyTemplate(L, t);
    });
    grid.append(h('div', { class: 'tpl' }, prev, h('div', { class: 'tpl-bar' },
      h('span', { class: 'grow', title: t.name }, t.name),
      L && mini('Aplicar', () => applyTemplate(L, t), 'Aplicar a la capa'),
      mini('✎', () => editTemplate(t), 'Editar (nombre y estilo)'),
      mini('✕', () => removeTemplate(t), 'Eliminar plantilla', 'danger'))));
  }
  const keep = h('input', { type: 'checkbox' });
  keep.checked = keepFontSize;
  keep.addEventListener('change', () => { keepFontSize = keep.checked; });
  return section('tpl', 'Plantillas de estilo', [
    L && btn('+ Guardar estilo actual como plantilla', () => newTemplate(L), 'primary block'),
    L && h('div', { class: 'row' }, h('label'), h('div', { class: 'ctrl' },
      h('label', { class: 'check' }, keep, h('span', {}, 'Conservar el tamaño actual al aplicar')))),
    grid,
  ], true);
}

// ------------------------------------------------------------ Paneles por tipo
function fontSelect(L) {
  const custom = new Set((S.doc.fonts || []).map((f) => f.family));
  const fams = [...new Set([...custom, ...SYSTEM_FONTS])];
  if (!fams.includes(L.fontFamily)) fams.unshift(L.fontFamily);
  const el = h('select', {},
    fams.map((f) => h('option', { value: f, style: `font-family:"${f}"` }, custom.has(f) ? `${f} (cargada)` : f)),
    h('option', { value: '__other__' }, 'Otra fuente instalada…'));
  bind(el, () => L.fontFamily);
  el.addEventListener('change', () => {
    if (el.value === '__other__') {
      const n = prompt('Nombre exacto de una fuente instalada en tu sistema:', L.fontFamily);
      if (n && n.trim()) L.fontFamily = n.trim();
      done({ structure: true });
      return;
    }
    L.fontFamily = el.value;
    changed();
  });
  return el;
}

function textPanel(L) {
  L.strokes ||= []; L.shadows ||= []; L.boxShadows ||= []; L.border ||= defaultBorder();
  const g = (L.gradient ||= { angle: 90, c1: '#ffe600', c2: '#ff5e00' });
  return [
    section('t-content', 'Texto', [
      fArea(() => L.text, (v) => { L.text = v; }, { rows: 3, id: 'txtContent', ph: 'Escribe aquí… (Intro = nueva línea)' }),
      row('', fCheck(() => L.uppercase, (v) => { L.uppercase = v; }, 'Todo en MAYÚSCULAS')),
    ]),
    templatesSection(L),
    section('t-font', 'Fuente', [
      row('Familia', fontSelect(L), mini('+', () => $('fileFont').click(), 'Cargar fuente desde archivo (TTF, OTF, WOFF)')),
      row('Tamaño', fRange(() => L.fontSize, (v) => { L.fontSize = Math.max(1, v); }, { min: 8, max: 400 })),
      row('Grosor', fSelect(WEIGHTS, () => String(L.fontWeight), (v) => { L.fontWeight = v; })),
      row('Estilo', fCheck(() => L.italic, (v) => { L.italic = v; }, 'Cursiva')),
      row('Alineación', fSeg([['left', 'Izq.', 'Izquierda'], ['center', 'Centro', 'Centrado'],
        ['right', 'Der.', 'Derecha'], ['justify', 'Just.', 'Justificado']], () => L.align, (v) => { L.align = v; })),
      row('Interlineado', fRange(() => L.lineHeight, (v) => { L.lineHeight = v; }, { min: 0.5, max: 3, step: 0.05 })),
      row('Espaciado', fRange(() => L.letterSpacing, (v) => { L.letterSpacing = v; }, { min: -10, max: 60, step: 0.5 })),
    ]),
    section('t-fill', 'Relleno', [
      row('Tipo', fSeg([['color', 'Color sólido'], ['gradient', 'Degradado']], () => L.fillType, (v) => { L.fillType = v; }, { structure: true })),
      ...(L.fillType === 'gradient'
        ? [
          row('Colores', fColor(() => g.c1, (v) => { g.c1 = v; }), fColor(() => g.c2, (v) => { g.c2 = v; }),
            mini('⇄', () => { [g.c1, g.c2] = [g.c2, g.c1]; done(); }, 'Intercambiar colores')),
          row('Ángulo', fRange(() => g.angle, (v) => { g.angle = v; }, { min: 0, max: 360 })),
        ]
        : [row('Color', fColor(() => L.color, (v) => { L.color = v; }))]),
    ]),
    section('t-stroke', 'Contorno de las letras', [
      ...strokeList(L.strokes),
      hint('Puedes apilar varios contornos: el primero queda pegado a la letra y los siguientes por fuera.'),
    ]),
    section('t-shadow', 'Sombras del texto', shadowList(L.shadows, 'text')),
    section('t-box', 'Caja: fondo, borde y sombra', [
      row('Fondo', fColor(() => L.bgColor, (v) => { L.bgColor = v; }),
        h('div', { style: 'flex:1;min-width:110px' }, fRange(() => L.bgAlpha || 0, (v) => { L.bgAlpha = v; }, { min: 0, max: 1, step: 0.05 }))),
      row('Relleno X', fRange(() => L.padX || 0, (v) => { L.padX = Math.max(0, v); }, { min: 0, max: 200 })),
      row('Relleno Y', fRange(() => L.padY || 0, (v) => { L.padY = Math.max(0, v); }, { min: 0, max: 200 })),
      h('p', { class: 'hint' }, h('strong', {}, 'Borde')),
      ...borderEditor(L.border),
      h('p', { class: 'hint' }, h('strong', {}, 'Sombras de la caja')),
      ...shadowList(L.boxShadows, 'box'),
    ], false),
    section('t-region', 'Regiones', [
      row('', fCheck(() => L.wrapRegions !== false, (v) => { L.wrapRegions = v; }, 'Evitar las regiones (el texto las rodea)')),
      hint('Dibuja regiones con la herramienta Lazo (L). El texto no se colocará sobre ellas y continuará después.'),
    ], false),
    transformSection(L),
    cssSection(L, true),
  ];
}

function imagePanel(L) {
  L.filters ||= {}; L.outline ||= { width: 0, color: '#ffffff', alpha: 1 }; L.border ||= defaultBorder(); L.shadows ||= [];
  const f = L.filters, o = L.outline;
  const fr = (label, key, min, max, def, unit = '') => row(label + unit,
    fRange(() => f[key] ?? def, (v) => { f[key] = v; }, { min, max }));
  return [
    section('i-img', 'Imagen', [
      row('Ajuste', fSelect([['fill', 'Estirar'], ['cover', 'Cubrir (recorta)'], ['contain', 'Contener']], () => L.fit || 'fill', (v) => { L.fit = v; })),
      row('Voltear', fCheck(() => L.flipH, (v) => { L.flipH = v; }, 'Horizontal'), fCheck(() => L.flipV, (v) => { L.flipV = v; }, 'Vertical')),
      h('div', { class: 'btns' },
        btn('Reemplazar…', () => $('fileReplace').click()),
        btn('Cubrir lienzo', () => fitImage(L, 'cover'), '', 'Escala la imagen para cubrir todo el lienzo (fondo)'),
        btn('Encajar', () => fitImage(L, 'contain'), '', 'Escala la imagen para que quepa entera'),
        btn('Tamaño real', () => fitImage(L, 'original'))),
    ]),
    transformSection(L),
    section('i-filters', 'Filtros', [
      fr('Brillo', 'brightness', 0, 300, 100, ' %'),
      fr('Contraste', 'contrast', 0, 300, 100, ' %'),
      fr('Saturación', 'saturate', 0, 300, 100, ' %'),
      fr('Escala grises', 'grayscale', 0, 100, 0, ' %'),
      fr('Sepia', 'sepia', 0, 100, 0, ' %'),
      fr('Invertir', 'invert', 0, 100, 0, ' %'),
      fr('Tono', 'hueRotate', 0, 360, 0, ' °'),
      fr('Desenfoque', 'blur', 0, 40, 0, ' px'),
      btn('Restablecer filtros', () => {
        Object.assign(f, { brightness: 100, contrast: 100, saturate: 100, grayscale: 0, sepia: 0, invert: 0, hueRotate: 0, blur: 0 });
        done();
      }, 'block'),
    ], false),
    section('i-outline', 'Contorno de la silueta', [
      row('Grosor', fRange(() => o.width || 0, (v) => { o.width = Math.max(0, v); }, { min: 0, max: 40 })),
      row('Color', fColor(() => o.color, (v) => { o.color = v; }),
        h('div', { style: 'flex:1;min-width:110px' }, fRange(() => o.alpha ?? 1, (v) => { o.alpha = v; }, { min: 0, max: 1, step: 0.05 }))),
      hint('Rodea la forma de la imagen. Ideal para PNG recortados sin fondo (personas, objetos…).'),
    ], false),
    section('i-shadow', 'Sombras', shadowList(L.shadows, 'image'), false),
    section('i-border', 'Borde y esquinas', borderEditor(L.border), false),
    section('i-region', 'Usar como región', [
      row('', fCheck(() => L.asRegion, (v) => { L.asRegion = v; }, 'El texto rodea esta imagen')),
      row('Margen', fRange(() => L.regionMargin || 0, (v) => { L.regionMargin = Math.max(0, v); }, { min: 0, max: 200 })),
      hint('Usa el rectángulo de la imagen como región. Para formas libres dibuja una región con el lazo.'),
    ], false),
    cssSection(L, false),
  ];
}

function regionPanel(L) {
  const centroid = () => {
    const n = L.points.length;
    return L.points.reduce((a, p) => [a[0] + p[0] / n, a[1] + p[1] / n], [0, 0]);
  };
  const scale = (k) => {
    const [cx, cy] = centroid();
    L.points = L.points.map(([x, y]) => [r2(cx + (x - cx) * k), r2(cy + (y - cy) * k)]);
    done();
  };
  const flip = (axis) => {
    const [cx, cy] = centroid();
    L.points = L.points.map(([x, y]) => (axis === 'x' ? [r2(2 * cx - x), y] : [x, r2(2 * cy - y)]));
    done();
  };
  return [
    section('r-main', 'Región de exclusión', [
      hint('El texto no se colocará encima de esta zona: lo rodea y continúa después. La región no aparece al exportar.'),
      row('Margen', fRange(() => L.margin || 0, (v) => { L.margin = Math.max(0, v); }, { min: 0, max: 200 })),
      row('Color guía', fColor(() => L.color, (v) => { L.color = v; })),
      row('', fCheck(() => L.visible !== false, (v) => { L.visible = v; }, 'Activa (bloquea el texto)')),
      row('Vértices', h('span', { class: 'hint' }, `${L.points.length} puntos`)),
    ]),
    section('r-tf', 'Transformar región', [
      row('Escala', btn('− 10 %', () => scale(0.9)), btn('+ 10 %', () => scale(1.1))),
      row('Voltear', btn('Horizontal', () => flip('x')), btn('Vertical', () => flip('y'))),
      hint('Arrastra la región sobre el lienzo para moverla. Flechas del teclado: mover 1 px (Shift: 10 px).'),
    ]),
    h('div', { class: 'btns' },
      btn('Duplicar', () => duplicateLayer(L.id)),
      btn('Eliminar región', () => deleteLayer(L.id), 'danger')),
  ];
}

function canvasPanel() {
  const c = S.doc.canvas;
  c.bgGradient ||= { angle: 135, c1: '#1e3c72', c2: '#e94057' };
  const preset = h('select', {}, h('option', { value: 'custom' }, 'Personalizado'), PRESETS.map(([v, l]) => h('option', { value: v }, l)));
  bindFn(() => { const k = `${c.width}x${c.height}`; preset.value = PRESETS.some((p) => p[0] === k) ? k : 'custom'; });
  preset.addEventListener('change', () => {
    if (preset.value === 'custom') return;
    const [w, hh] = preset.value.split('x').map(Number);
    c.width = w; c.height = hh;
    done();
  });
  const fonts = S.doc.fonts || [];
  return [
    section('c-size', 'Lienzo', [
      row('Formato', preset),
      row('Tamaño', fNum(() => c.width, (v) => { c.width = Math.round(Math.min(8000, Math.max(16, v))); }, { min: 16, max: 8000 }),
        h('span', { class: 'hint' }, '×'),
        fNum(() => c.height, (v) => { c.height = Math.round(Math.min(8000, Math.max(16, v))); }, { min: 16, max: 8000 }),
        h('span', { class: 'hint' }, 'px')),
    ]),
    section('c-bg', 'Fondo', [
      row('Tipo', fSeg([['color', 'Color'], ['gradient', 'Degradado'], ['transparent', 'Transp.']],
        () => c.bgType, (v) => { c.bgType = v; }, { structure: true })),
      c.bgType === 'color' && row('Color', fColor(() => c.bgColor, (v) => { c.bgColor = v; })),
      c.bgType === 'gradient' && row('Colores', fColor(() => c.bgGradient.c1, (v) => { c.bgGradient.c1 = v; }),
        fColor(() => c.bgGradient.c2, (v) => { c.bgGradient.c2 = v; }),
        mini('⇄', () => { const g = c.bgGradient; [g.c1, g.c2] = [g.c2, g.c1]; done(); }, 'Intercambiar')),
      c.bgType === 'gradient' && row('Ángulo', fRange(() => c.bgGradient.angle, (v) => { c.bgGradient.angle = v; }, { min: 0, max: 360 })),
      c.bgType === 'transparent' && hint('Exporta en PNG o WebP para conservar la transparencia.'),
      hint('Para usar una foto de fondo, añade una imagen y pulsa «Cubrir lienzo».'),
    ]),
    section('c-fonts', 'Fuentes del proyecto', [
      fonts.length
        ? h('ul', { class: 'font-list' }, fonts.map((f) => h('li', {},
          h('span', { style: `font-family:"${f.family}";font-size:16px` }, f.family),
          mini('✕', () => { if (confirm(`¿Quitar la fuente «${f.family}» del proyecto?`)) removeFont(f.assetId); }, 'Quitar', 'danger'))))
        : hint('No hay fuentes cargadas. Puedes usar las del sistema o cargar archivos TTF, OTF, WOFF o WOFF2.'),
      btn('+ Cargar fuente…', () => $('fileFont').click(), 'block'),
      hint('Las fuentes cargadas se guardan dentro del proyecto y se incrustan al exportar.'),
    ], false),
    templatesSection(null),
    section('c-keys', 'Atajos de teclado', [
      h('div', { class: 'keys' },
        [['V', 'Seleccionar'], ['L', 'Lazo (dibujar región)'], ['T', 'Nuevo texto'], ['Ctrl+V', 'Pegar imagen o texto'],
          ['Ctrl+C', 'Copiar capa'], ['Ctrl+D', 'Duplicar capa'], ['Supr', 'Eliminar capa'], ['Flechas', 'Mover 1 px (Shift: 10)'],
          ['Ctrl+Z / Ctrl+Y', 'Deshacer / Rehacer'], ['Ctrl+S', 'Guardar proyecto'], ['Ctrl+O', 'Abrir proyecto'],
          ['Ctrl+E', 'Exportar imagen'], ['Ctrl+rueda', 'Zoom'], ['Shift (arrastrar)', 'Bloquear eje / proporción libre'],
          ['Alt (arrastrar)', 'Sin imán'], ['Doble clic', 'Editar texto']]
          .map(([k, d]) => [h('kbd', {}, k), h('span', {}, d)])),
    ], false),
  ];
}

// ------------------------------------------------------------ Construcción del panel
export function buildPanel() {
  const L = selected();
  const sameLayer = (L?.id ?? null) === lastBuiltId;
  const st = props.scrollTop;
  binds = [];
  props.textContent = '';
  let content;
  if (!L) {
    content = [h('div', { class: 'props-title' }, h('span', { class: 'badge' }, 'Lienzo'), h('strong', {}, 'Ajustes del proyecto')), ...canvasPanel()];
  } else {
    const head = h('div', { class: 'props-title' }, h('span', { class: 'badge' }, TYPE_LABEL[L.type] || L.type),
      fText(() => L.name, (v) => { L.name = v; }, 'Nombre de la capa'));
    const body = L.type === 'text' ? textPanel(L) : L.type === 'image' ? imagePanel(L) : regionPanel(L);
    content = [head, ...body];
  }
  props.append(...content.flat(Infinity).filter(Boolean));
  props.scrollTop = sameLayer ? st : 0;
  lastBuiltId = L?.id ?? null;
}

on('focus-text', () => {
  const ta = $('txtContent');
  if (!ta) return;
  const d = ta.closest('details');
  if (d) d.open = true;
  ta.focus();
  ta.select();
});

// ------------------------------------------------------------ Lista de capas
const thumbs = new Map();
let lastSig = '';

function thumbFor(assetId) {
  if (thumbs.has(assetId)) return thumbs.get(assetId);
  thumbs.set(assetId, '');
  const a = S.doc.assets[assetId];
  if (a) {
    loadImage(a.data).then((img) => {
      const cv = document.createElement('canvas');
      cv.width = 56; cv.height = 40;
      const cx = cv.getContext('2d');
      const k = Math.max(56 / img.naturalWidth, 40 / img.naturalHeight);
      const w = img.naturalWidth * k, hh = img.naturalHeight * k;
      cx.drawImage(img, (56 - w) / 2, (40 - hh) / 2, w, hh);
      thumbs.set(assetId, cv.toDataURL('image/png'));
      lastSig = '';
      renderLayers();
    }).catch(() => {});
  }
  return '';
}

export function renderLayers() {
  const arr = S.doc.layers;
  const sig = JSON.stringify([S.selectedId, arr.map((l) => [l.id, l.name, l.visible, l.locked, l.type, l.assetId, l.color])]);
  if (sig === lastSig) return;
  lastSig = sig;
  list.textContent = '';
  if (!arr.length) {
    list.append(h('li', { class: 'empty' }, 'Sin capas. Añade texto o imágenes, pega con Ctrl+V o dibuja una región con el lazo.'));
    return;
  }
  for (let i = arr.length - 1; i >= 0; i--) {
    const L = arr[i];
    let ico;
    if (L.type === 'image') {
      const src = thumbFor(L.assetId);
      ico = src ? h('img', { class: 'ly-thumb', src, alt: '' }) : h('span', { class: 'ly-ico' }, '▣');
    } else if (L.type === 'text') ico = h('span', { class: 'ly-ico', style: 'font-weight:700;font-family:Georgia' }, 'T');
    else ico = h('span', { class: 'ly-ico', style: `color:${L.color}` }, '◌');

    const nameEl = h('span', { class: 'ly-name', title: 'Doble clic para renombrar' }, L.name || TYPE_LABEL[L.type]);
    nameEl.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      const inp = h('input', { type: 'text', value: L.name });
      nameEl.textContent = '';
      nameEl.append(inp);
      inp.focus(); inp.select();
      const fin = (ok) => {
        if (ok && inp.value.trim()) { L.name = inp.value.trim(); lastSig = ''; done(); } else { lastSig = ''; renderLayers(); }
      };
      inp.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') fin(true); if (ev.key === 'Escape') fin(false); ev.stopPropagation(); });
      inp.addEventListener('blur', () => fin(true));
    });

    const eye = h('button', {
      class: 'ly-btn' + (L.visible === false ? ' off' : ''), title: L.visible === false ? 'Mostrar' : 'Ocultar',
      onclick: (e) => { e.stopPropagation(); L.visible = L.visible === false; done({ structure: S.selectedId === L.id }); },
    }, '👁');
    const lock = h('button', {
      class: 'ly-btn' + (L.locked ? '' : ' off'), title: L.locked ? 'Desbloquear' : 'Bloquear (no se puede mover con el ratón)',
      onclick: (e) => { e.stopPropagation(); L.locked = !L.locked; done(); },
    }, L.locked ? '🔒' : '🔓');

    const li = h('li', {
      class: (L.id === S.selectedId ? 'active' : '') + (L.visible === false ? ' hidden-layer' : ''),
      draggable: true,
      onclick: () => select(L.id),
    }, ico, nameEl, lock, eye);

    li.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/x-layer', L.id); e.dataTransfer.effectAllowed = 'move'; });
    li.addEventListener('dragover', (e) => {
      if (!e.dataTransfer.types.includes('text/x-layer')) return;
      e.preventDefault();
      const above = e.offsetY < li.offsetHeight / 2;
      li.classList.toggle('drop-before', above);
      li.classList.toggle('drop-after', !above);
    });
    li.addEventListener('dragleave', () => li.classList.remove('drop-before', 'drop-after'));
    li.addEventListener('drop', (e) => {
      const id = e.dataTransfer.getData('text/x-layer');
      li.classList.remove('drop-before', 'drop-after');
      if (!id || id === L.id) return;
      e.preventDefault(); e.stopPropagation();
      const above = e.offsetY < li.offsetHeight / 2;
      const si = S.doc.layers.findIndex((l) => l.id === id);
      const ti = S.doc.layers.indexOf(L);
      let to;
      if (above) to = si > ti ? ti + 1 : ti;
      else to = si > ti ? ti : ti - 1;
      moveLayer(id, { to });
    });
    list.append(li);
  }
}

export function layerButtons() {
  $('lyUp').addEventListener('click', () => S.selectedId && moveLayer(S.selectedId, +1));
  $('lyDown').addEventListener('click', () => S.selectedId && moveLayer(S.selectedId, -1));
  $('lyDup').addEventListener('click', () => S.selectedId && duplicateLayer(S.selectedId));
  $('lyDel').addEventListener('click', () => S.selectedId && deleteLayer(S.selectedId));
}

export { getLayer };
