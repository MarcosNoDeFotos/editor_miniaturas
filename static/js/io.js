// Entrada / salida: proyectos, exportación de imagen, portapapeles, arrastrar y soltar, fuentes.
import {
  S, emit, changed, commitNow, resetHistory, migrateDoc, newDoc, addLayer, selected,
  defaultImage, defaultText,
} from './state.js';
import { uid, readAsDataURL, loadImage, downloadBlob, h, openModal, toast, isTyping, deepClone } from './util.js';
import { stage, renderStage } from './render.js';

const LAYER_PREFIX = '__miniatura_capa__:';
const PROJECT_EXT = '.miniatura';

// ------------------------------------------------------------ Imágenes
function findAsset(data) {
  for (const [id, a] of Object.entries(S.doc.assets)) if (a.data === data) return id;
  return null;
}

export async function addImageFromDataURL(data, name = 'Imagen') {
  const img = await loadImage(data);
  let id = findAsset(data);
  if (!id) { id = uid('a'); S.doc.assets[id] = { kind: 'image', name, data }; }
  const { width: W, height: H } = S.doc.canvas;
  const nw = img.naturalWidth || 200, nh = img.naturalHeight || 200;
  const k = Math.min(1, (W * 0.8) / nw, (H * 0.8) / nh);
  const w = Math.round(nw * k), hh = Math.round(nh * k);
  return addLayer(defaultImage(id, {
    name: String(name).replace(/\.[^.]+$/, '').slice(0, 40) || 'Imagen',
    x: Math.round((W - w) / 2), y: Math.round((H - hh) / 2), w, h: hh, natW: nw, natH: nh,
  }));
}

export async function addImageFromBlob(blob, name) {
  return addImageFromDataURL(await readAsDataURL(blob), name || blob.name || 'Imagen');
}

export async function replaceImage(L, file) {
  const data = await readAsDataURL(file);
  const img = await loadImage(data);
  let id = findAsset(data);
  if (!id) { id = uid('a'); S.doc.assets[id] = { kind: 'image', name: file.name, data }; }
  L.assetId = id;
  L.natW = img.naturalWidth; L.natH = img.naturalHeight;
  L.h = Math.round(L.w * (img.naturalHeight / img.naturalWidth));
  changed({ structure: true });
  commitNow();
}

async function naturalSize(L) {
  if (L.natW && L.natH) return [L.natW, L.natH];
  const a = S.doc.assets[L.assetId];
  if (!a) return [L.w, L.h];
  const img = await loadImage(a.data);
  L.natW = img.naturalWidth; L.natH = img.naturalHeight;
  return [L.natW, L.natH];
}

/** mode: 'cover' | 'contain' | 'original' */
export async function fitImage(L, mode) {
  const [nw, nh] = await naturalSize(L);
  const { width: W, height: H } = S.doc.canvas;
  let k = 1;
  if (mode === 'cover') k = Math.max(W / nw, H / nh);
  else if (mode === 'contain') k = Math.min(W / nw, H / nh);
  L.w = Math.round(nw * k); L.h = Math.round(nh * k);
  if (mode !== 'original') { L.rotation = 0; }
  L.x = Math.round((W - L.w) / 2); L.y = Math.round((H - L.h) / 2);
  changed();
  commitNow();
}

// ------------------------------------------------------------ Fuentes
const registered = new Set();

