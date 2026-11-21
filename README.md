# Editor de miniaturas

Editor web sencillo (Flask + HTML/CSS/JS) para crear miniaturas con capas de texto e imágenes.

## Puesta en marcha

```bash
pip install -r requirements.txt
python app.py
```

Se abre automáticamente `http://127.0.0.1:5000`. Variables opcionales: `PORT`, `HOST`, `NO_BROWSER=1`.
Recomendado: Chrome, Edge o Firefox.

## Funciones

- **Capas** de texto, imagen y región: reordenar (arrastrando en la lista o con ▲▼), ocultar, bloquear, renombrar, duplicar y eliminar.
- **Imágenes**: desde archivo, arrastrando al editor o **pegando del portapapeles (Ctrl+V)**. Incluye filtros, volteo, borde por lados, esquinas, sombras (silueta o caja), contorno de silueta para PNG recortados y botón «Cubrir lienzo» para fondos.
- **Texto**: fuente (del sistema o cargada desde TTF/OTF/WOFF), tamaño, grosor, alineación, interlineado, espaciado, color o degradado, **varios contornos apilados**, **varias sombras** con dirección (brújula de 8 direcciones o ángulo), distancia y desenfoque, y caja con fondo, relleno, **borde por lados** (elige arriba/derecha/abajo/izquierda) y sombras de caja.
- **Regiones con lazo** (tecla L): dibuja una forma libre; el texto **no se coloca encima**, la rodea y continúa después. Tienen margen ajustable y no aparecen al exportar. Una imagen también puede actuar como región.
- **Plantillas de texto**: crear a partir del estilo actual, aplicar, editar (nombre, sustituir por el estilo de la capa o JSON) y eliminar. Se guardan en `data/plantillas.json`.
- **CSS personalizado** por capa, además de los estilos generados por el panel.
- **Proyecto**: guardar / abrir archivos `.miniatura` (JSON con imágenes y fuentes incrustadas). Deshacer y rehacer.
- **Exportar** a PNG, JPG o WebP (0,5× a 3×) o copiar al portapapeles. La exportación la renderiza el propio navegador a partir del HTML/CSS del lienzo, así que el resultado es igual a lo que ves en el editor.

## Estructura

```
app.py                 servidor Flask y API de plantillas (/api/templates)
data/plantillas.json   plantillas guardadas (se crea con 6 de ejemplo)
templates/index.html   interfaz
static/css/editor.css  estilos de la interfaz
static/js/
  main.js        arranque, barra de herramientas y atajos
  state.js       estado, valores por defecto, historial
  layout.js      maquetación del texto alrededor de las regiones
  render.js      dibujo del lienzo con CSS en línea y superposición
  interact.js    ratón: mover, redimensionar, girar, lazo
  panel.js       panel de capas y de estilos
  io.js          proyectos, exportación, portapapeles, fuentes
  templates.js   cliente de la API de plantillas
```
