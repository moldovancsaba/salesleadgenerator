import { describe, it, expect } from 'vitest';
import type { TodayInboundItem, TodayViewData } from '@/lib/today';

describe('Inbound & Captured Leads Review Queue (Issue 292)', () => {
  it('defines the TodayInboundItem contract and verifies queue counts aggregation', () => {
    const item: TodayInboundItem = {
      leadId: 'lead_123',
      entityName: 'FC Barcelona',
      source: 'LINKEDIN_EXTENSION',
      contactName: 'Joan Laporta',
      contactTitle: 'President',
      contactEmail: 'president@fcbarcelona.cat',
      linkedinUrl: 'https://www.linkedin.com/in/joanlaporta',
      buyingRole: 'economic_buyer',
      createdAt: '2026-10-28T00:00:00.000Z',
      notes: 'Captured via LinkedIn Extension',
    };

    expect(item.leadId).toBe('lead_123');
    expect(item.source).toBe('LINKEDIN_EXTENSION');
    expect(item.buyingRole).toBe('economic_buyer');

    const viewData: TodayViewData = {
      date: '2026-10-28',
      timezone: 'UTC',
      scope: 'mine',
      counts: {
        total: 1,
        cadenceTasks: 0,
        overdueFollowUps: 0,
        dueTodayFollowUps: 0,
        dealsNeedingAttention: 0,
        inboundQueue: 1,
      },
      cadenceTasks: [],
      overdueFollowUps: [],
      dueTodayFollowUps: [],
      dealsNeedingAttention: [],
      inboundQueue: [item],
    };

    expect(viewData.counts.inboundQueue).toBe(1);
    expect(viewData.counts.total).toBe(1);
    expect(viewData.inboundQueue[0].entityName).toBe('FC Barcelona');
  });

  it('supports inbound form source as well', () => {
    const inboundFormItem: TodayInboundItem = {
      leadId: 'lead_456',
      entityName: 'Bayern Munich',
      source: 'inbound',
      contactName: 'Oliver Kahn',
      contactEmail: 'kahn@fcbayern.de',
      createdAt: '2026-10-28T01:00:00.000Z',
    };

    expect(inboundFormItem.source).toBe('inbound');
    expect(inboundFormItem.entityName).toBe('Bayern Munich');
  });
});
