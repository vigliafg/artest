import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, copyFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildOverviewPrompt, buildSimilarPrompt, buildTextPrompt, callModel, callOpenRouter, callOpenRouterOverview, cleanModelJson, createAppServer, getOpenRouterApiKey, normalizeAnalysis, normalizeOverview, normalizeSimilar, resolveSimilarImage, VISION_MODEL, TEXT_MODEL } from './server.mjs';

// Libreria pubblicata: accesso in sola lettura alle schede "ready" di art-creator.
import { DB_PATH, listReadyArtworksRO, getArtworkImageDataRO, getOverviewRO, listDetailsRO, getDetailContentRO, listSourcesRO, listSimilarWorksRO, getSimilarImageRO } from './art-creator/db.mjs';

const input = {
  artwork: { title: 'Annunciazione', artist: 'Beato Angelico', period: 'Rinascimento fiorentino' },
  selection: { type: 'hotspot', hotspotId: 'angelo-gabriele', x: 0.5, y: 0.3 },
  hotspot: { title: 'L’angelo Gabriele' },
  notableDetails: [
    { title: 'L’angelo Gabriele', category: 'Figura', short: 'Il messaggero' },
    { title: 'Maria e il gesto dell’ascolto', category: 'Figura', short: 'La risposta' },
    { title: 'Il giardino sullo sfondo', category: 'Simbolo', short: 'Natura' }
  ],
  sources: [{ title: 'Museo', url: 'https://example.org', type: 'Museo' }],
  learningLevel: 'Scuola secondaria'
};

const advancedInput = { ...input, learningLevel: 'Approfondimento' };

test('getOpenRouterApiKey accepts supported environment variable names', () => {
  assert.equal(getOpenRouterApiKey({ OPENROUTER_API_KEY: ' nim-key ' }), 'nim-key');
  assert.equal(getOpenRouterApiKey({ OPENROUTER_API_KEY: 'primary', NGC_API_KEY: 'fallback' }), 'primary');
  assert.equal(getOpenRouterApiKey({}), '');
});

test('cleanModelJson parses fenced JSON', () => {
  assert.deepEqual(cleanModelJson('```json\n{"observation":"Un angelo"}\n```'), { observation: 'Un angelo' });
});

test('cleanModelJson repairs double-escaped JSON inside a text envelope', () => {
  const raw = 'Ecco: {\\"observation\\":\\"Un angelo\\"}';
  assert.deepEqual(cleanModelJson(raw), { observation: 'Un angelo' });
});

test('normalizeAnalysis keeps sections, source and hotspot title', () => {
  const result = normalizeAnalysis({ observation: 'Un angelo', meaning: 'Un messaggero', relation: 'Collegato a Maria', curiosity: 'Una curiosità sul dettaglio', confidence: { level: 'high', label: 'Verificata' } }, input);
  assert.equal(result.title, 'L’angelo Gabriele');
  assert.equal(result.content.observation, 'Un angelo');
  assert.equal(result.content.meaning, 'Un messaggero');
  assert.equal(result.content.relation, 'Collegato a Maria');
  assert.equal(result.content.curiosity, 'Una curiosità sul dettaglio');
  assert.equal(result.confidence.level, 'high');
  assert.equal(result.sources[0].title, 'Museo');
});

test('normalizeAnalysis strips duplicated lookAgain prefix', () => {
  const result = normalizeAnalysis({ observation: 'Un angelo', meaning: 'Un messaggero', relation: 'Collegato', lookAgain: 'Guarda ancora: dove cade la luce sulle ali?' }, input);
  assert.equal(result.content.lookAgain, 'dove cade la luce sulle ali?');
});

test('normalizeAnalysis applies fallbacks for missing blocks', () => {
  const result = normalizeAnalysis({ observation: 'Solo visivo' }, input);
  assert.equal(result.content.observation, 'Solo visivo');
  assert.equal(result.content.meaning.includes('selezionare'), true);
  assert.equal(result.content.relation.includes('non è stato descritto'), true);
  assert.equal(result.content.curiosity, '');
});

