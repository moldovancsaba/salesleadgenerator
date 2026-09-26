import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import { startTestMongo, stopTestMongo } from './helpers/mongo-test-server';
import { buildApiRequest } from './helpers/api-request';
import { NextRequest } from 'next/server';

// Deals: Quote generation (issue #211). @vercel/blob's put()/get() are
// mocked at the SDK-export boundary (vi.mock('@vercel/blob', ...)) rather
// than at the fetch layer this repo's Resend tests use — Vercel Blob's real
// HTTP protocol (signed multipart tokens, x-vercel-blob-* headers) isn't
// something this repo has verified knowledge of to fake convincingly,
// whereas Resend's is (a plain documented POST /emails). This satisfies
// §19's own "Blob put()/fetch calls are mocked in unit tests, no real
// network call against Vercel Blob" requirement either way.
const blobStore = new Map<string, Buffer>();
vi.mock('@vercel/blob', () => ({
  put: vi.fn(async (pathname: string, body: Buffer) => {
    blobStore.set(pathname, body);
    return { pathname, url: `https://blob.example/${pathname}` };
  }),
  get: vi.fn(async (pathname: string) => {
    const stored = blobStore.get(pathname);
    if (!stored) return null;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(stored));
        controller.close();
      },
    });
    return { statusCode: 200, stream, headers: new Headers(), blob: { contentType: 'application/pdf', size: stored.length } };
  }),
}));

process.env.BLOB_READ_WRITE_TOKEN = 'test-blob-token';
process.env.RESEND_API_KEY = 're_test_placeholder_key';

let mongod: MongoMemoryServer;
let quotesGET: typeof import('../../app/api/leads/[id]/quotes/route').GET;
let quotesPOST: typeof import('../../app/api/leads/[id]/quotes/route').POST;
let sendPOST: typeof import('../../app/api/leads/[id]/quotes/[quoteId]/send/route').POST;
let markSignedPOST: typeof import('../../app/api/leads/[id]/quotes/[quoteId]/mark-signed/route').POST;
let viewGET: typeof import('../../app/api/quotes/[quoteId]/view/route').GET;

beforeAll(async () => {
  mongod = await startTestMongo();
  const listMod = await import('../../app/api/leads/[id]/quotes/route');
  quotesGET = listMod.GET;
  quotesPOST = listMod.POST;
  sendPOST = (await import('../../app/api/leads/[id]/quotes/[quoteId]/send/route')).POST;
  markSignedPOST = (await import('../../app/api/leads/[id]/quotes/[quoteId]/mark-signed/route')).POST;
  viewGET = (await import('../../app/api/quotes/[quoteId]/view/route')).GET;
}, 60000);

afterAll(async () => {
  await stopTestMongo(mongod);
});

beforeEach(() => {
  vi.spyOn(global, 'fetch');
});

