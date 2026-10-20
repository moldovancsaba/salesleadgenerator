import type { Db } from 'mongodb';
import { getActiveConnectionByProvider, getValidCredential, ConnectionRevokedError } from './integration-store';
import { fetchWithRetry } from '../../lib/integration-http';
import type { Brand } from './brand';

const PEOPLE_API_BASE = 'https://people.googleapis.com/v1';
const READ_MASK = 'names,emailAddresses,phoneNumbers,organizations';
const SEARCH_PAGE_SIZE = 25;

export type GoogleContactResult = {
  resourceName: string;
  name: string;
  email?: string;
  phone?: string;
  organization?: string;
};

function mapPerson(person: any): GoogleContactResult | null {
  if (!person?.resourceName) return null;
  const name = person.names?.[0]?.displayName;
  if (!name) return null;
  return {
    resourceName: person.resourceName,
    name,
    email: person.emailAddresses?.[0]?.value,
    phone: person.phoneNumbers?.[0]?.value,
    organization: person.organizations?.[0]?.name,
  };
}

export type ContactsAccessResult =
  | { ok: true; token: string; connectionId?: string }
  | { ok: false; status: 404 | 503; error: string };

async function resolveContactsAccess(
  db: Db,
  brand: Brand,
  tenantId: string,
  userContext?: { userId?: string; userEmail?: string }
): Promise<ContactsAccessResult> {
  let connection: any = null;

  // 1. Check for a user-scoped Google Contacts connection first
  if (userContext?.userId || userContext?.userEmail) {
    const userOrClauses: any[] = [];
    if (userContext.userId) userOrClauses.push({ userId: userContext.userId });
    if (userContext.userEmail) userOrClauses.push({ userEmail: userContext.userEmail.toLowerCase().trim() });

    connection = await db.collection('integration_connections').findOne({
      provider: 'google_contacts',
      status: { $ne: 'revoked' },
      $or: userOrClauses,
    }).catch(() => null);
  }

  // 2. Fall back to brand/workspace connection
  if (!connection) {
    connection = await getActiveConnectionByProvider(db, brand, tenantId, 'google_contacts');
  }

  if (!connection) return { ok: false, status: 404, error: 'Google Contacts is not connected for this brand' };
  try {
    const token = await getValidCredential(db, connection);
    return { ok: true, token, connectionId: connection.id };
  } catch (error) {
    const rawReason = error instanceof ConnectionRevokedError ? error.message : 'Google Contacts connection needs to be reconnected';
    const isTokenRevoked =
      rawReason.toLowerCase().includes('expired') ||
      rawReason.toLowerCase().includes('revoked') ||
      rawReason.toLowerCase().includes('invalid_grant');
    const reason = isTokenRevoked
      ? 'Google Contacts authorization has expired or been revoked. Please reconnect your account.'
      : rawReason;

    if (connection?.id && isTokenRevoked) {
      await db.collection('integration_connections').updateOne(
        { id: connection.id },
        { $set: { status: 'error', lastSyncError: rawReason, updatedAt: new Date().toISOString() } }
      ).catch(() => {});
    }

    return { ok: false, status: 503, error: reason };
  }
}

// Issue 216 §10, enhanced in Issue 251:
// - When query is non-empty: uses People API's people:searchContacts
// - When query is empty/omitted: uses People API's people/me/connections
//   (sorted by LAST_MODIFIED_DESCENDING) to display recent contacts.
export async function searchGoogleContacts(
  db: Db,
  brand: Brand,
  tenantId: string,
  query?: string,
  userContext?: { userId?: string; userEmail?: string }
): Promise<ContactsAccessResult & { results?: GoogleContactResult[] }> {
  const access = await resolveContactsAccess(db, brand, tenantId, userContext);
  if (!access.ok) return access;

  const trimmedQuery = (query || '').trim();
  let url: URL;
  if (!trimmedQuery) {
    url = new URL(`${PEOPLE_API_BASE}/people/me/connections`);
    url.searchParams.set('personFields', READ_MASK);
    url.searchParams.set('pageSize', String(SEARCH_PAGE_SIZE));
    url.searchParams.set('sortOrder', 'LAST_MODIFIED_DESCENDING');
  } else {
    url = new URL(`${PEOPLE_API_BASE}/people:searchContacts`);
    url.searchParams.set('query', trimmedQuery);
    url.searchParams.set('readMask', READ_MASK);
    url.searchParams.set('pageSize', String(SEARCH_PAGE_SIZE));
  }

  let res = await fetchWithRetry(url.toString(), { headers: { Authorization: `Bearer ${access.token}` } });

  // If request failed on empty query with sortOrder, fallback without sortOrder
  // (some Google Workspace domain policies reject sortOrder on people/me/connections)
  if (!res.ok && !trimmedQuery && url.searchParams.has('sortOrder')) {
    url.searchParams.delete('sortOrder');
    res = await fetchWithRetry(url.toString(), { headers: { Authorization: `Bearer ${access.token}` } });
  }

  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}));
    const message = errorBody?.error?.message || errorBody?.error_description || errorBody?.error || `Google Contacts API returned status ${res.status}`;
    console.error('[google-contacts-store] People API failed:', res.status, message, errorBody);

    const isTokenRevoked =
      res.status === 401 ||
      message.toLowerCase().includes('expired') ||
      message.toLowerCase().includes('revoked') ||
      message.toLowerCase().includes('invalid_grant');

    if (isTokenRevoked) {
      if (access.connectionId) {
        await db.collection('integration_connections').updateOne(
          { id: access.connectionId },
          { $set: { status: 'error', lastSyncError: message, updatedAt: new Date().toISOString() } }
        ).catch(() => {});
      }
      return { ok: false, status: 503, error: 'Google Contacts authorization has expired or been revoked. Please reconnect your account.' };
    }
    if (res.status === 403) {
      return { ok: false, status: 503, error: `Google Contacts access denied: ${message}` };
    }
    return { ok: false, status: 503, error: message };
  }

  const body = await res.json();
  const rawList = trimmedQuery ? (body.results || []).map((r: any) => r.person) : (body.connections || []);
  const results = rawList
    .map((p: any) => mapPerson(p))
    .filter((c: GoogleContactResult | null): c is GoogleContactResult => c !== null);
  return { ok: true, token: access.token, results };
}

// Issue #216 Algorithm B — fetches one contact by resourceName for import.
export async function getGoogleContact(
  db: Db,
  brand: Brand,
  tenantId: string,
  resourceName: string,
  userContext?: { userId?: string; userEmail?: string }
): Promise<ContactsAccessResult & { contact?: GoogleContactResult }> {
  const access = await resolveContactsAccess(db, brand, tenantId, userContext);
  if (!access.ok) return access;

  const url = new URL(`${PEOPLE_API_BASE}/${resourceName}`);
  url.searchParams.set('personFields', READ_MASK);

  const res = await fetchWithRetry(url.toString(), { headers: { Authorization: `Bearer ${access.token}` } });
  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}));
    const message = errorBody?.error?.message || `Google Contacts API returned status ${res.status}`;
    return { ok: false, status: 503, error: message };
  }
  const person = await res.json();
  const contact = mapPerson(person);
  if (!contact) return { ok: false, status: 503, error: 'This contact has no name and cannot be imported' };
  return { ok: true, token: access.token, contact };
}
