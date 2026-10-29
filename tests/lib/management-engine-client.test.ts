import { describe, it, expect, vi } from 'vitest';
import { ManagementEngineClient } from '../../lib/management-engine-client';

describe('ManagementEngineClient', () => {
  it('validates presence of listingId and non-empty patch', async () => {
    const client = new ManagementEngineClient();
    const res1 = await client.patchListing('', { phone: '+27123456789' });
    expect(res1.ok).toBe(false);
    expect(res1.error).toContain('listingId is required');

    const res2 = await client.patchListing('l-padel-1', {});
    expect(res2.ok).toBe(false);
    expect(res2.error).toContain('patch object cannot be empty');
  });

  it('sends well-formed payload to /api/ingest with api key header', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ outcome: 'patched', cardId: 'c-123' }),
    });

    const client = new ManagementEngineClient({
      baseUrl: 'https://padel-africa.doneisbetter.com',
      apiKey: 'test-ingest-key',
      fetchFn: mockFetch as any,
    });

    const result = await client.patchListing('l-padel-001', {
      phone: '+27110001111',
      website: 'https://testclub.co.za',
    });

    expect(result.ok).toBe(true);
    expect(result.outcome).toBe('patched');
    expect(result.listingId).toBe('l-padel-001');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('https://padel-africa.doneisbetter.com/api/ingest');
    expect(init.method).toBe('POST');
    expect(init.headers['x-api-key']).toBe('test-ingest-key');
    const parsedBody = JSON.parse(init.body);
    expect(parsedBody.id).toBe('l-padel-001');
    expect(parsedBody.sourcePool).toBe('ingest');
    expect(parsedBody.patch.phone).toBe('+27110001111');
    expect(parsedBody.patch.website).toBe('https://testclub.co.za');
  });

  it('handles HTTP error responses from management engine gracefully', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      json: async () => ({ error: 'Invalid phone format for country ZA' }),
    });

    const client = new ManagementEngineClient({
      baseUrl: 'https://padel-africa.doneisbetter.com',
      apiKey: 'test-key',
      fetchFn: mockFetch as any,
    });

    const result = await client.patchListing('l-padel-001', { phone: '123' });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Invalid phone format for country ZA');
  });
});
