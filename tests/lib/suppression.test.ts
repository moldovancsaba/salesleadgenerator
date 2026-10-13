import { describe, it, expect, beforeEach } from 'vitest';
import {
  normalizeSuppressionTarget,
  isRecipientSuppressed,
  suppressRecipient,
  unsuppressRecipient,
  SUPPRESSION_COLLECTION,
} from '../../lib/suppression';

// In-memory mock Db for unit tests
class MockCollection {
  docs: any[] = [];

  async createIndex() {
    return 'index_created';
  }

  async findOne(filter: any) {
    return (
      this.docs.find((d) => {
        if (d.brand !== filter.brand) return false;
        if (d.tenantId !== filter.tenantId) return false;

        const orKindTarget = filter.$or?.some(
          (clause: any) => d.kind === clause.kind && d.target === clause.target
        );
        if (!orKindTarget) return false;

        if (d.expiresAt && filter.$and) {
          const expiresClause = filter.$and[0]?.$or?.find((c: any) => c.expiresAt?.$gt);
          if (expiresClause) {
            const nowIso = expiresClause.expiresAt.$gt;
            if (d.expiresAt <= nowIso) return false;
          }
        }

        return true;
      }) || null
    );
  }

  async updateOne(filter: any, update: any, options?: any) {
    const existingIndex = this.docs.findIndex(
      (d) =>
        d.brand === filter.brand &&
        d.tenantId === filter.tenantId &&
        d.kind === filter.kind &&
        d.target === filter.target
    );
    if (existingIndex >= 0) {
      this.docs[existingIndex] = { ...this.docs[existingIndex], ...update.$set };
    } else if (options?.upsert) {
      this.docs.push({ ...update.$set });
    }
    return { acknowledged: true };
  }

  async deleteOne(filter: any) {
    const idx = this.docs.findIndex(
      (d) =>
        d.brand === filter.brand &&
        d.tenantId === filter.tenantId &&
        d.kind === filter.kind &&
        d.target === filter.target
    );
    if (idx >= 0) {
      this.docs.splice(idx, 1);
      return { deletedCount: 1 };
    }
    return { deletedCount: 0 };
  }
}

class MockDb {
  collections: Record<string, MockCollection> = {};
  collection(name: string) {
    if (!this.collections[name]) {
      this.collections[name] = new MockCollection();
    }
    return this.collections[name];
  }
}

describe('normalizeSuppressionTarget', () => {
  it('normalizes valid emails', () => {
    expect(normalizeSuppressionTarget(' Test@Domain.COM ')).toEqual({
      kind: 'email',
      target: 'test@domain.com',
    });
  });

  it('normalizes valid domains', () => {
    expect(normalizeSuppressionTarget(' Domain.COM ')).toEqual({
      kind: 'domain',
      target: 'domain.com',
    });
  });

  it('rejects invalid targets', () => {
    expect(normalizeSuppressionTarget('')).toBeNull();
    expect(normalizeSuppressionTarget('not a domain')).toBeNull();
    expect(normalizeSuppressionTarget('http://domain.com')).toBeNull();
  });
});

describe('isRecipientSuppressed and suppressRecipient', () => {
  let db: any;

  beforeEach(() => {
    db = new MockDb();
  });

  it('returns suppressed: false when registry is empty', async () => {
    const res = await isRecipientSuppressed(db, 'cogmap', 'default', 'rep@partner.com');
    expect(res.suppressed).toBe(false);
  });

  it('suppresses by direct email match', async () => {
    await suppressRecipient(db, {
      brand: 'cogmap',
      tenantId: 'default',
      target: 'lead@target.com',
      reason: 'unsubscribed',
    });

    const res = await isRecipientSuppressed(db, 'cogmap', 'default', 'Lead@Target.COM');
    expect(res.suppressed).toBe(true);
    expect(res.reason).toBe('unsubscribed');

    // Unrelated email is not suppressed
    const other = await isRecipientSuppressed(db, 'cogmap', 'default', 'other@target.com');
    expect(other.suppressed).toBe(false);
  });

  it('suppresses all emails by domain match', async () => {
    await suppressRecipient(db, {
      brand: 'seyu',
      tenantId: 'default',
      target: 'competitor.com',
      reason: 'do_not_contact',
    });

    const user1 = await isRecipientSuppressed(db, 'seyu', 'default', 'alice@competitor.com');
    expect(user1.suppressed).toBe(true);
    expect(user1.reason).toBe('do_not_contact');

    const user2 = await isRecipientSuppressed(db, 'seyu', 'default', 'bob@competitor.com');
    expect(user2.suppressed).toBe(true);
  });

  it('respects expiresAt', async () => {
    const now = new Date('2026-10-13T10:00:00Z');
    const past = new Date('2026-10-13T09:00:00Z').toISOString();
    const future = new Date('2026-10-13T11:00:00Z').toISOString();

    await suppressRecipient(db, {
      brand: 'cogmap',
      tenantId: 'default',
      target: 'temp-expired@test.com',
      reason: 'bounced',
      expiresAt: past,
    });

    await suppressRecipient(db, {
      brand: 'cogmap',
      tenantId: 'default',
      target: 'temp-valid@test.com',
      reason: 'bounced',
      expiresAt: future,
    });

    const expired = await isRecipientSuppressed(db, 'cogmap', 'default', 'temp-expired@test.com', now);
    expect(expired.suppressed).toBe(false);

    const active = await isRecipientSuppressed(db, 'cogmap', 'default', 'temp-valid@test.com', now);
    expect(active.suppressed).toBe(true);
  });

  it('allows unsuppressing a target', async () => {
    await suppressRecipient(db, {
      brand: 'dvsc',
      tenantId: 'default',
      target: 'client@club.com',
      reason: 'manual',
    });

    expect((await isRecipientSuppressed(db, 'dvsc', 'default', 'client@club.com')).suppressed).toBe(true);

    const removed = await unsuppressRecipient(db, 'dvsc', 'default', 'client@club.com');
    expect(removed).toBe(true);

    expect((await isRecipientSuppressed(db, 'dvsc', 'default', 'client@club.com')).suppressed).toBe(false);
  });
});
