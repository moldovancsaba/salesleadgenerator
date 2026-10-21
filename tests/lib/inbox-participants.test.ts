import { describe, it, expect, vi } from 'vitest';
import { getInboxThreadDetail } from '../../app/lib/inbox-store';
import * as brandModule from '../../app/lib/brand';

vi.mock('../../app/lib/brand', async (importOriginal) => {
  const actual = await importOriginal<typeof brandModule>();
  return {
    ...actual,
    getBrandConfig: vi.fn().mockResolvedValue({
      label: 'Seyu',
      dbCollection: 'leads',
      currency: 'EUR',
      aliases: ['seyu'],
      ownNameTerms: ['seyu', 'seyuselfies'],
      forecastModel: 'dealSizeBand',
    }),
  };
});

describe('Inbox Thread Participants — Existing Contact Identification & Open Affordance', () => {
  it('correctly marks participants as existing contacts when found on current lead or across other leads', async () => {
    // Lead 1 (Current thread lead): FRH Federation
    const leadFrh = {
      _id: '6ad7c7000000000000000001',
      id: '6ad7c7000000000000000001',
      entity_name: 'FRH Federation',
      contacts: [
        {
          name: 'Kitty Erdei',
          email: 'kitty.erdei@frh.ro',
          title: 'Secretary General',
        },
      ],
      contactEmails: ['kitty.erdei@frh.ro'],
    };

    // Lead 2 (External CRM Lead): Sportfive
    const leadSportfive = {
      _id: '6ad7c751b9e32a7106cb7788',
      id: '6ad7c751b9e32a7106cb7788',
      entity_name: 'Sportfive',
      contacts: [
        {
          name: 'Krisztián Szika',
          email: 'krisztian.szika@sportfive.com',
          title: 'Senior Director',
        },
      ],
      contactEmails: ['krisztian.szika@sportfive.com'],
    };

    // Lead 3 (External CRM Lead): As Roma
    const leadAsRoma = {
      _id: '6ad7c778b9e32a7106cb7789',
      id: '6ad7c778b9e32a7106cb7789',
      entity_name: 'As Roma',
      contacts: [
        {
          name: 'Matteo Coggiola',
          email: 'matteo.coggiola@asroma.it',
          title: 'Partnerships Manager',
        },
      ],
      contactEmails: ['matteo.coggiola@asroma.it'],
    };

    const mockLeads = [leadFrh, leadSportfive, leadAsRoma];

    const mockActivityDocs = [
      {
        _id: 'act_101',
        brand: 'seyu',
        tenantId: 'default',
        leadId: '6ad7c7000000000000000001',
        threadId: 'thread_sports_summit',
        type: 'email-inbound',
        direction: 'inbound',
        subject: 'Sports Business Summit Coordination',
        from: 'Krisztián Szika <krisztian.szika@sportfive.com>',
        to: ['tamas.sebestyen@seyuselfies.com'],
        cc: [
          'Matteo Coggiola <matteo.coggiola@asroma.it>',
          'Kitty Erdei <kitty.erdei@frh.ro>',
          'new.prospect@unknownclub.com',
        ],
        body: 'Looking forward to meeting you at the summit.',
        createdAt: new Date('2026-10-20T10:00:00Z'),
      },
    ];

    const mockDb: any = {
      collection: (colName: string) => {
        if (colName === 'activityLog') {
          return {
            createIndex: vi.fn().mockResolvedValue('ok'),
            find: () => ({
              sort: () => ({
                toArray: async () => mockActivityDocs,
              }),
            }),
          };
        }
        if (colName === 'outreach_logs') {
          return {
            createIndex: vi.fn().mockResolvedValue('ok'),
            find: () => ({
              sort: () => ({
                toArray: async () => [],
              }),
            }),
          };
        }
        if (colName === 'inbox_thread_states') {
          return {
            createIndex: vi.fn().mockResolvedValue('ok'),
            findOne: async () => null,
          };
        }
        if (colName === 'leads') {
          return {
            createIndex: vi.fn().mockResolvedValue('ok'),
            findOne: async (q: any) => {
              if (q.$or) {
                for (const clause of q.$or) {
                  const found = mockLeads.find((l) => l.id === clause.id || l._id === clause._id || l.id === String(clause._id));
                  if (found) return found;
                }
              }
              return null;
            },
            find: (q: any) => ({
              toArray: async () => {
                if (q.$or) {
                  const emails = q.$or[0]?.contactEmails?.$in || [];
                  return mockLeads.filter((l) =>
                    l.contactEmails.some((e) => emails.includes(e))
                  );
                }
                return mockLeads;
              },
            }),
          };
        }
        return {
          createIndex: vi.fn().mockResolvedValue('ok'),
          findOne: async () => null,
          find: () => ({ toArray: async () => [] }),
        };
      },
    };

    const detail = await getInboxThreadDetail(mockDb, 'seyu', 'default', 'thread_sports_summit');

    expect(detail.thread).toBeDefined();
    expect(detail.participants.length).toBeGreaterThanOrEqual(4);

    // 1. Krisztián Szika — should be identified as existing contact on Sportfive
    const szika = detail.participants.find((p) => p.email === 'krisztian.szika@sportfive.com');
    expect(szika).toBeDefined();
    expect(szika?.isExistingContact).toBe(true);
    expect(szika?.existingLeadId).toBe('6ad7c751b9e32a7106cb7788');
    expect(szika?.existingLeadName).toBe('Sportfive');

    // 2. Matteo Coggiola — should be identified as existing contact on As Roma
    const matteo = detail.participants.find((p) => p.email === 'matteo.coggiola@asroma.it');
    expect(matteo).toBeDefined();
    expect(matteo?.isExistingContact).toBe(true);
    expect(matteo?.existingLeadId).toBe('6ad7c778b9e32a7106cb7789');
    expect(matteo?.existingLeadName).toBe('As Roma');

    // 3. Kitty Erdei — should be identified as existing contact on current lead (FRH Federation)
    const kitty = detail.participants.find((p) => p.email === 'kitty.erdei@frh.ro');
    expect(kitty).toBeDefined();
    expect(kitty?.isExistingContact).toBe(true);
    expect(kitty?.existingLeadId).toBe('6ad7c7000000000000000001');
    expect(kitty?.existingLeadName).toBe('FRH Federation');

    // 4. Unknown Club prospect — is NOT an existing contact
    const unknown = detail.participants.find((p) => p.email === 'new.prospect@unknownclub.com');
    expect(unknown).toBeDefined();
    expect(unknown?.isExistingContact).toBeFalsy();
    expect(unknown?.existingLeadId).toBeUndefined();
  });

  it('determines correct UI button affordances: Open for existing contacts, + Contact only for new prospects', () => {
    const participants = [
      {
        name: 'Krisztián Szika',
        email: 'krisztian.szika@sportfive.com',
        isExistingContact: true,
        existingLeadId: '6ad7c751b9e32a7106cb7788',
        existingLeadName: 'Sportfive',
      },
      {
        name: 'New Prospect',
        email: 'new@prospect.com',
        isExistingContact: false,
        existingLeadId: undefined,
        existingLeadName: undefined,
      },
    ];

    const currentLead = {
      _id: 'lead_curr',
      entity_name: 'Current Thread Lead',
      contacts: [],
    };

    function resolveAffordance(p: any) {
      const isOnLead = Boolean(
        currentLead.contacts.some((c: any) => c.email?.toLowerCase() === p.email.toLowerCase())
      );
      const isExisting = Boolean(p.isExistingContact || isOnLead || p.existingLeadId);
      const targetLeadId = p.existingLeadId || (isOnLead ? currentLead._id : undefined);
      const targetLeadName = p.existingLeadName || (isOnLead ? currentLead.entity_name : undefined);

      return {
        isExisting,
        showOpenButton: Boolean(isExisting && targetLeadId),
        showAddContactButton: !isExisting,
        openUrl: targetLeadId ? `/sales/seyu?leadId=${encodeURIComponent(targetLeadId)}` : null,
        badgeLabel: targetLeadName || (isOnLead ? 'Saved' : null),
      };
    }

    const szikaAffordance = resolveAffordance(participants[0]);
    expect(szikaAffordance.isExisting).toBe(true);
    expect(szikaAffordance.showOpenButton).toBe(true);
    expect(szikaAffordance.showAddContactButton).toBe(false);
    expect(szikaAffordance.openUrl).toBe('/sales/seyu?leadId=6ad7c751b9e32a7106cb7788');
    expect(szikaAffordance.badgeLabel).toBe('Sportfive');

    const newProspectAffordance = resolveAffordance(participants[1]);
    expect(newProspectAffordance.isExisting).toBe(false);
    expect(newProspectAffordance.showOpenButton).toBe(false);
    expect(newProspectAffordance.showAddContactButton).toBe(true);
    expect(newProspectAffordance.openUrl).toBeNull();
  });
});
