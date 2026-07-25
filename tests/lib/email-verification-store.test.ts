import { describe, it, expect, vi } from 'vitest';
import { ObjectId } from 'mongodb';
import { verifyLeadContactsAsync } from '../../app/lib/email-verification-store';
import type { MxLookupResult } from '../../lib/email-verification';

function fakeDb(updateOne: ReturnType<typeof vi.fn>) {
  return { collection: () => ({ updateOne }) } as any;
}

describe('verifyLeadContactsAsync', () => {
  it('dedupes DNS lookups per unique domain, not per contact', async () => {
    const checkDomainFn = vi.fn(async (): Promise<MxLookupResult> => ({ ok: true, hosts: ['mx.acme.com'] }));
    const updateOne = vi.fn().mockResolvedValue({});
    const leadId = new ObjectId();

    await verifyLeadContactsAsync(
      fakeDb(updateOne),
      'leads',
      leadId,
      ['jane@acme.com', 'bob@acme.com', 'sue@other.com'],
      checkDomainFn
    );

    expect(checkDomainFn).toHaveBeenCalledTimes(2); // acme.com once, other.com once
    expect(checkDomainFn).toHaveBeenCalledWith('acme.com');
    expect(checkDomainFn).toHaveBeenCalledWith('other.com');
    expect(updateOne).toHaveBeenCalledTimes(3); // one write-back per contact email
  });

  it('deduplicates identical email addresses before dispatching any lookups', async () => {
    const checkDomainFn = vi.fn(async (): Promise<MxLookupResult> => ({ ok: true, hosts: ['mx.acme.com'] }));
    const updateOne = vi.fn().mockResolvedValue({});

    await verifyLeadContactsAsync(fakeDb(updateOne), 'leads', new ObjectId(), ['jane@acme.com', 'jane@acme.com'], checkDomainFn);

    expect(checkDomainFn).toHaveBeenCalledTimes(1);
    expect(updateOne).toHaveBeenCalledTimes(1);
  });

  it('writes each contact its own status via a positional $ match on its email', async () => {
    const checkDomainFn = vi.fn(async (): Promise<MxLookupResult> => ({ ok: false, reason: 'nxdomain' }));
    const updateOne = vi.fn().mockResolvedValue({});
    const leadId = new ObjectId();

    await verifyLeadContactsAsync(fakeDb(updateOne), 'leads', leadId, ['jane@nowhere.invalid'], checkDomainFn);

    expect(updateOne).toHaveBeenCalledWith(
      { _id: leadId, 'contacts.email': 'jane@nowhere.invalid' },
      { $set: { 'contacts.$.emailVerificationStatus': expect.objectContaining({ status: 'mx-failed', error: 'nxdomain' }), updatedAt: expect.any(Date) } }
    );
  });

  it('does nothing and never throws for an empty email list', async () => {
    const checkDomainFn = vi.fn();
    const updateOne = vi.fn();
    await expect(verifyLeadContactsAsync(fakeDb(updateOne), 'leads', new ObjectId(), [], checkDomainFn)).resolves.toBeUndefined();
    expect(checkDomainFn).not.toHaveBeenCalled();
    expect(updateOne).not.toHaveBeenCalled();
  });

  it('never throws even when the domain check itself rejects', async () => {
    const checkDomainFn = vi.fn().mockRejectedValue(new Error('dns exploded'));
    const updateOne = vi.fn();
    await expect(
      verifyLeadContactsAsync(fakeDb(updateOne), 'leads', new ObjectId(), ['jane@acme.com'], checkDomainFn)
    ).resolves.toBeUndefined();
  });

  it('never throws even when the Mongo write-back itself rejects', async () => {
    const checkDomainFn = vi.fn(async (): Promise<MxLookupResult> => ({ ok: true, hosts: ['mx.acme.com'] }));
    const updateOne = vi.fn().mockRejectedValue(new Error('mongo down'));
    await expect(
      verifyLeadContactsAsync(fakeDb(updateOne), 'leads', new ObjectId(), ['jane@acme.com'], checkDomainFn)
    ).resolves.toBeUndefined();
  });

  it('ignores blank/whitespace-only emails without dispatching a lookup for them', async () => {
    const checkDomainFn = vi.fn(async (): Promise<MxLookupResult> => ({ ok: true, hosts: ['mx.acme.com'] }));
    const updateOne = vi.fn().mockResolvedValue({});
    await verifyLeadContactsAsync(fakeDb(updateOne), 'leads', new ObjectId(), ['', '  ', 'jane@acme.com'], checkDomainFn);
    expect(checkDomainFn).toHaveBeenCalledTimes(1);
    expect(updateOne).toHaveBeenCalledTimes(1);
  });
});
