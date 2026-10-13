import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/outreach/engagement/route';
import { mapOutreachLogToActivityEntry, mapActivityLogDoc } from '@/app/lib/activity-log-store';
import {
  deriveEmailStatus,
  isHumanReply,
  detectReplyClassification,
  getCancelReasonLabel,
  computeEngagementRates,
} from '@/lib/email-engagement';

// Mock mongodb and brand access dependencies
vi.mock('@/lib/mongodb', () => ({
  default: Promise.resolve({
    db: () => ({
      collection: (name: string) => ({
        find: () => ({
          sort: () => ({
            limit: () => ({
              toArray: async () => [
                {
                  to: 'contact1@example.com',
                  brand: 'cogmap',
                  tenantId: 'default',
                  createdAt: new Date('2026-09-09T10:00:00Z'),
                  openCount: 2,
                  clickCount: 1,
                  repliedAt: new Date('2026-09-09T11:00:00Z'),
                  replyClass: 'human',
                },
                {
                  to: 'contact2@example.com',
                  brand: 'cogmap',
                  tenantId: 'default',
                  createdAt: new Date('2026-09-09T10:00:00Z'),
                  openCount: 1,
                  deliveryStatus: 'opened',
                },
                {
                  to: 'contact3@example.com',
                  brand: 'cogmap',
                  tenantId: 'default',
                  createdAt: new Date('2026-09-09T10:00:00Z'),
                  cancelledAt: new Date('2026-09-09T10:00:00Z'),
                  sendAttempted: false,
                  routingReason: 'SEND_CANCELLED_SUPPRESSED',
                },
              ],
            }),
          }),
        }),
      }),
    }),
  }),
  isMongoConfigured: () => true,
}));

vi.mock('@/lib/require-brand-access-api', () => ({
  requireBrandAccessApi: vi.fn().mockResolvedValue(null),
}));

describe('Outreach Engagement API and Activity Integration (issue 242)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/outreach/engagement', () => {
    it('returns calculated unique rates and tracking caveats for valid brand', async () => {
      const req = new NextRequest('http://localhost/api/outreach/engagement?brand=cogmap');
      const res = await GET(req);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.brand).toBe('cogmap');
      expect(data.tenantId).toBe('default');
      expect(data.rates).toBeDefined();

      // Sent: contact1 and contact2 (contact3 was cancelled)
      expect(data.rates.totalSentUnique).toBe(2);
      expect(data.rates.totalOpensUnique).toBe(2);
      expect(data.rates.totalClicksUnique).toBe(1);
      expect(data.rates.totalRepliesUnique).toBe(1);
      expect(data.rates.totalCancelledUnique).toBe(1);

      // Rates
      expect(data.rates.uniqueOpenRate).toBe(100.0);
      expect(data.rates.uniqueClickRate).toBe(50.0);
      expect(data.rates.uniqueReplyRate).toBe(50.0);

      // Caveats
      expect(data.rates.trackingCaveats).toContain('Open tracking is probabilistic');
      expect(data.rates.trackingCaveats).toContain('Display status is \'Opened\', never \'Read\'');
    });

    it('rejects invalid brand with 400', async () => {
      const req = new NextRequest('http://localhost/api/outreach/engagement?brand=invalid_brand');
      const res = await GET(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('Invalid brand');
    });
  });

  describe('Activity Log Mapping Integration', () => {
    it('mapOutreachLogToActivityEntry derives emailStatus and cancelReasonLabel', () => {
      const logDoc = {
        _id: '507f1f77bcf86cd799439011',
        leadId: 'lead_123',
        subject: 'Introductory Call',
        body: 'Hello there, would love to connect.',
        createdAt: new Date('2026-09-09T10:00:00Z'),
        sendAttempted: false,
        routingReason: 'SEND_CANCELLED_REPLIED',
      };

      const entry = mapOutreachLogToActivityEntry(logDoc);
      expect(entry.type).toBe('email-outbound');
      expect(entry.emailStatus).toBe('cancelled');
      expect(entry.cancelReasonLabel).toBe('Contact replied');
    });

    it('mapOutreachLogToActivityEntry attaches opened status and counts', () => {
      const logDoc = {
        _id: '507f1f77bcf86cd799439012',
        leadId: 'lead_456',
        subject: 'Partnership Overview',
        body: 'Attached is our overview.',
        createdAt: new Date('2026-09-09T10:00:00Z'),
        deliveryStatus: 'opened',
        openCount: 3,
        clickCount: 1,
      };

      const entry = mapOutreachLogToActivityEntry(logDoc);
      expect(entry.emailStatus).toBe('clicked');
      expect(entry.openCount).toBe(3);
      expect(entry.clickCount).toBe(1);
    });

    it('mapActivityLogDoc classifies inbound reply as replied for human and sent for OOO', () => {
      const humanDoc = {
        _id: '507f1f77bcf86cd799439013',
        leadId: 'lead_789',
        type: 'email-inbound',
        direction: 'inbound',
        subject: 'Re: Hello',
        createdAt: new Date('2026-09-09T11:00:00Z'),
        replyClass: 'human',
      };

      const humanEntry = mapActivityLogDoc(humanDoc);
      expect(humanEntry.emailStatus).toBe('replied');
      expect(humanEntry.replyClass).toBe('human');

      const oooDoc = {
        _id: '507f1f77bcf86cd799439014',
        leadId: 'lead_789',
        type: 'email-inbound',
        direction: 'inbound',
        subject: 'Out of Office: on vacation',
        createdAt: new Date('2026-09-09T11:05:00Z'),
        replyClass: 'out_of_office',
      };

      const oooEntry = mapActivityLogDoc(oooDoc);
      expect(oooEntry.emailStatus).toBe('sent');
      expect(oooEntry.replyClass).toBe('out_of_office');
    });
  });
});
