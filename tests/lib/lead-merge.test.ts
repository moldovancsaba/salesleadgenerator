import { describe, it, expect } from 'vitest';
import { diffLeads, buildMergedLead } from '../../lib/lead-merge';
import type { Lead } from '../../app/types';

function baseLead(overrides: Partial<Lead> = {}): Lead {
  return {
    _id: '507f1f77bcf86cd799439011',
    country: 'US',
    region: 'US',
    entity_name: 'Acme FC',
    url: 'https://acme-fc.example.com',
    kanbanColumn: 'DISCOVERED',
    sortOrder: 100,
    qualityStatus: 'DRAFT',
    feedbackScore: 0,
    declineCount: 0,
    acceptanceCount: 0,
    contacts: [],
    tags: [],
    deals: [],
    checklist: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as Lead;
}

describe('diffLeads', () => {
  it('finds zero conflicts for two leads identical except _id/timestamps', () => {
    const a = baseLead({ _id: 'a1', createdAt: '2026-01-01T00:00:00.000Z' });
    const b = baseLead({ _id: 'b1', createdAt: '2026-01-02T00:00:00.000Z' });
    const classifications = diffLeads(a, b);
    const conflicts = classifications.filter((c) => c.kind === 'conflict');
    expect(conflicts).toEqual([]);
  });

  it('classifies WON vs LOST as a conflict, not an auto-resolved pipeline-order pick', () => {
    const a = baseLead({ _id: 'a1', kanbanColumn: 'WON' });
    const b = baseLead({ _id: 'b1', kanbanColumn: 'LOST' });
    const classifications = diffLeads(a, b);
    const kanban = classifications.find((c) => c.field === 'kanbanColumn');
    expect(kanban?.kind).toBe('conflict');
  });

  it('auto-resolves kanbanColumn to the further-along stage for any non-WON/LOST-conflict pair', () => {
    const a = baseLead({ _id: 'a1', kanbanColumn: 'DISCOVERED' });
    const b = baseLead({ _id: 'b1', kanbanColumn: 'PROPOSAL' });
    const classifications = diffLeads(a, b);
    const kanban = classifications.find((c) => c.field === 'kanbanColumn');
    expect(kanban?.kind).toBe('auto-resolved');
    expect((kanban as any).mergedValue).toBe('PROPOSAL');
  });

  it('treats BACKLOG and DISCOVERED as equally unranked (neither "behind" the other)', () => {
    const a = baseLead({ _id: 'a1', kanbanColumn: 'BACKLOG' });
    const b = baseLead({ _id: 'b1', kanbanColumn: 'DISCOVERED' });
    const classifications = diffLeads(a, b);
    const kanban = classifications.find((c) => c.field === 'kanbanColumn');
    expect(kanban?.kind).toBe('auto-resolved');
    // Tie rule (>=) picks a's BACKLOG — asserting it doesn't throw/misclassify as a conflict is the real point.
    expect((kanban as any).mergedValue).toBe('BACKLOG');
  });

  it('auto-unions contacts using the exact same result dedupeContacts would produce on the concatenated arrays', async () => {
    const { dedupeContacts } = await import('../../lib/contacts');
    const contactsA = [{ name: 'Jordan Smith', email: 'jordan@acme-fc.example.com', isDecisionMaker: true }];
    const contactsB = [{ name: 'Alex Rivera', phone: '+1 555 0101' }];
    const a = baseLead({ _id: 'a1', contacts: contactsA as any });
    const b = baseLead({ _id: 'b1', contacts: contactsB as any });
    const classifications = diffLeads(a, b);
    const contactsClassification = classifications.find((c) => c.field === 'contacts');
    expect(contactsClassification?.kind).toBe('auto-union');
    expect((contactsClassification as any).mergedValue).toEqual(dedupeContacts([...contactsA, ...contactsB]));
  });

  it('auto-unions tags, deals, and checklist without dropping either side', () => {
    const a = baseLead({
      _id: 'a1',
      tags: ['sports', 'europe'],
      deals: [{ id: 'd1', value: 1000, currency: 'USD', createdAt: 'x', updatedAt: 'x', source: 'manual' }],
      checklist: [{ id: 'c1', text: 'Call back', done: false, createdAt: 'x' }],
    });
    const b = baseLead({
      _id: 'b1',
      tags: ['europe', 'renewal'],
      deals: [{ id: 'd2', value: 2000, currency: 'USD', createdAt: 'x', updatedAt: 'x', source: 'manual' }],
      checklist: [{ id: 'c2', text: 'Send proposal', done: true, createdAt: 'x' }],
    });
    const classifications = diffLeads(a, b);
    const tags = classifications.find((c) => c.field === 'tags') as any;
    const deals = classifications.find((c) => c.field === 'deals') as any;
    const checklist = classifications.find((c) => c.field === 'checklist') as any;
    expect(tags.mergedValue.sort()).toEqual(['europe', 'renewal', 'sports']);
    expect(deals.mergedValue).toHaveLength(2);
    expect(checklist.mergedValue).toHaveLength(2);
  });

  it('does not surface a ticketSizeEstimate conflict when only computedAt differs', () => {
    const a = baseLead({ _id: 'a1', ticketSizeEstimate: { method: 'tier_band', computedAt: '2026-01-01T00:00:00.000Z', low: 1000, expected: 2000, high: 3000, currency: 'USD', confidence: 'medium' } });
    const b = baseLead({ _id: 'b1', ticketSizeEstimate: { method: 'tier_band', computedAt: '2026-02-01T00:00:00.000Z', low: 1000, expected: 2000, high: 3000, currency: 'USD', confidence: 'medium' } });
    const classifications = diffLeads(a, b);
    expect(classifications.find((c) => c.field === 'ticketSizeEstimate')).toBeUndefined();
  });

  it('surfaces a ticketSizeEstimate conflict when the actual estimate differs', () => {
    const a = baseLead({ _id: 'a1', ticketSizeEstimate: { method: 'tier_band', computedAt: 'x', low: 1000, expected: 2000, high: 3000, currency: 'USD', confidence: 'medium' } });
    const b = baseLead({ _id: 'b1', ticketSizeEstimate: { method: 'tier_band', computedAt: 'x', low: 5000, expected: 6000, high: 7000, currency: 'USD', confidence: 'high' } });
    const classifications = diffLeads(a, b);
    expect(classifications.find((c) => c.field === 'ticketSizeEstimate')?.kind).toBe('conflict');
  });

  it('fills a field from whichever side has it, without surfacing a conflict', () => {
    const a = baseLead({ _id: 'a1', notes: '' });
    const b = baseLead({ _id: 'b1', notes: 'Interested in Q3 renewal' });
    const classifications = diffLeads(a, b);
    const notes = classifications.find((c) => c.field === 'notes') as any;
    expect(notes.kind).toBe('fill-from-one-side');
    expect(notes.mergedValue).toBe('Interested in Q3 renewal');
  });

  it('classifies each qualification sub-field independently', () => {
    const a = baseLead({ _id: 'a1', qualification: { budgetConfirmed: true, needNotes: 'Needs analytics' } });
    const b = baseLead({ _id: 'b1', qualification: { budgetConfirmed: false, needNotes: 'Needs analytics' } });
    const classifications = diffLeads(a, b);
    const budget = classifications.find((c) => c.field === 'qualification.budgetConfirmed');
    const need = classifications.find((c) => c.field === 'qualification.needNotes');
    expect(budget?.kind).toBe('conflict');
    expect(need).toBeUndefined(); // identical — nothing to decide
  });

  it('sums feedbackScore/declineCount/acceptanceCount', () => {
    const a = baseLead({ _id: 'a1', feedbackScore: 3, declineCount: 1, acceptanceCount: 2 });
    const b = baseLead({ _id: 'b1', feedbackScore: 5, declineCount: 0, acceptanceCount: 1 });
    const classifications = diffLeads(a, b);
    expect((classifications.find((c) => c.field === 'feedbackScore') as any).mergedValue).toBe(8);
    expect((classifications.find((c) => c.field === 'declineCount') as any).mergedValue).toBe(1);
    expect((classifications.find((c) => c.field === 'acceptanceCount') as any).mergedValue).toBe(3);
  });
});

describe('buildMergedLead', () => {
  it('merges two identical leads with an empty resolutions map', () => {
    const a = baseLead({ _id: 'a1' });
    const b = baseLead({ _id: 'b1' });
    const merged = buildMergedLead(a, b, 'a1', {});
    expect(merged._id).toBe('a1');
    expect(merged.entity_name).toBe('Acme FC');
  });

  it('throws a clear error when a real conflict has no matching resolution', () => {
    const a = baseLead({ _id: 'a1', entity_name: 'Acme FC' });
    const b = baseLead({ _id: 'b1', entity_name: 'Acme Football Club' });
    expect(() => buildMergedLead(a, b, 'a1', {})).toThrow(/entity_name/);
  });

  it('applies the caller-chosen side for a real conflict', () => {
    const a = baseLead({ _id: 'a1', entity_name: 'Acme FC' });
    const b = baseLead({ _id: 'b1', entity_name: 'Acme Football Club' });
    const merged = buildMergedLead(a, b, 'a1', { entity_name: 'B' });
    expect(merged.entity_name).toBe('Acme Football Club');
  });

  it('never auto-resolves WON vs LOST and requires an explicit resolution', () => {
    const a = baseLead({ _id: 'a1', kanbanColumn: 'WON' });
    const b = baseLead({ _id: 'b1', kanbanColumn: 'LOST', declineReason: 'BUDGET_CONSTRAINTS', declinedAt: '2026-01-05T00:00:00.000Z' });
    expect(() => buildMergedLead(a, b, 'a1', {})).toThrow(/kanbanColumn/);

    const mergedAsLost = buildMergedLead(a, b, 'a1', { kanbanColumn: 'B' });
    expect(mergedAsLost.kanbanColumn).toBe('LOST');
    expect(mergedAsLost.declineReason).toBe('BUDGET_CONSTRAINTS');
    expect(mergedAsLost.declinedAt).toBe('2026-01-05T00:00:00.000Z');

    const mergedAsWon = buildMergedLead(a, b, 'a1', { kanbanColumn: 'A' });
    expect(mergedAsWon.kanbanColumn).toBe('WON');
    expect(mergedAsWon.declineReason).toBeUndefined();
    expect(mergedAsWon.declinedAt).toBeUndefined();
  });

  it('keeps the primary lead\'s own identity/bookkeeping fields regardless of which side conflicts resolve to', () => {
    const a = baseLead({ _id: 'a1', sortOrder: 100 });
    const b = baseLead({ _id: 'b1', sortOrder: 999, entity_name: 'Acme Football Club' });
    const merged = buildMergedLead(a, b, 'a1', { entity_name: 'B' });
    expect(merged._id).toBe('a1');
    expect(merged.sortOrder).toBe(100);
    expect(merged.entity_name).toBe('Acme Football Club');
  });

  it('recomputes a fresh fingerprint from the final merged identity fields, not a stale copy', () => {
    const a = baseLead({ _id: 'a1', entity_name: 'Acme FC', url: 'https://acme-fc.example.com', region: 'US', fingerprint: 'stale-a' });
    const b = baseLead({ _id: 'b1', entity_name: 'Acme Football Club', url: 'https://acme-fc.example.com', region: 'US', fingerprint: 'stale-b' });
    const merged = buildMergedLead(a, b, 'a1', { entity_name: 'B' });
    expect(merged.fingerprint).not.toBe('stale-a');
    expect(merged.fingerprint).not.toBe('stale-b');
  });

  it('recomputes scoreProfile from the final resolved ice values', () => {
    const a = baseLead({ _id: 'a1', ice: { impact: 5, confidence: 5, ease: 5 } });
    const b = baseLead({ _id: 'b1', ice: { impact: 9, confidence: 9, ease: 9 } });
    const merged = buildMergedLead(a, b, 'a1', { ice: 'B' });
    expect(merged.ice).toEqual({ impact: 9, confidence: 9, ease: 9 });
    expect(merged.scoreProfile?.finalBlended.ice).toBe(9 * 9 * 9);
  });

  it('throws if primaryId does not match either lead', () => {
    const a = baseLead({ _id: 'a1' });
    const b = baseLead({ _id: 'b1' });
    expect(() => buildMergedLead(a, b, 'c1', {})).toThrow(/primaryId/);
  });
});
