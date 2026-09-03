import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { callModel, callOpenRouter, cleanModelJson, createAppServer, getOpenRouterApiKey, normalizeAnalysis, VISION_MODEL, TEXT_MODEL } from './server.mjs';

const input = {
  artwork: { title: 'Annunciazione', artist: 'Beato Angelico', period: 'Rinascimento fiorentino' },
  selection: { type: 'hotspot', hotspotId: 'angelo-gabriele', x: 0.5, y: 0.3 },
  hotspot: { title: 'L’angelo Gabriele' },
  sources: [{ title: 'Museo', url: 'https://example.org', type: 'Museo' }],
  learningLevel: 'Scuola secondaria'
};

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
  const result = normalizeAnalysis({ observation: 'Un angelo', importance: 'Un messaggero', confidence: { level: 'high', label: 'Verificata' } }, input);
  assert.equal(result.title, 'L’angelo Gabriele');
  assert.equal(result.content.observation, 'Un angelo');
  assert.equal(result.confidence.level, 'high');
  assert.equal(result.sources[0].title, 'Museo');
});

test('callOpenRouter builds a multimodal OpenRouter request', async () => {
  const previousKey = process.env.OPENROUTER_API_KEY;
  const previousWeb = process.env.OPENROUTER_WEB_SEARCH;
  process.env.OPENROUTER_API_KEY = 'test-key';
  process.env.OPENROUTER_WEB_SEARCH = 'true';
  let request;
  const requests = [];
  const fakeFetch = async (_url, options) => {
    request = options;
    requests.push(options);
    const model = JSON.parse(options.body).model;
    const result = model === VISION_MODEL ? { observation: 'Un angelo', visible_elements: ['figura'], colors: ['chiaro'], composition: 'Equilibrio', uncertainty: '' } : { observation: 'Un angelo', importance: 'Messaggero', composition: 'Equilibrio', curiosity: 'Curiosità', connection: 'Rinascimento', confidence: { level: 'high', label: 'Ben supportata' } };
    const message = { content: JSON.stringify(result) };
    if (model === TEXT_MODEL) message.annotations = [{ type: 'url_citation', url_citation: { title: 'Museo del Prado', url: 'https://example.org/prado' } }];
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
