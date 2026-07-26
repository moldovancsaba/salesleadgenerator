// Issue #75 — attributes each outreach template's WON/LOST conversions using
// last-touch attribution: the most recent send to a lead before that lead's
// terminal WON/LOST outcomelogs entry, within a bounded window, gets credit.

export type OutreachLogRecord = {
  leadId: string;
  templateId?: string;
  createdAt: Date;
};

export type OutcomeLogRecord = {
  leadId: string;
  afterState?: { kanbanColumn?: string };
  createdAt: Date;
};

export type TemplateConversionStats = {
  sent: number;
  won: number;
  lost: number;
  conversionRate: number;
  declineRate: number;
};

const DEFAULT_WINDOW_DAYS = 90;

function findTerminalOutcome(
  leadOutcomeLogs: OutcomeLogRecord[]
): OutcomeLogRecord | undefined {
  const terminal = leadOutcomeLogs.filter(
    (log) => log.afterState?.kanbanColumn === 'WON' || log.afterState?.kanbanColumn === 'LOST'
  );
  if (terminal.length === 0) return undefined;
  return terminal.reduce((earliest, log) => (log.createdAt < earliest.createdAt ? log : earliest));
}

export function computeTemplateConversions(
  outreachLogs: OutreachLogRecord[],
  outcomeLogs: OutcomeLogRecord[],
  windowDays: number = DEFAULT_WINDOW_DAYS
): Map<string, TemplateConversionStats> {
  const windowMs = windowDays * 24 * 60 * 60 * 1000;

  const outreachByLead = new Map<string, OutreachLogRecord[]>();
  for (const log of outreachLogs) {
    if (!log.templateId) continue;
    const list = outreachByLead.get(log.leadId) || [];
    list.push(log);
    outreachByLead.set(log.leadId, list);
  }

  const outcomesByLead = new Map<string, OutcomeLogRecord[]>();
  for (const log of outcomeLogs) {
    const list = outcomesByLead.get(log.leadId) || [];
    list.push(log);
    outcomesByLead.set(log.leadId, list);
  }

  const stats = new Map<string, TemplateConversionStats>();
  const ensure = (templateId: string): TemplateConversionStats => {
    let s = stats.get(templateId);
    if (!s) {
      s = { sent: 0, won: 0, lost: 0, conversionRate: 0, declineRate: 0 };
      stats.set(templateId, s);
    }
    return s;
  };

  for (const [leadId, sends] of outreachByLead) {
    for (const send of sends) {
      ensure(send.templateId as string).sent += 1;
    }

    const terminal = findTerminalOutcome(outcomesByLead.get(leadId) || []);
    if (!terminal) continue;

    const eligibleSends = sends.filter(
      (send) =>
        send.createdAt <= terminal.createdAt &&
        terminal.createdAt.getTime() - send.createdAt.getTime() <= windowMs
    );
    if (eligibleSends.length === 0) continue;

    const lastTouch = eligibleSends.reduce((latest, send) =>
      send.createdAt > latest.createdAt ? send : latest
    );

    const s = ensure(lastTouch.templateId as string);
    if (terminal.afterState?.kanbanColumn === 'WON') s.won += 1;
    else s.lost += 1;
  }

  for (const s of stats.values()) {
    s.conversionRate = s.sent > 0 ? s.won / s.sent : 0;
    s.declineRate = s.sent > 0 ? s.lost / s.sent : 0;
  }

  return stats;
}
