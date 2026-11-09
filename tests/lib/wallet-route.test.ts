import { describe, it, expect } from 'vitest';
import { POST } from '@/app/api/wallet/pass/route';
import { NextRequest } from 'next/server';

describe('POST /api/wallet/pass', () => {
  it('returns 501 with clear instructions when Apple credentials are not configured', async () => {
    delete process.env.APPLE_PASS_TYPE_IDENTIFIER;
    delete process.env.APPLE_SIGNER_CERT;

    const req = new NextRequest('http://localhost:3000/api/wallet/pass', {
      method: 'POST',
      body: JSON.stringify({
        name: 'John Smith',
        eventName: 'Grand Slam of Darts',
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(501);
    const json = await res.json();
    expect(json.configured).toBe(false);
    expect(json.instructions).toContain('APPLE_PASS_TYPE_IDENTIFIER');
  });
});
