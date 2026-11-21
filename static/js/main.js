// Punto de entrada: conecta estado, renderizado, panel, barra de herramientas y teclado.
import {
  S, on, emit, select, selected, setTool, undo, redo, canUndo, canRedo,
  deleteLayer, duplicateLayer, addLayer, defaultText, resetHistory, changed,
} from './state.js';
import { renderStage, renderOverlay } from './render.js';
import './interact.js';
import { buildPanel, refreshValues, renderLayers, layerButtons } from './panel.js';
import * as IO from './io.js';
import { loadTemplates } from './templates.js';
import { toast, isTyping, clamp } from './util.js';

const $ = (id) => document.getElementById(id);
const vp = $('viewport');
const sizer = $('sizer');
const wrap = $('stageWrap');

// ------------------------------------------------------------ Render y zoom
let raf = 0;
function scheduleRender() {
  if (raf) return;
  raf = requestAnimationFrame(() => {
    raf = 0;
    renderStage();
    applyZoom();
    updateTitle();
  });
}

function applyZoom() {
  const { width: W, height: H } = S.doc.canvas;
  sizer.style.width = W * S.zoom + 'px';
  sizer.style.height = H * S.zoom + 'px';
  wrap.style.transform = `scale(${S.zoom})`;
  $('zoomLabel').textContent = Math.round(S.zoom * 100) + '%';
  $('statusSize').textContent = `${W} × ${H} px`;
}

function setZoom(z, anchor) {
  const old = S.zoom;
  z = clamp(z, 0.05, 5);
  if (Math.abs(z - old) < 1e-4) return;
  let sx = 0, sy = 0;
  if (anchor) {
    const r = wrap.getBoundingClientRect();
    sx = (anchor.clientX - r.left) / old;
    sy = (anchor.clientY - r.top) / old;
  }
  S.zoom = z;
  S.autoFit = false;
  applyZoom();
  renderOverlay();
  if (anchor) {
    const r = wrap.getBoundingClientRect();
    vp.scrollLeft += r.left + sx * z - anchor.clientX;
    vp.scrollTop += r.top + sy * z - anchor.clientY;
  }
}

function fit() {
  const { width: W, height: H } = S.doc.canvas;
  const aw = Math.max(50, vp.clientWidth - 64), ah = Math.max(50, vp.clientHeight - 64);
  S.zoom = clamp(Math.min(aw / W, ah / H), 0.05, 2);
  S.autoFit = true;
  applyZoom();
  renderOverlay();
}

// ------------------------------------------------------------ Interfaz
const HINTS = {
  select: 'Arrastra para mover · Shift: bloquear eje · Alt: sin imán · Doble clic en un texto para editarlo · Ctrl+V pega imágenes',
  lasso: 'Lazo: mantén pulsado y dibuja libremente la región; al soltar se cierra. Esc para cancelar.',
};

function updateTools() {
  $('toolSelect').classList.toggle('active', S.tool === 'select');
  $('toolLasso').classList.toggle('active', S.tool === 'lasso');
  $('btnRegions').classList.toggle('active', S.showRegions);
  vp.classList.toggle('lasso', S.tool === 'lasso');
  $('statusHint').textContent = HINTS[S.tool] || '';
}

function updateUndo() {
  $('btnUndo').disabled = !canUndo();
  $('btnRedo').disabled = !canRedo();
}

function updateTitle() {
  document.title = `${S.dirty ? '• ' : ''}${S.fileName} — Editor de miniaturas`;
}

function addText() {
  const { width: W, height: H } = S.doc.canvas;
  addLayer(defaultText({
    x: Math.round(W * 0.08), y: Math.round(H * 0.1), w: Math.round(W * 0.84),
    fontSize: Math.max(12, Math.round(H * 0.13)),
  }));
  setTimeout(() => emit('focus-text'), 30);
}

function nudge(L, dx, dy) {
  if (L.type === 'region') L.points = L.points.map(([x, y]) => [x + dx, y + dy]);
  else { L.x += dx; L.y += dy; }
  changed();
}

