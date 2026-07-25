import type { Db } from 'mongodb';
import { estimateTicketSize } from '../../lib/ticket-size';
import type { TicketSizeResult, TicketSizeProductInput, TicketSizeTier } from '../../lib/ticket-size';
import { defaultRevenueTargetCurrency } from './sales-settings';
import type { SalesSettings, ProductLine } from './sales-settings';

const VALID_SIZE_TIERS: TicketSizeTier[] = ['Small', 'Medium', 'Large', 'Enterprise'];

function toProductInputs(products: ProductLine[]): TicketSizeProductInput[] {
  return products.map((p) => ({
    customerSize: p.customerSize,
    perUnitRate: p.pricing.perUserTypical ?? p.pricing.perUserPrice,
  }));
}

// Called synchronously from POST /api/leads and PUT /api/leads/[id] — this
// is an in-process computation against a single small company_settings
// lookup, not an outbound network call, so there is no latency reason to
// defer it the way lib/tech-stack-scan.ts's fire-and-forget scan is
// deferred (issue #69). The caller needs the value on the very next read.
export async function computeTicketSizeForLead(
  db: Db,
  brand: string,
  tenantId: string,
  lead: { size?: string; estimated_participants?: number }
): Promise<TicketSizeResult> {
  const settings = (await db.collection('company_settings').findOne({ brand, tenantId })) as SalesSettings | null;
  const currency = defaultRevenueTargetCurrency(brand);
  const sizeTier = (VALID_SIZE_TIERS as string[]).includes(lead.size || '') ? (lead.size as TicketSizeTier) : undefined;
  const unitCount = typeof lead.estimated_participants === 'number' && lead.estimated_participants > 0
    ? lead.estimated_participants
    : undefined;

  return estimateTicketSize(
    { sizeTier, unitCount, currency },
    settings?.dealSize || {},
    settings ? toProductInputs(settings.products) : []
  );
}
