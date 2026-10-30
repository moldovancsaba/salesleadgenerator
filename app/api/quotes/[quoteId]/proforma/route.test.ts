import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';

vi.mock('@/lib/require-brand-access-api', () => ({
  requireBrandAccessApi: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/app/lib/brand', () => ({
  resolveBrand: vi.fn().mockResolvedValue('cogmap'),
}));

vi.mock('@/lib/mongodb', () => ({
  isMongoConfigured: vi.fn().mockReturnValue(true),
  getClientPromise: vi.fn().mockResolvedValue({
    db: vi.fn().mockReturnValue({}),
  }),
}));

vi.mock('@/lib/szamlazz-service', () => ({
  issueProformaForQuote: vi.fn().mockResolvedValue({
    ok: true,
    invoiceNumber: 'DIJ-2026-999',
  }),
}));

describe('POST /api/quotes/[quoteId]/proforma', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('issues proforma for signed quote and returns invoiceNumber', async () => {
    const req = new NextRequest('http://localhost:3000/api/quotes/q-123/proforma?brand=cogmap', {
      method: 'POST',
    });

    const res = await POST(req, { params: Promise.resolve({ quoteId: 'q-123' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.invoiceNumber).toBe('DIJ-2026-999');
  });
});
