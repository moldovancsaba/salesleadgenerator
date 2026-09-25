// Deals: Quote generation — PDF rendering (issue #211). Runs on the Node.js
// serverless runtime only (@react-pdf/renderer depends on Node APIs and is
// not Edge-compatible — verified against react-pdf.org/compatibility). Any
// Route Handler importing this module must NOT set `export const runtime =
// 'edge'`. Real component tree rendered to real, selectable/extractable PDF
// text (never rasterized to an image), per issue #211 §14's own
// accessibility requirement.

import { Document, Page, Text, View, StyleSheet, renderToBuffer } from '@react-pdf/renderer';
import { QUOTE_PDF_COLORS } from './theme/quote-pdf-colors';
import { CURRENCY_SYMBOLS } from '@/app/lib/brand-constants';
import type { QuoteLineItem } from './quotes';

// @react-pdf/renderer draws directly with PDFKit primitives on the server —
// there is no DOM/CSSOM at render time, so GDS's usual `var(--gds-*)` CSS
// custom properties (defined in app/layout.tsx, consumed by browser-rendered
// components) cannot apply here. Colors come from ./theme/quote-pdf-colors.ts
// instead of inline literals — see that file for why importing gds-theme's
// own raw token object directly was tried and reverted (it broke `next
// build` by pulling a client-only symbol into a server route bundle).
const { neutralStrong, neutralMuted, borderSubtle, borderFaint, surfaceFaint, textFaint } = QUOTE_PDF_COLORS;

const styles = StyleSheet.create({
  page: { padding: 48, fontSize: 11, fontFamily: 'Helvetica' },
  header: { marginBottom: 32, borderBottom: `2 solid ${neutralStrong}`, paddingBottom: 16 },
  brand: { fontSize: 20, fontWeight: 700, marginBottom: 4 },
  quoteLabel: { fontSize: 10, color: neutralMuted },
  meta: { marginBottom: 24 },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  metaLabel: { color: neutralMuted },
  table: { marginTop: 16, marginBottom: 24, border: `1 solid ${borderSubtle}` },
  tableRow: { flexDirection: 'row', borderBottom: `1 solid ${borderFaint}`, padding: 8 },
  tableHeaderRow: { flexDirection: 'row', backgroundColor: surfaceFaint, padding: 8, fontWeight: 700 },
  colLabel: { flex: 3 },
  colValue: { flex: 1, textAlign: 'right' },
  totalRow: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 8, paddingTop: 8, borderTop: `2 solid ${neutralStrong}` },
  totalLabel: { marginRight: 16, fontWeight: 700 },
  totalValue: { fontWeight: 700 },
  footer: { position: 'absolute', bottom: 32, left: 48, right: 48, fontSize: 9, color: textFaint, textAlign: 'center' },
});

function formatMoney(value: number, currency: keyof typeof CURRENCY_SYMBOLS): string {
  const symbol = CURRENCY_SYMBOLS[currency] || '';
  return `${symbol}${value.toLocaleString('en-US')}`;
}

export type QuoteDocumentProps = {
  brandLabel: string;
  entityName: string;
  quoteId: string;
  createdAt: string; // ISO 8601
  lineItems: QuoteLineItem[];
  totalValue: number;
  currency: keyof typeof CURRENCY_SYMBOLS;
};

export function QuoteDocument({ brandLabel, entityName, quoteId, createdAt, lineItems, totalValue, currency }: QuoteDocumentProps) {
  const createdDate = new Date(createdAt);
  const formattedDate = Number.isNaN(createdDate.getTime()) ? createdAt : createdDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  return (
    <Document title={`Quote for ${entityName}`} author={brandLabel}>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.brand}>{brandLabel}</Text>
          <Text style={styles.quoteLabel}>Quote</Text>
        </View>

        <View style={styles.meta}>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Prepared for</Text>
            <Text>{entityName}</Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Date</Text>
            <Text>{formattedDate}</Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Quote reference</Text>
            <Text>{quoteId}</Text>
          </View>
        </View>

        <View style={styles.table}>
          <View style={styles.tableHeaderRow}>
            <Text style={styles.colLabel}>Description</Text>
            <Text style={styles.colValue}>Amount</Text>
          </View>
          {lineItems.map((item, i) => (
            <View style={styles.tableRow} key={i}>
              <Text style={styles.colLabel}>{item.label}</Text>
              <Text style={styles.colValue}>{formatMoney(item.value, item.currency)}</Text>
            </View>
          ))}
        </View>

        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Total</Text>
          <Text style={styles.totalValue}>{formatMoney(totalValue, currency)}</Text>
        </View>

        <Text style={styles.footer} fixed>
          This quote is valid as of the date shown above and does not constitute a binding agreement until countersigned by both parties.
        </Text>
      </Page>
    </Document>
  );
}

// Thrown (never returned as a partial/corrupt buffer) on a genuine render
// failure — the caller (app/lib/quotes-store.ts) must short-circuit before
// ever uploading or inserting a quotes document on this path, per issue
// #211 §15's "no orphaned Blob object, no quotes document written for a
// failed render" edge case.
export async function renderQuotePdf(props: QuoteDocumentProps): Promise<Buffer> {
  return renderToBuffer(<QuoteDocument {...props} />);
}
