import { describe, it, expect } from 'vitest';

describe('Contacts & Accounts UX Ergonomics (Issue 321)', () => {
  type Contact = {
    name: string;
    phone: string;
    buyingRole: string;
  };

  const sampleContacts: Contact[] = [
    { name: 'Alice Smith', phone: '+123456789', buyingRole: 'decision_maker' },
    { name: 'Bob Jones', phone: '', buyingRole: 'champion' },
    { name: 'Charlie Brown', phone: '   ', buyingRole: 'economic_buyer' },
    { name: 'Diana Prince', phone: '+987654321', buyingRole: 'influencer' },
  ];

  it('filters contacts by phone presence correctly', () => {
    const withPhone = sampleContacts.filter((c) => Boolean(c.phone && c.phone.trim().length > 3));
    expect(withPhone).toHaveLength(2);
    expect(withPhone.map((c) => c.name)).toEqual(['Alice Smith', 'Diana Prince']);
  });

  it('computes account pipeline-to-won percentage distribution accurately', () => {
    const account = {
      pipelineValueUsd: 75000,
      wonValueUsd: 25000,
    };

    const total = account.pipelineValueUsd + account.wonValueUsd;
    const wonPercent = Math.round((account.wonValueUsd / total) * 100);
    const pipePercent = 100 - wonPercent;

    expect(total).toBe(100000);
    expect(wonPercent).toBe(25);
    expect(pipePercent).toBe(75);
  });

  it('handles zero-value accounts without division by zero', () => {
    const account = { pipelineValueUsd: 0, wonValueUsd: 0 };
    const total = account.pipelineValueUsd + account.wonValueUsd;
    const wonPercent = total > 0 ? Math.round((account.wonValueUsd / total) * 100) : 0;
    const pipePercent = total > 0 ? 100 - wonPercent : 0;

    expect(wonPercent).toBe(0);
    expect(pipePercent).toBe(0);
  });
});
