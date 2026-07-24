// Company Setup / Sales Settings — a plain-language questionnaire capturing
// what a brand sells, who buys it, and how it's priced, so the OpenClaw/
// KiloClaw research agent (agent-runtime/) can refine lead scoring and
// forecasts. Deliberately avoids financial/accounting terms (ACV, ARR, MRR)
// in favor of the way a founder or small commercial team already thinks
// about their business — see GitHub issue #24 for the full rationale.

export type CustomerType =
  | 'sports_clubs'
  | 'federations'
  | 'schools'
  | 'academies'
  | 'event_organisers'
  | 'sponsors'
  | 'brands'
  | 'government'
  | 'other';

export type BuyerRole =
  | 'ceo'
  | 'marketing'
  | 'commercial'
  | 'coach'
  | 'federation'
  | 'club'
  | 'brand'
  | 'parent'
  | 'athlete'
  | 'other';

export type CustomerSize = 'individual' | 'small' | 'medium' | 'large' | 'enterprise';

export type PricingModel =
  | 'one_time'
  | 'monthly_subscription'
  | 'annual_subscription'
  | 'framework_agreement'
  | 'campaign_based'
  | 'per_user'
  | 'per_product'
  | 'per_event'
  | 'custom_quotation';

export type PurchaseFrequency =
  | 'once'
  | 'monthly'
  | 'yearly'
  | 'per_season'
  | 'per_event'
  | 'irregular';

export type SalesCycleLength =
  | 'under_1_month'
  | '1_3_months'
  | '3_6_months'
  | '6_12_months'
  | 'over_12_months';

export type RevenuePredictability = 'very_predictable' | 'predictable' | 'medium' | 'difficult';

export type Quarter = 'Q1' | 'Q2' | 'Q3' | 'Q4';

export interface ProductPricing {
  oneTimePrice?: number;
  monthlyPrice?: number;
  annualPrice?: number;
  frameworkAnnualValue?: number;
  campaignPrice?: number;
  campaignDurationMonths?: number;
  perUserPrice?: number;
  perUserMinimum?: number;
  perUserTypical?: number;
  perProductPrice?: number;
  perEventPrice?: number;
  customQuotationTypicalValue?: number;
}

export interface ProductLine {
  id: string;
  name: string;
  description: string;
  whyTheyBuy: string;
  typicalBuyer: BuyerRole[];
  typicalBuyerOther: string;
  customerSize: CustomerSize[];
  pricingModels: PricingModel[];
  pricing: ProductPricing;
  revenuePredictability: RevenuePredictability | '';
}

export interface DealSize {
  small?: number;
  medium?: number;
  large?: number;
  largestWon?: number;
}

export interface Upsell {
  commonAdditionalProducts: string;
  typicalValue?: number;
}

export interface ExampleCustomer {
  name: string;
  productsPurchased: string;
  totalContractValue?: number;
  contractLength: string;
}

export interface Seasonality {
  quarters: Quarter[];
  specificMonths: string;
}

export interface SalesSettings {
  brand: string;
  tenantId: string;
  companyName: string;
  contactPerson: string;
  website: string;
  mainIndustry: string;
  customerTypes: CustomerType[];
  customerTypesOther: string;
  products: ProductLine[];
  dealSize: DealSize;
  purchaseFrequency: PurchaseFrequency[];
  purchaseFrequencyComments: string;
  upsell: Upsell;
  salesCycle: SalesCycleLength | '';
  approver: string;
  exampleCustomer: ExampleCustomer;
  seasonality: Seasonality;
  notes: string;
  updatedAt?: string;
}

export function emptyProductLine(id: string): ProductLine {
  return {
    id,
    name: '',
    description: '',
    whyTheyBuy: '',
    typicalBuyer: [],
    typicalBuyerOther: '',
    customerSize: [],
    pricingModels: [],
    pricing: {},
    revenuePredictability: '',
  };
}