const FONT_MIME = { ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2' };

export async function registerFonts() {
  for (const f of S.doc.fonts || []) {
    const a = S.doc.assets[f.assetId];
    const key = f.family + '|' + f.assetId;
    if (!a || registered.has(key)) continue;
    try {
      const buf = await (await fetch(a.data)).arrayBuffer();
      const ff = new FontFace(f.family, buf);
      await ff.load();
      document.fonts.add(ff);
      registered.add(key);
    } catch (err) {
      console.warn('Fuente no válida', f.family, err);
    }
  }
  emit('render');
}

export async function loadFontFile(file) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (!FONT_MIME[ext]) throw new Error('Formato de fuente no soportado (usa TTF, OTF, WOFF o WOFF2)');
  const family = file.name.replace(/\.[^.]+$/, '').replace(/[^\p{L}\p{N} _-]/gu, ' ').replace(/\s+/g, ' ').trim() || 'Fuente';
  let data = await readAsDataURL(file);
  data = data.replace(/^data:[^;,]*/, 'data:' + FONT_MIME[ext]);
  const id = uid('f');
  S.doc.assets[id] = { kind: 'font', name: file.name, data, family };
  S.doc.fonts.push({ family, assetId: id });
  await registerFonts();
  changed({ structure: true });
  toast(`Fuente «${family}» cargada`);
  return family;
}

export function removeFont(assetId) {
  S.doc.fonts = S.doc.fonts.filter((f) => f.assetId !== assetId);
  delete S.doc.assets[assetId];
  changed({ structure: true });
}

// ------------------------------------------------------------ Proyecto
export function serialize() {
  const doc = deepClone(S.doc);
  const used = new Set();
  doc.layers.forEach((l) => l.assetId && used.add(l.assetId));
  (doc.fonts || []).forEach((f) => used.add(f.assetId));
  for (const k of Object.keys(doc.assets)) if (!used.has(k)) delete doc.assets[k];
  doc.savedAt = new Date().toISOString();
  return JSON.stringify(doc);
}

const projectTypes = [{ description: 'Proyecto de miniatura', accept: { 'application/json': [PROJECT_EXT, '.json'] } }];

export async function saveProject(saveAs = false) {
  commitNow();
  const blob = new Blob([serialize()], { type: 'application/json' });
  try {
    if (window.showSaveFilePicker) {
      let handle = saveAs ? null : S.fileHandle;
      if (!handle) {
        handle = await window.showSaveFilePicker({ suggestedName: S.fileName + PROJECT_EXT, types: projectTypes });
      }
      const w = await handle.createWritable();
      await w.write(blob);
      await w.close();
      S.fileHandle = handle;
      S.fileName = handle.name.replace(/\.(miniatura|json)$/i, '');
    } else {
      if (saveAs || S.fileName === 'proyecto') {
        const n = prompt('Nombre del archivo del proyecto:', S.fileName);
        if (!n) return;
        S.fileName = n.replace(/\.(miniatura|json)$/i, '');
      }
      downloadBlob(blob, S.fileName + PROJECT_EXT);
    }
    S.dirty = false;
    emit('title');
    toast('Proyecto guardado');
  } catch (err) {
    if (err.name !== 'AbortError') toast('No se pudo guardar: ' + err.message, 'error');
  }
}

export async function loadProjectText(text, name = 'proyecto', handle = null) {
  let obj;
  try { obj = JSON.parse(text); } catch { throw new Error('El archivo no es un proyecto válido'); }
  if (!obj || !Array.isArray(obj.layers) || !obj.canvas) throw new Error('El archivo no es un proyecto de miniatura');
  S.doc = migrateDoc(obj);
  S.fileHandle = handle;
  S.fileName = String(name).replace(/\.(miniatura|json)$/i, '');
  S.selectedId = null;
  await registerFonts();
  resetHistory();
  S.dirty = false;
  emit('doc-loaded');
  toast('Proyecto cargado');
}

export async function openProject() {
  if (S.dirty && !confirm('Hay cambios sin guardar. ¿Abrir otro proyecto de todos modos?')) return;
  if (window.showOpenFilePicker) {
    try {
      const [handle] = await window.showOpenFilePicker({ types: projectTypes });
      const file = await handle.getFile();
      await loadProjectText(await file.text(), file.name, handle);
    } catch (err) {
      if (err.name !== 'AbortError') toast(err.message, 'error');
    }
  } else {
    document.getElementById('fileProject').click();
  }
}

