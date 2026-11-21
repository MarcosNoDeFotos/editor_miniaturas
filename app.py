"""
Editor de miniaturas - servidor Flask.

Sirve la aplicación web y gestiona las plantillas de estilo de texto,
que se guardan en data/plantillas.json.

Uso:
    pip install -r requirements.txt
    python app.py            (abre http://127.0.0.1:5000)
"""
import json
import os
import threading
import time
import uuid
import webbrowser

from flask import Flask, abort, jsonify, render_template, request

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
TEMPLATES_FILE = os.path.join(DATA_DIR, "plantillas.json")

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 5 * 1024 * 1024  # las plantillas son JSON pequeños
app.json.ensure_ascii = False
app.json.sort_keys = False

_lock = threading.Lock()


# --------------------------------------------------------------------------
# Plantillas por defecto
# --------------------------------------------------------------------------
def _stroke(width, color, alpha=1):
    return {"enabled": True, "width": width, "color": color, "alpha": alpha}


def _shadow(angle, distance, blur, color, alpha=1):
    return {"enabled": True, "angle": angle, "distance": distance, "blur": blur,
            "color": color, "alpha": alpha}


def _box_shadow(angle, distance, blur, spread, color, alpha=1, inset=False):
    return {"enabled": True, "angle": angle, "distance": distance, "blur": blur,
            "spread": spread, "color": color, "alpha": alpha, "inset": inset}


def _border(**kw):
    b = {"width": 0, "style": "solid", "color": "#ffffff", "alpha": 1, "radius": 0,
         "top": True, "right": True, "bottom": True, "left": True}
    b.update(kw)
    return b


def _style(**kw):
    s = {
        "fontFamily": "Impact", "fontSize": 96, "fontWeight": "400", "italic": False,
        "fillType": "color", "color": "#ffffff",
        "gradient": {"angle": 90, "c1": "#ffe600", "c2": "#ff5e00"},
        "align": "left", "lineHeight": 1.1, "letterSpacing": 0, "uppercase": False,
        "strokes": [], "shadows": [],
        "bgColor": "#000000", "bgAlpha": 0, "padX": 0, "padY": 0,
        "border": _border(), "boxShadows": [],
        "opacity": 1, "blend": "normal", "customCss": "", "customTextCss": "",
    }
    s.update(kw)
    return s


def _default_templates():
    now = time.time()
    raw = [
        ("Impacto amarillo", _style(
            color="#ffe600", uppercase=True, fontSize=110,
            strokes=[_stroke(7, "#000000")],
            shadows=[_shadow(45, 9, 0, "#000000", 1)])),
        ("Doble contorno", _style(
            fontFamily="Arial Black", fontWeight="900", fontSize=96, uppercase=True,
            color="#ffffff",
            strokes=[_stroke(6, "#000000"), _stroke(6, "#ff2d55")],
            shadows=[_shadow(90, 10, 12, "#000000", 0.6)])),
        ("Neón azul", _style(
            fontFamily="Verdana", fontWeight="700", fontSize=88, color="#ffffff",
            shadows=[_shadow(0, 0, 8, "#00e5ff", 1), _shadow(0, 0, 22, "#00e5ff", 1),
                     _shadow(0, 0, 48, "#0066ff", 1)])),
        ("Degradado fuego", _style(
            fillType="gradient", gradient={"angle": 90, "c1": "#ffde00", "c2": "#ff2a00"},
            uppercase=True, fontSize=120, letterSpacing=2,
            strokes=[_stroke(6, "#1a0000")],
            shadows=[_shadow(60, 8, 6, "#000000", 0.8)])),
        ("Etiqueta roja", _style(
            fontFamily="Arial", fontWeight="800", fontSize=64, color="#ffffff",
            uppercase=True, bgColor="#e50914", bgAlpha=1, padX=28, padY=10,
            border=_border(radius=14),
            boxShadows=[_box_shadow(90, 8, 18, 0, "#000000", 0.55)])),
        ("Subtítulo suave", _style(
            fontFamily="Segoe UI", fontWeight="600", fontSize=52, color="#ffffff",
            lineHeight=1.2, shadows=[_shadow(90, 4, 10, "#000000", 0.75)])),
    ]
    return [{"id": uuid.uuid4().hex[:12], "name": n, "style": s,
             "created": now, "updated": now} for n, s in raw]


# --------------------------------------------------------------------------
# Persistencia
# --------------------------------------------------------------------------
def _load():
    if not os.path.exists(TEMPLATES_FILE):
        data = _default_templates()
        _save(data)
        return data
    try:
        with open(TEMPLATES_FILE, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        return data if isinstance(data, list) else []
    except (OSError, json.JSONDecodeError):
        return []


def _save(data):
    os.makedirs(DATA_DIR, exist_ok=True)
    tmp = TEMPLATES_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)
    os.replace(tmp, TEMPLATES_FILE)


def _validated(payload, partial=False):
    if not isinstance(payload, dict):
        abort(400, "Se esperaba un objeto JSON")
    out = {}
    if "name" in payload or not partial:
        name = str(payload.get("name", "")).strip()
        if not name or len(name) > 80:
            abort(400, "El nombre es obligatorio (máx. 80 caracteres)")
        out["name"] = name
    if "style" in payload or not partial:
        style = payload.get("style")
        if not isinstance(style, dict):
            abort(400, "El estilo debe ser un objeto")
        # Nunca se guardan datos de contenido o posición en una plantilla
        for k in ("id", "type", "text", "x", "y", "w", "h", "rotation", "name",
                  "visible", "locked"):
            style.pop(k, None)
        out["style"] = style
    return out


# --------------------------------------------------------------------------
# Rutas
# --------------------------------------------------------------------------
@app.get("/")
def index():
    return render_template("index.html")


@app.get("/api/templates")
def list_templates():
    with _lock:
        return jsonify(_load())


@app.post("/api/templates")
def create_template():
    data = _validated(request.get_json(silent=True))
    now = time.time()
    tpl = {"id": uuid.uuid4().hex[:12], "name": data["name"], "style": data["style"],
           "created": now, "updated": now}
    with _lock:
        items = _load()
        items.append(tpl)
        _save(items)
    return jsonify(tpl), 201


@app.put("/api/templates/<tid>")
def update_template(tid):
    data = _validated(request.get_json(silent=True), partial=True)
    with _lock:
        items = _load()
        for tpl in items:
            if tpl.get("id") == tid:
                tpl.update(data)
                tpl["updated"] = time.time()
                _save(items)
                return jsonify(tpl)
    abort(404, "Plantilla no encontrada")


@app.delete("/api/templates/<tid>")
def delete_template(tid):
    with _lock:
        items = _load()
        rest = [t for t in items if t.get("id") != tid]
        if len(rest) == len(items):
            abort(404, "Plantilla no encontrada")
        _save(rest)
    return jsonify({"ok": True})


@app.errorhandler(400)
@app.errorhandler(404)
def _json_error(err):
    return jsonify({"error": getattr(err, "description", str(err))}), err.code


if __name__ == "__main__":
    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", "5000"))
    if os.environ.get("NO_BROWSER") != "1":
        threading.Timer(1.0, lambda: webbrowser.open(f"http://{host}:{port}/")).start()
    app.run(host=host, port=port, debug=False)