export function emptySalesSettings(brand: string, tenantId = 'default'): SalesSettings {
  return {
    brand,
    tenantId,
    companyName: '',
    contactPerson: '',
    website: '',
    mainIndustry: '',
    customerTypes: [],
    customerTypesOther: '',
    products: [],
    dealSize: {},
    purchaseFrequency: [],
    purchaseFrequencyComments: '',
    upsell: { commonAdditionalProducts: '' },
    salesCycle: '',
    approver: '',
    exampleCustomer: { name: '', productsPurchased: '', contractLength: '' },
    seasonality: { quarters: [], specificMonths: '' },
    notes: '',
  };
}

const CUSTOMER_TYPES: CustomerType[] = [
  'sports_clubs', 'federations', 'schools', 'academies',
  'event_organisers', 'sponsors', 'brands', 'government', 'other',
];
const BUYER_ROLES: BuyerRole[] = [
  'ceo', 'marketing', 'commercial', 'coach', 'federation',
  'club', 'brand', 'parent', 'athlete', 'other',
];
const CUSTOMER_SIZES: CustomerSize[] = ['individual', 'small', 'medium', 'large', 'enterprise'];
const PRICING_MODELS: PricingModel[] = [
  'one_time', 'monthly_subscription', 'annual_subscription', 'framework_agreement',
  'campaign_based', 'per_user', 'per_product', 'per_event', 'custom_quotation',
];
const PURCHASE_FREQUENCIES: PurchaseFrequency[] = [
  'once', 'monthly', 'yearly', 'per_season', 'per_event', 'irregular',
];
const SALES_CYCLE_LENGTHS: SalesCycleLength[] = [
  'under_1_month', '1_3_months', '3_6_months', '6_12_months', 'over_12_months',
];
const REVENUE_PREDICTABILITY: RevenuePredictability[] = [
  'very_predictable', 'predictable', 'medium', 'difficult',
];
const QUARTERS: Quarter[] = ['Q1', 'Q2', 'Q3', 'Q4'];

function sanitizeString(value: unknown, maxLength = 2000): string {
  if (typeof value !== 'string') return '';
  return value.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').trim().slice(0, maxLength);
}

function sanitizeEnumArray<T extends string>(value: unknown, allowed: T[]): T[] {
  if (!Array.isArray(value)) return [];
  const allowedSet = new Set<string>(allowed);
  return Array.from(new Set(value.filter((v): v is T => typeof v === 'string' && allowedSet.has(v))));
}

function sanitizeEnum<T extends string>(value: unknown, allowed: T[]): T | '' {
  return typeof value === 'string' && (allowed as string[]).includes(value) ? (value as T) : '';
}

// Coerces a submitted price/quantity field to a non-negative number, or
// undefined if genuinely absent — never a corrupted string, the same class
// of bug the 2.4.8 ICE-field incident already fixed once for leads.
function sanitizeOptionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const num = typeof value === 'number' ? value : parseFloat(String(value));
  if (Number.isNaN(num)) return undefined;
  return Math.max(0, num);
}

function sanitizeProductPricing(value: unknown): ProductPricing {
  const raw = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  return {
    oneTimePrice: sanitizeOptionalNumber(raw.oneTimePrice),
    monthlyPrice: sanitizeOptionalNumber(raw.monthlyPrice),
    annualPrice: sanitizeOptionalNumber(raw.annualPrice),
    frameworkAnnualValue: sanitizeOptionalNumber(raw.frameworkAnnualValue),
    campaignPrice: sanitizeOptionalNumber(raw.campaignPrice),
    campaignDurationMonths: sanitizeOptionalNumber(raw.campaignDurationMonths),
    perUserPrice: sanitizeOptionalNumber(raw.perUserPrice),
    perUserMinimum: sanitizeOptionalNumber(raw.perUserMinimum),
    perUserTypical: sanitizeOptionalNumber(raw.perUserTypical),
    perProductPrice: sanitizeOptionalNumber(raw.perProductPrice),
    perEventPrice: sanitizeOptionalNumber(raw.perEventPrice),
    customQuotationTypicalValue: sanitizeOptionalNumber(raw.customQuotationTypicalValue),
  };
}

