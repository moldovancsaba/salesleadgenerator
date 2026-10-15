import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/session', () => ({
  resolveSessionFromIdToken: vi.fn(),
}));

vi.mock('@/lib/mongodb', () => ({
  default: Promise.resolve({
    db: () => ({}),
  }),
  isMongoConfigured: vi.fn(() => true),
}));

vi.mock('@/app/lib/gmail-sync-store', () => ({
  pollUserGmail: vi.fn(),
}));

import { resolveSessionFromIdToken } from '@/lib/session';
import { isMongoConfigured } from '@/lib/mongodb';
import { pollUserGmail } from '@/app/lib/gmail-sync-store';
import { POST } from '@/app/api/user/integrations/[provider]/sync/route';

describe('POST /api/user/integrations/[provider]/sync (issue 249)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isMongoConfigured).mockReturnValue(true);
  });

  it('rejects unknown provider with 400', async () => {
    const req = new NextRequest('http://localhost/api/user/integrations/unknown/sync', { method: 'POST' });
    const res = await POST(req, { params: Promise.resolve({ provider: 'unknown' }) });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('Unknown provider');
  });

  it('rejects unauthenticated request with 401', async () => {
    vi.mocked(resolveSessionFromIdToken).mockResolvedValue(null);
    const req = new NextRequest('http://localhost/api/user/integrations/gmail/sync', { method: 'POST' });
    const res = await POST(req, { params: Promise.resolve({ provider: 'gmail' }) });
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toBe('Not authenticated');
  });

  it('rejects unsupported provider with 400 when authenticated', async () => {
    vi.mocked(resolveSessionFromIdToken).mockResolvedValue({ sub: 'user_1', email: 'user@example.com' } as any);
    const req = new NextRequest('http://localhost/api/user/integrations/google_calendar/sync', { method: 'POST' });
    const res = await POST(req, { params: Promise.resolve({ provider: 'google_calendar' }) });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('Sync not supported for this provider');
  });

  it('returns sync counts on success for authenticated Gmail sync', async () => {
    vi.mocked(resolveSessionFromIdToken).mockResolvedValue({ sub: 'user_1', email: 'user@example.com' } as any);
    vi.mocked(pollUserGmail).mockResolvedValue({ ingested: 2, skipped: 5 });

    const req = new NextRequest('http://localhost/api/user/integrations/gmail/sync?brand=cogmap', { method: 'POST' });
    const res = await POST(req, { params: Promise.resolve({ provider: 'gmail' }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.ingested).toBe(2);
    expect(data.skipped).toBe(5);
  });

  it('returns 400 when pollUserGmail reports failure without any processed messages', async () => {
    vi.mocked(resolveSessionFromIdToken).mockResolvedValue({ sub: 'user_1', email: 'user@example.com' } as any);
    vi.mocked(pollUserGmail).mockResolvedValue({ ingested: 0, skipped: 0, failure: 'no_active_connection' });

    const req = new NextRequest('http://localhost/api/user/integrations/gmail/sync?brand=cogmap', { method: 'POST' });
    const res = await POST(req, { params: Promise.resolve({ provider: 'gmail' }) });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.ok).toBe(false);
    expect(data.error).toBe('no_active_connection');
  });
});
