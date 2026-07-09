import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/api/app.js';
import { db, closeDb } from '../src/shared/db.js';
import { closeRedis, redis } from '../src/shared/redis.js';
import { ensureUser, issueApiKey } from '../src/shared/api-keys.js';
import { propagateConfirmedFlag } from '../src/registry/propagation.js';

/**
 * Exercises the real HTTP layer against a live Postgres/Redis (see docker-compose.yml) rather
 * than mocking the DB — the two-person rule and auth middleware are exactly the kind of logic
 * that looks right in isolation and breaks on the actual request path.
 *
 * Requires `docker compose up -d` + `npm run migrate` first. Run via `npm run test:integration`.
 */

let app: FastifyInstance;
let reporterKey: string;
let analystAKey: string;
let analystBKey: string;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();

  const suffix = Math.random().toString(36).slice(2, 8);
  const reporter = await ensureUser(`reporter-${suffix}@test.dev`);
  const analystA = await ensureUser(`analyst-a-${suffix}@test.dev`);
  const analystB = await ensureUser(`analyst-b-${suffix}@test.dev`);

  reporterKey = (await issueApiKey(reporter, { scopes: ['registry:review'] })).rawKey;
  analystAKey = (await issueApiKey(analystA, { scopes: ['registry:review'] })).rawKey;
  analystBKey = (await issueApiKey(analystB, { scopes: ['registry:review'] })).rawKey;
});

afterAll(async () => {
  await app.close();
  await Promise.all([closeDb(), closeRedis()]);
});

describe('GET /health', () => {
  it('reports db and redis connectivity', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', db: true, redis: true });
  });
});

describe('POST /v1/scan', () => {
  it('scores an address with no history using neutral priors', async () => {
    const destination = `GUNKNOWN${Math.random().toString(36).slice(2, 10).toUpperCase()}`;

    const res = await app.inject({
      method: 'POST',
      url: '/v1/scan',
      payload: { destination },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.score).toBeCloseTo(64.5, 5);
    expect(body.verdict).toBe('caution');
  });

  it('caches the verdict in Redis on first computation', async () => {
    const destination = `GCACHE${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
    await app.inject({ method: 'POST', url: '/v1/scan', payload: { destination } });

    const cached = await redis.get(`scan:verdict:${destination}`);
    expect(cached).not.toBeNull();
    expect(JSON.parse(cached!).verdict).toBe('caution');
  });
});

describe('registry two-person rule', () => {
  it('enforces distinct reporter/endorser/confirmer and propagates on confirm', async () => {
    const target = `GBADACTOR${Math.random().toString(36).slice(2, 10).toUpperCase()}`;

    const fileRes = await app.inject({
      method: 'POST',
      url: '/v1/registry',
      headers: { 'x-api-key': reporterKey },
      payload: { targetAddress: target, category: 'phishing', evidence: { note: 'test' } },
    });
    expect(fileRes.statusCode).toBe(201);
    const reportId = fileRes.json().report.id;

    const selfEndorse = await app.inject({
      method: 'POST',
      url: `/v1/registry/${reportId}/endorse`,
      headers: { 'x-api-key': reporterKey },
    });
    expect(selfEndorse.statusCode).toBe(409);

    const endorse = await app.inject({
      method: 'POST',
      url: `/v1/registry/${reportId}/endorse`,
      headers: { 'x-api-key': analystAKey },
    });
    expect(endorse.statusCode).toBe(200);
    expect(endorse.json().report.status).toBe('endorsed');

    const sameAnalystConfirm = await app.inject({
      method: 'POST',
      url: `/v1/registry/${reportId}/confirm`,
      headers: { 'x-api-key': analystAKey },
    });
    expect(sameAnalystConfirm.statusCode).toBe(409);

    const confirm = await app.inject({
      method: 'POST',
      url: `/v1/registry/${reportId}/confirm`,
      headers: { 'x-api-key': analystBKey },
    });
    expect(confirm.statusCode).toBe(200);
    expect(confirm.json().report.status).toBe('confirmed');

    // Propagation normally runs via the registry-propagation queue worker (src/workers.ts);
    // invoked directly here so the test doesn't depend on a worker process being up.
    await propagateConfirmedFlag(reportId);

    const scan = await app.inject({
      method: 'POST',
      url: '/v1/scan',
      payload: { destination: target },
    });
    expect(scan.json()).toEqual({ verdict: 'danger', reasons: [`registry:phishing`] });
  });

  it('rejects unauthenticated report filing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/registry',
      payload: { targetAddress: 'GNOAUTH', category: 'other', evidence: {} },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('scoring reflects certification results', () => {
  it('a project with a failed static analysis scores lower than an uncertified address', async () => {
    const issuerAddress = `GPROJECT${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
    const [project] = await db('projects')
      .insert({ name: 'Test Project', issuer_address: issuerAddress })
      .returning('*');

    await db('certifications').insert({
      project_id: project.id,
      status: 'pending',
      checklist: JSON.stringify([
        { check: 'static_analysis', outcome: 'fail', details: 'test', checkedAt: new Date() },
      ]),
    });

    const res = await app.inject({ method: 'GET', url: `/v1/scores/${issuerAddress}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // contractVerified drags to 0 instead of the 50 neutral prior an unknown address gets.
    expect(body.signals.contractVerified).toBe(0);
    expect(body.score).toBeLessThan(64.5);
  });
});
