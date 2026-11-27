export interface LeadConsentEntry {
  key: string;
  label: string;
  value: boolean | string;
}

export function formatConsentValue(value: boolean | string | undefined | null): string {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^true$/i.test(trimmed)) return 'Yes';
    if (/^false$/i.test(trimmed)) return 'No';
    if (/^yes$/i.test(trimmed)) return 'Yes';
    if (/^no$/i.test(trimmed)) return 'No';
    return trimmed;
  }
  return '';
}

export function normalizeConsentEntries(raw: unknown): LeadConsentEntry[] {
  if (!Array.isArray(raw)) return [];
  const byIdentity = new Map<string, LeadConsentEntry>();

  for (const item of raw.slice(0, 50)) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const key = typeof rec.key === 'string' ? rec.key.trim().slice(0, 80) : '';
    const label = typeof rec.label === 'string' ? rec.label.trim().slice(0, 200) : '';
    if (!key && !label) continue;
    const rawVal = rec.value;
    if (typeof rawVal !== 'boolean' && typeof rawVal !== 'string') continue;
    const value = typeof rawVal === 'boolean' ? rawVal : rawVal.trim().slice(0, 100);
    const entry: LeadConsentEntry = {
      key: key || label,
      label: label || key,
      value,
    };
    byIdentity.set(questionOf(entry), entry);
  }

  return Array.from(byIdentity.values());
}

/**
 * A question is identified by its wording. Field ids are not unique across campaigns
 * (a copied page keeps them), so an id alone must never join two answers.
 */
function questionOf(entry: LeadConsentEntry): string {
  return entry.label.trim().toLowerCase();
}

/** Later answers replace earlier ones to the same question and keep its position. */
function putEntries(map: Map<string, LeadConsentEntry>, entries: ReadonlyArray<LeadConsentEntry>): void {
  for (const entry of entries) map.set(questionOf(entry), entry);
}

function isRefusal(value: boolean | string): boolean {
  return formatConsentValue(value) === 'No';
}

export function mergeConsentEntries(
  existing: unknown,
  incoming: unknown
): LeadConsentEntry[] | undefined {
  const base = normalizeConsentEntries(existing);
  const next = normalizeConsentEntries(incoming);
  if (base.length === 0 && next.length === 0) return undefined;

  const byIdentity = new Map<string, LeadConsentEntry>();
  putEntries(byIdentity, base);
  putEntries(byIdentity, next);
  return Array.from(byIdentity.values());
}

/** Joins two lists with no known order: where they disagree, a refusal stands. */
export function mergeConsentsKeepingRefusals(
  first: ReadonlyArray<LeadConsentEntry> | undefined | null,
  second: ReadonlyArray<LeadConsentEntry> | undefined | null
): LeadConsentEntry[] | undefined {
  const merged = new Map<string, LeadConsentEntry>();
  putEntries(merged, first ?? []);
  for (const entry of second ?? []) {
    const current = merged.get(questionOf(entry));
    if (!current || isRefusal(entry.value)) merged.set(questionOf(entry), entry);
  }
  return merged.size > 0 ? Array.from(merged.values()) : undefined;
}

function appendLegacyBooleanFlags(
  map: Map<string, LeadConsentEntry>,
  source: Record<string, unknown> | undefined | null
): void {
  if (!source || typeof source !== 'object') return;
  if (typeof source.consentPdc === 'boolean') {
    const label = 'PDC Email Opt-in';
    const hasEquivalent = Array.from(map.values()).some(
      (e) => e.key.toLowerCase() === 'consentpdc' || e.label.toLowerCase() === label.toLowerCase()
    );
    if (!hasEquivalent) {
      putEntries(map, [{ key: 'consentPdc', label, value: source.consentPdc }]);
    }
  }
  if (typeof source.consentMrVegas === 'boolean') {
    const label = 'Mr Vegas Promo Opt-in';
    const hasEquivalent = Array.from(map.values()).some(
      (e) => e.key.toLowerCase() === 'consentmrvegas' || e.label.toLowerCase() === label.toLowerCase()
    );
    if (!hasEquivalent) {
      putEntries(map, [{ key: 'consentMrVegas', label, value: source.consentMrVegas }]);
    }
  }
}

/**
 * The answers held by one stored record (a submission snapshot or `extraFields`). The old yes/no
 * flags are read per record, so a later record's "No" replaces an earlier "Yes".
 */
function entriesFromRecord(record: unknown): LeadConsentEntry[] {
  if (!record || typeof record !== 'object') return [];
  const source = record as Record<string, unknown>;
  const map = new Map<string, LeadConsentEntry>();
  putEntries(map, normalizeConsentEntries(source.consents));
  appendLegacyBooleanFlags(map, source);
  return Array.from(map.values());
}

