import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '../../app/api/landing/[brand]/[campaign]/hostess-scan/route';
import { DEFAULT_HOSTESS_PASSWORD } from '../../lib/hostess-scan';
import { DEFAULT_SCANNER_CONFIG, DEFAULT_VEGAS_CAMPAIGN, type LandingPageRecord } from '../../lib/landing-page-schema';

vi.mock('@/lib/mongodb', () => ({
  isMongoConfigured: vi.fn(() => true),
  default: Promise.resolve({ db: () => mockDb }),
}));

vi.mock('@/app/lib/brand', () => ({
  resolveBrand: vi.fn(async (b: string) => (b === 'vegas' ? 'vegas' : null)),
  getBrandConfig: vi.fn(async (b: string) => (b === 'vegas' ? { label: 'Mr Vegas', dbCollection: 'leads_vegas' } : null)),
}));

const pages: Record<string, LandingPageRecord | null> = {};
vi.mock('@/lib/landing-page-store', () => ({
  getLandingPageBySlug: vi.fn(async (brand: string, slug: string) => pages[`${brand}/${slug}`] ?? null),
}));

vi.mock('@/app/lib/lead-actions', () => ({
  executeLeadAction: vi.fn(async ({ leadId, payload }) => ({
    success: true,
    lead: { _id: leadId, kanbanColumn: payload.kanbanColumn, tags: ['moved'] },
  })),
}));

vi.mock('@/app/lib/activity-log-store', () => ({
  ACTIVITY_LOG_COLLECTION: 'activity_logs',
  ensureActivityLogIndexes: vi.fn(async () => {}),
}));

import { executeLeadAction } from '@/app/lib/lead-actions';

let mockCollection: any;
let mockDb: any;
let caller = 0;

function page(campaign: string, scanner: Partial<LandingPageRecord['scanner']> | null): LandingPageRecord {
  return {
    ...DEFAULT_VEGAS_CAMPAIGN,
    slug: campaign,
    scanner: scanner === null ? undefined : { ...DEFAULT_SCANNER_CONFIG, ...scanner },
  } as LandingPageRecord;
}

function post(campaign: string, body: Record<string, unknown>) {
  caller += 1;
  const req = new NextRequest(`http://localhost/api/landing/vegas/${campaign}/hostess-scan`, {
    method: 'POST',
    headers: { 'x-forwarded-for': `10.0.0.${caller}` },
    body: JSON.stringify(body),
  });
  return POST(req, { params: Promise.resolve({ brand: 'vegas', campaign }) });
}

const badge = (name: string, email: string) =>
  ['BEGIN:VCARD', 'VERSION:3.0', `FN:${name}`, `EMAIL;TYPE=INTERNET:${email}`, 'TEL;TYPE=CELL:+44 7999 123456', 'END:VCARD'].join('\r\n');

beforeEach(() => {
  vi.mocked(executeLeadAction).mockClear();
  for (const key of Object.keys(pages)) delete pages[key];
  pages['vegas/grand-slam-of-darts'] = DEFAULT_VEGAS_CAMPAIGN;
  pages['vegas/expo-2027'] = page('expo-2027', {
    enabled: true,
    targetColumn: 'QUALIFIED',
    tags: ['expo-2027'],
    accessCode: 'expo-door-code',
    successHeadline: 'Welcome in',
    successMessage: 'Enjoy the expo',
  });

  mockCollection = {
    findOne: vi.fn(),
    updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
    insertOne: vi.fn().mockResolvedValue({ insertedId: 'new-lead-id-123' }),
    countDocuments: vi.fn().mockResolvedValue(5),
  };
  mockDb = { collection: vi.fn(() => mockCollection) };
});

describe('POST /api/landing/[brand]/[campaign]/hostess-scan: access', () => {
  it('rejects a wrong access code with 401', async () => {
    const res = await post('grand-slam-of-darts', { password: 'wrongpassword', qrContent: badge('John', 'john@example.com') });
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('Invalid access code');
  });

  it('answers 404 when the page has no scanner, or the scanner is off', async () => {
    pages['vegas/no-scanner'] = page('no-scanner', null);
    pages['vegas/scanner-off'] = page('scanner-off', { enabled: false, accessCode: 'x' });
    for (const campaign of ['no-scanner', 'scanner-off', 'unknown-page']) {
      const res = await post(campaign, { password: 'x', qrContent: badge('John', 'john@example.com') });
      expect(res.status).toBe(404);
      expect((await res.json()).code).toBe('SCANNER_DISABLED');
    }
  });

  it('stays closed when an enabled scanner has no access code', async () => {
    pages['vegas/no-code'] = page('no-code', { enabled: true });
    const res = await post('no-code', { password: 'anything', qrContent: badge('John', 'john@example.com') });
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe('ACCESS_CODE_NOT_SET');
  });

  it("checks each page's own code: another page's code does not open it", async () => {
    const wrong = await post('expo-2027', { password: DEFAULT_HOSTESS_PASSWORD, verifyOnly: true });
    expect(wrong.status).toBe(401);
    const right = await post('expo-2027', { password: 'expo-door-code', verifyOnly: true });
    expect(right.status).toBe(200);
    expect((await right.json()).ok).toBe(true);
  });

  it('locks a caller out after repeated wrong codes', async () => {
    const ip = '203.0.113.9';
    const attempt = (code: string) =>
      POST(
        new NextRequest('http://localhost/api/landing/vegas/expo-2027/hostess-scan', {
          method: 'POST',
          headers: { 'x-forwarded-for': ip },
          body: JSON.stringify({ password: code, verifyOnly: true }),
        }),
        { params: Promise.resolve({ brand: 'vegas', campaign: 'expo-2027' }) }
      );
    for (let i = 0; i < 8; i++) expect((await attempt('nope')).status).toBe(401);
    expect((await attempt('expo-door-code')).status).toBe(429);
  });

  it('rejects missing qrContent with 400', async () => {
    const res = await post('grand-slam-of-darts', { password: DEFAULT_HOSTESS_PASSWORD, qrContent: '' });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Missing QR code content');
  });

  it('refuses a QR code that is not an attendee badge', async () => {
    const res = await post('grand-slam-of-darts', { password: DEFAULT_HOSTESS_PASSWORD, qrContent: 'https://example.com/poster' });
    expect(res.status).toBe(422);
    expect(mockCollection.insertOne).not.toHaveBeenCalled();
  });
});