function sanitizeProductLine(value: unknown, index: number): ProductLine {
  const raw = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  return {
    id: sanitizeString(raw.id, 100) || `product-${index}`,
    name: sanitizeString(raw.name, 200),
    description: sanitizeString(raw.description, 1000),
    whyTheyBuy: sanitizeString(raw.whyTheyBuy, 1000),
    typicalBuyer: sanitizeEnumArray(raw.typicalBuyer, BUYER_ROLES),
    typicalBuyerOther: sanitizeString(raw.typicalBuyerOther, 200),
    customerSize: sanitizeEnumArray(raw.customerSize, CUSTOMER_SIZES),
    pricingModels: sanitizeEnumArray(raw.pricingModels, PRICING_MODELS),
    pricing: sanitizeProductPricing(raw.pricing),
    revenuePredictability: sanitizeEnum(raw.revenuePredictability, REVENUE_PREDICTABILITY),
  };
}

// Normalizes an arbitrary request body into a well-shaped SalesSettings
// document before it's written to MongoDB — every field defaults to an
// empty/safe value rather than throwing, mirroring app/lib/normalize-lead.ts.
export function sanitizeSalesSettings(body: unknown, brand: string, tenantId: string): SalesSettings {
  const raw = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const dealSizeRaw = (raw.dealSize && typeof raw.dealSize === 'object' ? raw.dealSize : {}) as Record<string, unknown>;
  const upsellRaw = (raw.upsell && typeof raw.upsell === 'object' ? raw.upsell : {}) as Record<string, unknown>;
  const exampleCustomerRaw = (raw.exampleCustomer && typeof raw.exampleCustomer === 'object' ? raw.exampleCustomer : {}) as Record<string, unknown>;
  const seasonalityRaw = (raw.seasonality && typeof raw.seasonality === 'object' ? raw.seasonality : {}) as Record<string, unknown>;

  return {
    brand,
    tenantId,
    companyName: sanitizeString(raw.companyName, 200),
    contactPerson: sanitizeString(raw.contactPerson, 200),
    website: sanitizeString(raw.website, 300),
    mainIndustry: sanitizeString(raw.mainIndustry, 200),
    customerTypes: sanitizeEnumArray(raw.customerTypes, CUSTOMER_TYPES),
    customerTypesOther: sanitizeString(raw.customerTypesOther, 200),
    products: Array.isArray(raw.products) ? raw.products.map((p, i) => sanitizeProductLine(p, i)) : [],
    dealSize: {
      small: sanitizeOptionalNumber(dealSizeRaw.small),
      medium: sanitizeOptionalNumber(dealSizeRaw.medium),
      large: sanitizeOptionalNumber(dealSizeRaw.large),
      largestWon: sanitizeOptionalNumber(dealSizeRaw.largestWon),
    },
    purchaseFrequency: sanitizeEnumArray(raw.purchaseFrequency, PURCHASE_FREQUENCIES),
    purchaseFrequencyComments: sanitizeString(raw.purchaseFrequencyComments, 1000),
    upsell: {
      commonAdditionalProducts: sanitizeString(upsellRaw.commonAdditionalProducts, 1000),
      typicalValue: sanitizeOptionalNumber(upsellRaw.typicalValue),
    },
    salesCycle: sanitizeEnum(raw.salesCycle, SALES_CYCLE_LENGTHS),
    approver: sanitizeString(raw.approver, 300),
    exampleCustomer: {
      name: sanitizeString(exampleCustomerRaw.name, 200),
      productsPurchased: sanitizeString(exampleCustomerRaw.productsPurchased, 1000),
      totalContractValue: sanitizeOptionalNumber(exampleCustomerRaw.totalContractValue),
      contractLength: sanitizeString(exampleCustomerRaw.contractLength, 200),
    },
    seasonality: {
      quarters: sanitizeEnumArray(seasonalityRaw.quarters, QUARTERS),
      specificMonths: sanitizeString(seasonalityRaw.specificMonths, 300),
    },
    notes: sanitizeString(raw.notes, 4000),
  };
}

