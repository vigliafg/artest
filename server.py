import base64
import json
import mimetypes
import os
import re
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent
HOST = os.getenv("APP_HOST", "127.0.0.1")
PORT = int(os.getenv("APP_PORT", "18000"))
OPENROUTER_ENDPOINT = os.getenv("OPENROUTER_ENDPOINT", "https://openrouter.ai/api/v1/chat/completions")
VISION_MODEL = os.getenv("OPENROUTER_VISION_MODEL", "meta/muse-spark-1.3")
TEXT_MODEL = os.getenv("OPENROUTER_TEXT_MODEL", "meta/muse-spark-1.3")
def web_search_enabled(environ=None):
    environ = os.environ if environ is None else environ
    return environ.get("OPENROUTER_WEB_SEARCH", "").strip().lower() == "true"
IMAGE_PATH = ROOT / "annunciazione-beato-angelico.jpg"
MAX_BODY_BYTES = 2 * 1024 * 1024


def load_local_env():
    for filename in (".env.local", ".env"):
        path = ROOT / filename
        if not path.exists():
            continue
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            name, value = line.split("=", 1)
            if name.strip() and name.strip() not in os.environ:
                os.environ[name.strip()] = value.strip().strip("'\"")


load_local_env()


def get_openrouter_api_key(environ=None):
    environ = os.environ if environ is None else environ
    return environ.get("OPENROUTER_API_KEY", "").strip()


def error_payload(code, message, retryable=False):
    return {"error": {"code": code, "message": message, "retryable": retryable}}


def image_data_uri():
    if not IMAGE_PATH.exists():
        raise FileNotFoundError("Immagine dell’opera non trovata")
    mime = mimetypes.guess_type(IMAGE_PATH.name)[0] or "image/jpeg"
    return f"data:{mime};base64,{base64.b64encode(IMAGE_PATH.read_bytes()).decode('ascii')}"


def try_parse_json(text):
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", text, flags=re.DOTALL)
        if match:
            try:
                return json.loads(match.group(0))
            except json.JSONDecodeError:
                pass
    return None


