import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '../../app/api/forms/[brand]/submit/route';
import { DEFAULT_BLOCKS_CONFIG, DEFAULT_VEGAS_CAMPAIGN, type LandingPageRecord } from '../../lib/landing-page-schema';

vi.mock('@/lib/mongodb', () => ({
  isMongoConfigured: vi.fn(() => true),
  default: Promise.resolve({ db: () => mockDb }),
}));
vi.mock('@/app/lib/brand', () => ({
  resolveBrand: vi.fn(async (b: string) => (b === 'vegas' ? 'vegas' : null)),
  getBrandConfig: vi.fn(async () => ({ label: 'Mr Vegas', dbCollection: 'leads_vegas', fromEmail: 'hello@example.com' })),
}));
vi.mock('@/app/lib/scheduling-store', () => ({ checkAndRecordRateLimit: vi.fn(async () => true) }));
vi.mock('@/app/lib/ticket-size-store', () => ({ computeTicketSizeForLead: vi.fn(async () => undefined) }));
vi.mock('@/app/lib/activity-log-store', () => ({
  ACTIVITY_LOG_COLLECTION: 'activity_logs',
  ensureActivityLogIndexes: vi.fn(async () => {}),
  truncateBody: (s: string) => s,
}));
vi.mock('@/lib/automation-store', () => ({ evaluateEventRules: vi.fn(async () => {}) }));
vi.mock('@/lib/webhook-store', () => ({ emitWebhookEvent: vi.fn(async () => {}) }));

const sendEmail = vi.fn(async () => ({ sent: true }));
vi.mock('@/lib/landing-confirmation-email', () => ({ sendLandingConfirmationEmail: (...args: unknown[]) => sendEmail(...(args as [])) }));

let page: LandingPageRecord | null = null;
const incrementSubmission = vi.fn(async () => {});
vi.mock('@/lib/landing-page-store', () => ({
  getLandingPageBySlug: vi.fn(async () => page),
  incrementLandingPageSubmission: (...args: unknown[]) => incrementSubmission(...(args as [])),
}));

let mockDb: any;
let mockCollection: any;

const submission = {
  firstName: 'Luke',
  lastName: 'Humphries',
  contactEmail: 'luke@example.com',
  country: 'GB',
  postCode: 'WV6 9NW',
  dateOfBirth: '1995-02-11',
  campaign: 'grand-slam-of-darts',
};

function submit(overrides: Record<string, unknown> = {}) {
  const req = new NextRequest('http://localhost/api/forms/vegas/submit', {
    method: 'POST',
    body: JSON.stringify({ ...submission, ...overrides }),
  });
  return POST(req, { params: Promise.resolve({ brand: 'vegas' }) });
}

beforeEach(() => {
  sendEmail.mockClear();
  incrementSubmission.mockClear();
  mockCollection = {
    findOne: vi.fn().mockResolvedValue(null),
    updateOne: vi.fn().mockResolvedValue({}),
    insertOne: vi.fn().mockResolvedValue({ insertedId: 'lead-1' }),
    countDocuments: vi.fn().mockResolvedValue(0),
  };
  mockDb = { collection: vi.fn(() => mockCollection) };
});

describe('POST /api/forms/[brand]/submit: confirmation & pass email', () => {
  it('collects the lead and sends the Vegas promotional confirmation email when custom email is enabled and pass is off', async () => {
    page = DEFAULT_VEGAS_CAMPAIGN;
    const res = await submit();
    expect(res.status).toBe(201);
    expect((await res.json()).submitted).toBe(true);
    expect(mockDb.collection().insertOne).toHaveBeenCalled();
    expect(incrementSubmission).toHaveBeenCalledWith('vegas', 'grand-slam-of-darts');
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        confirmationEmail: DEFAULT_VEGAS_CAMPAIGN.confirmationEmail,
      })
    );
  });

  it('collects the lead and sends no email when both the pass and custom confirmation email are switched off', async () => {
    page = {
      ...DEFAULT_VEGAS_CAMPAIGN,
      confirmationEmail: { ...DEFAULT_VEGAS_CAMPAIGN.confirmationEmail, enabled: false },
    };
    const res = await submit();
    expect(res.status).toBe(201);
    expect((await res.json()).submitted).toBe(true);
    expect(mockDb.collection().insertOne).toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('still sends the pass email for a page that shows the pass and has no custom confirmation email', async () => {
    page = {
      ...DEFAULT_VEGAS_CAMPAIGN,
      blocks: { ...DEFAULT_BLOCKS_CONFIG },
      confirmationEmail: undefined,
    };
    const res = await submit();
    expect(res.status).toBe(201);
    expect(mockDb.collection().insertOne).toHaveBeenCalled();
    expect(incrementSubmission).toHaveBeenCalledWith('vegas', 'grand-slam-of-darts');
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        confirmationEmail: undefined,
      })
    );
  });

  it('adds a new lead directly into ENGAGED when visitor answers Yes to marketing/promotional offers', async () => {
    page = DEFAULT_VEGAS_CAMPAIGN;
    const res = await submit({
      consents: [
        {
          key: 'f_vegas_consent',
          label: 'Can Mr Vegas contact you with marketing and promotional offers?',
          value: 'Yes',
        },
      ],
    });
    expect(res.status).toBe(201);
    expect(mockCollection.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        kanbanColumn: 'ENGAGED',
        manualLaneFloorColumn: 'ENGAGED',
      })
    );
  });

  it('moves an existing DISCOVERED lead to ENGAGED on repeat submit with marketing opt-in Yes, without downgrading PROPOSAL leads', async () => {
    page = DEFAULT_VEGAS_CAMPAIGN;
    mockCollection.findOne.mockResolvedValueOnce({
      _id: 'lead-existing-1',
      kanbanColumn: 'DISCOVERED',
      contacts: [{ name: 'Luke Humphries', email: 'luke@example.com' }],
      createdAt: new Date('2026-11-10T10:00:00Z'),
    });

    const resPromoted = await submit({
      consents: [
        {
          key: 'f_vegas_consent',
          label: 'Can Mr Vegas contact you with marketing and promotional offers?',
          value: 'Yes',
        },
      ],
    });
    expect(resPromoted.status).toBe(201);
    expect((await resPromoted.json()).deduplicated).toBe(true);
    const insertedLeadDocs = mockCollection.insertOne.mock.calls.filter(
      (call: any[]) => call[0] && 'kanbanColumn' in call[0]
    );
    expect(insertedLeadDocs).toHaveLength(0);
    expect(mockCollection.updateOne).toHaveBeenCalledWith(
      { _id: 'lead-existing-1' },
      {
        $set: expect.objectContaining({
          kanbanColumn: 'ENGAGED',
        }),
      }
    );

    mockCollection.updateOne.mockClear();
    mockCollection.findOne.mockResolvedValueOnce({
      _id: 'lead-proposal-1',
      kanbanColumn: 'PROPOSAL',
      contacts: [{ name: 'Luke Humphries', email: 'luke@example.com' }],
      createdAt: new Date('2026-11-10T10:00:00Z'),
    });

    const resKept = await submit({
      consents: [
        {
          key: 'f_vegas_consent',
          label: 'Can Mr Vegas contact you with marketing and promotional offers?',
          value: 'Yes',
        },
      ],
    });
    expect(resKept.status).toBe(201);
    const updateCalls = mockCollection.updateOne.mock.calls.map((c: any[]) => c[1]?.$set?.kanbanColumn);
    expect(updateCalls).not.toContain('ENGAGED');
  });
});