/**
 * Every consent question answered anywhere on a lead, newest source last. This describes the
 * RECORD, which can hold several people. Never read it as one contact's answers: use
 * `buildConsentLedger` with `resolveContactConsents` for that.
 */
export function resolveLeadConsents(lead: Record<string, any> | null | undefined): LeadConsentEntry[] {
  if (!lead || typeof lead !== 'object') return [];
  const merged = new Map<string, LeadConsentEntry>();

  if (Array.isArray(lead.submissionHistory)) {
    for (const snap of lead.submissionHistory) putEntries(merged, entriesFromRecord(snap));
  }
  putEntries(merged, entriesFromRecord(lead.extraFields));

  if (Array.isArray(lead.contacts)) {
    for (const contact of lead.contacts) {
      if (contact && typeof contact === 'object') {
        putEntries(merged, normalizeConsentEntries((contact as Record<string, unknown>).consents));
      }
    }
  }

  putEntries(merged, normalizeConsentEntries(lead.consents));

  return Array.from(merged.values());
}

// ---------------------------------------------------------------------------
// Who gave which answer. A consent belongs to the e-mail address that gave it:
// it is never shared with another contact on the same lead. Unknown stays blank.
// ---------------------------------------------------------------------------

type LeadLike = Record<string, any>;

interface ConsentSubmission {
  /** Empty when the record does not say who answered. */
  email: string;
  name: string;
  at: number;
  campaign: string;
  entries: LeadConsentEntry[];
}

