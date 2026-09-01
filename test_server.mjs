import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { callNvidia, cleanModelJson, createAppServer, normalizeAnalysis, NVIDIA_MODEL } from './server.mjs';

const input = {
  artwork: { title: 'Annunciazione', artist: 'Beato Angelico', period: 'Rinascimento fiorentino' },
  selection: { type: 'hotspot', hotspotId: 'angelo-gabriele', x: 0.5, y: 0.3 },
  hotspot: { title: 'L’angelo Gabriele' },
  sources: [{ title: 'Museo', url: 'https://example.org', type: 'Museo' }],
  learningLevel: 'Scuola secondaria'
};

test('cleanModelJson parses fenced JSON', () => {
  assert.deepEqual(cleanModelJson('```json\n{"observation":"Un angelo"}\n```'), { observation: 'Un angelo' });
});

test('normalizeAnalysis keeps sections, source and hotspot title', () => {
  const result = normalizeAnalysis({ observation: 'Un angelo', importance: 'Un messaggero', confidence: { level: 'high', label: 'Verificata' } }, input);
  assert.equal(result.title, 'L’angelo Gabriele');
  assert.equal(result.content.observation, 'Un angelo');
  assert.equal(result.confidence.level, 'high');
  assert.equal(result.sources[0].title, 'Museo');
});

test('callNvidia builds a multimodal NVIDIA request', async () => {
  const previous = process.env.NVIDIA_API_KEY;
  process.env.NVIDIA_API_KEY = 'test-key';
  let request;
  const fakeFetch = async (_url, options) => {
    request = options;
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ observation: 'Un angelo', importance: 'Messaggero', composition: 'Equilibrio', curiosity: 'Curiosità', connection: 'Rinascimento', confidence: { level: 'high', label: 'Ben supportata' } }) } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const result = await callNvidia({ ...input, selectionImage: 'data:image/jpeg;base64,AA==' }, fakeFetch);
  const body = JSON.parse(request.body);
  assert.equal(body.model, NVIDIA_MODEL);
  assert.equal(body.messages[0].content[1].type, 'image_url');
  assert.equal(body.messages[0].content[3].type, 'image_url');
  assert.match(body.messages[0].content[1].image_url.url, /^data:image\/jpeg;base64,/);
  assert.equal(request.headers.Authorization, 'Bearer test-key');
  assert.equal(result.content.observation, 'Un angelo');
  if (previous === undefined) delete process.env.NVIDIA_API_KEY; else process.env.NVIDIA_API_KEY = previous;
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
