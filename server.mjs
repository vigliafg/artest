import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)));

function loadLocalEnv() {
  for (const filename of ['.env.local', '.env']) {
    try {
      const text = readFileSync(join(ROOT, filename), 'utf8');
      for (const line of text.split(/\r?\n/)) {
        const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
        if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
      }
    } catch {}
  }
}
loadLocalEnv();

export const OPENROUTER_ENDPOINT = process.env.OPENROUTER_ENDPOINT || 'https://openrouter.ai/api/v1/chat/completions';
export const VISION_MODEL = process.env.OPENROUTER_VISION_MODEL || 'moonshotai/kimi-k2.6';
export const TEXT_MODEL = process.env.OPENROUTER_TEXT_MODEL || 'nvidia/nemotron-3-ultra-550b-a55b';
const PORT = Number(process.env.APP_PORT || 8000);
const HOST = process.env.APP_HOST || '127.0.0.1';
const IMAGE_PATH = join(ROOT, 'annunciazione-beato-angelico.jpg');

export function getOpenRouterApiKey(env = process.env) { return env.OPENROUTER_API_KEY?.trim() || ''; }

export function cleanModelJson(value) {
  if (value && typeof value === 'object') return value;
  const text = String(value || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(text); } catch {}
  const match = text.match(/\{[\s\S]*\}/);
  if (match) { try { return JSON.parse(match[0]); } catch {} }
  return { observation: text };
}

export function normalizeAnalysis(raw, input) {
  const selection = input.selection || {};
  const hotspot = input.hotspot || {};
  const content = raw?.content && typeof raw.content === 'object' ? raw.content : raw || {};
  const confidence = raw?.confidence && typeof raw.confidence === 'object' ? raw.confidence : {};
  const fallback = { observation: 'Il modello non ha restituito un’osservazione sufficiente per questa selezione.', importance: 'Prova a selezionare un’area leggermente più ampia.', composition: 'Il dettaglio va letto in relazione all’immagine completa.', curiosity: 'Per questo dettaglio non è stata recuperata una curiosità verificata.', connection: 'L’interpretazione deve restare collegata all’evidenza visiva dell’opera.' };
  const get = key => String(content[key] || fallback[key]).trim();
  const level = String(confidence.level || (selection.type === 'hotspot' ? 'high' : 'medium'));
  return { id: `openrouter-analysis-${Date.now()}`, status: 'completed', title: hotspot.title || 'Area selezionata', confidence: { level, label: String(confidence.label || (level === 'high' ? 'Osservazione ben supportata' : 'Interpretazione probabile')), tone: level === 'high' ? 'cool' : 'warm' }, content: { observation: get('observation'), importance: get('importance'), composition: get('composition'), curiosity: get('curiosity'), connection: get('connection') }, sources: input.sources || [], disclaimer: 'La risposta è generata da due modelli tramite OpenRouter: uno per l’osservazione visiva e uno per la spiegazione educativa.' };
}

export async function imageDataUri() { return `data:image/jpeg;base64,${(await readFile(IMAGE_PATH)).toString('base64')}`; }
export function buildVisionPrompt(input) { const a = input.artwork || {}; const s = input.selection || {}; const h = input.hotspot || {}; const coordinates = ['x', 'y', 'width', 'height'].map(k => s[k]).filter(v => v !== undefined).join(', ') || 'punto libero'; return `Analizza visivamente l’opera per un educatore italiano. Opera: ${a.title || ''}; artista: ${a.artist || ''}; dettaglio: ${h.title || 'area selezionata'}; coordinate: ${coordinates}. Descrivi esclusivamente elementi osservabili e restituisci JSON valido con observation, visible_elements, colors, composition e uncertainty. Non inventare dati storici.`; }
export function buildTextPrompt(input, visionResult) { const a = input.artwork || {}; const h = input.hotspot || {}; return `Scrivi una spiegazione didattica in italiano per ${input.learningLevel || 'Scuola secondaria'} usando esclusivamente questa osservazione visiva: ${JSON.stringify(visionResult)}. Opera: ${a.title || ''}; artista: ${a.artist || ''}; dettaglio: ${h.title || 'area selezionata'}. Restituisci esclusivamente JSON valido con observation, importance, composition, curiosity, connection e confidence {level,label}. Non inventare informazioni.`; }

