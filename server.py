import base64
import json
import mimetypes
import os
import re
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent
HOST = os.getenv("APP_HOST", "127.0.0.1")
PORT = int(os.getenv("APP_PORT", "8000"))
NVIDIA_ENDPOINT = os.getenv("NVIDIA_ENDPOINT", "https://integrate.api.nvidia.com/v1/chat/completions")
NVIDIA_MODEL = os.getenv("NVIDIA_MODEL", "moonshotai/kimi-k2.6")
IMAGE_PATH = ROOT / "annunciazione-beato-angelico.jpg"
REMOTE_IMAGE = "https://upload.wikimedia.org/wikipedia/commons/0/0e/Fra_Angelico_-_The_Annunciation_-_WGA00555.jpg"
MAX_BODY_BYTES = 2 * 1024 * 1024


def json_response(handler, status, payload):
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(data)))
    handler.send_header("Cache-Control", "no-store")
    handler.end_headers()
    handler.wfile.write(data)


def error_payload(code, message, retryable=False):
    return {"error": {"code": code, "message": message, "retryable": retryable}}


def image_data_uri():
    if not IMAGE_PATH.exists():
        return None
    mime = mimetypes.guess_type(IMAGE_PATH.name)[0] or "image/jpeg"
    encoded = base64.b64encode(IMAGE_PATH.read_bytes()).decode("ascii")
    return f"data:{mime};base64,{encoded}"


