import { describe, it, expect, vi } from 'vitest';
import { SzamlazzClient, issueProformaForQuote } from '../../lib/szamlazz-service';
import { ObjectId } from 'mongodb';

describe('Számlázz.hu Service Integration (Issue 291)', () => {
  it('submits proforma XML via fetch and parses result', async () => {
    const mockXmlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<xmlszamlavalasz xmlns="http://www.szamlazz.hu/xmlszamlavalasz">
  <sikeres>true</sikeres>
  <szamlaszam>DIJ-2026-101</szamlaszam>
  <szamlaNettoVegosszeg>2500.00</szamlaNettoVegosszeg>
  <szamlaBruttoVegosszeg>3175.00</szamlaBruttoVegosszeg>
</xmlszamlavalasz>`;

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => mockXmlResponse,
    });

    const client = new SzamlazzClient({
      apiKey: 'test-key',
      fetchFn: mockFetch as any,
    });

    const res = await client.createProforma({
      currency: 'EUR',
      orderNumber: 'Q-123',
      buyer: { name: 'Acme Club' },
      items: [
        {
          name: 'Court Software',
          quantity: 1,
          unit: 'year',
          netUnitPrice: 2500,
          vatRate: '27',
          netTotal: 2500,
          vatTotal: 675,
          grossTotal: 3175,
        },
      ],
    });

    expect(res.ok).toBe(true);
    expect(res.invoiceNumber).toBe('DIJ-2026-101');
    expect(res.grossTotal).toBe(3175);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('orchestrates issueProformaForQuote and records proforma details on quote document', async () => {
    const testQuoteId = new ObjectId();
    const mockQuote = {
      _id: testQuoteId,
      tenantId: 'default',
      brand: 'cogmap',
      totalValue: 5000,
      currency: 'EUR',
      signerName: 'John Doe',
      signerEmail: 'john@example.com',
      lineItems: [
        { label: 'Platform License', value: 5000, quantity: 1, unitPrice: 5000 },
      ],
    };

    const mockCollection = {
      findOne: vi.fn().mockResolvedValue(mockQuote),
      updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
    };

    const mockDb: any = {
      collection: vi.fn().mockReturnValue(mockCollection),
    };

    const mockClient: any = {
      createProforma: vi.fn().mockResolvedValue({
        ok: true,
        invoiceNumber: 'DIJ-2026-555',
        netTotal: 5000,
        grossTotal: 6350,
      }),
    };

    const res = await issueProformaForQuote(mockDb, {
      quoteId: testQuoteId.toString(),
      brand: 'cogmap',
      tenantId: 'default',
      client: mockClient,
    });

    expect(res.ok).toBe(true);
    expect(res.invoiceNumber).toBe('DIJ-2026-555');
    expect(mockCollection.updateOne).toHaveBeenCalledWith(
      { _id: testQuoteId },
      expect.objectContaining({
        $set: expect.objectContaining({
          proformaInvoiceNumber: 'DIJ-2026-555',
        }),
      })
    );
  });
});