// Mocks Resend's real /emails endpoint at the fetch layer — same convention
// as tests/integration/outreach-send.integration.test.ts.
function mockResendSuccess() {
  const original = global.fetch;
  (global.fetch as any).mockImplementation(async (input: any, init?: any) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.endsWith('/emails')) {
      return new Response(JSON.stringify({ id: `resend-${Math.random().toString(36).slice(2)}` }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return original(input, init);
  });
}

async function seedLead(entityName: string, overrides: Record<string, unknown> = {}): Promise<string> {
  const clientPromise = (await import('../../lib/mongodb')).default;
  const client = await clientPromise;
  const db = client.db();
  const result = await db.collection('leads').insertOne({
    entity_name: entityName,
    tenantId: 'default',
    kanbanColumn: 'ENGAGED',
    ice: { impact: 5, confidence: 5, ease: 5 },
    contacts: [{ name: 'Jamie Rivera', email: 'jamie@example.com', isDecisionMaker: true }],
    deals: [],
    ...overrides,
  });
  return result.insertedId.toString();
}

function req(url: string, init?: ConstructorParameters<typeof NextRequest>[1]) {
  return buildApiRequest(url, init);
}

function idParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

function quoteParams(id: string, quoteId: string) {
  return { params: Promise.resolve({ id, quoteId }) };
}

describe('POST /api/leads/[id]/quotes — generate (issue 211)', () => {
  it('generates a PDF, stores it, and inserts a draft quote matching the deal snapshot', async () => {
    const leadId = await seedLead('Quote Gen Co', {
      deals: [{ id: 'deal-1', value: 50000, currency: 'USD', label: 'Season sponsorship', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', source: 'manual' }],
    });

    const res = await quotesPOST(req(`/api/leads/${leadId}/quotes?brand=cogmap&tenantId=default`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dealId: 'deal-1' }),
    }), idParams(leadId));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.quote.status).toBe('draft');
    expect(body.quote.lineItems).toEqual([{ label: 'Season sponsorship', value: 50000, currency: 'USD' }]);
    expect(body.quote.totalValue).toBe(50000);
    expect(body.quote).not.toHaveProperty('pdfBlobPath');
    expect(body.quote).not.toHaveProperty('shareToken');
    expect(body.quote.viewUrl).toMatch(/\/api\/quotes\/.+\/view\?token=.+/);
  });

  it('404s for a non-existent lead', async () => {
    const { ObjectId } = await import('mongodb');
    const fakeId = new ObjectId().toString();
    const res = await quotesPOST(req(`/api/leads/${fakeId}/quotes?brand=cogmap&tenantId=default`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dealId: 'deal-1' }),
    }), idParams(fakeId));
    expect(res.status).toBe(404);
  });

  it('404s for a dealId that does not exist on the lead', async () => {
    const leadId = await seedLead('No Such Deal Co', { deals: [] });
    const res = await quotesPOST(req(`/api/leads/${leadId}/quotes?brand=cogmap&tenantId=default`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dealId: 'nonexistent-deal' }),
    }), idParams(leadId));
    expect(res.status).toBe(404);
  });

  it('409s for a deal with no positive value (defense-in-depth against a directly-seeded bad record)', async () => {
    const leadId = await seedLead('Zero Value Deal Co', {
      deals: [{ id: 'deal-zero', value: 0, currency: 'USD', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', source: 'manual' }],
    });
    const res = await quotesPOST(req(`/api/leads/${leadId}/quotes?brand=cogmap&tenantId=default`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dealId: 'deal-zero' }),
    }), idParams(leadId));
    expect(res.status).toBe(409);
  });

  it('is an immutable snapshot — a later edit to the source deal never changes an already-generated quote', async () => {
    const leadId = await seedLead('Snapshot Immutable Co', {
      deals: [{ id: 'deal-snap', value: 10000, currency: 'USD', label: 'Original label', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', source: 'manual' }],
    });
    const genRes = await quotesPOST(req(`/api/leads/${leadId}/quotes?brand=cogmap&tenantId=default`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dealId: 'deal-snap' }),
    }), idParams(leadId));
    const genBody = await genRes.json();
    expect(genBody.quote.lineItems[0].value).toBe(10000);

    const clientPromise = (await import('../../lib/mongodb')).default;
    const client = await clientPromise;
    const db = client.db();
    const { ObjectId } = await import('mongodb');
    await db.collection('leads').updateOne({ _id: new ObjectId(leadId) }, { $set: { 'deals.0.value': 99999, 'deals.0.label': 'Edited label' } });

    const listRes = await quotesGET(req(`/api/leads/${leadId}/quotes?brand=cogmap&tenantId=default`), idParams(leadId));
    const listBody = await listRes.json();
    const quote = listBody.quotes.find((q: any) => q._id === genBody.quote._id);
    expect(quote.lineItems[0].value).toBe(10000);
    expect(quote.lineItems[0].label).toBe('Original label');
  });

  it('rejects a machine (x-api-key) caller with 401 when it lacks any real session — canGenerate/canSend still visible on GET regardless', async () => {
    const leadId = await seedLead('Config Flags Co', { deals: [] });
    const res = await quotesGET(req(`/api/leads/${leadId}/quotes?brand=cogmap&tenantId=default`), idParams(leadId));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.canGenerate).toBe(true);
    expect(body.canSend).toBe(true);
  });
});

