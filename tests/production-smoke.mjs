// Real HTTP/Blob/Gemini smoke. Creates and deletes only its own licensed fixtures.
// Run explicitly: node tests/production-smoke.mjs
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { upload } from '@vercel/blob/client';

const base = process.env.SMOKE_BASE_URL || 'https://docchat-lyart.vercel.app';
const results = [];
const ownedIds = new Set();
let cookie = '';
let batchId;
const record = (check, passed, details = {}) => {
  const row = { timestamp: new Date().toISOString(), check, passed, ...details };
  results.push(row);
  console.log(JSON.stringify(row));
  if (!passed) throw new Error('Check failed: ' + check);
};
async function api(path, method = 'GET', body) {
  const r = await fetch(base + path, {
    method, headers: { Cookie: cookie, Origin: base, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(120000),
  });
  const setCookie = r.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  return r;
}
async function fixture(filename, mimeType) {
  const bytes = await readFile(new URL('./fixtures/documents/' + filename, import.meta.url));
  return { filename, mimeType, bytes, clientId: randomUUID() };
}
async function add(files, initial = false) {
  const r = await api(initial ? '/api/batches' : `/api/batches/${batchId}/documents`, 'POST', {
    files: files.map(f => ({ clientId: f.clientId, filename: f.filename, mimeType: f.mimeType, size: f.bytes.length })),
  });
  const body = await r.json();
  record(initial ? 'create-batch' : 'add-document', r.status === 201, { status: r.status });
  batchId = body.batch.id;
  for (const target of body.files) {
    ownedIds.add(target.documentId);
    const f = files.find(file => file.clientId === target.clientId);
    await upload(target.uploadPathname, new Blob([f.bytes], { type: f.mimeType }), {
      access: 'private', handleUploadUrl: base + '/api/upload', contentType: f.mimeType,
      headers: { Cookie: cookie, Origin: base }, multipart: false,
      clientPayload: JSON.stringify({ batchId, documentId: target.documentId }),
    });
    record('private-upload', true, { filename: f.filename });
  }
  return body.files;
}
async function ready() {
  for (let attempt = 0; attempt < 100; attempt++) {
    const r = await api(`/api/batches/${batchId}`);
    const body = await r.json();
    if (!r.ok) throw Error('Batch read failed: ' + r.status);
    if (body.batch.documents.some(d => d.status === 'failed')) throw Error('Ingestion failed');
    if (body.batch.status === 'ready') {
      record('callback-ingestion-ready', true, { documents: body.batch.documents.length });
      return body.batch.documents;
    }
    if (attempt % 10 === 0) console.log(JSON.stringify({ progress: 'waiting-for-Blob-callback-and-ingestion', statuses: body.batch.documents.map(d => d.status) }));
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  throw Error('Ingestion timeout');
}
async function chat(message, documentIds, history = []) {
  const started = Date.now();
  const r = await api('/api/chat', 'POST', { batchId, documentIds, message, history });
  if (!r.ok) throw Error('Chat HTTP ' + r.status);
  const body = await r.text();
  const events = body.split('\n').filter(l => l.startsWith('data: ') && l !== 'data: [DONE]').map(l => JSON.parse(l.slice(6)));
  if (events.some(e => e.type === 'error')) throw Error('Chat stream error');
  return {
    text: events.filter(e => e.type === 'text-delta').map(e => e.delta).join(''),
    sources: events.find(e => e.type === 'data-sources')?.data || [],
    durationMs: Date.now() - started,
  };
}

try {
  const files = await Promise.all([
    fixture('wikipedia-contribution-guide-fr.pdf', 'application/pdf'),
    fixture('wikipedia-classroom-booklet-ar.pdf', 'application/pdf'),
    fixture('multiformat-smoke.txt', 'text/plain'),
  ]);
  await add(files, true);
  let documents = await ready();
  const cases = [
    { lang: 'fr', filename: files[0].filename, question: "Quel est l'objectif principal de l'initiative Art+Féminisme ?", matches: t => /genre|femmes|fémin/i.test(t) },
    { lang: 'ar', filename: files[1].filename, question: 'ما هي ويكيبيديا؟', matches: t => /موسوعة/.test(t) },
    { lang: 'en', filename: files[2].filename, question: 'What are the approval code and the payment window?', matches: t => /TXT-7319/.test(t) && /30/.test(t) },
  ];
  for (const item of cases) {
    const selected = documents.find(d => d.filename === item.filename);
    const answer = await chat(item.question, [selected.id]);
    record('document-QA-' + item.lang, item.matches(answer.text) && /\[\d+\]/.test(answer.text) && answer.sources.some(s => s.documentId === selected.id), {
      question: item.question, answer: answer.text, sources: answer.sources.map(s => ({ filename: s.filename, location: s.source })), durationMs: answer.durationMs,
    });
  }
  const social = await chat('hello', documents.map(d => d.id));
  record('social-no-citations', social.text.length > 0 && social.sources.length === 0, { answer: social.text });
  const addition = await fixture('operations-smoke.md', 'text/markdown');
  const targets = await add([addition]);
  documents = await ready();
  const addedId = targets[0].documentId;
  const question = 'According to the Operations document, who owns escalation and what is the target response?';
  const added = await chat(question, documents.map(d => d.id));
  record('added-document-in-context', /Nadia/.test(added.text) && /4/.test(added.text) && added.sources.some(s => s.documentId === addedId), { answer: added.text });
  const removed = await api('/api/documents/' + addedId, 'DELETE');
  record('delete-added-document', removed.ok, { status: removed.status });
  ownedIds.delete(addedId);
  documents = await ready();
  record('deleted-document-absent-from-batch', !documents.some(d => d.id === addedId));
  const after = await chat(question, documents.map(d => d.id), [{ role: 'user', content: question }, { role: 'assistant', content: added.text }]);
  record('deleted-document-not-used-with-history', !after.sources.some(s => s.documentId === addedId) && !/Nadia/.test(after.text), { answer: after.text });
  const stale = await api('/api/chat', 'POST', { batchId, documentIds: [addedId], message: question, history: [] });
  record('reject-stale-document-selection', stale.status === 404, { status: stale.status });
  const otherSession = await fetch(base + `/api/batches/${batchId}`);
  record('reject-other-session', otherSession.status === 401, { status: otherSession.status });
} catch (error) {
  recordFailure(error);
} finally {
  for (const id of ownedIds) {
    try {
      const r = await api('/api/documents/' + id, 'DELETE');
      console.log(JSON.stringify({ check: 'cleanup-test-document', status: r.status }));
      if (!r.ok) process.exitCode = 1;
    } catch { process.exitCode = 1; }
  }
  console.log(JSON.stringify({ summary: true, checks: results.length, passed: results.filter(r => r.passed).length, base }));
}
function recordFailure(error) {
  console.error(JSON.stringify({ check: 'smoke-failure', message: error.message }));
  process.exitCode = 1;
}
