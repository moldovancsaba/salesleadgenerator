import { describe, expect, it, vi, beforeEach } from 'vitest';
import { leadHasMarketingPromoOptIn } from '../../lib/inbound-lead-form';
import { backfillMarketingOptInLeadsToEngaged } from '../../lib/landing-engaged-backfill';

const executeLeadActionMock = vi.fn();

vi.mock('../../app/lib/lead-actions', () => ({
  executeLeadAction: (...args: unknown[]) => executeLeadActionMock(...(args as [])),
}));

describe('landing-engaged-backfill', () => {
  beforeEach(() => {
    executeLeadActionMock.mockReset();
    executeLeadActionMock.mockResolvedValue({ success: true });
  });

  it('detects legacy and current affirmative marketing opt-ins accurately while ignoring No/false', () => {
    expect(leadHasMarketingPromoOptIn({ extraFields: { consentMrVegas: true } })).toBe(true);
    expect(leadHasMarketingPromoOptIn({ extraFields: { consentMrVegas: false }, notes: 'Mr Vegas Promo Opt-in: No' })).toBe(false);
    expect(
      leadHasMarketingPromoOptIn({
        extraFields: {
          consents: [
            {
              key: 'f_vegas_consent',
              label: 'Can Mr Vegas contact you with marketing and promotional offers?',
              value: 'Yes',
            },
          ],
        },
      })
    ).toBe(true);
    expect(
      leadHasMarketingPromoOptIn({
        extraFields: {
          dynamicFields: {
            'Can Mr Vegas contact you with marketing and promotional offers?': 'Yes',
          },
        },
      })
    ).toBe(true);
    expect(
      leadHasMarketingPromoOptIn({
        notes: '[Inbound Form 2026-11-12] [Mr Vegas Promo Opt-in: Yes]',
      })
    ).toBe(true);
  });

  it('previews in dryRun mode and moves only eligible marketing opt-in leads into ENGAGED', async () => {
    const updateCalls: Array<{ id: unknown; update: unknown }> = [];
    const candidateDocs = [
      {
        _id: 'lead-yes-1',
        kanbanColumn: 'DISCOVERED',
        entity_name: 'Fan One',
        contacts: [{ name: 'Fan One', email: 'one@example.com' }],
        value_proposition: 'Inbound inquiry',
        extraFields: { consentMrVegas: true },
      },
      {
        _id: 'lead-no-2',
        kanbanColumn: 'DISCOVERED',
        entity_name: 'Fan Two',
        contacts: [{ name: 'Fan Two', email: 'two@example.com' }],
        value_proposition: 'Inbound inquiry',
        extraFields: { consentMrVegas: false },
        notes: 'Mr Vegas Promo Opt-in: No',
      },
      {
        _id: 'lead-yes-sparse-3',
        kanbanColumn: 'QUALIFIED',
        entity_name: 'Fan Three',
        contacts: [{ name: 'Fan Three', email: 'three@example.com' }],
        value_proposition: '',
        notes: '[Inbound Form 2026-11-11] [Mr Vegas Promo Opt-in: Yes]',
      },
    ];

    const db = {
      collection: vi.fn(() => ({
        find: () => ({
          sort: () => ({
            toArray: async () => candidateDocs,
          }),
        }),
        updateOne: async (query: { _id: unknown }, update: unknown) => {
          updateCalls.push({ id: query._id, update });
          return { modifiedCount: 1 };
        },
      })),
    } as any;

    const preview = await backfillMarketingOptInLeadsToEngaged({
      db,
      brand: 'vegas',
      dbCollection: 'vegas_leads',
      tenantId: 'default',
      dryRun: true,
    });

    expect(preview).toEqual({
      dryRun: true,
      brand: 'vegas',
      scanned: 3,
      eligibleOptIn: 2,
      moved: 0,
      remaining: 2,
      errors: [],
    });
    expect(executeLeadActionMock).not.toHaveBeenCalled();

    const executed = await backfillMarketingOptInLeadsToEngaged({
      db,
      brand: 'vegas',
      dbCollection: 'vegas_leads',
      tenantId: 'default',
      dryRun: false,
    });

    expect(executed.moved).toBe(2);
    expect(executed.remaining).toBe(0);
    expect(executeLeadActionMock).toHaveBeenCalledTimes(2);
    expect(executeLeadActionMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ leadId: 'lead-yes-1', action: 'COLUMN_MOVE', payload: expect.objectContaining({ kanbanColumn: 'ENGAGED' }) })
    );
    // Sparse lead had value_proposition enriched before executeLeadAction
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].id).toBe('lead-yes-sparse-3');
  });
});
