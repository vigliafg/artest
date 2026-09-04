// art-creator — server HTTP (zero dipendenze) + API CRUD + generazione LLM
import { createServer } from 'node:http';
import { readFile, writeFile, stat, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { extname, join, normalize, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initSchema, db, UPLOAD_DIR, ROOT as APP_ROOT } from './db.mjs';
import {
  createArtwork, getArtwork, listArtworks, updateArtwork, deleteArtwork,
  addDetail, listDetails, getDetail, replaceDetails, updateDetail,
  saveDetailContent, getDetailContent,
  saveOverview, getOverview,
  addSource, listSources, getFullArtwork, approveArtwork, publishArtwork,
  getArtworkImageData, setAnnotatedImage
} from './db.mjs';
import { callModel, VISION_MODEL, TEXT_MODEL, getOpenRouterApiKey,
  buildVisionPrompt, buildOverviewPrompt, buildTextPrompt,
  normalizeAnalysis, normalizeOverview } from '../server.mjs';

const execFileAsync = promisify(execFile);
const PORT = Number(process.env.ART_CREATOR_PORT || 8100);
const HOST = process.env.APP_HOST || '127.0.0.1';
const PUBLIC_DIR = join(APP_ROOT, 'public');

initSchema();

// ---------- helpers ----------
function json(res, status, payload) {
  const data = Buffer.from(JSON.stringify(payload));
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': data.length, 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
  res.end(data);
}
function err(res, status, message) { json(res, status, { error: { code: 'ERR', message } }); }

function readBody(req, limitMb = 30) {
  return new Promise((resolvePromise, reject) => {
    let body = '';
    let tooLarge = false;
    req.on('data', chunk => { body += chunk; if (Buffer.byteLength(body) > limitMb * 1024 * 1024) tooLarge = true; });
    req.on('end', () => { if (tooLarge) return reject(new Error('Payload troppo grande')); try { resolvePromise(JSON.parse(body)); } catch (e) { reject(new Error('JSON non valido')); } });
    req.on('error', reject);
  });
}

function slugify(text) {
  const base = String(text || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return base || 'opera-' + Date.now();
}

async function persistImage(artworkId, imageDataUrl) {
  const match = String(imageDataUrl || '').match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) throw new Error('imageDataUrl non valido: atteso data:image/...;base64,...');
  const ext = match[1] === 'image/jpeg' ? '.jpg' : match[1] === 'image/png' ? '.png' : match[1] === 'image/webp' ? '.webp' : '.jpg';
  const filename = artworkId + ext;
  const buf = Buffer.from(match[2], 'base64');
  await writeFile(join(UPLOAD_DIR, filename), buf); // scratch per PIL (crop/annotazione); il DB resta la sorgente
  return { path: 'uploads/' + filename, data: buf, mime: match[1] };
}

function artworkPublic(a) {
  return {
    id: a.id, title: a.title, artist: a.artist, date: a.date, period: a.period,
    technique: a.technique, institution: a.institution, location: a.location,
    imageUrl: '/api/artworks/' + a.id + '/image',
    annotatedImageUrl: a.hasAnnotated ? '/api/artworks/' + a.id + '/image-annotated' : null,
    imageWidth: a.imageWidth, imageHeight: a.imageHeight,
    status: a.status, createdAt: a.createdAt, updatedAt: a.updatedAt
  };
}

async function imageDataUriOf(artwork) {
  const images = getArtworkImageData(artwork.id);
  if (images && images.clean) {
    const buf = Buffer.from(images.clean.data);
    return `data:${images.clean.mime || 'image/jpeg'};base64,` + buf.toString('base64');
  }
  return 'data:image/jpeg;base64,' + (await readFile(join(APP_ROOT, artwork.imagePath))).toString('base64');
}

// ---------- rotte ----------
function handleApi(req, res, urlPath) {
  const method = req.method;
  const parts = urlPath.split('/').filter(Boolean); // es. ['api','artworks',':id','details']

  // GET /api/artworks
  if (method === 'GET' && parts.length === 2 && parts[0] === 'api' && parts[1] === 'artworks') {
    return json(res, 200, { artworks: listArtworks().map(artworkPublic) });
  }

  // GET /api/artworks/:id
  if (method === 'GET' && parts.length === 3 && parts[0] === 'api' && parts[1] === 'artworks') {
    const full = getFullArtwork(parts[2]);
    if (!full) return err(res, 404, 'Opera non trovata');
    full.imageUrl = '/api/artworks/' + full.id + '/image';
    full.annotatedImageUrl = full.hasAnnotated ? '/api/artworks/' + full.id + '/image-annotated' : null;
    return json(res, 200, full);
  }

  // GET /api/artworks/:id/image | /image-annotated — BLOB dal DB (immagine pulita / annotata)
  if (method === 'GET' && parts.length === 4 && parts[0] === 'api' && parts[1] === 'artworks' &&
      (parts[3] === 'image' || parts[3] === 'image-annotated')) {
    const images = getArtworkImageData(parts[2]);
    const img = parts[3] === 'image' ? (images && images.clean) : (images && images.annotated);
    if (!img) return err(res, 404, 'Immagine non disponibile: ri-carica l’opera o premi “Salva nel database”.');
    const buf = Buffer.from(img.data);
    res.writeHead(200, { 'Content-Type': img.mime, 'Content-Length': buf.length, 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' });
    return res.end(buf);
  }

  // POST /api/artworks  { id?, imageDataUrl, ...metadati }
  if (method === 'POST' && parts.length === 2 && parts[0] === 'api' && parts[1] === 'artworks') {
    return readBody(req).then(async (input) => {
      const artworkId = input.id || slugify(input.title || 'opera');
      if (getArtwork(artworkId)) return err(res, 409, 'Esiste già un’opera con id ' + artworkId);
      if (!input.imageDataUrl) return err(res, 400, 'imageDataUrl obbligatorio');
      const persisted = await persistImage(artworkId, input.imageDataUrl);
      const created = createArtwork({
        id: artworkId,
        title: input.title || '', artist: input.artist || '', date: input.date || '',
        period: input.period || '', technique: input.technique || '',
        institution: input.institution || '', location: input.location || '',
        imagePath: persisted.path, imageData: persisted.data, imageMime: persisted.mime,
        imageWidth: Number(input.imageWidth) || 0, imageHeight: Number(input.imageHeight) || 0
      });
      json(res, 201, { artwork: artworkPublic(created) });
    }).catch(e => err(res, 400, e.message));
  }

  // PATCH /api/artworks/:id  (metadati o status)
  if (method === 'PATCH' && parts.length === 3 && parts[0] === 'api' && parts[1] === 'artworks') {
    return readBody(req).then(async (input) => {
      const updated = updateArtwork(parts[2], input);
      if (!updated) return err(res, 404, 'Opera non trovata');
      json(res, 200, { artwork: artworkPublic(updated) });
    }).catch(e => err(res, 400, e.message));
  }

  // DELETE /api/artworks/:id
  if (method === 'DELETE' && parts.length === 3 && parts[0] === 'api' && parts[1] === 'artworks') {
    const full = getFullArtwork(parts[2]);
    if (!full) return err(res, 404, 'Opera non trovata');
    deleteArtwork(parts[2]);
    const imagePath = full.imagePath;
    return Promise.resolve().then(function () { return unlink(join(APP_ROOT, imagePath)); }).catch(function () {}).then(function () {
      json(res, 200, { ok: true });
    });
  }

  // PUT /api/artworks/:id/details  (sostituisce l'elenco dettagli) — usato dopo la proposta AI
  if (method === 'PUT' && parts.length === 4 && parts[0] === 'api' && parts[1] === 'artworks' && parts[3] === 'details') {
    return readBody(req).then(async (input) => {
      const artwork = getArtwork(parts[2]);
      if (!artwork) return err(res, 404, 'Opera non trovata');
      const items = Array.isArray(input.details) ? input.details : [];
      const saved = replaceDetails(parts[2], items);
      // SUBITO dopo la proposta dei dettagli: rigenera l'immagine annotata
      // (riquadri oro + didascalie numerate) e la salva nel DB come BLOB.
      let annotatedImageUrl = null;
      let annotatedBoxes = 0;
      let annotatedCaptions = 0;
      try {
        const annotated = await renderAnnotated(artwork);
        if (annotated) {
          setAnnotatedImage(parts[2], annotated.data, 'image/jpeg');
          annotatedImageUrl = '/api/artworks/' + parts[2] + '/image-annotated';
          annotatedBoxes = annotated.boxes;
          annotatedCaptions = annotated.captions;
        }
      } catch (e) { console.error('ERR annotate (dopo proposta dettagli):', e); }
      json(res, 200, { details: saved, annotatedImageUrl, annotatedBoxes, annotatedCaptions });
    }).catch(e => err(res, 400, e.message));
  }

  // GET /api/artworks/:id/details
  if (method === 'GET' && parts.length === 4 && parts[0] === 'api' && parts[1] === 'artworks' && parts[3] === 'details') {
    return json(res, 200, { details: listDetails(parts[2]) });
  }

  // POST /api/artworks/:id/generate/overview  — genera testo opera+artista
  if (method === 'POST' && parts.length === 5 && parts[0] === 'api' && parts[1] === 'artworks' && parts[3] === 'generate' && parts[4] === 'overview') {
    return readBody(req).then(async () => {
      const artwork = getArtwork(parts[2]);
      if (!artwork) return err(res, 404, 'Opera non trovata');
      const apiKey = getOpenRouterApiKey();
      if (!apiKey) return err(res, 503, 'OPENROUTER_API_KEY non configurata');
      const input = {
        artwork: artwork,
        learningLevel: 'Approfondimento',
        sources: listSources(artwork.id)
      };
      const raw = await callModel(TEXT_MODEL, [{ type: 'text', text: buildOverviewPrompt(input) }], apiKey);
      const normalized = normalizeOverview(raw.data, input, raw.citations);
      saveOverview(artwork.id, normalized.content, { status: 'generated', model: TEXT_MODEL, promptVersion: 'art-creator-1' });
      const overview = getOverview(artwork.id);
      json(res, 200, { overview });
    }).catch(e => { console.error('ERR overview:', e); err(res, 500, e.message); });
  }

  // POST /api/artworks/:id/generate/meta — riconosce l'opera e propone i metadati
  if (method === 'POST' && parts.length === 5 && parts[0] === 'api' && parts[1] === 'artworks' && parts[3] === 'generate' && parts[4] === 'meta') {
    return readBody(req).then(async () => {
      const artwork = getArtwork(parts[2]);
      if (!artwork) return err(res, 404, 'Opera non trovata');
      const apiKey = getOpenRouterApiKey();
      if (!apiKey) return err(res, 503, 'OPENROUTER_API_KEY non configurata');
      const imageDataUrl = await imageDataUriOf(artwork);
      const meta = await recognizeArtwork(imageDataUrl, apiKey);
      json(res, 200, { meta });
    }).catch(e => { console.error('ERR meta:', e); err(res, 500, e.message); });
  }

  // POST /api/artworks/:id/generate/details — propone i dettagli notevoli dall'immagine intera
  if (method === 'POST' && parts.length === 5 && parts[0] === 'api' && parts[1] === 'artworks' && parts[3] === 'generate' && parts[4] === 'details') {
    return readBody(req).then(async () => {
      const artwork = getArtwork(parts[2]);
      if (!artwork) return err(res, 404, 'Opera non trovata');
      const apiKey = getOpenRouterApiKey();
      if (!apiKey) return err(res, 503, 'OPENROUTER_API_KEY non configurata');
      const imageDataUrl = await imageDataUriOf(artwork);
      const proposal = await proposeDetails(imageDataUrl, artwork, apiKey);
      json(res, 200, { details: proposal });
    }).catch(e => { console.error('ERR details:', e); err(res, 500, e.message); });
  }

  // POST /api/details/:id/generate/:tab|both — una tab singola, oppure ENTRAMBE in parallelo
  // con UNA sola chiamata di visione condivisa (le due tab analizzano lo stesso crop).
  if (method === 'POST' && parts.length === 5 && parts[0] === 'api' && parts[1] === 'details' && parts[3] === 'generate' &&
      (parts[4] === 'studio' || parts[4] === 'approfondimento' || parts[4] === 'both')) {
    const detailId = Number(parts[2]);
    const mode = parts[4];
    return readBody(req).then(async (input) => {
      const detail = getDetail(detailId);
      if (!detail) return err(res, 404, 'Dettaglio non trovato');
      const artwork = getArtwork(detail.artworkId);
      const apiKey = getOpenRouterApiKey();
      if (!apiKey) return err(res, 503, 'OPENROUTER_API_KEY non configurata');
      const fullImage = await imageDataUriOf(artwork);
      const runTab = async (tab, sharedVisionData) => {
        const level = tab === 'approfondimento' ? 'Approfondimento' : 'Scuola secondaria';
        const result = await analyzeDetail({ artwork, detail, selectionImage: input.selectionImage || null, fullImage, level, apiKey, sharedVisionData });
        saveDetailContent(detailId, tab, result.content, { status: 'generated', model: TEXT_MODEL, promptVersion: 'art-creator-2' });
        return getDetailContent(detailId, tab);
      };
      if (mode === 'both') {
        const vision = await callModel(VISION_MODEL, visionContentParts(artwork, detail, input.selectionImage || null, fullImage), apiKey);
        const [studioRow, approfondimentoRow] = await Promise.all([
          runTab('studio', vision.data),
          runTab('approfondimento', vision.data)
        ]);
        return json(res, 200, { content: { studio: studioRow, approfondimento: approfondimentoRow } });
      }
      const row = await runTab(mode, null);
      return json(res, 200, { content: row });
    }).catch(e => { console.error('ERR genDetail:', e); err(res, 500, e.message); });
  }

  // POST /api/artworks/:id/approve — genera l'immagine annotata (riquadri + didascalie) poi approva tutto
  if (method === 'POST' && parts.length === 4 && parts[0] === 'api' && parts[1] === 'artworks' && parts[3] === 'approve') {
    return Promise.resolve().then(async () => {
      const artwork = getArtwork(parts[2]);
      if (!artwork) return err(res, 404, 'Opera non trovata');
      let warning = null;
      let annotatedBoxes = 0;
      let annotatedCaptions = 0;
      try {
        const annotated = await renderAnnotated(artwork);
        if (annotated) {
          setAnnotatedImage(artwork.id, annotated.data, 'image/jpeg');
          annotatedBoxes = annotated.boxes;
          annotatedCaptions = annotated.captions;
        }
      } catch (e) { warning = 'Immagine annotata non generata: ' + e.message; console.error('ERR annotate:', e); }
      const full = approveArtwork(parts[2]);
      if (!full) return err(res, 404, 'Opera non trovata');
      return json(res, 200, { ok: true, status: full.status, artwork: full, annotatedWarning: warning, annotatedBoxes, annotatedCaptions });
    }).catch(e => err(res, 500, e.message));
  }

  // POST /api/artworks/:id/annotate — (ri)genera da sola l'immagine annotata
  if (method === 'POST' && parts.length === 4 && parts[0] === 'api' && parts[1] === 'artworks' && parts[3] === 'annotate') {
    return Promise.resolve().then(async () => {
      const artwork = getArtwork(parts[2]);
      if (!artwork) return err(res, 404, 'Opera non trovata');
      const annotated = await renderAnnotated(artwork);
      if (!annotated) return json(res, 200, { ok: false, message: 'Nessun dettaglio: prima proponi i dettagli notevoli' });
      setAnnotatedImage(artwork.id, annotated.data, 'image/jpeg');
      return json(res, 200, { ok: true, annotatedImageUrl: '/api/artworks/' + artwork.id + '/image-annotated', annotatedBoxes: annotated.boxes, annotatedCaptions: annotated.captions });
    }).catch(e => { console.error('ERR annotate:', e); err(res, 500, e.message); });
  }

  // POST /api/artworks/:id/publish — esporta JSON pronto per artest
  if (method === 'POST' && parts.length === 4 && parts[0] === 'api' && parts[1] === 'artworks' && parts[3] === 'publish') {
    const published = publishArtwork(parts[2]);
    if (!published) return err(res, 400, 'Opera non pronta: genera e approva prima i contenuti');
    return json(res, 200, { ok: true, published });
  }

  // PATCH /api/details/:id/content/:tab — salva (approva) il contenuto rivisto dall'utente
  if (method === 'PATCH' && parts.length === 5 && parts[0] === 'api' && parts[1] === 'details' && parts[3] === 'content') {
    const detailId = Number(parts[2]);
    const tab = parts[4];
    if (tab !== 'studio' && tab !== 'approfondimento') return err(res, 404, 'Tab non valida');
    return readBody(req).then(async (input) => {
      const existing = getDetailContent(detailId, tab);
      if (!existing) return err(res, 404, 'Contenuto non trovato');
      const merged = {};
      for (const key of ['observation', 'meaning', 'relation', 'curiosity', 'comparisons', 'openQuestions', 'lookAgain']) {
        merged[key] = input[key] !== undefined ? String(input[key]) : existing.content[key];
      }
      saveDetailContent(detailId, tab, merged, { status: input.status || existing.status, model: existing.model, promptVersion: existing.promptVersion });
      json(res, 200, { content: getDetailContent(detailId, tab) });
    }).catch(e => err(res, 400, e.message));
  }

  return err(res, 404, 'Endpoint non trovato: ' + method + ' ' + urlPath);
}

// ---------- generazione AI (dettagli dall'immagine) ----------
async function proposeDetails(imageDataUrl, artwork, apiKey) {
  const prompt = `Sei uno storico dell’arte italiano. Guarda l’immagine dell’opera "${artwork.title}" di ${artwork.artist} (${artwork.date || 'data ignota'}) e proponi i 4-6 dettagli più significativi da esplorare didatticamente: figure, gesti, elementi architettonici, simboli, luce, colori, oggetti.

Per ogni dettaglio restituisci un rettangolo normalizzato (0-1) che lo inquadri nell’immagine intera.

Rispondi SOLO con JSON valido nella forma:
{"details":[{"title":"Titolo breve del dettaglio","category":"Figura|Composizione|Simbolo|Luce|Colore|Oggetto|Architettura","region":{"x":0.33,"y":0.24,"width":0.28,"height":0.58},"short":"perché è interessante (max 10 parole)"}]}

Regole: title in italiano, chiaro e didattico; region interamente dentro [0,1] con width/height >= 0.05; nessun testo fuori dal JSON.`;
  const raw = await callModel(VISION_MODEL, [
    { type: 'text', text: prompt },
    { type: 'image_url', image_url: { url: imageDataUrl } }
  ], apiKey);
  const list = Array.isArray(raw.data?.details) ? raw.data.details : [];
  return list.map((item, index) => {
    const r = item.region || {};
    return {
      title: String(item.title || ('Dettaglio ' + (index + 1))).slice(0, 80),
      category: String(item.category || 'Dettaglio').slice(0, 40),
      region: {
        x: clamp01(Number(r.x)), y: clamp01(Number(r.y)),
        width: Math.max(0.04, Math.min(1, Number(r.width) || 0.2)),
        height: Math.max(0.04, Math.min(1, Number(r.height) || 0.2))
      },
      short: String(item.short || '').slice(0, 120)
    };
  });
}
async function recognizeArtwork(imageDataUrl, apiKey) {
  const prompt = `Guarda questa immagine di un’opera d’arte e riconosci l’opera, se è celebre e la conosci. Rispondi SOLO con JSON valido:
{"title":"Titolo dell'opera","artist":"Nome dell'artista","date":"data o periodo (es. c. 1440–1445)","period":"periodo/corrente artistica (es. Rinascimento fiorentino)","technique":"tecnica (es. Affresco)","institution":"istituzione che la conserva (se la conosci)","location":"collocazione specifica (se la conosci)","description":"una frase breve che descrive cosa mostra l'immagine"}

Se non riconosci con certezza l’opera o qualche campo, usa stringhe vuote per i campi incerti e metti in title una descrizione generica. Non inventare. Nessun testo fuori dal JSON.`;
  const raw = await callModel(VISION_MODEL, [
    { type: 'text', text: prompt },
    { type: 'image_url', image_url: { url: imageDataUrl } }
  ], apiKey);
  const d = raw.data || {};
  return {
    title: String(d.title || '').slice(0, 120),
    artist: String(d.artist || '').slice(0, 120),
    date: String(d.date || '').slice(0, 80),
    period: String(d.period || '').slice(0, 80),
    technique: String(d.technique || '').slice(0, 80),
    institution: String(d.institution || '').slice(0, 120),
    location: String(d.location || '').slice(0, 120),
    description: String(d.description || '').slice(0, 300)
  };
}
function clamp01(v) { return Math.max(0, Math.min(1, Number(v) || 0)); }

// ---------- generazione AI (contenuto per dettaglio) ----------
function detailInput(artwork, detail, level) {
  return {
    artwork,
    selection: { type: 'hotspot', hotspotId: detail.id, ...detail.region },
    hotspot: { id: detail.id, title: detail.title, category: detail.category },
    learningLevel: level,
    notableDetails: listDetails(artwork.id)
      .filter(d => d.id !== detail.id)
      .map(d => ({ title: d.title, category: d.category, short: '' })),
    sources: listSources(artwork.id)
  };
}
function visionContentParts(artwork, detail, selectionImage, fullImage) {
  const input = detailInput(artwork, detail, 'Scuola secondaria'); // la visione NON dipende dal livello
  const parts = [{ type: 'text', text: buildVisionPrompt(input) }, { type: 'image_url', image_url: { url: fullImage } }];
  if (selectionImage) parts.push(
    { type: 'text', text: 'La seconda immagine è il crop esatto della regione selezionata.' },
    { type: 'image_url', image_url: { url: selectionImage } }
  );
  return parts;
}
async function analyzeDetail({ artwork, detail, selectionImage, fullImage, level, apiKey, sharedVisionData = null }) {
  const input = detailInput(artwork, detail, level);
  let visionData = sharedVisionData;
  if (!visionData) {
    const vision = await callModel(VISION_MODEL, visionContentParts(artwork, detail, selectionImage, fullImage), apiKey);
    visionData = vision.data;
  }
  const explanation = await callModel(TEXT_MODEL, [{ type: 'text', text: buildTextPrompt(input, visionData) }], apiKey);
  return normalizeAnalysis(explanation.data, input, explanation.citations);
}

// ---------- immagine annotata (riquadri + didascalie) via PIL ----------
async function renderAnnotated(artwork) {
  const details = listDetails(artwork.id);
  if (!details.length) return null;
  let sourcePath = join(APP_ROOT, artwork.imagePath);
  let tempSource = false;
  if (!existsSync(sourcePath)) {
    const images = getArtworkImageData(artwork.id);
    if (!images || !images.clean) throw new Error('Immagine originale non disponibile');
    sourcePath = join(UPLOAD_DIR, artwork.id + '.src.jpg');
    await writeFile(sourcePath, Buffer.from(images.clean.data));
    tempSource = true;
  }
  const metaPath = join(UPLOAD_DIR, artwork.id + '.details.json');
  const outPath = join(UPLOAD_DIR, artwork.id + '.annotated.jpg');
  try {
    await writeFile(metaPath, JSON.stringify(details.map(d => ({ title: d.title, category: d.category, region: d.region }))));
    const { stdout } = await execFileAsync('python3', ['annotate.py', sourcePath, metaPath, outPath], { cwd: APP_ROOT, timeout: 60000 });
    const boxes = Number((stdout.match(/RIQUADRI_DISEGNATI\s+(\d+)/) || [])[1] || details.length);
    const captions = Number((stdout.match(/DIDASCALIE_DISEGNATE\s+(\d+)/) || [])[1] || details.length);
    return { data: await readFile(outPath), boxes, captions };
  } finally {
    if (tempSource) unlink(sourcePath).catch(() => {});
    unlink(metaPath).catch(() => {});
    unlink(outPath).catch(() => {});
  }
}

// ---------- static + avvio ----------
async function serveStatic(req, res, urlPath) {
  const requestPath = urlPath === '/' ? '/index.html' : urlPath;
  const filePath = resolve(PUBLIC_DIR, `.${normalize(requestPath)}`);
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end('Forbidden'); return; }
  try {
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error();
    const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json' };
    res.writeHead(200, { 'Content-Type': types[extname(filePath)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(await readFile(filePath));
  } catch {
    res.writeHead(404); res.end('Not Found');
  }
}

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const urlPath = decodeURIComponent(url.pathname);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
    res.end(); return;
  }

  if (urlPath === '/api/status') {
    const full = listArtworks().length;
    return json(res, 200, {
      app: 'art-creator',
      configured: Boolean(getOpenRouterApiKey()),
      visionModel: VISION_MODEL,
      textModel: TEXT_MODEL,
      artworks: full,
      database: db ? 'sqlite' : null
    });
  }

  if (urlPath.startsWith('/api/')) return handleApi(req, res, urlPath);

  // uploads/ (immagini)
  if (urlPath.startsWith('/uploads/')) {
    const filePath = resolve(APP_ROOT, `.${normalize(urlPath)}`);
    if (!filePath.startsWith(APP_ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }
    return readFile(filePath).then(data => {
      res.writeHead(200, { 'Content-Type': urlPath.endsWith('.png') ? 'image/png' : 'image/jpeg', 'Cache-Control': 'no-cache' });
      res.end(data);
    }).catch(() => { res.writeHead(404); res.end('Not Found'); });
  }

  return serveStatic(req, res, urlPath);
});

server.listen(PORT, HOST, () => {
  console.log(`art-creator: http://${HOST}:${PORT}`);
  console.log(`DB: SQLite (node:sqlite)`);
  console.log(`Modello visione: ${VISION_MODEL}`);
  console.log(`Modello testo: ${TEXT_MODEL}`);
  console.log(getOpenRouterApiKey() ? 'OpenRouter API key: configurata' : 'OpenRouter API key: NON configurata');
});
