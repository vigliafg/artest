import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildOverviewPrompt, buildTextPrompt, callModel, callOpenRouter, callOpenRouterOverview, cleanModelJson, createAppServer, getOpenRouterApiKey, normalizeAnalysis, normalizeOverview, VISION_MODEL, TEXT_MODEL } from './server.mjs';

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
  const raw = { observation: 'o', meaning: 'm', relation: 'r', curiosity: 'c', comparisons: 'Un confronto con opere reali', openQuestions: 'Una questione aperta' };
  const school = normalizeAnalysis(raw, input);
  assert.equal(school.content.comparisons, '');
  assert.equal(school.content.openQuestions, '');
  assert.equal(school.content.curiosity, 'c');
  const advanced = normalizeAnalysis(raw, advancedInput);
  assert.equal(advanced.content.comparisons, 'Un confronto con opere reali');
  assert.equal(advanced.content.openQuestions, 'Una questione aperta');
});

test('buildTextPrompt instructs the model to omit advanced blocks at school level', () => {
  const prompt = buildTextPrompt(input, { observation: 'Vedo un angelo' });
  assert.equal(prompt.includes('NON INCLUDERE questo campo per il livello Scuola secondaria'), true);
  assert.equal(prompt.includes('"comparisons"'), true);
  assert.equal(prompt.includes('"openQuestions"'), true);
});

test('buildTextPrompt requests advanced blocks only at Approfondimento', () => {
  const prompt = buildTextPrompt(advancedInput, { observation: 'Vedo un angelo' });
  assert.equal(prompt.includes('OBBLIGATORIO al livello Approfondimento'), true);
  assert.equal(prompt.includes('stesso soggetto, stesso artista o stesso contesto'), true);
  assert.equal(prompt.includes('questioni aperte o dibattute dagli studiosi'), true);
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

test('callModel extracts url_citation annotations from the message', async () => {
  const previous = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = 'test-key';
  const fakeFetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: 'ciao', annotations: [{ type: 'url_citation', url_citation: { url: 'https://example.org', title: 'Fonte' } }, { type: 'other' }] } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  const result = await callModel(TEXT_MODEL, [{ type: 'text', text: 'ciao' }], 'test-key', fakeFetch);
  assert.deepEqual(result.citations, [{ title: 'Fonte', url: 'https://example.org' }]);
  if (previous === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = previous;
});
