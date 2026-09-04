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
export const VISION_MODEL = process.env.OPENROUTER_VISION_MODEL || 'meta/muse-spark-1.3';
export const TEXT_MODEL = process.env.OPENROUTER_TEXT_MODEL || 'meta/muse-spark-1.3';
export function webSearchEnabled(env = process.env) { return env.OPENROUTER_WEB_SEARCH?.trim().toLowerCase() === 'true'; }
const PORT = Number(process.env.APP_PORT || 8000);
const HOST = process.env.APP_HOST || '127.0.0.1';
const IMAGE_PATH = join(ROOT, 'annunciazione-beato-angelico.jpg');

export function getOpenRouterApiKey(env = process.env) { return env.OPENROUTER_API_KEY?.trim() || ''; }

const FENCE = String.fromCharCode(96) + String.fromCharCode(96) + String.fromCharCode(96);

function tryParseJson(text) {
  try { return JSON.parse(text); } catch {}
  const match = text.match(/\{[\s\S]*\}/);
  if (match) { try { return JSON.parse(match[0]); } catch {} }
  return null;
}

function unwrapJson(value, depth) {
  if (!value || depth > 4) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) return tryParseJson(trimmed) || value;
    if (trimmed.startsWith('"')) {
      try { return unwrapJson(JSON.parse(trimmed), depth + 1); } catch { return value; }
    }
    return value;
  }
  if (typeof value === 'object') {
    // Model wrapped the real JSON as a string inside a single envelope key.
    const keys = Object.keys(value);
    if (keys.length === 1) {
      const nested = value[keys[0]];
      const candidate = unwrapJson(nested, depth + 1);
      if (candidate && candidate !== nested && typeof candidate === 'object') return candidate;
    }
    return value;
  }
  return value;
}