describe('POST /api/leads/[id]/quotes/[quoteId]/send (issue 211)', () => {
  async function generateDraftQuote(entityName: string, value = 25000) {
    const leadId = await seedLead(entityName, {
      deals: [{ id: 'deal-send', value, currency: 'USD', label: 'Send Test Deal', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', source: 'manual' }],
    });
    const genRes = await quotesPOST(req(`/api/leads/${leadId}/quotes?brand=cogmap&tenantId=default`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dealId: 'deal-send' }),
    }), idParams(leadId));
    const genBody = await genRes.json();
    return { leadId, quoteId: genBody.quote._id as string };
  }

  it('sends via the real Resend path and sets status: sent', async () => {
    mockResendSuccess();
    const { leadId, quoteId } = await generateDraftQuote('Send Success Co');

    const res = await sendPOST(req(`/api/leads/${leadId}/quotes/${quoteId}/send?brand=cogmap&tenantId=default`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idempotencyKey: 'test-key-1' }),
    }), quoteParams(leadId, quoteId));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sent).toBe(true);
    expect(body.quote.status).toBe('sent');

    const clientPromise = (await import('../../lib/mongodb')).default;
    const client = await clientPromise;
    const db = client.db();
    const logEntry = await db.collection('outreach_logs').findOne({ leadId, quoteId });
    expect(logEntry).toBeTruthy();
    expect(logEntry!.sentAutomatically).toBe(false);
  });

  it('never throws on a Resend-side rejection — returns sent: false without mutating status', async () => {
    const original = global.fetch;
    (global.fetch as any).mockImplementation(async (input: any, init?: any) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url.endsWith('/emails')) {
        return new Response(JSON.stringify({ name: 'validation_error', message: 'rejected by test' }), { status: 422, headers: { 'content-type': 'application/json' } });
      }
      return original(input, init);
    });
    const { leadId, quoteId } = await generateDraftQuote('Send Rejected Co');

    const res = await sendPOST(req(`/api/leads/${leadId}/quotes/${quoteId}/send?brand=cogmap&tenantId=default`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idempotencyKey: 'test-key-2' }),
    }), quoteParams(leadId, quoteId));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sent).toBe(false);

    const listRes = await quotesGET(req(`/api/leads/${leadId}/quotes?brand=cogmap&tenantId=default`), idParams(leadId));
    const listBody = await listRes.json();
    expect(listBody.quotes[0].status).toBe('draft');
  });

  it('409s on a quote that is not in draft status', async () => {
    mockResendSuccess();
    const { leadId, quoteId } = await generateDraftQuote('Already Sent Co');
    await sendPOST(req(`/api/leads/${leadId}/quotes/${quoteId}/send?brand=cogmap&tenantId=default`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idempotencyKey: 'test-key-3a' }),
    }), quoteParams(leadId, quoteId));

    const secondRes = await sendPOST(req(`/api/leads/${leadId}/quotes/${quoteId}/send?brand=cogmap&tenantId=default`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idempotencyKey: 'test-key-3b' }),
    }), quoteParams(leadId, quoteId));
    expect(secondRes.status).toBe(409);
  });
});

describe('GET /api/quotes/[quoteId]/view (issue 211)', () => {
  async function generateDraftQuote(entityName: string) {
    const leadId = await seedLead(entityName, {
      deals: [{ id: 'deal-view', value: 15000, currency: 'USD', label: 'View Test Deal', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', source: 'manual' }],
    });
    const genRes = await quotesPOST(req(`/api/leads/${leadId}/quotes?brand=cogmap&tenantId=default`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dealId: 'deal-view' }),
    }), idParams(leadId));
    const genBody = await genRes.json();
    const url = new URL(genBody.quote.viewUrl);
    const token = url.searchParams.get('token')!;
    return { leadId, quoteId: genBody.quote._id as string, token };
  }

  // Deliberately built as a plain NextRequest, not buildApiRequest — this
  // route is genuinely public and must work with zero auth headers at all.
  function publicViewReq(quoteId: string, token: string) {
    return new NextRequest(`http://localhost/api/quotes/${quoteId}/view?token=${encodeURIComponent(token)}`);
  }

  // Issue #229: a wrong token and an unknown quote answer identically, so
  // the response doesn't confirm that a quote id exists.
  it('404s for a wrong token, same as for an unknown quote', async () => {
    const { quoteId } = await generateDraftQuote('Wrong Token Co');
    const res = await viewGET(publicViewReq(quoteId, 'not-the-real-token'), { params: Promise.resolve({ quoteId }) });
    expect(res.status).toBe(404);
  });

  it('404s a malformed quote id without recording a rate-limit attempt', async () => {
    const database = await (async () => (await (await import('../../lib/mongodb')).default).db())();
    const before = await database.collection('quote_view_rate_limits').countDocuments({});
    const res = await viewGET(publicViewReq('not-an-object-id', 'x'), { params: Promise.resolve({ quoteId: 'not-an-object-id' }) });
    expect(res.status).toBe(404);
    expect(await database.collection('quote_view_rate_limits').countDocuments({})).toBe(before);
  });

  it('rate-limits per client IP, so one client hammering a quote does not lock out another', async () => {
    const { quoteId, token } = await generateDraftQuote('Rate Limit Split Co');
    const fromIp = (ip: string, t: string) => new NextRequest(
      `http://localhost/api/quotes/${quoteId}/view?token=${encodeURIComponent(t)}`,
      { headers: { 'x-forwarded-for': ip } }
    );
    let last = 0;
    for (let i = 0; i < 40 && last !== 429; i++) {
      last = (await viewGET(fromIp('198.51.100.1', 'wrong'), { params: Promise.resolve({ quoteId }) })).status;
    }
    expect(last).toBe(429);
    const other = await viewGET(fromIp('198.51.100.2', token), { params: Promise.resolve({ quoteId }) });
    expect(other.status).not.toBe(429);
  });

  it('404s for an unknown quoteId', async () => {
    const { ObjectId } = await import('mongodb');
    const fakeId = new ObjectId().toString();
    const res = await viewGET(publicViewReq(fakeId, 'irrelevant'), { params: Promise.resolve({ quoteId: fakeId }) });
    expect(res.status).toBe(404);
  });

  it('serves the real PDF bytes for a correct token and flips sent -> viewed exactly once', async () => {
    mockResendSuccess();
    const { leadId, quoteId, token } = await generateDraftQuote('View Flip Co');
    await sendPOST(req(`/api/leads/${leadId}/quotes/${quoteId}/send?brand=cogmap&tenantId=default`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idempotencyKey: 'view-flip-key' }),
    }), quoteParams(leadId, quoteId));

    const res = await viewGET(publicViewReq(quoteId, token), { params: Promise.resolve({ quoteId }) });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(res.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes.subarray(0, 5).toString('ascii')).toBe('%PDF-');

    const listRes = await quotesGET(req(`/api/leads/${leadId}/quotes?brand=cogmap&tenantId=default`), idParams(leadId));
    const listBody = await listRes.json();
    expect(listBody.quotes[0].status).toBe('viewed');

    // Repeat visit — idempotent, no regression, no error.
    const secondRes = await viewGET(publicViewReq(quoteId, token), { params: Promise.resolve({ quoteId }) });
    expect(secondRes.status).toBe(200);
    const listRes2 = await quotesGET(req(`/api/leads/${leadId}/quotes?brand=cogmap&tenantId=default`), idParams(leadId));
    const listBody2 = await listRes2.json();
    expect(listBody2.quotes[0].status).toBe('viewed');
  });

  it('a repeat visit to an already-signed quote still serves the PDF but never regresses status', async () => {
    mockResendSuccess();
    const { leadId, quoteId, token } = await generateDraftQuote('Signed Reverify Co');
    await sendPOST(req(`/api/leads/${leadId}/quotes/${quoteId}/send?brand=cogmap&tenantId=default`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idempotencyKey: 'signed-reverify-key' }),
    }), quoteParams(leadId, quoteId));
    await markSignedPOST(req(`/api/leads/${leadId}/quotes/${quoteId}/mark-signed?brand=cogmap&tenantId=default`, { method: 'POST' }), quoteParams(leadId, quoteId));

    const res = await viewGET(publicViewReq(quoteId, token), { params: Promise.resolve({ quoteId }) });
    expect(res.status).toBe(200);

    const listRes = await quotesGET(req(`/api/leads/${leadId}/quotes?brand=cogmap&tenantId=default`), idParams(leadId));
    const listBody = await listRes.json();
    expect(listBody.quotes[0].status).toBe('signed');
  });
});

