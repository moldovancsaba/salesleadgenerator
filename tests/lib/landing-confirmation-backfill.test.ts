import { describe, expect, it, vi, beforeEach } from 'vitest';

const resendSendMock = vi.fn();

vi.mock('resend', () => ({
  Resend: class MockResend {
    emails = {
      send: resendSendMock,
    };
  },
}));

import {
  buildSubmittedLeadsFilter,
  collectUniqueSubmittedRecipients,
  dispatchConfirmationEmailsForLandingPage,
} from '../../lib/landing-confirmation-backfill';
import { DEFAULT_VEGAS_CAMPAIGN } from '../../lib/landing-page-schema';

describe('landing-confirmation-backfill', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resendSendMock.mockReset();
  });

  it('deduplicates contacts across submitted leads and skips already-emailed recipients', () => {
    const leads = [
      {
        _id: { toString: () => 'lead-1' },
        contacts: [
          { name: 'Alice Fan', email: 'Alice@Example.com ' },
          { name: 'Bob Fan', email: 'bob@example.com' },
        ],
      },
      {
        _id: { toString: () => 'lead-2' },
        contacts: [{ name: 'Alice Duplicate', email: 'alice@example.com' }],
      },
      {
        _id: { toString: () => 'lead-3' },
        contacts: [{ name: 'Charlie AlreadySent', email: 'charlie@example.com' }],
      },
      {
        _id: { toString: () => 'lead-4' },
        entity_name: 'Dave Fallback',
        contactEmails: ['dave@example.com'],
      },
      {
        _id: { toString: () => 'lead-5' },
        contacts: [{ name: 'Bad', email: 'not-an-email' }],
      },
    ];

    const alreadySent = new Set(['charlie@example.com']);
    const result = collectUniqueSubmittedRecipients(leads, alreadySent);

    expect(result.matchedLeads).toBe(5);
    expect(result.uniqueRecipients).toBe(4);
    expect(result.skippedAlreadySent).toBe(1);
    expect(result.pending).toEqual([
      { leadId: 'lead-1', email: 'alice@example.com', name: 'Alice Fan' },
      { leadId: 'lead-1', email: 'bob@example.com', name: 'Bob Fan' },
      { leadId: 'lead-4', email: 'dave@example.com', name: 'Dave Fallback' },
    ]);
  });

  it('builds an inclusive filter for landing submissions and repeat inquiries', () => {
    const filter = buildSubmittedLeadsFilter('grand-slam-of-darts', 'default');
    expect(JSON.stringify(filter)).toContain('grand-slam-of-darts');
    expect(JSON.stringify(filter)).toContain('landing_grand-slam-of-darts');
    expect(JSON.stringify(filter)).toContain('Inbound Form');
  });

  it('dispatches batched confirmation emails via dryRun preview and send mode without duplicating activityLog recipients', async () => {
    const insertedLogs: unknown[] = [];
    const mockLeads = [
      {
        _id: { toString: () => 'l1' },
        contacts: [{ name: 'First Fan', email: 'first@example.com' }],
      },
      {
        _id: { toString: () => 'l2' },
        contacts: [{ name: 'Already Emailed', email: 'already@example.com' }],
      },
      {
        _id: { toString: () => 'l3' },
        contacts: [{ name: 'Second Fan', email: 'second@example.com' }],
      },
    ];

    const db = {
      collection: vi.fn((name: string) => {
        if (name === 'vegas_leads') {
          return {
            find: () => ({
              sort: () => ({
                toArray: async () => mockLeads,
              }),
            }),
          };
        }
        return {
          createIndex: async () => {},
          find: () => ({
            toArray: async () => [{ matchedContactKey: 'already@example.com', toAddresses: ['already@example.com'] }],
          }),
          insertOne: async (doc: unknown) => {
            insertedLogs.push(doc);
            return { insertedId: 'log-1' };
          },
        };
      }),
    } as any;

    process.env.RESEND_API_KEY = 're_test_key';
    const sendPayloads: Array<{ to: string[]; subject: string }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (String(url).startsWith('https://api.resend.com/emails?')) {
          return new Response(JSON.stringify({ data: [], has_more: false }), { status: 200 });
        }
        if (String(url).includes('/emails') && init?.method === 'POST') {
          sendPayloads.push(JSON.parse(String(init.body)));
        }
        return new Response(JSON.stringify({ id: 'ok' }), { status: 200 });
      })
    );

    const preview = await dispatchConfirmationEmailsForLandingPage({
      db,
      brand: 'vegas',
      brandLabel: 'Vegas',
      dbCollection: 'vegas_leads',
      fromEmail: 'vegas@haho.ai',
      tenantId: 'default',
      page: DEFAULT_VEGAS_CAMPAIGN,
      dryRun: true,
      limit: 50,
      throttleMs: 0,
    });

    expect(preview.dryRun).toBe(true);
    expect(preview.uniqueRecipients).toBe(3);
    expect(preview.skippedAlreadySent).toBe(1);
    expect(preview.remaining).toBe(2);
    expect(preview.sent).toBe(0);
    expect(insertedLogs).toHaveLength(0);

    resendSendMock.mockResolvedValueOnce({ data: { id: 're_batch_1' }, error: null });

    const sentBatch = await dispatchConfirmationEmailsForLandingPage({
      db,
      brand: 'vegas',
      brandLabel: 'Vegas',
      dbCollection: 'vegas_leads',
      fromEmail: 'vegas@haho.ai',
      tenantId: 'default',
      page: DEFAULT_VEGAS_CAMPAIGN,
      dryRun: false,
      limit: 1,
      throttleMs: 0,
    });

    expect(sentBatch.dryRun).toBe(false);
    expect(sentBatch.attempted).toBe(1);
    expect(sentBatch.sent).toBe(1);
    expect(sentBatch.failed).toBe(0);
    expect(sentBatch.remaining).toBe(1);
    expect(resendSendMock).toHaveBeenCalledTimes(1);
    expect(resendSendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'first@example.com',
        subject: 'Thank you for attending The Mr Vegas Grand Slam of Darts',
      })
    );
    expect(insertedLogs).toHaveLength(1);
  });
});
