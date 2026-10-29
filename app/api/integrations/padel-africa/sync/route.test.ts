import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { POST } from './route';

vi.mock('@/lib/api-auth', () => ({
  requireApiKey: vi.fn(),
}));

vi.mock('@/lib/mongodb', () => ({
  isMongoConfigured: vi.fn().mockReturnValue(true),
  getClientPromise: vi.fn().mockResolvedValue({
    db: vi.fn().mockReturnValue({}),
  }),
}));

vi.mock('@/lib/padel-sync-service', () => ({
  syncPadelListingsToLeads: vi.fn(),
}));

describe('POST /api/integrations/padel-africa/sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects unauthorized requests with 401', async () => {
    const { requireApiKey } = await import('@/lib/api-auth');
    (requireApiKey as any).mockReturnValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));

    const req = new NextRequest('http://localhost:3000/api/integrations/padel-africa/sync', {
      method: 'POST',
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('Unauthorized');
  });

  it('executes sync and returns sync statistics when authorized', async () => {
    const { requireApiKey } = await import('@/lib/api-auth');
    (requireApiKey as any).mockReturnValue(null);

    const { syncPadelListingsToLeads } = await import('@/lib/padel-sync-service');
    (syncPadelListingsToLeads as any).mockResolvedValue({
      ok: true,
      totalFound: 940,
      inserted: 5,
      updated: 935,
      errors: [],
    });

    const req = new NextRequest('http://localhost:3000/api/integrations/padel-africa/sync', {
      method: 'POST',
      headers: {
        'x-api-key': 'valid-api-key',
      },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.totalFound).toBe(940);
    expect(body.inserted).toBe(5);
    expect(body.updated).toBe(935);
  });
});
