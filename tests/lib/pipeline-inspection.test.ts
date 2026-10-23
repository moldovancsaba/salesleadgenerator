import { describe, it, expect } from 'vitest';
import {
  computePipelineInspection,
  resolveLeadCommercialValue,
  type InspectionLeadInput,
  type InspectionOutcomeLog,
} from '../../lib/pipeline-inspection';

describe('resolveLeadCommercialValue (issue 277)', () => {
  it('prefers explicit deals sum over ticketSizeEstimate', () => {
    const res = resolveLeadCommercialValue({
      _id: 'l1',
      entity_name: 'Club A',
      kanbanColumn: 'PROPOSAL',
      deals: [{ id: 'd1', value: 45000, currency: 'EUR', createdAt: '', updatedAt: '', source: 'manual' }],
      ticketSizeEstimate: { expected: 20000, currency: 'EUR' },
    });
    expect(res).toEqual({ value: 45000, currency: 'EUR' });
  });

  it('falls back to ticketSizeEstimate.expected when no deals exist', () => {
    const res = resolveLeadCommercialValue({
      _id: 'l2',
      entity_name: 'Club B',
      kanbanColumn: 'QUALIFIED',
      ticketSizeEstimate: { expected: 18500, currency: 'USD' },
    });
    expect(res).toEqual({ value: 18500, currency: 'USD' });
  });
});

describe('computePipelineInspection (issue 277)', () => {
  const now = new Date('2026-10-23T12:00:00.000Z');

  it('classifies new, advanced, regressed, won, lost, and slipped deals accurately', () => {
    const leads: InspectionLeadInput[] = [
      {
        _id: 'lead-new',
        entity_name: 'New FC',
        kanbanColumn: 'DISCOVERED',
        createdAt: '2026-10-15T10:00:00.000Z',
        updatedAt: '2026-10-15T10:00:00.000Z',
        ticketSizeEstimate: { expected: 15000, currency: 'EUR' },
      },
      {
        _id: 'lead-adv',
        entity_name: 'Advanced FC',
        kanbanColumn: 'PROPOSAL',
        createdAt: '2026-08-01T10:00:00.000Z',
        updatedAt: '2026-10-18T10:00:00.000Z',
        ticketSizeEstimate: { expected: 30000, currency: 'EUR' },
      },
      {
        _id: 'lead-reg',
        entity_name: 'Regressed FC',
        kanbanColumn: 'QUALIFIED',
        createdAt: '2026-08-01T10:00:00.000Z',
        updatedAt: '2026-10-19T10:00:00.000Z',
        ticketSizeEstimate: { expected: 10000, currency: 'EUR' },
      },
      {
        _id: 'lead-won',
        entity_name: 'Champion FC',
        kanbanColumn: 'WON',
        createdAt: '2026-07-01T10:00:00.000Z',
        updatedAt: '2026-10-20T10:00:00.000Z',
        ticketSizeEstimate: { expected: 50000, currency: 'EUR' },
      },
      {
        _id: 'lead-lost',
        entity_name: 'Lost FC',
        kanbanColumn: 'LOST',
        createdAt: '2026-07-01T10:00:00.000Z',
        updatedAt: '2026-10-21T10:00:00.000Z',
        ticketSizeEstimate: { expected: 12000, currency: 'EUR' },
      },
      {
        _id: 'lead-slipped',
        entity_name: 'Stale Proposal FC',
        kanbanColumn: 'PROPOSAL',
        createdAt: '2026-07-01T10:00:00.000Z',
        updatedAt: '2026-09-25T10:00:00.000Z', // 28 days idle (> 10d PROPOSAL threshold)
        ticketSizeEstimate: { expected: 25000, currency: 'EUR' },
      },
    ];

    const logs: InspectionOutcomeLog[] = [
      {
        leadId: 'lead-adv',
        createdAt: '2026-10-18T10:00:00.000Z',
        beforeState: { kanbanColumn: 'ENGAGED' },
        afterState: { kanbanColumn: 'PROPOSAL' },
      },
      {
        leadId: 'lead-reg',
        createdAt: '2026-10-19T10:00:00.000Z',
        beforeState: { kanbanColumn: 'PROPOSAL' },
        afterState: { kanbanColumn: 'QUALIFIED' },
      },
      {
        leadId: 'lead-won',
        createdAt: '2026-10-20T10:00:00.000Z',
        beforeState: { kanbanColumn: 'PROPOSAL' },
        afterState: { kanbanColumn: 'WON' },
      },
      {
        leadId: 'lead-lost',
        createdAt: '2026-10-21T10:00:00.000Z',
        beforeState: { kanbanColumn: 'ENGAGED' },
        afterState: { kanbanColumn: 'LOST' },
      },
    ];

    const report = computePipelineInspection(leads, logs, 30, now, 'EUR');

    expect(report.buckets.new).toEqual({
      bucket: 'new',
      label: 'New Pipeline',
      count: 1,
      totalValue: 15000,
    });
    expect(report.buckets.advanced).toEqual({
      bucket: 'advanced',
      label: 'Stage Advanced',
      count: 1,
      totalValue: 30000,
    });
    expect(report.buckets.regressed).toEqual({
      bucket: 'regressed',
      label: 'Stage Regressed',
      count: 1,
      totalValue: 10000,
    });
    expect(report.buckets.won).toEqual({
      bucket: 'won',
      label: 'Closed Won',
      count: 1,
      totalValue: 50000,
    });
    expect(report.buckets.lost).toEqual({
      bucket: 'lost',
      label: 'Closed Lost',
      count: 1,
      totalValue: 12000,
    });
    expect(report.buckets.slipped).toEqual({
      bucket: 'slipped',
      label: 'Slipped / Stale',
      count: 1,
      totalValue: 25000,
    });

    // Net delta = new (15k) + advanced (30k) - lost (12k) - regressed (10k) = +23,000
    expect(report.netPipelineDeltaValue).toBe(23000);
    expect(report.netPipelineDeltaCount).toBe(0);
  });
});