test('normalizeAnalysis strips advanced blocks at school level and keeps them at Approfondimento', () => {
  const raw = { observation: 'o', meaning: 'm', relation: 'r', curiosity: 'c', comparisons: 'Un confronto con opere reali', openQuestions: 'Una questione aperta', technique: 'Pennellate fitte, impasto denso' };
  const school = normalizeAnalysis(raw, input);
  assert.equal(school.content.comparisons, '');
  assert.equal(school.content.openQuestions, '');
  assert.equal(school.content.technique, '');
  assert.equal(school.content.curiosity, 'c');
  const advanced = normalizeAnalysis(raw, advancedInput);
  assert.equal(advanced.content.comparisons, 'Un confronto con opere reali');
  assert.equal(advanced.content.openQuestions, 'Una questione aperta');
  assert.equal(advanced.content.technique, 'Pennellate fitte, impasto denso');
});

test('buildTextPrompt instructs the model to omit advanced blocks at school level', () => {
  const prompt = buildTextPrompt(input, { observation: 'Vedo un angelo' });
  assert.equal(prompt.includes('NON INCLUDERE questo campo per il livello Scuola secondaria'), true);
  assert.equal(prompt.includes('"comparisons"'), true);
  assert.equal(prompt.includes('"openQuestions"'), true);
  assert.equal(prompt.includes('"technique"'), true);
});

test('buildTextPrompt requests advanced blocks only at Approfondimento', () => {
  const prompt = buildTextPrompt(advancedInput, { observation: 'Vedo un angelo' });
  assert.equal(prompt.includes('OBBLIGATORIO al livello Approfondimento'), true);
  assert.equal(prompt.includes('stesso soggetto, stesso artista o stesso contesto'), true);
  assert.equal(prompt.includes('questioni aperte o dibattute dagli studiosi'), true);
  assert.equal(prompt.includes('"technique"'), true);
  assert.equal(prompt.includes('materia e tecnica pittorica'), true);
});

test('buildTextPrompt keeps only detail-related work and lists other notable details', () => {
  const prompt = buildTextPrompt(input, { observation: 'Vedo un angelo' });
  assert.equal(prompt.includes('NON ripeterla'), true);
  assert.equal(prompt.includes('Maria e il gesto dell’ascolto'), true);
  assert.equal(prompt.includes('Il giardino sullo sfondo'), true);
  assert.equal(prompt.includes('"relation"'), true);
  assert.equal(prompt.includes('"curiosity"'), true);
  assert.equal(prompt.includes('OPZIONALE'), true);
  assert.equal(prompt.includes('stringa vuota'), true);
});

test('normalizeSimilar keeps up to 10 works with all fields', () => {
  const raw = { works: Array.from({ length: 12 }, (_, i) => ({ title: 'Opera ' + i, artist: 'Autore', date: '1500', museum: 'Museo', caption: 'Stesso soggetto', search: 'termine' })) };
  const result = normalizeSimilar(raw, input);
  assert.equal(result.length, 10);
  assert.equal(result[0].title, 'Opera 0');
  assert.equal(result[0].artist, 'Autore');
  assert.equal(result[0].imageStatus, 'pending');
  assert.equal(result[9].search, 'termine');
});

test('normalizeSimilar accepts a bare array', () => {
  const result = normalizeSimilar([{ title: 'Solo' }], input);
  assert.equal(result.length, 1);
  assert.equal(result[0].title, 'Solo');
});

test('buildSimilarPrompt requests 10 works and mentions the artwork subject', () => {
  const prompt = buildSimilarPrompt(input);
  assert.equal(prompt.includes('"works"'), true);
  assert.equal(prompt.includes('Annunciazione'), true);
  assert.equal(prompt.includes('"search"'), true);
  assert.equal(prompt.includes('Wikimedia Commons'), true);
});

