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
  lead: { size?: string; estimated_participants?: number; region?: string }
): Promise<TicketSizeResult> {
  const settings = (await db.collection('company_settings').findOne({ brand, tenantId })) as SalesSettings | null;
  // Issue #169 — previously always recomputed the brand's fixed default
  // here, silently ignoring an operator's own currency choice saved via the
  // Sales Settings page (settings.revenueTarget.currency). The settings doc
  // is already loaded above; read the real selection from it before falling
  // back to the brand default for a not-yet-configured brand/tenant.
  const currency = settings?.revenueTarget?.currency ?? defaultRevenueTargetCurrency(brand);
  const sizeTier = (VALID_SIZE_TIERS as string[]).includes(lead.size || '') ? (lead.size as TicketSizeTier) : undefined;
  const unitCount = typeof lead.estimated_participants === 'number' && lead.estimated_participants > 0
    ? lead.estimated_participants
    : undefined;
  // Region is free text (see RegionMultipliers' own comment in
  // app/lib/sales-settings.ts) — an unrecognized/unconfigured region simply
  // finds no entry here, and lib/ticket-size.ts's own resolveRegionMultiplier()
  // treats that as a 1.0 no-op, never an error (issue #84).
  const regionMultiplier = lead.region ? settings?.regionMultipliers?.[lead.region.toUpperCase()] : undefined;

  return estimateTicketSize(
    { sizeTier, unitCount, currency, regionMultiplier },
    settings?.dealSize || {},
    settings ? toProductInputs(settings.products) : []
  );
}