export function cleanModelJson(value) {
  if (value && typeof value === 'object') return unwrapJson(value, 0);
  let text = String(value || '').trim();
  if (text.indexOf(FENCE) === 0) {
    const endIdx = text.lastIndexOf(FENCE);
    if (endIdx > 3) text = text.slice(3, endIdx).trim();
  }
  let parsed = tryParseJson(text);
  if (parsed) return unwrapJson(parsed, 0);
  const unescaped = text.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  parsed = tryParseJson(unescaped);
  if (parsed) return unwrapJson(parsed, 0);
  return unwrapJson({ observation: text }, 0);
}
function stripLookAgainPrefix(text) {
  return String(text || '').replace(/^[\"'\u2019\u2018 ]*guarda ancora[\"'\u2019\u2018 :.!-]*/i, '').trim();
}

export function normalizeAnalysis(raw, input, citations = []) {
  const selection = input.selection || {};
  const hotspot = input.hotspot || {};
  const content = extractContent(raw);
  const confidence = raw?.confidence && typeof raw.confidence === 'object' ? raw.confidence : {};
  const fallback = {
    observation: 'Il modello non ha restituito un’osservazione sufficiente per questa selezione.',
    meaning: 'Prova a selezionare un’area più precisa o ad allargare leggermente la selezione.',
    relation: 'Il collegamento con gli altri dettagli dell’opera non è stato descritto dal modello.'
  };
  const get = key => String(content[key] || fallback[key]).trim();
  const level = String(confidence.level || (selection.type === 'hotspot' ? 'high' : 'medium'));
  const advanced = String(input.learningLevel || '').toLowerCase().includes('approfondimento');
  return {
    id: `openrouter-analysis-${Date.now()}`,
    status: 'completed',
    title: hotspot.title || 'Area selezionata',
    confidence: {
      level,
      label: String(confidence.label || (level === 'high' ? 'Osservazione ben supportata' : 'Interpretazione probabile')),
      tone: level === 'high' ? 'cool' : 'warm'
    },
    content: {
      observation: get('observation'),
      meaning: get('meaning'),
      relation: get('relation'),
      curiosity: String(content.curiosity || '').trim(),
      comparisons: advanced ? String(content.comparisons || '').trim() : '',
      openQuestions: advanced ? String(content.openQuestions || '').trim() : '',
      lookAgain: stripLookAgainPrefix(String(content.lookAgain || '').trim())
    },
    sources: [...collectWebSources(citations), ...(input.sources || [])],
    disclaimer: 'La spiegazione è generata tramite OpenRouter: osserva il dettaglio selezionato e lo collega agli altri dettagli dell’opera. Il contesto storico-artistico generale è presentato in cima alla pagina.'
  };
}
export function normalizeOverview(raw, input, citations = []) {
  const artwork = input.artwork || {};
  const content = extractContent(raw);
  const fallback = {
    painting: 'Il modello non ha prodotto una presentazione del dipinto. Riprova tra poco.',
    artist: 'Il modello non ha prodotto una presentazione dell’artista. Riprova tra poco.'
  };
  const get = key => String(content[key] || fallback[key]).trim();
  return {
    id: `openrouter-overview-${Date.now()}`,
    status: 'completed',
    title: artwork.title || 'Opera',
    content: { painting: get('painting'), artist: get('artist') },
    sources: [...collectWebSources(citations), ...(input.sources || [])],
    disclaimer: 'La presentazione è generata tramite OpenRouter a partire dalla conoscenza del modello e dalle fonti indicate. Verifica i dati con le fonti prima di un uso didattico.'
  };
}
function collectWebSources(citations) {
  return (Array.isArray(citations) ? citations : []).filter(c => c && c.url).map((c, index) => ({ title: c.title || `Fonte web ${index + 1}`, url: c.url, type: 'Web' }));
}

function extractContent(raw) {
  return raw?.content && typeof raw.content === 'object' ? raw.content : (raw || {});
}

export async function imageDataUri() { return `data:image/jpeg;base64,${(await readFile(IMAGE_PATH)).toString('base64')}`; }


export function buildVisionPrompt(input) {
  const a = input.artwork || {};
  const s = input.selection || {};
  const h = input.hotspot || {};
  const coordinates = ['x', 'y', 'width', 'height'].map(k => s[k]).filter(v => v !== undefined).join(', ') || 'punto libero';
  return `Analizza visivamente l’opera per un educatore italiano. Opera: ${a.title || ''}; artista: ${a.artist || ''}; dettaglio: ${h.title || 'area selezionata'}; coordinate: ${coordinates}. Descrivi esclusivamente elementi osservabili e restituisci JSON valido con observation, visible_elements, colors, composition e uncertainty. Non inventare dati storici.`;
}

export function buildOverviewPrompt(input) {
  const a = input.artwork || {};
  const level = input.learningLevel || 'Scuola secondaria';
  const sources = (input.sources || []).map(s => `- ${s.title}: ${s.url}`).join('\n') || '- Nessuna fonte aggiuntiva';
  return `Sei uno storico dell’arte e un educatore italiano. Scrivi una presentazione storico-artistica dell’opera e del suo autore, pensata per studenti di livello ${level}, da mostrare in cima alla pagina prima dell’esplorazione dei dettagli.

Opera: ${a.title || ''}
Artista: ${a.artist || ''}
Data: ${a.date || ''}
Periodo: ${a.period || ''}
Tecnica: ${a.technique || ''}
Istituzione: ${a.institution || ''}
Collocazione: ${a.location || ''}

Fonti editoriali di riferimento (usa i fatti che riportano):
${sources}

Regole:
- Massimo 500 parole in totale: circa 250-300 per "painting" e 150-200 per "artist".
- "painting": presentazione storico-artistica del dipinto — soggetto, contesto e committenza, iconografia essenziale, caratteristiche stilistiche, perché è importante nella storia dell’arte.
- "artist": chi era l’artista, formazione e ambiente, tratti distintivi dello stile, ruolo nella storia dell’arte.
- Non inventare dati: usa solo fatti di cui sei ragionevolmente certo o presenti nelle fonti; se un dettaglio è incerto, omettilo.
- Scrivi in italiano chiaro e adatto a studenti di ${level}.
- Rispondi esclusivamente con JSON valido, senza markdown, nella forma: {"painting":"...","artist":"..."}`;
}
export function buildTextPrompt(input, visionResult) {
  const a = input.artwork || {};
  const h = input.hotspot || {};
  const detail = h.title || 'area selezionata';
  const advanced = String(input.learningLevel || '').toLowerCase().includes('approfondimento');
  const others = (Array.isArray(input.notableDetails) ? input.notableDetails : []).filter(d => d && d.title && d.title !== h.title);
  const notable = others.map(d => `- ${d.title}${d.category ? ` (${d.category})` : ''}${d.short ? `: ${d.short}` : ''}`).join('\n') || '- Nessun altro dettaglio notevole è disponibile.';
  const comparisonRule = advanced
    ? '"comparisons" (OBBLIGATORIO al livello Approfondimento): confronta QUESTO dettaglio con 1-2 altre opere REALI che conosci (stesso soggetto, stesso artista o stesso contesto). Cita solo opere esistenti e verificate dalla tua conoscenza: titolo, autore, periodo, luogo. Spiega in cosa il confronto aiuta a capire il dettaglio. Se non trovi un confronto valido, scegli il più vicino e spiega perché.'
    : '"comparisons": NON INCLUDERE questo campo per il livello Scuola secondaria.';
  const openRule = advanced
    ? '"openQuestions" (OBBLIGATORIO al livello Approfondimento): segnala 1-2 questioni aperte o dibattute dagli studiosi su QUESTO dettaglio o sull’opera (iconografia, attribuzione, interpretazione, stato di conservazione). Scrivi almeno una questione.'
    : '"openQuestions": NON INCLUDERE questo campo per il livello Scuola secondaria.';
  const lookAgainRule = '"lookAgain" (OBBLIGATORIO, una sola frase, max 20 parole): chiudi il ciclo didattico con un invito a guardare ancora l\'immagine, puntando su UN elemento visivo specifico legato a QUESTO dettaglio (es. "dove cade la luce sulle ali?"). Deve spingere lo studente a tornare all\'immagine, non a leggere.';
  const example = advanced
    ? '{"observation":"...","meaning":"...","relation":"...","curiosity":"...","comparisons":"...","openQuestions":"...","lookAgain":"...","confidence":{"level":"high|medium|low","label":"..."}}'
    : '{"observation":"...","meaning":"...","relation":"...","curiosity":"...","lookAgain":"...","confidence":{"level":"high|medium|low","label":"..."}}';
  return `Sei un educatore d’arte italiano che spiega a uno studente di livello ${input.learningLevel || 'Scuola secondaria'} il dettaglio selezionato di un’opera.

IMPORTANTE: la presentazione storico-artistica generale dell’opera e dell’artista (contesto storico, biografia, epoca, tecnica) è GIÀ mostrata in cima alla pagina. NON ripeterla: occupati esclusivamente del dettaglio selezionato.

Opera: ${a.title || ''}; artista: ${a.artist || ''}.
Dettaglio selezionato: ${detail}.
Osservazione visiva del dettaglio (dall’analisi dell’immagine): ${JSON.stringify(visionResult)}.

Altri dettagli notevoli dell’opera a cui puoi fare riferimento nei collegamenti:
${notable}

Rispondi con UN SOLO oggetto JSON valido, senza markdown né testo fuori dall’oggetto. La risposta deve contenere TUTTI i campi elencati qui sotto, in questo ordine:
1. "observation" (OBBLIGATORIO, 60-90 parole): descrizione visuale del dettaglio — ciò che si vede davvero (forme, colori, gesti, materiali, luce).
2. "meaning" (OBBLIGATORIO, 60-90 parole): descrizione concettuale del dettaglio da solo — cosa rappresenta, che significato ha, perché l’artista lo ha inserito.
3. "relation" (OBBLIGATORIO, 60-90 parole): come il dettaglio si relaziona agli altri dettagli notevoli dell’opera elencati sopra — cita almeno uno di questi dettagli per nome e spiega il legame visivo, simbolico o narrativo.
4. "curiosity" (OPZIONALE a ogni livello): solo se hai una curiosità breve, verificabile e SPECIFICA di QUESTO dettaglio (mai sull’opera o sull’artista in generale). Se non ne hai una di cui sei ragionevolmente certo, usa esattamente la stringa vuota: "".
   Anche "lookAgain" (vedi campo 7) è sempre richiesto: è l’invito finale a tornare a guardare l’immagine.
5. ${comparisonRule}
6. ${openRule}
7. ${lookAgainRule}

Aggiungi sempre anche "confidence": {"level":"high|medium|low","label":"..."}.

Esempio della forma JSON richiesta:
${example}

Non inventare nulla: fonda il testo su ciò che è osservabile e su fatti di cui sei ragionevolmente certo; in caso di dubbio indica una confidenza più bassa.`;
}

// Rate limit globale: i modelli contributor di OpenRouter hanno 30 richieste/min.
// Tutte le chiamate passano da qui -> semaforo a finestra scorrevole (default 26/min, sotto la soglia).
// Consente di parallelizzare in sicurezza la generazione (art-creator) senza incappare nel 429.
const OPENROUTER_RPM = Math.max(1, Number(process.env.OPENROUTER_RPM || 26));
const callTimestamps = [];
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
async function acquireRateSlot() {
  for (;;) {
    const now = Date.now();
    while (callTimestamps.length && callTimestamps[0] <= now - 60000) callTimestamps.shift();
    if (callTimestamps.length < OPENROUTER_RPM) { callTimestamps.push(now); return; }
    await sleep(Math.max(250, callTimestamps[0] + 60000 - now));
  }
}

export async function callModel(model, content, apiKey, fetchImpl = globalThis.fetch) {
  const body = { model, messages: [{ role: 'user', content }], temperature: 0.2, top_p: 0.7, max_tokens: 8000, stream: false };
  if (webSearchEnabled()) body.plugins = [{ id: 'web', max_results: 5 }];
  const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json', 'HTTP-Referer': 'http://127.0.0.1:8000', 'X-Title': 'Leggi l Opera d Arte' };
  let response = null;
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    await acquireRateSlot();
    try {
      response = await fetchImpl(OPENROUTER_ENDPOINT, { method: 'POST', headers, body: JSON.stringify(body) });
      if (response.status !== 429) break;
      lastError = new Error('Limite temporaneo di OpenRouter raggiunto');
    } catch (e) { lastError = e; }
    if (attempt < 2) await sleep(2500 * (attempt + 1)); // backoff su 429 / errore di rete
  }
  if (!response) throw lastError || new Error('Errore di rete verso OpenRouter');
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) { if (response.status === 401 || response.status === 403) throw new Error('La chiave OpenRouter non è valida o non è autorizzata'); if (response.status === 429) throw new Error('Limite temporaneo di OpenRouter raggiunto'); throw new Error(`OpenRouter ha rifiutato la richiesta (${response.status})`); }
  const message = payload?.choices?.[0]?.message;
  const text = Array.isArray(message?.content) ? message.content.map(part => part.text || '').join('\n') : message?.content;
  const annotations = Array.isArray(message?.annotations) ? message.annotations : [];
  const citations = annotations.filter(a => a && a.type === 'url_citation' && a.url_citation && a.url_citation.url).map(a => ({ title: a.url_citation.title || '', url: a.url_citation.url }));
  return { data: cleanModelJson(text), citations };
}

