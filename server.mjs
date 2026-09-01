import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)));
export const NVIDIA_ENDPOINT = process.env.NVIDIA_ENDPOINT || 'https://integrate.api.nvidia.com/v1/chat/completions';
export const NVIDIA_MODEL = process.env.NVIDIA_MODEL || 'moonshotai/kimi-k2.6';
export const IMAGE_PATH = join(ROOT, 'annunciazione-beato-angelico.jpg');
const PORT = Number(process.env.APP_PORT || 8000);
const HOST = process.env.APP_HOST || '127.0.0.1';

const artworkSources = [
  { title: 'Museo Nazionale di San Marco', type: 'Museo', url: 'https://museitoscani.cultura.gov.it/museo-di-san-marco/' },
  { title: 'Treccani — Beato Angelico', type: 'Enciclopedia', url: 'https://www.treccani.it/enciclopedia/beato-angelico/' }
];

export function cleanModelJson(value) {
  if (value && typeof value === 'object') return value;
  const text = String(value || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(text); } catch { /* continue */ }
  const match = text.match(/\{[\s\S]*\}/);
  if (match) { try { return JSON.parse(match[0]); } catch { /* continue */ } }
  return { observation: text };
}

export function normalizeAnalysis(raw, input) {
  const selection = input.selection || {};
  const hotspot = input.hotspot || {};
  const content = raw?.content && typeof raw.content === 'object' ? raw.content : raw || {};
  const confidence = raw?.confidence && typeof raw.confidence === 'object' ? raw.confidence : {};
  const fallback = {
    observation: 'Il modello non ha restituito un’osservazione sufficiente per questa selezione.',
    importance: 'Prova a selezionare un’area leggermente più ampia.',
    composition: 'Il dettaglio va letto in relazione all’immagine completa.',
    curiosity: 'Per questo dettaglio non è stata recuperata una curiosità verificata.',
    connection: 'L’interpretazione deve restare collegata all’evidenza visiva dell’opera.'
  };
  const get = key => String(content[key] || fallback[key]).trim();
  const confidenceLevel = String(confidence.level || (selection.type === 'hotspot' ? 'high' : 'medium'));
  return {
    id: `nvidia-analysis-${Date.now()}`,
    status: 'completed',
    title: hotspot.title || 'Area selezionata',
    confidence: {
      level: confidenceLevel,
      label: String(confidence.label || (confidenceLevel === 'high' ? 'Osservazione ben supportata' : 'Interpretazione probabile')),
      tone: confidenceLevel === 'high' ? 'cool' : 'warm'
    },
    content: { observation: get('observation'), importance: get('importance'), composition: get('composition'), curiosity: get('curiosity'), connection: get('connection') },
    sources: input.sources || artworkSources,
    disclaimer: 'La risposta è generata da un modello multimodale NVIDIA e combina osservazione visiva e informazioni selezionate. Verifica le interpretazioni con le fonti indicate.'
  };
}

export async function imageDataUri() {
  const bytes = await readFile(IMAGE_PATH);
  return `data:image/jpeg;base64,${bytes.toString('base64')}`;
}

export function buildPrompt(input) {
  const artwork = input.artwork || {};
  const selection = input.selection || {};
  const hotspot = input.hotspot || {};
  const sources = (input.sources || []).map(source => `- ${source.title}: ${source.url}`).join('\n') || '- Nessuna fonte aggiuntiva';
  const coordinates = ['x', 'y', 'width', 'height'].map(key => selection[key]).filter(value => value !== undefined).join(', ') || 'punto libero';
  return `Sei un educatore di storia dell'arte per studenti italiani di livello ${input.learningLevel || 'Scuola secondaria'}.\nAnalizza l’opera completa e la regione selezionata dall’utente.\n\nOpera: ${artwork.title || 'Annunciazione'}\nArtista: ${artwork.artist || 'Beato Angelico'}\nData: ${artwork.date || ''}\nPeriodo: ${artwork.period || ''}\nTecnica: ${artwork.technique || ''}\nDettaglio curato, se presente: ${hotspot.title || 'nessuno'}\nCoordinate normalizzate (x, y, width, height): ${coordinates}\n\nFonti editoriali disponibili:\n${sources}\n\nRegole:\n- Descrivi prima ciò che è osservabile nell'immagine.\n- Distingui osservazione, contesto e interpretazione.\n- Non inventare dettagli, simboli o dati storici.\n- Se non puoi identificare la regione, dichiaralo.\n- Usa linguaggio chiaro e massimo 200 parole.\n\nRispondi esclusivamente con JSON valido, senza markdown, nella forma: {"observation":"...","importance":"...","composition":"...","curiosity":"...","connection":"...","confidence":{"level":"high|medium|low","label":"..."}}`;
}