def clean_model_json(value):
    if isinstance(value, dict):
        return value
    text = str(value or "").strip()
    text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\s*```$", "", text)
    parsed = try_parse_json(text)
    if parsed is not None:
        return parsed
    # Reasoning models sometimes double-escape the JSON inside a plain-text envelope.
    unescaped = text.replace('\\"', '"').replace('\\\\', '\\')
    repaired = try_parse_json(unescaped)
    if repaired is not None:
        return repaired
    return {"observation": text}


def get_text(response):
    choices = response.get("choices") or []
    message = (choices[0].get("message") or {}) if choices else {}
    content = message.get("content", "")
    if isinstance(content, list):
        return "\n".join(str(part.get("text", "")) for part in content if isinstance(part, dict))
    return content


def get_citations(response):
    choices = response.get("choices") or []
    message = (choices[0].get("message") or {}) if choices else {}
    citations = []
    for annotation in message.get("annotations") or []:
        if not isinstance(annotation, dict):
            continue
        inner = annotation.get("url_citation") if annotation.get("type") == "url_citation" else None
        if isinstance(inner, dict) and inner.get("url"):
            citations.append({"title": inner.get("title") or "", "url": inner["url"]})
    return citations


def normalize_analysis(raw, request_data, citations=None):
    citations = citations or []
    web_sources = [
        {"title": str(c.get("title") or f"Fonte web {index + 1}"), "url": c["url"], "type": "Web"}
        for index, c in enumerate(citations)
        if isinstance(c, dict) and c.get("url")
    ]
    selection = request_data.get("selection") or {}
    hotspot = request_data.get("hotspot") or {}
    sections = raw.get("content") if isinstance(raw, dict) and isinstance(raw.get("content"), dict) else raw
    sections = sections if isinstance(sections, dict) else {}
    confidence = raw.get("confidence") if isinstance(raw, dict) and isinstance(raw.get("confidence"), dict) else {}
    level = str(confidence.get("level", "high" if selection.get("type") == "hotspot" else "medium"))
    fallback = {
        "observation": "Il modello non ha restituito un’osservazione sufficiente per questa selezione.",
        "importance": "Prova a selezionare un’area leggermente più ampia.",
        "composition": "Il dettaglio va letto in relazione all’immagine completa.",
        "curiosity": "Per questo dettaglio non è stata recuperata una curiosità verificata.",
        "connection": "L’interpretazione deve restare collegata all’evidenza visiva dell’opera.",
    }
    return {
        "id": f"openrouter-analysis-{int(time.time() * 1000)}",
        "status": "completed",
        "title": hotspot.get("title") or "Area selezionata",
        "confidence": {"level": level, "label": str(confidence.get("label", "Osservazione ben supportata" if level == "high" else "Interpretazione probabile")), "tone": "cool" if level == "high" else "warm"},
        "content": {key: str(sections.get(key) or fallback[key]).strip() for key in fallback},
        "sources": web_sources + (request_data.get("sources") or []),
        "disclaimer": "La risposta è generata tramite OpenRouter: il modello osserva il dettaglio e integra i fatti sull’opera che conosce dal proprio addestramento.",
    }


def build_vision_prompt(data):
    artwork = data.get("artwork") or {}
    selection = data.get("selection") or {}
    hotspot = data.get("hotspot") or {}
    coordinates = ", ".join(str(selection[key]) for key in ("x", "y", "width", "height") if selection.get(key) is not None) or "punto libero"
    return f"Analizza visivamente l’opera per un educatore italiano. Opera: {artwork.get('title', '')}; artista: {artwork.get('artist', '')}; dettaglio: {hotspot.get('title', 'area selezionata')}; coordinate: {coordinates}. Descrivi esclusivamente elementi osservabili e restituisci JSON valido con observation, visible_elements, colors, composition e uncertainty. Non inventare dati storici."


def build_text_prompt(data, vision):
    artwork = data.get("artwork") or {}
    hotspot = data.get("hotspot") or {}
    return f"Sei un educatore d’arte italiano. Cerca nella tua memoria di addestramento tutti i fatti che conosci su quest’opera e su ogni suo elemento: titolo, artista, data, periodo, tecnica, luogo di conservazione, contesto storico-artistico, iconografia e significati. Ricorda anche ciò che sai sul dettaglio selezionato ({hotspot.get('title', 'area selezionata')}) e su ogni figura, oggetto o elemento che lo compone. Opera: {artwork.get('title', '')}; artista: {artwork.get('artist', '')}; periodo: {artwork.get('period', '')}; data: {artwork.get('date', '')}; tecnica: {artwork.get('technique', '')}. Osservazione visiva del dettaglio: {json.dumps(vision, ensure_ascii=False)}. Scrivi una spiegazione didattica per {data.get('learningLevel', 'Scuola secondaria')} che integri l’osservazione visiva del dettaglio con i fatti che già conosci sull’opera, distinguendo ciò che è visibile da ciò che è ricostruito dalla conoscenza. Restituisci esclusivamente JSON valido con observation, importance, composition, curiosity, connection e confidence {{level,label}}. Non inventare nulla: usa solo fatti di cui sei ragionevolmente certo e, in caso di dubbio, indica una confidenza più bassa."


def call_model(model, content, api_key):
    payload = {"model": model, "messages": [{"role": "user", "content": content}], "temperature": 0.2, "top_p": 0.7, "max_tokens": 8000, "stream": False}
    if web_search_enabled():
        payload["plugins"] = [{"id": "web", "max_results": 5}]
    body = json.dumps(payload).encode("utf-8")
    request = Request(OPENROUTER_ENDPOINT, data=body, method="POST", headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json", "Accept": "application/json", "HTTP-Referer": "http://127.0.0.1:18000", "X-Title": "Leggi l Opera d Arte"})
    try:
        with urlopen(request, timeout=60) as response:
            raw = json.loads(response.read().decode("utf-8"))
            return {"data": clean_model_json(get_text(raw)), "citations": get_citations(raw)}
    except HTTPError as exc:
        if exc.code in (401, 403):
            raise ValueError("La chiave OpenRouter non è valida o non è autorizzata") from exc
        if exc.code == 429:
            raise TimeoutError("Limite temporaneo di OpenRouter raggiunto") from exc
        raise ValueError(f"OpenRouter ha rifiutato la richiesta ({exc.code})") from exc
    except URLError as exc:
        raise TimeoutError("Endpoint OpenRouter non raggiungibile") from exc


def call_openrouter(request_data):
    api_key = get_openrouter_api_key()
    if not api_key:
        raise RuntimeError("OPENROUTER_API_KEY non configurata")
    content = [{"type": "text", "text": build_vision_prompt(request_data)}, {"type": "image_url", "image_url": {"url": image_data_uri()}}]
    if request_data.get("selectionImage"):
        content.extend([{"type": "text", "text": "La seconda immagine è il crop esatto della regione selezionata."}, {"type": "image_url", "image_url": {"url": request_data["selectionImage"]}}])
    vision = call_model(VISION_MODEL, content, api_key)
    explanation = call_model(TEXT_MODEL, [{"type": "text", "text": build_text_prompt(request_data, vision["data"])}], api_key)
    return normalize_analysis(explanation["data"], request_data, explanation["citations"])


class AppHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_POST(self):
        if self.path != "/api/analyze":
            json_response(self, 404, error_payload("NOT_FOUND", "Endpoint non trovato"))
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if length <= 0 or length > MAX_BODY_BYTES:
            json_response(self, 413, error_payload("PAYLOAD_TOO_LARGE", "Richiesta non valida o troppo grande"))
            return
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            if not payload.get("artwork") or not payload.get("selection"):
                json_response(self, 400, error_payload("INVALID_REQUEST", "Opera e selezione sono obbligatorie"))
                return
            json_response(self, 200, call_openrouter(payload))
        except RuntimeError as exc:
            json_response(self, 503, error_payload("OPENROUTER_NOT_CONFIGURED", str(exc)))
        except TimeoutError as exc:
            json_response(self, 504, error_payload("OPENROUTER_TIMEOUT", str(exc), True))
        except ValueError as exc:
            json_response(self, 502, error_payload("OPENROUTER_ERROR", str(exc), True))
        except (json.JSONDecodeError, UnicodeDecodeError):
            json_response(self, 400, error_payload("INVALID_JSON", "Il corpo della richiesta non è JSON valido"))
        except Exception:
            json_response(self, 500, error_payload("INTERNAL_ERROR", "Errore interno durante l’analisi", True))

    def log_message(self, format, *args):
        if self.path.startswith("/api"):
            super().log_message(format, *args)


def json_response(handler, status, payload):
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(data)))
    handler.send_header("Cache-Control", "no-store")
    handler.end_headers()
    handler.wfile.write(data)


if __name__ == "__main__":
    print(f"Leggi l’Opera d’Arte: http://{HOST}:{PORT}")
    print(f"Modello visione: {VISION_MODEL}")
    print(f"Modello testo: {TEXT_MODEL}")
    print("OpenRouter API key: configurata" if get_openrouter_api_key() else "OpenRouter API key: non configurata")
    ThreadingHTTPServer((HOST, PORT), AppHandler).serve_forever()
