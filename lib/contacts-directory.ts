import type { ContactDirectoryEntry } from './contacts';

export type ContactsSortKey =
  | 'name'
  | 'leads'
  | 'company'
  | 'title'
  | 'email'
  | 'phone'
  | 'buyingRole'
  | 'crmStatus';

export type ContactsDirectoryQueryOptions = {
  q?: string;
  crmStatus?: string;
  owner?: string;
  buyingRole?: string;
  phoneOnly?: boolean;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
};

export type ContactsDirectoryQueryResult<T extends ContactDirectoryEntry = ContactDirectoryEntry> = {
  contacts: T[];
  filteredContacts: T[];
  totalContacts: number;
  filteredCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

function escapeRegExpLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function sortContactsDirectory<T extends ContactDirectoryEntry>(
  list: ReadonlyArray<T>,
  sortBy: string = 'name',
  sortDir: 'asc' | 'desc' = 'asc'
): T[] {
  const dir = sortDir === 'desc' ? -1 : 1;
  return [...list].sort((a, b) => {
    let cmp = 0;
    if (sortBy === 'leads' || sortBy === 'company') {
      const leadA = a.leads?.[0]?.entity_name || '';
      const leadB = b.leads?.[0]?.entity_name || '';
      cmp = leadA.localeCompare(leadB);
    } else if (sortBy === 'title') {
      cmp = (a.title || '').localeCompare(b.title || '');
    } else if (sortBy === 'email') {
      cmp = (a.email || '').localeCompare(b.email || '');
    } else if (sortBy === 'phone') {
      cmp = (a.phone || '').localeCompare(b.phone || '');
    } else if (sortBy === 'buyingRole') {
      cmp = (a.buyingRole || '').localeCompare(b.buyingRole || '');
    } else if (sortBy === 'crmStatus') {
      cmp = (a.crmStatus || '').localeCompare(b.crmStatus || '');
    } else {
      cmp = (a.name || '').localeCompare(b.name || '');
    }

    if (cmp !== 0) return cmp * dir;
    // Deterministic secondary key ensures identical-value contacts stay stable across pages.
    return a.key.localeCompare(b.key);
  });
}

export function queryContactsDirectory<T extends ContactDirectoryEntry>(
  allContacts: ReadonlyArray<T>,
  options: ContactsDirectoryQueryOptions = {}
): ContactsDirectoryQueryResult<T> {
  const totalContacts = allContacts.length;
  let filtered = [...allContacts];

  const q = (options.q || '').trim();
  if (q) {
    const re = new RegExp(escapeRegExpLiteral(q), 'i');
    filtered = filtered.filter(
      (c) =>
        re.test(c.name) ||
        (c.email && re.test(c.email)) ||
        (c.secondaryEmail && re.test(c.secondaryEmail)) ||
        (c.phone && re.test(c.phone)) ||
        (c.title && re.test(c.title)) ||
        (c.leads && c.leads.some((l) => re.test(l.entity_name)))
    );
  }

  const crmStatusFilter = (options.crmStatus || '').trim().toLowerCase();
  if (crmStatusFilter) {
    filtered = filtered.filter((c) => (c.crmStatus || 'prospect').toLowerCase() === crmStatusFilter);
  }

  const ownerFilter = (options.owner || '').trim();
  if (ownerFilter) {
    filtered = filtered.filter((c) => c.ownerUserId === ownerFilter);
  }

  const buyingRoleFilter = (options.buyingRole || '').trim().toLowerCase();
  if (buyingRoleFilter) {
    filtered = filtered.filter((c) => (c.buyingRole || '').toLowerCase() === buyingRoleFilter);
  }

  if (options.phoneOnly) {
    filtered = filtered.filter((c) => Boolean(c.phone && c.phone.trim().length > 3));
  }

  const sorted = sortContactsDirectory(filtered, options.sortBy, options.sortDir);
  const filteredCount = sorted.length;

  const hasPaging =
    typeof options.page === 'number' || typeof options.pageSize === 'number';

  if (!hasPaging) {
    return {
      contacts: sorted,
      filteredContacts: sorted,
      totalContacts,
      filteredCount,
      page: 1,
      pageSize: filteredCount,
      totalPages: 1,
    };
  }

  const pageSize = Math.max(1, Math.min(500, Math.floor(options.pageSize ?? 100)));
  const totalPages = Math.max(1, Math.ceil(filteredCount / pageSize));
  const safePage = Math.max(1, Math.min(totalPages, Math.floor(options.page ?? 1)));
  const start = (safePage - 1) * pageSize;
  const contacts = sorted.slice(start, start + pageSize);

  return {
    contacts,
    filteredContacts: sorted,
    totalContacts,
    filteredCount,
    page: safePage,
    pageSize,
    totalPages,
  };
}