export async function callNvidia(input, fetchImpl = globalThis.fetch) {
  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey) throw new Error('NVIDIA_API_KEY non configurata');
  const image = await imageDataUri();
  const imageContent = [{ type: 'text', text: buildPrompt(input) }, { type: 'image_url', image_url: { url: image } }];
  if (input.selectionImage) {
    imageContent.push({ type: 'text', text: 'La seconda immagine è il crop esatto della regione selezionata. Usalo per identificare il soggetto senza confonderlo con l’altro personaggio.' });
    imageContent.push({ type: 'image_url', image_url: { url: input.selectionImage } });
  }
  const response = await fetchImpl(NVIDIA_ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      model: NVIDIA_MODEL,
      messages: [{ role: 'user', content: imageContent }],
      temperature: 0.2,
      top_p: 0.7,
      max_tokens: 500,
      stream: false
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new Error('La chiave NVIDIA non è valida o non è autorizzata');
    if (response.status === 429) throw new Error('Limite temporaneo dell’endpoint NVIDIA raggiunto');
    throw new Error(`NVIDIA ha rifiutato la richiesta (${response.status})`);
  }
  const message = payload?.choices?.[0]?.message?.content;
  const text = Array.isArray(message) ? message.map(part => part.text || '').join('\n') : message;
  return normalizeAnalysis(cleanModelJson(text), input);
}

function json(res, status, payload) {
  const data = Buffer.from(JSON.stringify(payload));
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': data.length, 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
  res.end(data);
}

function error(code, message, retryable = false) { return { error: { code, message, retryable } }; }

async function serveStatic(req, res) {
  const requestPath = req.url === '/' ? '/index.html' : new URL(req.url, 'http://localhost').pathname;
  const filePath = resolve(ROOT, `.${normalize(requestPath)}`);
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }
  try {
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error('not a file');
    const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.jsx': 'text/javascript; charset=utf-8', '.jpg': 'image/jpeg' };
    res.writeHead(200, { 'Content-Type': types[extname(filePath)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(await readFile(filePath));
  } catch { res.writeHead(404); res.end('Not Found'); }
}

export function createAppServer() {
  return createServer(async (req, res) => {
    if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }); res.end(); return; }
    if (req.method === 'GET' && req.url === '/api/status') {
      return json(res, 200, { configured: Boolean(process.env.NVIDIA_API_KEY), model: NVIDIA_MODEL });
    }
    if (req.method === 'POST' && req.url === '/api/analyze') {
      let body = '';
      req.on('data', chunk => { body += chunk; if (body.length > 2 * 1024 * 1024) req.destroy(); });
      req.on('end', async () => {
        try {
          const input = JSON.parse(body);
          if (!input.artwork || !input.selection) return json(res, 400, error('INVALID_REQUEST', 'Opera e selezione sono obbligatorie'));
          return json(res, 200, await callNvidia(input));
        } catch (err) {
          const message = err.message || 'Errore interno durante l’analisi';
          if (message.includes('NVIDIA_API_KEY')) return json(res, 503, error('NVIDIA_NOT_CONFIGURED', message));
          if (message.includes('non è valida') || message.includes('rifiutato') || message.includes('Limite')) return json(res, 502, error('NVIDIA_ERROR', message, true));
          return json(res, 500, error('INTERNAL_ERROR', message, true));
        }
      });
      return;
    }
    if (req.method === 'GET') return serveStatic(req, res);
    json(res, 404, error('NOT_FOUND', 'Endpoint non trovato'));
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createAppServer().listen(PORT, HOST, () => {
    console.log(`Leggi l’Opera d’Arte: http://${HOST}:${PORT}`);
    console.log(`Modello NVIDIA: ${NVIDIA_MODEL}`);
    console.log(process.env.NVIDIA_API_KEY ? 'NVIDIA_API_KEY: configurata' : 'NVIDIA_API_KEY: non configurata');
  });
}