export function newProject() {
  if (S.dirty && !confirm('Hay cambios sin guardar. ¿Crear un proyecto nuevo?')) return;
  const keepCanvas = deepClone(S.doc.canvas);
  S.doc = newDoc();
  S.doc.canvas.width = keepCanvas.width;
  S.doc.canvas.height = keepCanvas.height;
  S.fileHandle = null;
  S.fileName = 'proyecto';
  S.selectedId = null;
  resetHistory();
  S.dirty = false;
  emit('doc-loaded');
}

// ------------------------------------------------------------ Exportación
/** Renderiza el lienzo a un <canvas> usando SVG foreignObject (el navegador aplica el CSS). */
export async function renderToCanvas(scale = 1, opaque = false) {
  await document.fonts.ready;
  renderStage();
  const { width: W, height: H } = S.doc.canvas;
  const clone = stage.cloneNode(true);
  clone.removeAttribute('id');
  clone.querySelectorAll('[data-id]').forEach((n) => {
    n.removeAttribute('data-id'); n.removeAttribute('data-type'); n.removeAttribute('class');
  });
  clone.querySelectorAll('img').forEach((n) => n.removeAttribute('data-asset'));

  const usedFamilies = new Set(S.doc.layers.filter((l) => l.type === 'text' && l.visible !== false).map((l) => l.fontFamily));
  let css = '';
  for (const f of S.doc.fonts || []) {
    const a = S.doc.assets[f.assetId];
    if (a && usedFamilies.has(f.family)) css += `@font-face{font-family:"${f.family.replace(/"/g, '')}";src:url(${a.data});}`;
  }
  const xhtml = new XMLSerializer().serializeToString(clone);
  const sw = Math.round(W * scale), sh = Math.round(H * scale);
  const svgText = `<svg xmlns="http://www.w3.org/2000/svg" width="${sw}" height="${sh}" viewBox="0 0 ${W} ${H}">`
    + `<foreignObject x="0" y="0" width="${W}" height="${H}">`
    + `<div xmlns="http://www.w3.org/1999/xhtml" style="margin:0;padding:0;width:${W}px;height:${H}px;overflow:hidden;">`
    + `<style>${css}</style>${xhtml}</div></foreignObject></svg>`;

  const img = new Image();
  img.decoding = 'sync';
  await new Promise((res, rej) => {
    img.onload = res;
    img.onerror = () => rej(new Error('El navegador no pudo renderizar la imagen'));
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgText);
  });
  await new Promise((r) => setTimeout(r, 80));

  const cv = document.createElement('canvas');
  cv.width = sw; cv.height = sh;
  const cx = cv.getContext('2d');
  if (opaque) { cx.fillStyle = '#ffffff'; cx.fillRect(0, 0, sw, sh); }
  cx.drawImage(img, 0, 0, sw, sh);
  return cv;
}

const FORMATS = {
  png: { mime: 'image/png', ext: '.png', label: 'PNG (sin pérdida, admite transparencia)' },
  jpeg: { mime: 'image/jpeg', ext: '.jpg', label: 'JPG (más ligero)' },
  webp: { mime: 'image/webp', ext: '.webp', label: 'WebP' },
};

export async function exportBlob(format, scale, quality) {
  const f = FORMATS[format] || FORMATS.png;
  const cv = await renderToCanvas(scale, format === 'jpeg');
  return new Promise((res, rej) => {
    try {
      cv.toBlob((b) => (b ? res(b) : rej(new Error('No se pudo generar la imagen'))), f.mime, quality);
    } catch (err) {
      rej(new Error('El navegador bloqueó la exportación (' + err.message + '). Prueba con Chrome, Edge o Firefox.'));
    }
  });
}

let lastExport = { format: 'png', scale: 1, quality: 0.92 };

