import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import { NextRequest } from 'next/server';
import type { Db } from 'mongodb';
import { startTestMongo, stopTestMongo } from './helpers/mongo-test-server';
import { buildApiRequest } from './helpers/api-request';

// Issue #227 — GET (every mode) and POST /api/outreach-templates are
// brand-gated (requireBrandAccessApi) and store/query templates under the
// resolved brand slug, never a raw ?brand= value or a 'default' fallback.

let mongod: MongoMemoryServer;
let templatesGET: typeof import('../../app/api/outreach-templates/route').GET;
let templatesPOST: typeof import('../../app/api/outreach-templates/route').POST;
let createApiKey: typeof import('../../app/lib/api-key-store').createApiKey;
let db: Db;

beforeAll(async () => {
  mongod = await startTestMongo();
  const mod = await import('../../app/api/outreach-templates/route');
  templatesGET = mod.GET;
  templatesPOST = mod.POST;
  createApiKey = (await import('../../app/lib/api-key-store')).createApiKey;
  db = (await (await import('../../lib/mongodb')).getClientPromise()).db();
}, 60000);

afterAll(async () => {
  await stopTestMongo(mongod);
});

function templatePayload(overrides: Record<string, any> = {}) {
  return {
    name: 'Intro email',
    channel: 'email',
    industry: 'sports',
    subject: 'Hello {entity_name}',
    body: 'Hi {contact_name}, reaching out.',
    variables: ['entity_name', 'contact_name'],
    tags: ['intro'],
    ...overrides,
  };
}

function post(url: string, body: Record<string, any>, headers: Record<string, string> = {}) {
  return buildApiRequest(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

async function seyuScopedKey(): Promise<string> {
  const { rawKey } = await createApiKey(db, { name: 'seyu-only', brand: 'seyu', scopes: ['read-write'] }, 'integration-test');
  return rawKey;
}

describe('GET /api/outreach-templates', () => {
  it.each(['', '&mode=analytics', '&mode=search&q=intro'])('rejects a request with no credential (401)%s', async (suffix) => {
    const res = await templatesGET(new NextRequest(`http://localhost/api/outreach-templates?brand=cogmap${suffix}`));
    expect(res.status).toBe(401);
  });

  it('400s on an unknown brand', async () => {
    const res = await templatesGET(buildApiRequest('/api/outreach-templates?brand=not-a-brand'));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Invalid brand');
  });

  it('403s a scoped key issued for a different brand', async () => {
    const res = await templatesGET(buildApiRequest('/api/outreach-templates?brand=cogmap&mode=analytics', {
      headers: { 'x-api-key': await seyuScopedKey() },
    }));
    expect(res.status).toBe(403);
  });
});

describe('POST /api/outreach-templates', () => {
  it('rejects a request with no credential (401)', async () => {
    const res = await templatesPOST(new NextRequest('http://localhost/api/outreach-templates?brand=cogmap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(templatePayload()),
    }));
    expect(res.status).toBe(401);
  });

  it('400s on an unknown brand', async () => {
    const res = await templatesPOST(post('/api/outreach-templates?brand=not-a-brand', templatePayload()));
    expect(res.status).toBe(400);
  });

  it('403s a scoped key issued for a different brand', async () => {
    const res = await templatesPOST(post('/api/outreach-templates?brand=cogmap', templatePayload(), { 'x-api-key': await seyuScopedKey() }));
    expect(res.status).toBe(403);
  });

  it('400s when the body brand names a different brand than ?brand=', async () => {
    const res = await templatesPOST(post('/api/outreach-templates?brand=cogmap', templatePayload({ brand: 'seyu' })));
    expect(res.status).toBe(400);
  });

  it('stores under the canonical slug and is readable only under that brand', async () => {
    const created = await templatesPOST(post('/api/outreach-templates?brand=cogmapsales&tenantId=default', templatePayload({
      name: 'Alias Stored Template',
      brand: 'cogmap',
    })));
    expect(created.status).toBe(201);
    const createdBody = await created.json();
    expect(createdBody.brand).toBe('cogmap');

    const cogmapRes = await templatesGET(buildApiRequest('/api/outreach-templates?brand=cogmap&tenantId=default'));
    expect(cogmapRes.status).toBe(200);
    const cogmapBody = await cogmapRes.json();
    expect(cogmapBody.source).toBe('mongodb');
    expect(cogmapBody.templates.map((t: any) => t.name)).toContain('Alias Stored Template');

    const seyuRes = await templatesGET(buildApiRequest('/api/outreach-templates?brand=seyu&tenantId=default'));
    const seyuBody = await seyuRes.json();
    expect(seyuBody.templates.map((t: any) => t.name)).not.toContain('Alias Stored Template');

    const searchRes = await templatesGET(buildApiRequest('/api/outreach-templates?brand=cogmap&mode=search&q=Alias'));
    expect(searchRes.status).toBe(200);
    expect((await searchRes.json()).templates.map((t: any) => t.name)).toContain('Alias Stored Template');
  });
});
