import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/session', () => ({
  resolveSessionFromIdToken: vi.fn(),
}));

import { GET } from '../../app/api/release-notes/route';
import { resolveSessionFromIdToken } from '@/lib/session';

describe('GET /api/release-notes (issue 269)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (resolveSessionFromIdToken as any).mockResolvedValue({
      email: 'user@example.com',
      sub: 'usr-123',
    });
  });

  it('rejects unauthenticated requests with 401', async () => {
    (resolveSessionFromIdToken as any).mockResolvedValue(null);
    const req = new NextRequest('http://localhost:3000/api/release-notes?limit=10&offset=0');
    const res = await GET(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('Unauthorized');
  });

  it('returns paginated release notes with latest metadata', async () => {
    const req = new NextRequest('http://localhost:3000/api/release-notes?limit=10&offset=0');
    const res = await GET(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.notes).toHaveLength(10);
    expect(body.total).toBeGreaterThan(300);
    expect(body.hasMore).toBe(true);
    expect(body.latestVersion).toBeDefined();
    expect(body.latestDate).toBeDefined();
  });

  it('filters by category and query', async () => {
    const req = new NextRequest('http://localhost:3000/api/release-notes?category=security&limit=5');
    const res = await GET(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.notes.length).toBeGreaterThan(0);
    for (const note of body.notes) {
      expect(note.securityCount).toBeGreaterThan(0);
    }
  });

  it('retrieves a single release note by version', async () => {
    const req = new NextRequest('http://localhost:3000/api/release-notes?version=2.4.323');
    const res = await GET(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.note).toBeDefined();
    expect(body.note.version).toBe('2.4.323');
    expect(body.note.items.length).toBeGreaterThan(0);
  });

  it('returns 404 for non-existent version', async () => {
    const req = new NextRequest('http://localhost:3000/api/release-notes?version=99.99.99');
    const res = await GET(req);
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.error).toBe('Release note not found');
  });
});
