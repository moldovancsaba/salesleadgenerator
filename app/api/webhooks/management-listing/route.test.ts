import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';

const mockLeadsCollection = {
  findOne: vi.fn(),
  find: vi.fn(),
  insertOne: vi.fn(),
  updateOne: vi.fn(),
};

vi.mock('@/lib/mongodb', () => ({
  isMongoConfigured: vi.fn().mockReturnValue(true),
  getClientPromise: vi.fn().mockImplementation(async () => ({
    db: vi.fn().mockReturnValue({
      collection: vi.fn().mockReturnValue(mockLeadsCollection),
    }),
  })),
}));

describe('POST /api/webhooks/management-listing (Issue 302)', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockLeadsCollection.findOne.mockResolvedValue(null);
    mockLeadsCollection.find.mockReturnValue({
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([{ id: 100 }]),
      }),
    });
    mockLeadsCollection.insertOne.mockResolvedValue({ insertedId: 'new-lead-id' });
    mockLeadsCollection.updateOne.mockResolvedValue({ modifiedCount: 1 });
  });

  it('rejects invalid payload without listing.id with 400', async () => {
    const req = new NextRequest('http://localhost:3000/api/webhooks/management-listing', {
      method: 'POST',
      body: JSON.stringify({ event: 'listing.published' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('missing listing.id');
  });

  it('inserts new lead on published listing event', async () => {
    const payload = {
      event: 'listing.published',
      vertical: 'padel-africa',
      listing: {
        id: 'l-zaf-padel-99',
        name: 'Durban Padel Oasis',
        phone: '+27310001111',
        website: 'https://durbanpadel.co.za',
        venue: {
          address: {
            countryCode: 'ZA',
            locality: 'Durban',
          },
        },
      },
    };

    const req = new NextRequest('http://localhost:3000/api/webhooks/management-listing', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.action).toBe('inserted');
    expect(data.listingId).toBe('l-zaf-padel-99');
    expect(mockLeadsCollection.insertOne).toHaveBeenCalledTimes(1);
  });

  it('updates existing lead when listing already exists', async () => {
    mockLeadsCollection.findOne.mockResolvedValue({
      _id: 'existing-mongo-id',
      externalSource: { listingId: 'l-zaf-padel-99' },
    });

    const payload = {
      event: 'listing.updated',
      vertical: 'padel-africa',
      listing: {
        id: 'l-zaf-padel-99',
        name: 'Durban Padel Oasis (Updated)',
        phone: '+27310001111',
      },
    };

    const req = new NextRequest('http://localhost:3000/api/webhooks/management-listing', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.action).toBe('updated');
    expect(mockLeadsCollection.updateOne).toHaveBeenCalledTimes(1);
  });
});