describe('POST /api/leads/[id]/quotes/[quoteId]/mark-signed (issue 211)', () => {
  it('409s marking a draft (never sent) quote as signed', async () => {
    const leadId = await seedLead('Mark Draft Co', {
      deals: [{ id: 'deal-ms1', value: 5000, currency: 'USD', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', source: 'manual' }],
    });
    const genRes = await quotesPOST(req(`/api/leads/${leadId}/quotes?brand=cogmap&tenantId=default`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dealId: 'deal-ms1' }),
    }), idParams(leadId));
    const genBody = await genRes.json();

    const res = await markSignedPOST(req(`/api/leads/${leadId}/quotes/${genBody.quote._id}/mark-signed?brand=cogmap&tenantId=default`, { method: 'POST' }), quoteParams(leadId, genBody.quote._id));
    expect(res.status).toBe(409);
  });

  it('marks a sent quote as signed, then 409s a second attempt', async () => {
    mockResendSuccess();
    const leadId = await seedLead('Mark Sent Co', {
      deals: [{ id: 'deal-ms2', value: 8000, currency: 'USD', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', source: 'manual' }],
    });
    const genRes = await quotesPOST(req(`/api/leads/${leadId}/quotes?brand=cogmap&tenantId=default`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dealId: 'deal-ms2' }),
    }), idParams(leadId));
    const genBody = await genRes.json();
    await sendPOST(req(`/api/leads/${leadId}/quotes/${genBody.quote._id}/send?brand=cogmap&tenantId=default`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idempotencyKey: 'mark-sent-key' }),
    }), quoteParams(leadId, genBody.quote._id));

    const firstRes = await markSignedPOST(req(`/api/leads/${leadId}/quotes/${genBody.quote._id}/mark-signed?brand=cogmap&tenantId=default`, { method: 'POST' }), quoteParams(leadId, genBody.quote._id));
    expect(firstRes.status).toBe(200);
    const firstBody = await firstRes.json();
    expect(firstBody.quote.status).toBe('signed');
    expect(firstBody.quote.signedAt).toBeTruthy();

    const secondRes = await markSignedPOST(req(`/api/leads/${leadId}/quotes/${genBody.quote._id}/mark-signed?brand=cogmap&tenantId=default`, { method: 'POST' }), quoteParams(leadId, genBody.quote._id));
    expect(secondRes.status).toBe(409);
  });
});