function emailOf(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function timeOf(value: unknown): number {
  if (value instanceof Date) return value.getTime() || 0;
  return typeof value === 'string' ? Date.parse(value) || 0 : 0;
}

function contactsOf(lead: LeadLike): LeadLike[] {
  return Array.isArray(lead.contacts) ? lead.contacts.filter((c: unknown) => c && typeof c === 'object') : [];
}

/**
 * The form submissions behind a lead. A record saved before submission history existed
 * (2026-11-16) holds only its first submitter's answers, because a repeat form did not change
 * them then. That person is the first contact while it still matches the address the form
 * stored as `general_contact`; otherwise the answers are left without a person.
 */
function consentSubmissions(lead: LeadLike): ConsentSubmission[] {
  const history: LeadLike[] = Array.isArray(lead.submissionHistory)
    ? lead.submissionHistory.filter((s: unknown) => s && typeof s === 'object')
    : [];
  if (history.length > 0) {
    return history.map((snap) => ({
      email: emailOf(snap.contactEmail),
      name: textOf(snap.contactName),
      at: timeOf(snap.submittedAt),
      campaign: textOf(snap.campaign),
      entries: entriesFromRecord(snap),
    }));
  }

  const entries = entriesFromRecord(lead.extraFields);
  if (entries.length === 0) return [];
  const first = contactsOf(lead)[0];
  const firstEmail = emailOf(first?.email);
  const known = firstEmail !== '' && firstEmail === emailOf(lead.general_contact);
  return [
    {
      email: known ? firstEmail : '',
      name: known ? textOf(first?.name) : '',
      at: timeOf(lead.createdAt),
      campaign: textOf(lead.campaign),
      entries,
    },
  ];
}

/** Current answers by lower-cased e-mail address. */
export type ConsentLedger = Map<string, LeadConsentEntry[]>;

type Answer = { entry: LeadConsentEntry; campaign: string };

export function buildConsentLedger(leads: ReadonlyArray<LeadLike>): ConsentLedger {
  const byEmail = new Map<string, Map<string, Answer>>();
  const answersFor = (email: string) => {
    let answers = byEmail.get(email);
    if (!answers) byEmail.set(email, (answers = new Map()));
    return answers;
  };

  // Form submissions, oldest first, so the newest answer to a question is the one kept.
  const submissions = leads
    .flatMap(consentSubmissions)
    .filter((s) => s.email && s.entries.length > 0)
    .sort((a, b) => a.at - b.at);
  for (const submission of submissions) {
    const answers = answersFor(submission.email);
    for (const entry of submission.entries) {
      // The same field on the same campaign after its wording was edited is the same question.
      for (const [question, prior] of answers) {
        if (
          question !== questionOf(entry) &&
          submission.campaign &&
          prior.campaign === submission.campaign &&
          prior.entry.key.toLowerCase() === entry.key.toLowerCase()
        ) {
          answers.delete(question);
        }
      }
      answers.set(questionOf(entry), { entry, campaign: submission.campaign });
    }
  }

  // Answers stored on a contact (a spreadsheet import has no form history). A stored refusal
  // always counts; any other stored answer only fills a question no form has answered.
  for (const lead of leads) {
    for (const contact of contactsOf(lead)) {
      const email = emailOf(contact.email);
      if (!email) continue;
      for (const entry of normalizeConsentEntries(contact.consents)) {
        const answers = answersFor(email);
        const current = answers.get(questionOf(entry));
        if (current) {
          if (isRefusal(entry.value) && !isRefusal(current.entry.value)) {
            answers.set(questionOf(entry), { ...current, entry });
          }
          continue;
        }
        const reworded = Array.from(answers.values()).some(
          (a) => a.entry.key.toLowerCase() === entry.key.toLowerCase()
        );
        if (isRefusal(entry.value) || !reworded) answers.set(questionOf(entry), { entry, campaign: '' });
      }
    }
  }

  const ledger: ConsentLedger = new Map();
  for (const [email, answers] of byEmail) {
    if (answers.size > 0) ledger.set(email, Array.from(answers.values(), (a) => a.entry));
  }
  return ledger;
}

/** One contact's own answers. */
export function resolveContactConsents(
  contact: LeadLike | null | undefined,
  ledger: ConsentLedger
): LeadConsentEntry[] {
  const email = emailOf(contact?.email);
  if (email) return ledger.get(email) ?? [];
  return normalizeConsentEntries(contact?.consents);
}

/** The answers for an export row: those of the person the row names (the first contact). */
export function resolveRowConsents(lead: LeadLike, ledger: ConsentLedger): LeadConsentEntry[] {
  const person = contactsOf(lead)[0];
  return person ? resolveContactConsents(person, ledger) : resolveLeadConsents(lead);
}

export interface PersonConsents {
  name: string;
  email: string;
  consents: LeadConsentEntry[];
}

/** One lead's answers grouped by who gave them, for display. */
export function resolveConsentsByPerson(lead: LeadLike | null | undefined): {
  people: PersonConsents[];
  unattributed: LeadConsentEntry[];
} {
  if (!lead || typeof lead !== 'object') return { people: [], unattributed: [] };
  const submissions = consentSubmissions(lead);
  const contacts = contactsOf(lead);

  const people: PersonConsents[] = Array.from(buildConsentLedger([lead]), ([email, consents]) => {
    const submitted = [...submissions].reverse().find((s) => s.email === email && s.name);
    const contact = contacts.find((c) => emailOf(c.email) === email);
    return { email, name: submitted?.name || textOf(contact?.name), consents };
  });
  for (const contact of contacts) {
    const own = emailOf(contact.email) ? [] : normalizeConsentEntries(contact.consents);
    if (own.length > 0) people.push({ email: '', name: textOf(contact.name), consents: own });
  }

  const unknown = new Map<string, LeadConsentEntry>();
  for (const s of submissions) if (!s.email) putEntries(unknown, s.entries);
  let unattributed = Array.from(unknown.values());
  // Answers saved on the record with no person behind them at all (for example sent through the API).
  if (people.length === 0 && unattributed.length === 0) unattributed = resolveLeadConsents(lead);

  return { people, unattributed };
}

export function formatConsentsSummary(
  consents: ReadonlyArray<LeadConsentEntry> | undefined | null
): string {
  if (!Array.isArray(consents) || consents.length === 0) return '';
  return consents
    .map((c) => `${c.label}: ${formatConsentValue(c.value)}`)
    .filter(Boolean)
    .join('; ');
}

export interface ConsentCsvColumnDef {
  header: string;
  labelLower: string;
}

/**
 * Builds distinct CSV column definitions (`Consent: <Label>`) across a batch of leads or contacts
 * so spreadsheet exports include filterable per-consent columns whenever consents exist.
 */
export function collectConsentColumnDefs(
  allConsentsLists: ReadonlyArray<ReadonlyArray<LeadConsentEntry> | undefined | null>
): ConsentCsvColumnDef[] {
  const byLabel = new Map<string, ConsentCsvColumnDef>();
  for (const list of allConsentsLists) {
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      if (!entry?.label) continue;
      const labelLower = entry.label.trim().toLowerCase();
      if (!labelLower) continue;
      let existing = byLabel.get(labelLower);
      if (!existing) {
        existing = { header: `Consent: ${entry.label.trim()}`, labelLower };
        byLabel.set(labelLower, existing);
      }
    }
  }
  return Array.from(byLabel.values());
}

export function resolveConsentColumnValue(
  consents: ReadonlyArray<LeadConsentEntry> | undefined | null,
  col: ConsentCsvColumnDef
): string {
  if (!Array.isArray(consents) || consents.length === 0) return '';
  const match = consents.find((c) => c.label.trim().toLowerCase() === col.labelLower);
  return match ? formatConsentValue(match.value) : '';
}
