import type { Db, ObjectId } from 'mongodb';
import { checkDomain, isRoleAccount, isFreeProvider, extractDomain, statusFromMxResult } from '../../lib/email-verification';
import type { MxLookupResult } from '../../lib/email-verification';

// Verifies every unique email domain among the given contact emails —
// deduped, so two contacts sharing a domain trigger one DNS lookup, not two
// (issue #67) — then writes each contact's own emailVerificationStatus back
// via a positional `$` update. Callers (POST/PUT route handlers) invoke this
// with `void`, fire-and-forget, after their own response has already been
// built: every failure here is caught and logged, never thrown, so a DNS or
// Mongo hiccup after the HTTP response already returned can't surface as an
// unhandled rejection or affect request latency/status.
export async function verifyLeadContactsAsync(
  db: Db,
  collectionName: string,
  leadId: ObjectId,
  emails: string[],
  // Overridable only for tests — verifies the domain-dedup behavior below
  // without touching real DNS.
  checkDomainFn: (domain: string) => Promise<MxLookupResult> = checkDomain
): Promise<void> {
  try {
    const uniqueEmails = [...new Set(
      emails.filter((e): e is string => typeof e === 'string' && e.trim().length > 0).map((e) => e.trim())
    )];
    if (uniqueEmails.length === 0) return;

    const domainLookups = new Map<string, Promise<MxLookupResult>>();
    for (const email of uniqueEmails) {
      const domain = extractDomain(email);
      if (!domain || domainLookups.has(domain)) continue;
      domainLookups.set(domain, checkDomainFn(domain));
    }

    const domainResults = new Map<string, MxLookupResult>();
    await Promise.all(
      [...domainLookups.entries()].map(async ([domain, promise]) => {
        domainResults.set(domain, await promise);
      })
    );

    const now = new Date().toISOString();
    await Promise.all(uniqueEmails.map(async (email) => {
      const domain = extractDomain(email);
      const mx = domain ? domainResults.get(domain) : undefined;
      if (!domain || !mx) return;

      const localPart = email.slice(0, email.lastIndexOf('@'));
      const status = statusFromMxResult(mx, now, isRoleAccount(localPart), isFreeProvider(domain));

      try {
        await db.collection(collectionName).updateOne(
          { _id: leadId, 'contacts.email': email },
          { $set: { 'contacts.$.emailVerificationStatus': status, updatedAt: new Date() } }
        );
      } catch (error) {
        console.error('[app/lib/email-verification-store] write-back failed', { leadId: leadId.toString(), email, error });
      }
    }));
  } catch (error) {
    console.error('[app/lib/email-verification-store] verification run failed', { leadId: leadId.toString(), error });
  }
}