def clean_model_json(value):
    if isinstance(value, dict):
        return value
    text = str(value or "").strip()
    text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\s*```$", "", text)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", text, flags=re.DOTALL)
        if match:
            try:
                return json.loads(match.group(0))
            except json.JSONDecodeError:
                pass
    return {"observation": text}


def get_text(response):
    choices = response.get("choices") or []
    if not choices:
        return ""
    message = choices[0].get("message") or {}
    content = message.get("content", "")
    if isinstance(content, list):
        return "\n".join(str(part.get("text", "")) for part in content if isinstance(part, dict))
    return content


def normalize_analysis(raw, request_data):
    selection = request_data.get("selection") or {}
    hotspot = request_data.get("hotspot") or {}
    title = hotspot.get("title") or "Area selezionata"
    sections = raw.get("content") if isinstance(raw.get("content"), dict) else raw
    def field(name, fallback):
        value = sections.get(name) if isinstance(sections, dict) else None
        return str(value).strip() if value else fallback

    confidence = raw.get("confidence") if isinstance(raw.get("confidence"), dict) else {}
    confidence_level = str(confidence.get("level", "high" if selection.get("type") == "hotspot" else "medium"))
    confidence_label = str(confidence.get("label", "Osservazione ben supportata" if confidence_level == "high" else "Interpretazione probabile"))
    sources = request_data.get("sources") or []
    return {
        "id": "nvidia-analysis-" + str(os.getpid()) + "-" + str(int(__import__("time").time() * 1000)),
        "status": "completed",
        "title": title,
        "confidence": {"level": confidence_level, "label": confidence_label, "tone": "cool" if confidence_level == "high" else "warm"},
        "content": {
            "observation": field("observation", "Il modello non ha restituito un’osservazione sufficiente per questa selezione."),
            "importance": field("importance", "Prova a selezionare un’area leggermente più ampia."),
            "composition": field("composition", "Il dettaglio va letto in relazione all’immagine completa."),
            "curiosity": field("curiosity", "Per questo dettaglio non è stata recuperata una curiosità verificata."),
            "connection": field("connection", "L’interpretazione deve restare collegata all’evidenza visiva dell’opera.")
        },
        "sources": sources,
        "disclaimer": "La risposta è generata da un modello multimodale NVIDIA e combina osservazione visiva e informazioni selezionate. Verifica le interpretazioni con le fonti indicate.",
    }


def call_nvidia(request_data):
    api_key = os.getenv("NVIDIA_API_KEY")
    if not api_key:
        raise RuntimeError("NVIDIA_API_KEY non configurata")
    artwork = request_data.get("artwork") or {}
    selection = request_data.get("selection") or {}
    hotspot = request_data.get("hotspot") or {}
    level = request_data.get("learningLevel", "Scuola secondaria")
    image_uri = image_data_uri()
    if not image_uri:
        image_uri = REMOTE_IMAGE

    region = ", ".join(str(selection.get(key)) for key in ("x", "y", "width", "height") if selection.get(key) is not None)
    sources = "\n".join(f"- {source.get('title')}: {source.get('url')}" for source in request_data.get("sources", []) if isinstance(source, dict))
    prompt = f"""Sei un educatore di storia dell'arte per studenti italiani di livello {level}.
Analizza l'opera completa e la regione selezionata dall'utente.

Opera: {artwork.get('title', 'Annunciazione')}
Artista: {artwork.get('artist', 'Beato Angelico')}
Data: {artwork.get('date', '')}
Periodo: {artwork.get('period', '')}
Tecnica: {artwork.get('technique', '')}
Dettaglio curato, se presente: {hotspot.get('title', 'nessuno')}
Coordinate normalizzate della selezione (x, y, width, height): {region or 'punto libero'}

Fonti editoriali disponibili:
{sources or '- Nessuna fonte aggiuntiva'}

Regole:
- Descrivi prima ciò che è osservabile nell'immagine.
- Distingui chiaramente osservazione, contesto e interpretazione.
- Non inventare dettagli, simboli o dati storici.
- Se non puoi identificare una regione, dichiaralo.
- Mantieni il linguaggio chiaro e adatto all'età.
- Produci massimo 200 parole complessive.

Rispondi esclusivamente con JSON valido, senza markdown, usando questa forma:
{{
  "observation": "che cosa si osserva",
  "importance": "perché è importante",
  "composition": "come contribuisce alla composizione",
  "curiosity": "una curiosità verificabile oppure una frase di incertezza",
  "connection": "un collegamento artistico o storico prudente",
  "confidence": {{"level": "high|medium|low", "label": "breve etichetta"}}
}}"""
    content = [{"type": "text", "text": prompt}, {"type": "image_url", "image_url": {"url": image_uri}}]
    body = json.dumps({
        "model": NVIDIA_MODEL,
        "messages": [{"role": "user", "content": content}],
        "temperature": 0.2,
        "top_p": 0.7,
        "max_tokens": 500,
        "stream": False,
    }).encode("utf-8")
    request = Request(NVIDIA_ENDPOINT, data=body, method="POST", headers={
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    })
    try:
        with urlopen(request, timeout=45) as response:
            response_body = response.read().decode("utf-8")
            return normalize_analysis(clean_model_json(get_text(json.loads(response_body))), request_data)
    except HTTPError as exc:
        details = exc.read().decode("utf-8", errors="replace")[:500]
        if exc.code in (401, 403):
            raise ValueError("La chiave NVIDIA non è valida o non è autorizzata") from exc
        if exc.code == 429:
            raise TimeoutError("Limite temporaneo dell’endpoint NVIDIA raggiunto") from exc
        raise ValueError(f"NVIDIA ha rifiutato la richiesta ({exc.code}): {details}") from exc
    except URLError as exc:
        raise TimeoutError("Endpoint NVIDIA non raggiungibile") from exc


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
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0 or length > MAX_BODY_BYTES:
            json_response(self, 413, error_payload("PAYLOAD_TOO_LARGE", "Richiesta non valida o troppo grande"))
            return
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            if not payload.get("artwork") or not payload.get("selection"):
                json_response(self, 400, error_payload("INVALID_REQUEST", "Opera e selezione sono obbligatorie"))
                return
            result = call_nvidia(payload)
            json_response(self, 200, result)
        except RuntimeError as exc:
            json_response(self, 503, error_payload("NVIDIA_NOT_CONFIGURED", str(exc)))
        except TimeoutError as exc:
            json_response(self, 504, error_payload("NVIDIA_TIMEOUT", str(exc), True))
        except ValueError as exc:
            json_response(self, 502, error_payload("NVIDIA_ERROR", str(exc), True))
        except (json.JSONDecodeError, UnicodeDecodeError):
            json_response(self, 400, error_payload("INVALID_JSON", "Il corpo della richiesta non è JSON valido"))
        except Exception:
            json_response(self, 500, error_payload("INTERNAL_ERROR", "Errore interno durante l’analisi", True))

    def log_message(self, format, *args):
        if self.path.startswith("/api"):
            super().log_message(format, *args)


if __name__ == "__main__":
    print(f"Leggi l’Opera d’Arte: http://{HOST}:{PORT}")
    print(f"Modello NVIDIA: {NVIDIA_MODEL}")
    print("NVIDIA_API_KEY: configurata" if os.getenv("NVIDIA_API_KEY") else "NVIDIA_API_KEY: non configurata")
    ThreadingHTTPServer((HOST, PORT), AppHandler).serve_forever()