export async function callOpenRouter(input, fetchImpl = globalThis.fetch) {
  const apiKey = getOpenRouterApiKey();
  if (!apiKey) throw new Error('OPENROUTER_API_KEY non configurata');
  const image = await imageDataUri();
  const content = [{ type: 'text', text: buildVisionPrompt(input) }, { type: 'image_url', image_url: { url: image } }];
  if (input.selectionImage) content.push({ type: 'text', text: 'La seconda immagine è il crop esatto della regione selezionata.' }, { type: 'image_url', image_url: { url: input.selectionImage } });
  const vision = await callModel(VISION_MODEL, content, apiKey, fetchImpl);
  const explanation = await callModel(TEXT_MODEL, [{ type: 'text', text: buildTextPrompt(input, vision.data) }], apiKey, fetchImpl);
  return normalizeAnalysis(explanation.data, input, explanation.citations);
}

export async function callOpenRouterOverview(input, fetchImpl = globalThis.fetch) {
  const apiKey = getOpenRouterApiKey();
  if (!apiKey) throw new Error('OPENROUTER_API_KEY non configurata');
  const overview = await callModel(TEXT_MODEL, [{ type: 'text', text: buildOverviewPrompt(input) }], apiKey, fetchImpl);
  return normalizeOverview(overview.data, input, overview.citations);
}
export const callNvidia = callOpenRouter;
function json(res, status, payload) { const data = Buffer.from(JSON.stringify(payload)); res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': data.length, 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' }); res.end(data); }
function error(code, message, retryable = false) { return { error: { code, message, retryable } }; }
async function serveStatic(req, res) { const requestPath = req.url === '/' ? '/index.html' : new URL(req.url, 'http://localhost').pathname; const filePath = resolve(ROOT, `.${normalize(requestPath)}`); if (!filePath.startsWith(ROOT)) return (res.writeHead(403), res.end('Forbidden')); try { const info = await stat(filePath); if (!info.isFile()) throw new Error(); const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.jsx': 'text/javascript; charset=utf-8', '.jpg': 'image/jpeg' }; res.writeHead(200, { 'Content-Type': types[extname(filePath)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }); res.end(await readFile(filePath)); } catch { res.writeHead(404); res.end('Not Found'); } }
export function createAppServer() { return createServer((req, res) => { if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }); res.end(); return; } if (req.method === 'GET' && req.url === '/api/status') return json(res, 200, { configured: Boolean(getOpenRouterApiKey()), visionModel: VISION_MODEL, textModel: TEXT_MODEL }); if (req.method === 'POST' && (req.url === '/api/overview' || req.url === '/api/analyze')) { let body = ''; let tooLarge = false; req.on('data', chunk => { body += chunk; if (Buffer.byteLength(body) > 2 * 1024 * 1024) tooLarge = true; }); req.on('end', async () => { if (tooLarge) return json(res, 413, error('PAYLOAD_TOO_LARGE', 'Richiesta non valida o troppo grande')); try { const input = JSON.parse(body); if (!input.artwork) return json(res, 400, error('INVALID_REQUEST', 'Opera e selezione sono obbligatorie')); if (req.url === '/api/overview') return json(res, 200, await callOpenRouterOverview(input)); if (!input.selection) return json(res, 400, error('INVALID_REQUEST', 'Opera e selezione sono obbligatorie')); return json(res, 200, await callOpenRouter(input)); } catch (err) { const message = err.message || 'Errore interno durante l’analisi'; if (message.includes('OPENROUTER_API_KEY')) return json(res, 503, error('OPENROUTER_NOT_CONFIGURED', message)); if (message.includes('non è valida') || message.includes('rifiutato') || message.includes('Limite')) return json(res, 502, error('OPENROUTER_ERROR', message, true)); return json(res, 500, error('INTERNAL_ERROR', message, true)); } }); return; } if (req.method === 'GET') return serveStatic(req, res); json(res, 404, error('NOT_FOUND', 'Endpoint non trovato')); }); }
if (process.argv[1] === fileURLToPath(import.meta.url)) createAppServer().listen(PORT, HOST, () => { console.log(`Leggi l’Opera d’Arte: http://${HOST}:${PORT}`); console.log(`Modello visione: ${VISION_MODEL}`); console.log(`Modello testo: ${TEXT_MODEL}`); console.log(getOpenRouterApiKey() ? 'OpenRouter API key: configurata' : 'OpenRouter API key: non configurata'); });