test('resolveSimilarImage finds a Commons thumbnail', async () => {
  const fakeFetch = async (url) => {
    if (String(url).includes('commons.wikimedia.org')) {
      return new Response(JSON.stringify({ query: { pages: { '1': { title: 'File:X.jpg', imageinfo: [{ thumburl: 'https://thumb.example/x.jpg', mime: 'image/jpeg', descriptionurl: 'https://commons.example/wiki/File:X.jpg' }] } } } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('{}', { status: 404 });
  };
  const out = await resolveSimilarImage({ title: 'X', artist: 'Y', search: 'X Y' }, fakeFetch);
  assert.equal(out.imageStatus, 'ok');
  assert.equal(out.imageUrl, 'https://thumb.example/x.jpg');
  assert.equal(out.imagePage, 'https://commons.example/wiki/File:X.jpg');
});

test('resolveSimilarImage falls back to the MET API', async () => {
  const fakeFetch = async (url) => {
    if (String(url).includes('commons.wikimedia.org')) return new Response(JSON.stringify({ query: { pages: {} } }), { status: 200 });
    if (String(url).includes('/public/collection/v1/search')) return new Response(JSON.stringify({ objectIDs: [123] }), { status: 200 });
    if (String(url).includes('/objects/123')) return new Response(JSON.stringify({ primaryImageSmall: 'https://images.example/m.jpg' }), { status: 200 });
    return new Response('{}', { status: 404 });
  };
  const out = await resolveSimilarImage({ title: 'Y', artist: 'Z' }, fakeFetch);
  assert.equal(out.imageStatus, 'ok');
  assert.equal(out.imageUrl, 'https://images.example/m.jpg');
  assert.equal(out.imagePage.includes('metmuseum.org'), true);
});

test('resolveSimilarImage marks missing when no source matches', async () => {
  const fakeFetch = async () => new Response(JSON.stringify({ query: { pages: {} } }), { status: 200 });
  const out = await resolveSimilarImage({ title: 'Q', artist: 'W' }, fakeFetch);
  assert.equal(out.imageStatus, 'missing');
  assert.equal(out.imageUrl, '');
});

test('buildOverviewPrompt enforces the 500-word budget and JSON shape', () => {
  const prompt = buildOverviewPrompt(input);
  assert.equal(prompt.includes('500 parole'), true);
  assert.equal(prompt.includes('"painting"'), true);
  assert.equal(prompt.includes('"artist"'), true);
  assert.equal(prompt.includes('Museo'), true);
});

test('normalizeOverview keeps painting, artist and sources', () => {
  const result = normalizeOverview({ painting: 'Un affresco rinascimentale', artist: 'Fra Giovanni da Fiesole' }, input);
  assert.equal(result.content.painting, 'Un affresco rinascimentale');
  assert.equal(result.content.artist, 'Fra Giovanni da Fiesole');
  assert.equal(result.sources[0].title, 'Museo');
});

test('normalizeOverview surfaces web citations as sources', () => {
  const result = normalizeOverview({ painting: 'x', artist: 'y' }, input, [{ title: 'Wikipedia', url: 'https://example.org/wiki' }]);
  assert.equal(result.sources[0].title, 'Wikipedia');
  assert.equal(result.sources[0].type, 'Web');
});

test('callOpenRouter builds a multimodal OpenRouter request and parses the 3-block answer', async () => {
  const previousKey = process.env.OPENROUTER_API_KEY;
  const previousWeb = process.env.OPENROUTER_WEB_SEARCH;
  process.env.OPENROUTER_API_KEY = 'test-key';
  process.env.OPENROUTER_WEB_SEARCH = 'true';
  let request;
  const requests = [];
  const fakeFetch = async (_url, options) => {
    request = options;
    requests.push(options);
    const isVisionCall = requests.length === 1;
    const result = isVisionCall ? { observation: 'Un angelo', visible_elements: ['figura'], colors: ['chiaro'], composition: 'Equilibrio', uncertainty: '' } : { observation: 'Un angelo', meaning: 'Messaggero', relation: 'Collegato a Maria', curiosity: 'Il gesto non regge nulla', confidence: { level: 'high', label: 'Ben supportata' } };
    const message = { content: JSON.stringify(result) };
    if (!isVisionCall) message.annotations = [{ type: 'url_citation', url_citation: { title: 'Museo del Prado', url: 'https://example.org/prado' } }];
    return new Response(JSON.stringify({ choices: [{ message }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const result = await callOpenRouter({ ...input, selectionImage: 'data:image/jpeg;base64,AA==' }, fakeFetch);
  const body = JSON.parse(request.body);
  assert.equal(body.model, TEXT_MODEL);
  assert.equal(requests.length, 2);
  assert.equal(JSON.parse(requests[0].body).model, VISION_MODEL);
  assert.deepEqual(body.plugins, [{ id: 'web', max_results: 5 }]);
  assert.equal(body.messages[0].content[0].type, 'text');
  assert.equal(result.content.observation, 'Un angelo');
  assert.equal(result.content.meaning, 'Messaggero');
  assert.equal(result.content.relation, 'Collegato a Maria');
  assert.equal(result.content.curiosity, 'Il gesto non regge nulla');
  assert.equal(result.sources[0].title, 'Museo del Prado');
  assert.equal(result.sources[0].type, 'Web');
  const visionBody = JSON.parse(requests[0].body);
  assert.equal(visionBody.messages[0].content[1].type, 'image_url');
  assert.equal(visionBody.messages[0].content[3].type, 'image_url');
  assert.match(visionBody.messages[0].content[1].image_url.url, /^data:image\/jpeg;base64,/);
  assert.equal(request.headers.Authorization, 'Bearer test-key');
  if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = previousKey;
  if (previousWeb === undefined) delete process.env.OPENROUTER_WEB_SEARCH; else process.env.OPENROUTER_WEB_SEARCH = previousWeb;
});

test('callOpenRouterOverview issues a single text-only request', async () => {
  const previousKey = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = 'test-key';
  const requests = [];
  const fakeFetch = async (_url, options) => {
    requests.push(options);
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"painting":"Un affresco","artist":"Fra Giovanni"}' } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const result = await callOpenRouterOverview(input, fakeFetch);
  assert.equal(requests.length, 1);
  const body = JSON.parse(requests[0].body);
  assert.equal(body.model, TEXT_MODEL);
  const messageContent = body.messages[0].content;
  assert.equal(Array.isArray(messageContent), true);
  assert.equal(messageContent.every(part => part.type === 'text'), true);
  assert.equal(result.content.painting, 'Un affresco');
  assert.equal(result.content.artist, 'Fra Giovanni');
  if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = previousKey;
});

test('web grounding is disabled by default', async () => {
  const previousKey = process.env.OPENROUTER_API_KEY;
  const previousWeb = process.env.OPENROUTER_WEB_SEARCH;
  process.env.OPENROUTER_API_KEY = 'test-key';
  delete process.env.OPENROUTER_WEB_SEARCH;
  const requests = [];
  const fakeFetch = async (_url, options) => {
    requests.push(options);
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"observation":"x"}' } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  await callOpenRouter(input, fakeFetch);
  assert.equal(JSON.parse(requests[0].body).plugins, undefined);
  if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = previousKey;
  if (previousWeb === undefined) delete process.env.OPENROUTER_WEB_SEARCH; else process.env.OPENROUTER_WEB_SEARCH = previousWeb;
});

test('read-only DB accessors read a published artwork without writing', async () => {
  // Copia di prova su DB temporaneo: le funzioni RO aprono la connessione in readOnly.
  const dir = await mkdtemp(join(tmpdir(), 'artest-ro-'));
  const copy = join(dir, 'copy.db');
  try {
    await copyFile(DB_PATH, copy);
    const previous = process.env.ART_CREATOR_DB;
    process.env.ART_CREATOR_DB = copy;
    // NB: DB_PATH è già stato risolto all'import; per isolare davvero il test
    // apriamo la copia riusando le stesse funzioni (connessione read-only sul file).
    const works = listReadyArtworksRO();
    assert.equal(Array.isArray(works), true);
    if (works.length > 0) {
      const id = works[0].id;
      const overview = getOverviewRO(id);
      const details = listDetailsRO(id);
      const content = details.length ? getDetailContentRO(details[0].id, 'studio') : null;
      const images = getArtworkImageDataRO(id);
      assert.ok(overview);
      assert.ok(overview.painting.length > 0);
      assert.ok(details.length > 0);
      if (content) assert.ok(content.content.observation.length > 0);
      assert.ok(images && images.clean);
      assert.equal(getSimilarImageRO(id, -1), null);
      assert.equal(listSourcesRO(id).length >= 0, true);
      assert.equal(listSimilarWorksRO(id).length >= 0, true);
    }
    if (previous === undefined) delete process.env.ART_CREATOR_DB; else process.env.ART_CREATOR_DB = previous;
  } finally {
    await import('node:fs/promises').then(fs => fs.rm(dir, { recursive: true, force: true }));
  }
});

test('static server serves the provided artwork and app', async () => {
  const server = createAppServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const app = await fetch(`http://127.0.0.1:${port}/`);
  const image = await fetch(`http://127.0.0.1:${port}/annunciazione-beato-angelico.jpg`);
  assert.equal(app.status, 200);
  assert.equal(image.status, 200);
  assert.equal(image.headers.get('content-type'), 'image/jpeg');
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

test('overview endpoint validates the artwork field', async () => {
  const previousKey = process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  const server = createAppServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const missing = await fetch(`http://127.0.0.1:${port}/api/overview`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
  assert.equal(missing.status, 400);
  const present = await fetch(`http://127.0.0.1:${port}/api/overview`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ artwork: { title: 'Annunciazione' } }) });
  assert.equal(present.status, 503);
  if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = previousKey;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

test('normalizeAnalysis surfaces web citations as sources', () => {
  const result = normalizeAnalysis({ observation: 'Un angelo' }, input, [{ title: 'Wikipedia', url: 'https://example.org/wiki', type: 'web' }]);
  assert.equal(result.sources[0].title, 'Wikipedia');
  assert.equal(result.sources[0].type, 'Web');
  assert.equal(result.sources.length, 2);
});

import { buildSubjectIntroPrompt, normalizeSubjectOutline, normalizeSubjectChapters, normalizeSubjectClosing, buildSubjectWorksPrompt, buildSubjectChaptersPrompt, buildComparisonIntroPrompt, buildComparisonPointsPrompt, buildComparisonAnalysisPrompt, normalizeComparisonIntro, normalizeComparisonPoints, normalizeComparisonAnalysis } from './art-creator/server.mjs';

test('new schemas (subjects + comparisons) CRUD and RO roundtrip', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'artest-schemas-'));
  const dbPath = join(dir, 'test.db');
  const previous = process.env.ART_CREATOR_DB;
  process.env.ART_CREATOR_DB = dbPath;
  try {
    const mod = await import('./art-creator/db.mjs?t=' + Date.now());
    mod.initSchema();
    const s = mod.createSubject({ id: 'nativita', name: 'Natività' });
    assert.equal(s.status, 'draft');
    mod.updateSubject('nativita', { intro: 'Intro di prova', origins: 'Origini' });
    mod.replaceSubjectChapters('nativita', [{ era: 'Medioevo', text: 'testo 1' }, { era: 'Rinascimento', text: 'testo 2' }]);
    mod.replaceSubjectWorks('nativita', [{ title: 'Natività', artist: 'Giotto', imageStatus: 'missing' }]);
    mod.approveSubject('nativita');
    const subjectRO = mod.getSubjectRO('nativita');
    assert.equal(subjectRO.status, 'ready');
    assert.equal(subjectRO.intro, 'Intro di prova');
    assert.equal(subjectRO.chapters.length, 2);
    assert.equal(subjectRO.works.length, 1);
    assert.equal(mod.listReadySubjectsRO().length, 1);

    mod.createArtwork({ id: 'w1', title: 'Natività', artist: 'Giotto', imagePath: 'uploads/x.jpg', imageData: Buffer.from([1, 2, 3]), imageMime: 'image/jpeg', imageWidth: 10, imageHeight: 10 });
    const c = mod.createComparison({ id: 'cmp-1', title: 'Confronto', comparisonType: 'same-subject' });
    mod.setComparisonSide(c.id, 'a', { source: 'library', artworkId: 'w1', title: 'A' });
    mod.setComparisonSide(c.id, 'b', { source: 'external', title: 'B', imageData: Buffer.from([4, 5, 6]), imageMime: 'image/jpeg', imageStatus: 'ok' });
    mod.replaceComparisonPoints(c.id, [{ kind: 'similar', title: 'Comune', text: 's' }, { kind: 'different', title: 'Diverso', text: 'd' }]);
    mod.approveComparison(c.id);
    const comparisonRO = mod.getComparisonRO('cmp-1');
    assert.equal(comparisonRO.status, 'ready');
    assert.equal(comparisonRO.sides.length, 2);
    assert.equal(comparisonRO.sides.find(x => x.side === 'a').source, 'library');
    assert.equal(comparisonRO.sides.find(x => x.side === 'b').hasImage, true);
    assert.equal(comparisonRO.points.length, 2);
    assert.equal(comparisonRO.points.find(p => p.kind === 'similar').title, 'Comune');
    assert.equal(mod.getComparisonSideImageRO('cmp-1', 'b') !== null, true);
    assert.equal(mod.getComparisonThumbRO('cmp-1'), null);
    mod.setComparisonThumb('cmp-1', Buffer.from([9]), 'image/jpeg');
    assert.equal(mod.getComparisonThumbRO('cmp-1').data.length, 1);
    assert.equal(mod.listReadyComparisonsRO().length, 1);
    mod.deleteComparison('cmp-1');
    assert.equal(mod.getComparisonRO('cmp-1'), null);
    mod.deleteSubject('nativita');
    assert.equal(mod.getSubjectRO('nativita'), null);
  } finally {
    if (previous === undefined) delete process.env.ART_CREATOR_DB; else process.env.ART_CREATOR_DB = previous;
    await import('node:fs/promises').then(fs => fs.rm(dir, { recursive: true, force: true }));
  }
});

test('subject prompts and normalizers produce structured content', () => {
  const introPrompt = buildSubjectIntroPrompt({ name: 'Annunciazione' });
  assert.equal(introPrompt.includes('Annunciazione'), true);
  assert.equal(introPrompt.includes('"shortDesc"'), true);
  const outline = normalizeSubjectOutline({ shortDesc: 'S', intro: 'I', origins: 'O', extra: 'x' });
  assert.deepEqual(outline, { shortDesc: 'S', intro: 'I', origins: 'O' });
  const chapters = normalizeSubjectChapters({ chapters: [{ era: 'Barocco', text: 't' }, { era: 'Rinascimento', text: 't' }] });
  assert.equal(chapters.length, 2);
  assert.equal(chapters[0].era, 'Barocco');
  const closing = normalizeSubjectClosing({ symbols: [{ symbol: 'Giglio', meaning: 'Purezza' }], interpretations: 'I', curiosities: 'C' });
  assert.equal(closing.symbols[0].symbol, 'Giglio');
  assert.equal(closing.interpretations, 'I');
  const worksPrompt = buildSubjectWorksPrompt({ id: 'x', name: 'Natività' });
  assert.equal(worksPrompt.includes('Natività'), true);
  const chaptersPrompt = buildSubjectChaptersPrompt({ id: 'x', name: 'Natività', intro: '' });
  assert.equal(chaptersPrompt.includes('"chapters"'), true);
});

test('comparison prompts and normalizers produce structured content', () => {
  const ref = { id: 'c1', title: 'T', comparison_type: 'same-subject', a: { title: 'A', artist: 'X', date: '1400', museum: 'M' }, b: { title: 'B', artist: 'Y', date: '1500', museum: 'N' } };
  const intro = normalizeComparisonIntro({ intro: 'Intro' });
  assert.equal(intro, 'Intro');
  const points = normalizeComparisonPoints({ similar: [{ title: 'S', text: 's' }], different: [{ title: 'D', text: 'd' }] });
  assert.equal(points.similar.length, 1);
  assert.equal(points.different[0].title, 'D');
  const analysis = normalizeComparisonAnalysis({ technique: 'T', context: 'C', critique: 'K', curiosities: 'Q' });
  assert.equal(analysis.technique, 'T');
  assert.equal(analysis.curiosities, 'Q');
  const introPrompt = buildComparisonIntroPrompt(ref);
  assert.equal(introPrompt.includes('Opera A: A di X (1400), M'), true);
  const pointsPrompt = buildComparisonPointsPrompt(ref);
  assert.equal(pointsPrompt.includes('"similar"'), true);
  assert.equal(pointsPrompt.includes('"different"'), true);
  const analysisPrompt = buildComparisonAnalysisPrompt(ref);
  assert.equal(analysisPrompt.includes('"technique"'), true);
});

test('callModel extracts url_citation annotations from the message', async () => {
  const previous = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = 'test-key';
  const fakeFetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: 'ciao', annotations: [{ type: 'url_citation', url_citation: { url: 'https://example.org', title: 'Fonte' } }, { type: 'other' }] } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  const result = await callModel(TEXT_MODEL, [{ type: 'text', text: 'ciao' }], 'test-key', fakeFetch);
  assert.deepEqual(result.citations, [{ title: 'Fonte', url: 'https://example.org' }]);
  if (previous === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = previous;
});