export function exportDialog() {
  const { width: W, height: H } = S.doc.canvas;
  const name = h('input', { type: 'text', value: S.fileName });
  const fmt = h('select', {}, Object.entries(FORMATS).map(([k, f]) => h('option', { value: k }, f.label)));
  fmt.value = lastExport.format;
  const scale = h('select', {}, [0.5, 1, 1.5, 2, 3].map((s) =>
    h('option', { value: s }, `${s}× — ${Math.round(W * s)} × ${Math.round(H * s)} px`)));
  scale.value = String(lastExport.scale);
  const q = h('input', { type: 'range', min: 0.5, max: 1, step: 0.01, value: lastExport.quality });
  const qv = h('span', { class: 'hint' }, Math.round(lastExport.quality * 100) + '%');
  q.addEventListener('input', () => { qv.textContent = Math.round(q.value * 100) + '%'; });
  const qRow = h('div', { class: 'row' }, h('label', {}, 'Calidad'), h('div', { class: 'ctrl' }, h('div', { class: 'range' }, q, qv)));
  const upd = () => { qRow.style.display = fmt.value === 'png' ? 'none' : ''; };
  fmt.addEventListener('change', upd); upd();

  const read = () => {
    lastExport = { format: fmt.value, scale: +scale.value, quality: +q.value };
    return lastExport;
  };

  openModal({
    title: 'Exportar imagen',
    body: [
      h('div', { class: 'row' }, h('label', {}, 'Nombre'), h('div', { class: 'ctrl' }, name)),
      h('div', { class: 'row' }, h('label', {}, 'Formato'), h('div', { class: 'ctrl' }, fmt)),
      h('div', { class: 'row' }, h('label', {}, 'Tamaño'), h('div', { class: 'ctrl' }, scale)),
      qRow,
      h('p', { class: 'hint' }, 'Las regiones, guías y marcos de selección no aparecen en la imagen exportada.'),
    ],
    actions: [
      { label: 'Cancelar' },
      {
        label: 'Copiar al portapapeles',
        onClick: async () => {
          const o = read();
          const blob = await exportBlob('png', o.scale, 1);
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
          toast('Imagen copiada al portapapeles');
        },
      },
      {
        label: 'Exportar', primary: true,
        onClick: async () => {
          const o = read();
          const f = FORMATS[o.format];
          const fname = (name.value.trim() || 'miniatura').replace(/[\\/:*?"<>|]/g, '_') + f.ext;
          toast('Generando imagen…', 'info', 1200);
          const blob = await exportBlob(o.format, o.scale, o.quality);
          if (window.showSaveFilePicker) {
            try {
              const hd = await window.showSaveFilePicker({
                suggestedName: fname, types: [{ description: f.label, accept: { [f.mime]: [f.ext] } }],
              });
              const w = await hd.createWritable(); await w.write(blob); await w.close();
            } catch (err) {
              if (err.name === 'AbortError') return false;
              throw err;
            }
          } else downloadBlob(blob, fname);
          toast('Imagen exportada');
          return true;
        },
      },
    ],
  });
}

// ------------------------------------------------------------ Portapapeles
function pasteLayerJson(json) {
  let obj;
  try { obj = JSON.parse(json); } catch { return false; }
  const L = obj.layer;
  if (!L || !L.type) return false;
  if (obj.asset && L.assetId && !S.doc.assets[L.assetId]) S.doc.assets[L.assetId] = obj.asset;
  L.id = uid(L.type[0]);
  if (L.type === 'region') L.points = L.points.map(([x, y]) => [x + 20, y + 20]);
  else { L.x += 20; L.y += 20; }
  addLayer(L);
  return true;
}

function addTextLayer(text) {
  const { width: W, height: H } = S.doc.canvas;
  addLayer(defaultText({ text, x: Math.round(W * 0.1), y: Math.round(H * 0.4), w: Math.round(W * 0.8) }));
}

export async function pasteFromClipboardButton() {
  try {
    if (navigator.clipboard?.read) {
      const items = await navigator.clipboard.read();
      for (const it of items) {
        const type = it.types.find((t) => t.startsWith('image/'));
        if (type) { await addImageFromBlob(await it.getType(type), 'Imagen pegada'); return; }
      }
    }
    const text = await navigator.clipboard.readText();
    if (text) {
      if (text.startsWith(LAYER_PREFIX)) pasteLayerJson(text.slice(LAYER_PREFIX.length));
      else addTextLayer(text);
    } else toast('El portapapeles está vacío');
  } catch (err) {
    toast('No se pudo leer el portapapeles. Usa Ctrl+V sobre el editor.', 'error');
  }
}

export function installClipboard() {
  document.addEventListener('paste', async (e) => {
    if (isTyping(e.target) || document.querySelector('.modal-back')) return;
    const items = [...(e.clipboardData?.items || [])];
    const imgs = items.filter((i) => i.kind === 'file' && i.type.startsWith('image/'));
    if (imgs.length) {
      e.preventDefault();
      for (const it of imgs) {
        const f = it.getAsFile();
        if (f) await addImageFromBlob(f, 'Imagen pegada');
      }
      return;
    }
    const text = e.clipboardData?.getData('text/plain');
    if (text) {
      e.preventDefault();
      if (text.startsWith(LAYER_PREFIX)) pasteLayerJson(text.slice(LAYER_PREFIX.length));
      else addTextLayer(text);
    }
  });

  document.addEventListener('copy', (e) => {
    if (isTyping(e.target) || window.getSelection()?.toString()) return;
    const L = selected();
    if (!L) return;
    const payload = { layer: L, asset: L.assetId ? S.doc.assets[L.assetId] : null };
    e.clipboardData.setData('text/plain', LAYER_PREFIX + JSON.stringify(payload));
    e.preventDefault();
    toast('Capa copiada');
  });
}

// ------------------------------------------------------------ Archivos (inputs y soltar)
export async function handleFiles(files) {
  for (const f of files) {
    const ext = (f.name.split('.').pop() || '').toLowerCase();
    try {
      if (f.type.startsWith('image/')) await addImageFromBlob(f, f.name);
      else if (FONT_MIME[ext]) await loadFontFile(f);
      else if (ext === 'miniatura' || ext === 'json') {
        if (S.dirty && !confirm('Hay cambios sin guardar. ¿Abrir el proyecto soltado?')) continue;
        await loadProjectText(await f.text(), f.name, null);
      } else toast(`Archivo no soportado: ${f.name}`, 'error');
    } catch (err) {
      toast(err.message, 'error');
    }
  }
}

export function installFileInputs() {
  const fi = document.getElementById('fileImage');
  fi.addEventListener('change', async () => { await handleFiles([...fi.files]); fi.value = ''; });

  const fp = document.getElementById('fileProject');
  fp.addEventListener('change', async () => {
    const f = fp.files[0]; fp.value = '';
    if (!f) return;
    try { await loadProjectText(await f.text(), f.name, null); } catch (err) { toast(err.message, 'error'); }
  });

  const ff = document.getElementById('fileFont');
  ff.addEventListener('change', async () => {
    const f = ff.files[0]; ff.value = '';
    if (!f) return;
    try {
      const fam = await loadFontFile(f);
      const L = selected();
      if (L && L.type === 'text') { L.fontFamily = fam; changed({ structure: true }); }
    } catch (err) { toast(err.message, 'error'); }
  });

  const fr = document.getElementById('fileReplace');
  fr.addEventListener('change', async () => {
    const f = fr.files[0]; fr.value = '';
    const L = selected();
    if (f && L && L.type === 'image') {
      try { await replaceImage(L, f); } catch (err) { toast(err.message, 'error'); }
    }
  });

  window.addEventListener('dragover', (e) => { e.preventDefault(); });
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    const files = [...(e.dataTransfer?.files || [])];
    if (files.length) handleFiles(files);
  });
}
