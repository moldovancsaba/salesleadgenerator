/**
 * Pure XML generator and response parser for Számlázz.hu Számla Agent API.
 * Standards-compliant implementation supporting Hungarian electronic invoices and proforma (Díjbekérő).
 *
 * Official Számlázz.hu Agent Endpoint: https://www.szamlazz.hu/szamla/
 * Target entity: Moldován Csaba Kft.
 */

export interface SzamlazzCredentials {
  apiKey: string; // szamlaagentkulcs
  eInvoice?: boolean; // eszamla (default false for proforma, true for official e-invoice)
}

export interface SzamlazzBuyer {
  name: string;
  country?: string;
  zip?: string;
  city?: string;
  address?: string;
  email?: string;
  taxNumber?: string; // adoszam
  euTaxNumber?: string; // eu adoszam
}

export interface SzamlazzSeller {
  bankName?: string;
  bankAccount?: string;
  emailReplyTo?: string;
}

export interface SzamlazzItem {
  name: string;
  quantity: number;
  unit: string; // pl. 'db', 'hó', 'alkalom'
  netUnitPrice: number;
  vatRate: string; // pl. '27', '0', 'TEHK', 'AAM', 'EU'
  netTotal: number;
  vatTotal: number;
  grossTotal: number;
  comment?: string;
}

export interface CreateProformaParams {
  credentials: SzamlazzCredentials;
  currency: 'HUF' | 'EUR' | 'USD';
  orderNumber: string; // quoteId or dealId
  paymentMethod?: string; // default: 'Átutalás'
  issueDate?: string; // YYYY-MM-DD
  fulfillmentDate?: string; // YYYY-MM-DD
  dueDate?: string; // YYYY-MM-DD
  buyer: SzamlazzBuyer;
  seller?: SzamlazzSeller;
  items: SzamlazzItem[];
  comment?: string;
  isProforma?: boolean; // if true, sets <dijbekero>true</dijbekero>
}

export interface SzamlazzAgentResponse {
  ok: boolean;
  invoiceNumber?: string; // szamlaszam / dijbekeroszam
  netTotal?: number;
  grossTotal?: number;
  pdfBase64?: string;
  error?: string;
  errorCode?: string;
}

function escapeXml(unsafe: string = ''): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Builds standard XML for Számlázz.hu Számla Agent bizonylat creation (action-xmlagentxmlfile).
 */