// ------------------------------------------------------------ Eventos internos
on('render', scheduleRender);
on('overlay', renderOverlay);
on('select', () => { buildPanel(); renderLayers(); });
on('panel', buildPanel);
on('panel-values', refreshValues);
on('layers', renderLayers);
on('templates', () => { if (!isTyping()) buildPanel(); });
on('tool', updateTools);
on('history', updateUndo);
on('title', updateTitle);
on('zoom', ({ factor, clientX, clientY }) => setZoom(S.zoom * factor, { clientX, clientY }));
on('cursor', (p) => { $('statusPos').textContent = `x ${Math.round(p[0])} · y ${Math.round(p[1])}`; });
on('doc-loaded', () => {
  renderStage();
  fit();
  buildPanel();
  renderLayers();
  updateTitle();
  updateUndo();
});

// ------------------------------------------------------------ Barra de herramientas
$('btnNew').addEventListener('click', () => IO.newProject());
$('btnOpen').addEventListener('click', () => IO.openProject());
$('btnSave').addEventListener('click', () => IO.saveProject(false));
$('btnSaveAs').addEventListener('click', () => IO.saveProject(true));
$('toolSelect').addEventListener('click', () => setTool('select'));
$('toolLasso').addEventListener('click', () => setTool(S.tool === 'lasso' ? 'select' : 'lasso'));
$('btnAddText').addEventListener('click', addText);
$('btnAddImage').addEventListener('click', () => $('fileImage').click());
$('btnPaste').addEventListener('click', () => IO.pasteFromClipboardButton());
$('btnUndo').addEventListener('click', undo);
$('btnRedo').addEventListener('click', redo);
$('btnZoomIn').addEventListener('click', () => setZoom(S.zoom * 1.2));
$('btnZoomOut').addEventListener('click', () => setZoom(S.zoom / 1.2));
$('zoomLabel').addEventListener('click', () => setZoom(1));
$('btnFit').addEventListener('click', fit);
$('btnRegions').addEventListener('click', () => { S.showRegions = !S.showRegions; updateTools(); renderOverlay(); });
$('btnExport').addEventListener('click', () => IO.exportDialog());
layerButtons();

// ------------------------------------------------------------ Teclado
document.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  if (mod && k === 's') { e.preventDefault(); IO.saveProject(e.shiftKey); return; }
  if (mod && k === 'o') { e.preventDefault(); IO.openProject(); return; }
  if (mod && k === 'e') { e.preventDefault(); IO.exportDialog(); return; }
  if (document.querySelector('.modal-back')) return;
  if (isTyping(e.target)) {
    if (e.key === 'Escape') e.target.blur();
    return;
  }
  if (mod && k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return; }
  if (mod && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); redo(); return; }
  if (mod && k === 'd') { e.preventDefault(); if (S.selectedId) duplicateLayer(S.selectedId); return; }
  if (mod && k === '0') { e.preventDefault(); fit(); return; }
  if (mod && (k === '+' || k === '=')) { e.preventDefault(); setZoom(S.zoom * 1.2); return; }
  if (mod && k === '-') { e.preventDefault(); setZoom(S.zoom / 1.2); return; }
  if (mod || e.altKey) return;

  const L = selected();
  const step = e.shiftKey ? 10 : 1;
  switch (e.key) {
    case 'Delete':
    case 'Backspace':
      if (L) { e.preventDefault(); deleteLayer(L.id); }
      break;
    case 'Escape':
      if (S.tool === 'lasso') setTool('select'); else select(null);
      break;
    case 'ArrowLeft': if (L && !L.locked) { e.preventDefault(); nudge(L, -step, 0); } break;
    case 'ArrowRight': if (L && !L.locked) { e.preventDefault(); nudge(L, step, 0); } break;
    case 'ArrowUp': if (L && !L.locked) { e.preventDefault(); nudge(L, 0, -step); } break;
    case 'ArrowDown': if (L && !L.locked) { e.preventDefault(); nudge(L, 0, step); } break;
    default:
      if (k === 'v') setTool('select');
      else if (k === 'l') setTool('lasso');
      else if (k === 't') { e.preventDefault(); addText(); }
  }
});

window.addEventListener('beforeunload', (e) => {
  if (S.dirty) { e.preventDefault(); e.returnValue = ''; }
});

new ResizeObserver(() => { if (S.autoFit) fit(); }).observe(vp);

// ------------------------------------------------------------ Inicio
IO.installClipboard();
IO.installFileInputs();
resetHistory();
renderStage();
fit();
buildPanel();
renderLayers();
updateTools();
updateUndo();
updateTitle();
loadTemplates().catch((err) => toast('No se pudieron cargar las plantillas: ' + err.message, 'error'));
document.fonts.ready.then(() => emit('render'));
document.fonts.addEventListener?.('loadingdone', () => emit('render'));
