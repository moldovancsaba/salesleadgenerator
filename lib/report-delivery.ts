// Ad-hoc report builder (issue #212) — scheduled-delivery email transport.
// A new, dedicated helper, NOT lib/outreach-send.ts reused wholesale (that
// module is lead-outreach-specific: it writes to outreach_logs, reads lead
// templates, routes through evaluateOutreachRouting()). Only its
// Resend-client-construction and graceful-per-send-failure conventions
// carry over here.

import { Resend } from 'resend';

export function isReportDeliveryConfigured(): boolean {
  return !!process.env.RESEND_API_KEY;
}

export type ReportEmailResult = { sent: boolean; reason?: string };

// Never throws — a send failure for one recipient/report must not abort a
// tick batch processing other due reports (issue #212 §15's own required
// contract, matching sendAutomatedEmail()'s existing never-throws promise).
export async function sendReportEmail(params: {
  to: string;
  from: string;
  subject: string;
  html: string;
  idempotencyKey: string;
}): Promise<ReportEmailResult> {
  if (!isReportDeliveryConfigured()) {
    return { sent: false, reason: 'RESEND_API_KEY not configured' };
  }

  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const { error } = await resend.emails.send(
      { from: params.from, to: params.to, subject: params.subject, html: params.html },
      { idempotencyKey: params.idempotencyKey }
    );
    if (error) return { sent: false, reason: error.message || 'Resend rejected the send' };
    return { sent: true };
  } catch (err: any) {
    return { sent: false, reason: err?.message || 'Resend send failed' };
  }
}

// A plain-text/HTML summary table of a report's result rows — deliberately
// minimal (no chart rendering in an email; that's the in-app builder's
// job), matching this app's existing "email is a summary, not a full UI"
// convention for automated sends.
export function renderReportEmailHtml(reportName: string, rows: Array<{ groupKey: Record<string, string | null>; value: number | null; sampleSize?: number }>): string {
  const rowsHtml = rows.length === 0
    ? '<tr><td>No data for this period.</td></tr>'
    : rows.map((r) => {
        const key = Object.values(r.groupKey).filter((v) => v !== undefined).map((v) => v ?? '(missing)').join(' / ') || '(all)';
        const value = r.value === null ? 'Insufficient data' : String(r.value);
        return `<tr><td>${key}</td><td>${value}</td></tr>`;
      }).join('');

  return `<h2>${reportName}</h2><table border="1" cellpadding="6" style="border-collapse:collapse"><tbody>${rowsHtml}</tbody></table>`;
}