export const CUSTOMER_TYPE_OPTIONS: { value: CustomerType; label: string }[] = [
  { value: 'sports_clubs', label: 'Sports clubs' },
  { value: 'federations', label: 'Federations' },
  { value: 'schools', label: 'Schools' },
  { value: 'academies', label: 'Academies' },
  { value: 'event_organisers', label: 'Event organisers' },
  { value: 'sponsors', label: 'Sponsors' },
  { value: 'brands', label: 'Brands' },
  { value: 'government', label: 'Government' },
  { value: 'other', label: 'Other' },
];

export const BUYER_ROLE_OPTIONS: { value: BuyerRole; label: string }[] = [
  { value: 'ceo', label: 'CEO' },
  { value: 'marketing', label: 'Marketing' },
  { value: 'commercial', label: 'Commercial' },
  { value: 'coach', label: 'Coach' },
  { value: 'federation', label: 'Federation' },
  { value: 'club', label: 'Club' },
  { value: 'brand', label: 'Brand' },
  { value: 'parent', label: 'Parent' },
  { value: 'athlete', label: 'Athlete' },
  { value: 'other', label: 'Other' },
];

export const CUSTOMER_SIZE_OPTIONS: { value: CustomerSize; label: string }[] = [
  { value: 'individual', label: 'Individual' },
  { value: 'small', label: 'Small organisation' },
  { value: 'medium', label: 'Medium organisation' },
  { value: 'large', label: 'Large organisation' },
  { value: 'enterprise', label: 'Enterprise' },
];

export const PRICING_MODEL_OPTIONS: { value: PricingModel; label: string }[] = [
  { value: 'one_time', label: 'One-time purchase' },
  { value: 'monthly_subscription', label: 'Monthly subscription' },
  { value: 'annual_subscription', label: 'Annual subscription' },
  { value: 'framework_agreement', label: 'Framework agreement' },
  { value: 'campaign_based', label: 'Campaign based' },
  { value: 'per_user', label: 'Per user' },
  { value: 'per_product', label: 'Per product sold' },
  { value: 'per_event', label: 'Per event' },
  { value: 'custom_quotation', label: 'Custom quotation' },
];

export const PURCHASE_FREQUENCY_OPTIONS: { value: PurchaseFrequency; label: string }[] = [
  { value: 'once', label: 'Once only' },
  { value: 'monthly', label: 'Every month' },
  { value: 'yearly', label: 'Every year' },
  { value: 'per_season', label: 'Before every season' },
  { value: 'per_event', label: 'Before every event' },
  { value: 'irregular', label: 'Irregular' },
];

export const SALES_CYCLE_OPTIONS: { value: SalesCycleLength; label: string }[] = [
  { value: 'under_1_month', label: 'Less than 1 month' },
  { value: '1_3_months', label: '1–3 months' },
  { value: '3_6_months', label: '3–6 months' },
  { value: '6_12_months', label: '6–12 months' },
  { value: 'over_12_months', label: 'More than 12 months' },
];

export const REVENUE_PREDICTABILITY_OPTIONS: { value: RevenuePredictability; label: string }[] = [
  { value: 'very_predictable', label: 'Very predictable' },
  { value: 'predictable', label: 'Predictable' },
  { value: 'medium', label: 'Medium' },
  { value: 'difficult', label: 'Difficult' },
];

export const QUARTER_OPTIONS: { value: Quarter; label: string }[] = [
  { value: 'Q1', label: 'Q1' },
  { value: 'Q2', label: 'Q2' },
  { value: 'Q3', label: 'Q3' },
  { value: 'Q4', label: 'Q4' },
];