describe('POST /api/landing/[brand]/[campaign]/hostess-scan: the Vegas page keeps its behaviour', () => {
  it('moves an existing lead to ENGAGED and adds the hostess tags', async () => {
    mockCollection.findOne.mockResolvedValueOnce({
      _id: 'existing-id-1',
      entity_name: 'David Jones',
      contactEmails: ['david@dartsfan.com'],
      tags: ['grand-slam-of-darts'],
      kanbanColumn: 'DISCOVERED',
      notes: 'Initial entry note',
    });
    const res = await post('grand-slam-of-darts', {
      password: DEFAULT_HOSTESS_PASSWORD,
      qrContent: badge('David Jones', 'david@dartsfan.com'),
      hostessNote: 'Met at hall entrance',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.alreadyCheckedIn).toBe(false);
    expect(body.movedTo).toBe('ENGAGED');
    const saved = mockCollection.updateOne.mock.calls[0][1].$set;
    expect(saved.tags).toEqual(expect.arrayContaining(['grand-slam-of-darts', 'hostess-contacted', 'card-accepted']));
    expect(saved.notes).toContain('Met at hall entrance');
    expect(executeLeadAction).toHaveBeenCalledWith(expect.objectContaining({ payload: expect.objectContaining({ kanbanColumn: 'ENGAGED' }) }));
  });

  it('creates a walk-in in ENGAGED when no lead matches', async () => {
    mockCollection.findOne.mockResolvedValueOnce(null);
    const res = await post('grand-slam-of-darts', { password: DEFAULT_HOSTESS_PASSWORD, qrContent: badge('Sarah Connor', 'sarah@future.com') });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.lead.kanbanColumn).toBe('ENGAGED');
    const created = mockCollection.insertOne.mock.calls[0][0];
    expect(created.kanbanColumn).toBe('ENGAGED');
    expect(created.tags).toEqual(expect.arrayContaining(['grand-slam-of-darts', 'hostess-contacted', 'card-accepted']));
  });

  it('says so when the attendee was scanned before', async () => {
    mockCollection.findOne.mockResolvedValueOnce({
      _id: 'existing-id-2',
      contactEmails: ['repeat@example.com'],
      kanbanColumn: 'ENGAGED',
      hostessContacted: true,
      tags: [],
    });
    const res = await post('grand-slam-of-darts', { password: DEFAULT_HOSTESS_PASSWORD, qrContent: badge('Repeat Guest', 'repeat@example.com') });
    expect((await res.json()).alreadyCheckedIn).toBe(true);
  });
});

describe('POST /api/landing/[brand]/[campaign]/hostess-scan: another campaign, its own workflow', () => {
  const scan = (name: string, email: string) => post('expo-2027', { password: 'expo-door-code', qrContent: badge(name, email) });

  it("moves a lead to the page's target column and adds only the page's tags", async () => {
    mockCollection.findOne.mockResolvedValueOnce({ _id: 'lead-9', contactEmails: ['visitor@example.com'], kanbanColumn: 'DISCOVERED', tags: ['expo-2027'] });
    const res = await scan('Visitor One', 'visitor@example.com');
    expect(res.status).toBe(200);
    expect((await res.json()).movedTo).toBe('QUALIFIED');
    const saved = mockCollection.updateOne.mock.calls[0][1].$set;
    expect(saved.tags).toEqual(['expo-2027']);
    expect(saved.tags).not.toContain('hostess-contacted');
    expect(executeLeadAction).toHaveBeenCalledWith(expect.objectContaining({ payload: expect.objectContaining({ kanbanColumn: 'QUALIFIED' }) }));
  });

  it('never moves a lead back from a later stage', async () => {
    mockCollection.findOne.mockResolvedValueOnce({ _id: 'lead-10', contactEmails: ['late@example.com'], kanbanColumn: 'PROPOSAL', tags: [] });
    const res = await scan('Late Stage', 'late@example.com');
    const body = await res.json();
    expect(body.movedTo).toBe('PROPOSAL');
    expect(executeLeadAction).not.toHaveBeenCalled();
  });

  it('creates a walk-in in the target column with no campaign-specific leftovers', async () => {
    mockCollection.findOne.mockResolvedValueOnce(null);
    const res = await scan('Walk In', 'walkin@example.org');
    expect(res.status).toBe(200);
    const created = mockCollection.insertOne.mock.calls[0][0];
    expect(created.kanbanColumn).toBe('QUALIFIED');
    expect(created.tags).toEqual(['expo-2027']);
    expect(created.sport_or_sector).toBe('');
    expect(JSON.stringify(created)).not.toMatch(/dart|vegas/i);
  });

  it('refuses a walk-in when the page does not create leads', async () => {
    pages['vegas/expo-2027'] = page('expo-2027', { enabled: true, accessCode: 'expo-door-code', createUnknownLeads: false });
    mockCollection.findOne.mockResolvedValueOnce(null);
    const res = await scan('Stranger', 'stranger@example.org');
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe('ATTENDEE_NOT_FOUND');
    expect(mockCollection.insertOne).not.toHaveBeenCalled();
  });
});
