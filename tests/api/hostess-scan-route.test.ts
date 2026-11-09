import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '../../app/api/landing/[brand]/[campaign]/hostess-scan/route';
import { DEFAULT_HOSTESS_PASSWORD } from '../../lib/hostess-scan';

vi.mock('@/lib/mongodb', () => {
  return {
    isMongoConfigured: vi.fn(() => true),
    default: Promise.resolve({
      db: () => mockDb,
    }),
  };
});

vi.mock('@/app/lib/brand', () => ({
  resolveBrand: vi.fn(async (b: string) => (b === 'vegas' ? 'vegas' : null)),
  getBrandConfig: vi.fn(async (b: string) =>
    b === 'vegas'
      ? { label: 'Mr Vegas', dbCollection: 'leads_vegas' }
      : null
  ),
}));

vi.mock('@/app/lib/lead-actions', () => ({
  executeLeadAction: vi.fn(async ({ leadId, action, payload }) => ({
    success: true,
    lead: { _id: leadId, kanbanColumn: payload.kanbanColumn, tags: ['hostess-contacted', 'card-accepted'] },
  })),
}));

vi.mock('@/app/lib/activity-log-store', () => ({
  ACTIVITY_LOG_COLLECTION: 'activity_logs',
  ensureActivityLogIndexes: vi.fn(async () => {}),
}));

let mockCollection: any;
let mockDb: any;

beforeEach(() => {
  mockCollection = {
    findOne: vi.fn(),
    updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
    insertOne: vi.fn().mockResolvedValue({ insertedId: 'new-lead-id-123' }),
    countDocuments: vi.fn().mockResolvedValue(5),
  };

  mockDb = {
    collection: vi.fn(() => mockCollection),
  };
});

describe('POST /api/landing/[brand]/[campaign]/hostess-scan', () => {
  const params = Promise.resolve({ brand: 'vegas', campaign: 'grand-slam-of-darts' });

  it('rejects wrong password with 401', async () => {
    const req = new NextRequest('http://localhost/api/landing/vegas/grand-slam-of-darts/hostess-scan', {
      method: 'POST',
      body: JSON.stringify({
        password: 'wrongpassword',
        qrContent: 'BEGIN:VCARD\r\nFN:John\r\nEND:VCARD',
      }),
    });

    const res = await POST(req, { params });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('Invalid hostess password');
  });

  it('rejects missing qrContent with 400', async () => {
    const req = new NextRequest('http://localhost/api/landing/vegas/grand-slam-of-darts/hostess-scan', {
      method: 'POST',
      body: JSON.stringify({
        password: DEFAULT_HOSTESS_PASSWORD,
        qrContent: '',
      }),
    });

    const res = await POST(req, { params });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Missing QR code content');
  });

  it('moves existing lead to ENGAGED and adds hostess-contacted tags', async () => {
    mockCollection.findOne.mockResolvedValueOnce({
      _id: 'existing-id-1',
      entity_name: 'David Jones',
      contactEmails: ['david@dartsfan.com'],
      tags: ['grand-slam-of-darts'],
      kanbanColumn: 'DISCOVERED',
      notes: 'Initial entry note',
    });

    const vCardData = [
      'BEGIN:VCARD',
      'VERSION:3.0',
      'FN:David Jones',
      'EMAIL;TYPE=INTERNET:david@dartsfan.com',
      'TEL;TYPE=CELL:+44 7999 123456',
      'END:VCARD',
    ].join('\r\n');

    const req = new NextRequest('http://localhost/api/landing/vegas/grand-slam-of-darts/hostess-scan', {
      method: 'POST',
      body: JSON.stringify({
        password: DEFAULT_HOSTESS_PASSWORD,
        qrContent: vCardData,
        hostessNote: 'Met at hall entrance',
      }),
    });

    const res = await POST(req, { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.lead.kanbanColumn).toBe('ENGAGED');
    expect(mockCollection.updateOne).toHaveBeenCalled();
  });

  it('creates new lead in ENGAGED column when not found previously', async () => {
    mockCollection.findOne.mockResolvedValueOnce(null);

    const vCardData = [
      'BEGIN:VCARD',
      'VERSION:3.0',
      'FN:Sarah Connor',
      'EMAIL;TYPE=INTERNET:sarah@future.com',
      'TEL;TYPE=CELL:+44 7888 654321',
      'END:VCARD',
    ].join('\r\n');

    const req = new NextRequest('http://localhost/api/landing/vegas/grand-slam-of-darts/hostess-scan', {
      method: 'POST',
      body: JSON.stringify({
        password: DEFAULT_HOSTESS_PASSWORD,
        qrContent: vCardData,
      }),
    });

    const res = await POST(req, { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.lead.kanbanColumn).toBe('ENGAGED');
    expect(mockCollection.insertOne).toHaveBeenCalled();
  });
});