export async function callModel(model, content, apiKey, fetchImpl = globalThis.fetch) {
  const response = await fetchImpl(OPENROUTER_ENDPOINT, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json', 'HTTP-Referer': 'http://127.0.0.1:8000', 'X-Title': 'Leggi l Opera d Arte' }, body: JSON.stringify({ model, messages: [{ role: 'user', content }], temperature: 0.2, top_p: 0.7, max_tokens: 500, stream: false }) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) { if (response.status === 401 || response.status === 403) throw new Error('La chiave OpenRouter non è valida o non è autorizzata'); if (response.status === 429) throw new Error('Limite temporaneo di OpenRouter raggiunto'); throw new Error(`OpenRouter ha rifiutato la richiesta (${response.status})`); }
  const message = payload?.choices?.[0]?.message?.content;
  return cleanModelJson(Array.isArray(message) ? message.map(part => part.text || '').join('\n') : message);
}

export async function callOpenRouter(input, fetchImpl = globalThis.fetch) {
  const apiKey = getOpenRouterApiKey();
  if (!apiKey) throw new Error('OPENROUTER_API_KEY non configurata');
  const image = await imageDataUri();
  const content = [{ type: 'text', text: buildVisionPrompt(input) }, { type: 'image_url', image_url: { url: image } }];
  if (input.selectionImage) content.push({ type: 'text', text: 'La seconda immagine è il crop esatto della regione selezionata.' }, { type: 'image_url', image_url: { url: input.selectionImage } });
  const vision = await callModel(VISION_MODEL, content, apiKey, fetchImpl);
  const explanation = await callModel(TEXT_MODEL, [{ type: 'text', text: buildTextPrompt(input, vision) }], apiKey, fetchImpl);
  return normalizeAnalysis(explanation, input);
}

export const callNvidia = callOpenRouter;
function json(res, status, payload) { const data = Buffer.from(JSON.stringify(payload)); res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': data.length, 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' }); res.end(data); }
function error(code, message, retryable = false) { return { error: { code, message, retryable } }; }
async function serveStatic(req, res) { const requestPath = req.url === '/' ? '/index.html' : new URL(req.url, 'http://localhost').pathname; const filePath = resolve(ROOT, `.${normalize(requestPath)}`); if (!filePath.startsWith(ROOT)) return (res.writeHead(403), res.end('Forbidden')); try { const info = await stat(filePath); if (!info.isFile()) throw new Error(); const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.jsx': 'text/javascript; charset=utf-8', '.jpg': 'image/jpeg' }; res.writeHead(200, { 'Content-Type': types[extname(filePath)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }); res.end(await readFile(filePath)); } catch { res.writeHead(404); res.end('Not Found'); } }
export function createAppServer() { return createServer((req, res) => { if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }); res.end(); return; } if (req.method === 'GET' && req.url === '/api/status') return json(res, 200, { configured: Boolean(getOpenRouterApiKey()), visionModel: VISION_MODEL, textModel: TEXT_MODEL }); if (req.method === 'POST' && req.url === '/api/analyze') { let body = ''; let tooLarge = false; req.on('data', chunk => { body += chunk; if (Buffer.byteLength(body) > 2 * 1024 * 1024) tooLarge = true; }); req.on('end', async () => { if (tooLarge) return json(res, 413, error('PAYLOAD_TOO_LARGE', 'Richiesta non valida o troppo grande')); try { const input = JSON.parse(body); if (!input.artwork || !input.selection) return json(res, 400, error('INVALID_REQUEST', 'Opera e selezione sono obbligatorie')); return json(res, 200, await callOpenRouter(input)); } catch (err) { const message = err.message || 'Errore interno durante l’analisi'; if (message.includes('OPENROUTER_API_KEY')) return json(res, 503, error('OPENROUTER_NOT_CONFIGURED', message)); if (message.includes('non è valida') || message.includes('rifiutato') || message.includes('Limite')) return json(res, 502, error('OPENROUTER_ERROR', message, true)); return json(res, 500, error('INTERNAL_ERROR', message, true)); } }); return; } if (req.method === 'GET') return serveStatic(req, res); json(res, 404, error('NOT_FOUND', 'Endpoint non trovato')); }); }
if (process.argv[1] === fileURLToPath(import.meta.url)) createAppServer().listen(PORT, HOST, () => { console.log(`Leggi l’Opera d’Arte: http://${HOST}:${PORT}`); console.log(`Modello visione: ${VISION_MODEL}`); console.log(`Modello testo: ${TEXT_MODEL}`); console.log(getOpenRouterApiKey() ? 'OpenRouter API key: configurata' : 'OpenRouter API key: non configurata'); });