export function buildSzamlazzXml(params: CreateProformaParams): string {
  const {
    credentials,
    currency,
    orderNumber,
    paymentMethod = 'Átutalás',
    issueDate = new Date().toISOString().slice(0, 10),
    fulfillmentDate = new Date().toISOString().slice(0, 10),
    dueDate = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
    buyer,
    seller,
    items,
    comment,
    isProforma = true,
  } = params;

  const xmlItems = items.map((item) => `
    <tetel>
      <megnevezes>${escapeXml(item.name)}</megnevezes>
      <mennyiseg>${item.quantity}</mennyiseg>
      <mennyisegiEgyseg>${escapeXml(item.unit || 'db')}</mennyisegiEgyseg>
      <nettoEgysegar>${item.netUnitPrice.toFixed(2)}</nettoEgysegar>
      <afakulcs>${escapeXml(item.vatRate || '27')}</afakulcs>
      <nettoErtek>${item.netTotal.toFixed(2)}</nettoErtek>
      <afaErtek>${item.vatTotal.toFixed(2)}</afaErtek>
      <bruttoErtek>${item.grossTotal.toFixed(2)}</bruttoErtek>
      ${item.comment ? `<megjegyzes>${escapeXml(item.comment)}</megjegyzes>` : ''}
    </tetel>`).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<xmlszamla xmlns="http://www.szamlazz.hu/xmlszamla" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.szamlazz.hu/xmlszamla https://www.szamlazz.hu/szamla/docs/xsds/agent/xmlszamla.xsd">
  <beallitasok>
    <szamlaagentkulcs>${escapeXml(credentials.apiKey)}</szamlaagentkulcs>
    <eszamla>${credentials.eInvoice ? 'true' : 'false'}</eszamla>
    <szamlaLetoltes>true</szamlaLetoltes>
    <valaszVerzio>2</valaszVerzio>
  </beallitasok>
  <fejlec>
    <keltDatum>${issueDate}</keltDatum>
    <teljesitesDatum>${fulfillmentDate}</teljesitesDatum>
    <fizetesiHatidoDatum>${dueDate}</fizetesiHatidoDatum>
    <fizmod>${escapeXml(paymentMethod)}</fizmod>
    <penznem>${currency}</penznem>
    <szamlaSablon>SzlaAlap</szamlaSablon>
    <rendelesSzam>${escapeXml(orderNumber)}</rendelesSzam>
    ${isProforma ? '<dijbekero>true</dijbekero>' : ''}
    ${comment ? `<megjegyzes>${escapeXml(comment)}</megjegyzes>` : ''}
  </fejlec>
  <elado>
    ${seller?.bankName ? `<bank>${escapeXml(seller.bankName)}</bank>` : ''}
    ${seller?.bankAccount ? `<bankszamlaszam>${escapeXml(seller.bankAccount)}</bankszamlaszam>` : ''}
    ${seller?.emailReplyTo ? `<emailReplyTo>${escapeXml(seller.emailReplyTo)}</emailReplyTo>` : ''}
  </elado>
  <vevo>
    <nev>${escapeXml(buyer.name)}</nev>
    <orszag>${escapeXml(buyer.country || 'Magyarország')}</orszag>
    <irsz>${escapeXml(buyer.zip || '')}</irsz>
    <telepules>${escapeXml(buyer.city || '')}</telepules>
    <cim>${escapeXml(buyer.address || '')}</cim>
    ${buyer.email ? `<email>${escapeXml(buyer.email)}</email>` : ''}
    ${buyer.taxNumber ? `<adoszam>${escapeXml(buyer.taxNumber)}</adoszam>` : ''}
    ${buyer.euTaxNumber ? `<adoszamEU>${escapeXml(buyer.euTaxNumber)}</adoszamEU>` : ''}
  </vevo>
  <tetelek>${xmlItems}
  </tetelek>
</xmlszamla>`.trim();
}

/**
 * Parses Számlázz.hu XML response (valaszVerzio 2).
 */
export function parseSzamlazzResponse(xmlText: string): SzamlazzAgentResponse {
  if (!xmlText) {
    return { ok: false, error: 'Empty response from Számlázz.hu' };
  }

  // Check for error responses
  const isSuccess = /<sikeres>\s*true\s*<\/sikeres>/i.test(xmlText);
  if (!isSuccess) {
    const errorMsgMatch = xmlText.match(/<hibauzenet>([\s\S]*?)<\/hibauzenet>/);
    const errorCodeMatch = xmlText.match(/<hibakod>([\s\S]*?)<\/hibakod>/);
    return {
      ok: false,
      error: errorMsgMatch ? errorMsgMatch[1].trim() : 'Unknown Számlázz.hu error',
      errorCode: errorCodeMatch ? errorCodeMatch[1].trim() : undefined,
    };
  }

  const invoiceNumMatch = xmlText.match(/<szamlaszam>([\s\S]*?)<\/szamlaszam>/);
  const netTotalMatch = xmlText.match(/<szamlaNettoVegosszeg>([\s\S]*?)<\/szamlaNettoVegosszeg>/);
  const grossTotalMatch = xmlText.match(/<szamlaBruttoVegosszeg>([\s\S]*?)<\/szamlaBruttoVegosszeg>/);
  const pdfMatch = xmlText.match(/<pdf>([\s\S]*?)<\/pdf>/);

  return {
    ok: true,
    invoiceNumber: invoiceNumMatch ? invoiceNumMatch[1].trim() : undefined,
    netTotal: netTotalMatch ? parseFloat(netTotalMatch[1].trim()) : undefined,
    grossTotal: grossTotalMatch ? parseFloat(grossTotalMatch[1].trim()) : undefined,
    pdfBase64: pdfMatch ? pdfMatch[1].trim() : undefined,
  };
}

/**
 * Builds XML for query existing invoice/proforma data and payment status.
 */
export function buildSzamlazzQueryXml(apiKey: string, invoiceNumber: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<xmlszamladijbekero xmlns="http://www.szamlazz.hu/xmlszamladijbekero" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <beallitasok>
    <szamlaagentkulcs>${escapeXml(apiKey)}</szamlaagentkulcs>
    <valaszVerzio>2</valaszVerzio>
  </beallitasok>
  <fejlec>
    <szamlaszam>${escapeXml(invoiceNumber)}</szamlaszam>
  </fejlec>
</xmlszamladijbekero>`.trim();
}
