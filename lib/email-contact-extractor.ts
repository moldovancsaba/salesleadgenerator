import {
  normalizeContact,
  dedupeContacts,
  type NormalizedContact,
} from './contacts';
import { parseSignatureBlock } from './signature-parser';

export const COMMON_PUBLIC_MAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'yahoo.co.uk',
  'hotmail.com',
  'outlook.com',
  'live.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'proton.me',
  'protonmail.com',
  'aol.com',
  'zoho.com',
  'gmx.com',
  'mail.com',
]);

export const INTERNAL_COMPANY_DOMAINS = new Set([
  'seyuselfies.com',
  'seyu.hu',
  'cogmap.com',
  'cog-map.com',
  'dvsc.hu',
  'haho.ai',
  'doneisbetter.com',
]);

const CCTLD_TO_COUNTRY: Record<string, string> = {
  de: 'DE',
  uk: 'GB',
  fr: 'FR',
  au: 'AU',
  ca: 'CA',
  nl: 'NL',
  it: 'IT',
  es: 'ES',
  hu: 'HU',
  at: 'AT',
  ch: 'CH',
  jp: 'JP',
  se: 'SE',
  no: 'NO',
  dk: 'DK',
  pl: 'PL',
  cz: 'CZ',
  be: 'BE',
  ie: 'IE',
  nz: 'NZ',
  br: 'BR',
  ro: 'RO',
  pt: 'PT',
  gr: 'GR',
  fi: 'FI',
  bg: 'BG',
  hr: 'HR',
  rs: 'RS',
  sk: 'SK',
  si: 'SI',
  ua: 'UA',
  ee: 'EE',
  lv: 'LV',
  lt: 'LT',
  lu: 'LU',
  is: 'IS',
  za: 'ZA',
  mx: 'MX',
  ar: 'AR',
  cl: 'CL',
  co: 'CO',
};

/**
 * Parses an individual RFC 5322 formatted address into name and email.
 * E.g. "Jane Doe <jane@acme.com>" -> { name: "Jane Doe", email: "jane@acme.com" }
 */
export function parseEmailParticipant(raw: string | undefined | null): { name: string; email: string } | null {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Pattern: "Display Name" <email@example.com> or Display Name <email@example.com>
  const angleMatch = trimmed.match(/^(?:["']?([^"']+)["']?\s*)?<([^>]+)>/);
  if (angleMatch) {
    const rawName = (angleMatch[1] || '').trim();
    const email = (angleMatch[2] || '').trim().toLowerCase();
    if (!email || !email.includes('@')) return null;

    let name = rawName;
    if (!name) {
      name = formatLocalPartAsName(email.split('@')[0]);
    }
    return { name, email };
  }

  // Bare email address: jane@acme.com
  if (trimmed.includes('@')) {
    const cleanEmail = trimmed.replace(/[<>]/g, '').trim().toLowerCase();
    const localPart = cleanEmail.split('@')[0];
    return {
      name: formatLocalPartAsName(localPart),
      email: cleanEmail,
    };
  }

  return null;
}

/**
 * Converts an email local part like "john.doe" or "alex_smith" into "John Doe".
 */
export function formatLocalPartAsName(localPart: string): string {
  if (!localPart) return 'Valued Contact';
  const clean = localPart.replace(/[.+_-]/g, ' ').trim();
  if (!clean) return 'Valued Contact';

  return clean
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Splits comma-separated email lists (while respecting quoted strings) and parses each.
 */
export function parseEmailAddressList(rawList: string | string[] | undefined | null): Array<{ name: string; email: string }> {
  if (!rawList) return [];

  const stringsToParse: string[] = [];
  if (Array.isArray(rawList)) {
    for (const item of rawList) {
      if (typeof item === 'string') stringsToParse.push(item);
    }
  } else if (typeof rawList === 'string') {
    // Regex splits on commas that are outside quotes
    const parts = rawList.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
    stringsToParse.push(...parts);
  }

  const results: Array<{ name: string; email: string }> = [];
  const seenEmails = new Set<string>();

  for (const str of stringsToParse) {
    const parsed = parseEmailParticipant(str);
    if (parsed && !seenEmails.has(parsed.email)) {
      seenEmails.add(parsed.email);
      results.push(parsed);
    }
  }

  return results;
}

/**
 * Infers an organization name and domain from an email address.
 * E.g. "alex@acme-sports.com" -> { domain: "acme-sports.com", companyName: "Acme Sports", isPublicProvider: false }
 */
export function inferCompanyFromEmail(email: string): {
  domain: string;
  companyName: string;
  isPublicProvider: boolean;
} | null {
  if (!email || !email.includes('@')) return null;
  const domain = email.split('@')[1].toLowerCase().trim();
  if (!domain) return null;

  if (COMMON_PUBLIC_MAIL_DOMAINS.has(domain)) {
    return {
      domain,
      companyName: '',
      isPublicProvider: true,
    };
  }

  // Extract base domain name: e.g. "sub.acme-sports.co.uk" -> "acme-sports"
  const domainParts = domain.split('.');
  let mainPart = domainParts[0];
  if (domainParts.length > 2 && ['co', 'com', 'org', 'net', 'edu', 'gov'].includes(domainParts[domainParts.length - 2])) {
    mainPart = domainParts[domainParts.length - 3] || domainParts[0];
  }

  const cleanMain = mainPart.replace(/[-_]/g, ' ').trim();
  const companyName =
    cleanMain.length <= 4 && !/[aeiouy]{2}/i.test(cleanMain)
      ? cleanMain.toUpperCase()
      : cleanMain
          .split(/\s+/)
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
          .join(' ');

  return {
    domain,
    companyName,
    isPublicProvider: false,
  };
}

/**
 * Checks if two email addresses belong to the same private company domain.
 * Returns false if either is missing, invalid, or belongs to a common public provider (e.g. Gmail).
 */
export function isSameEmailDomain(emailA?: string | null, emailB?: string | null): boolean {
  if (!emailA || !emailB || !emailA.includes('@') || !emailB.includes('@')) return false;
  const domainA = emailA.split('@')[1].toLowerCase().trim();
  const domainB = emailB.split('@')[1].toLowerCase().trim();
  if (!domainA || !domainB || domainA !== domainB) return false;
  return !COMMON_PUBLIC_MAIL_DOMAINS.has(domainA);
}

/**
 * Infers an ISO country code from a domain ccTLD. Defaults to 'US'.
 */
export function inferCountryFromDomain(domain: string): string {
  if (!domain) return 'US';
  const parts = domain.toLowerCase().split('.');
  const tld = parts[parts.length - 1];
  return CCTLD_TO_COUNTRY[tld] || 'US';
}

/**
 * Detects if an address is an internal brand sender, company team member, system address, or automated robot.
 */
export function isInternalOrSystemEmail(
  email: string,
  options: { brand?: string; internalEmails?: string[] } = {}
): boolean {
  if (!email || typeof email !== 'string') return true;
  const normalized = email.toLowerCase().trim();
  if (!normalized.includes('@')) return true;

  const [localPart, domain] = normalized.split('@');
  if (!localPart || !domain) return true;

  // 1. Known system & bot prefixes
  if (
    localPart.startsWith('noreply') ||
    localPart.startsWith('no-reply') ||
    localPart.startsWith('mailer-daemon') ||
    localPart.startsWith('notification') ||
    localPart.startsWith('bounce') ||
    localPart.startsWith('postmaster') ||
    localPart.startsWith('alert') ||
    localPart.startsWith('alerts') ||
    localPart.startsWith('billing') ||
    localPart.startsWith('invitation') ||
    localPart.startsWith('calendar')
  ) {
    return true;
  }

  // 2. Known bot / meeting notetaker / automation platforms
  if (
    localPart.includes('notetaker') ||
    localPart.includes('fyxer') ||
    localPart.includes('gemini') ||
    domain.includes('fyxer') ||
    domain.includes('notetaker') ||
    domain.includes('fireflies.ai') ||
    domain.includes('otter.ai') ||
    domain.includes('read.ai') ||
    domain.includes('asana.com') ||
    domain.includes('pipedrive') ||
    domain.includes('resend.dev')
  ) {
    return true;
  }

  // 3. Known internal company domains
  if (
    INTERNAL_COMPANY_DOMAINS.has(domain) ||
    domain.endsWith('.seyuselfies.com') ||
    domain.endsWith('.seyu.hu') ||
    domain.endsWith('.cogmap.com') ||
    domain.endsWith('.cog-map.com') ||
    domain.endsWith('.dvsc.hu') ||
    domain.endsWith('.haho.ai')
  ) {
    return true;
  }

  // 4. Matches brand address prefix or domain (e.g. cogmap@..., seyu@..., dvsc@...)
  if (options.brand) {
    const brandLower = options.brand.toLowerCase();
    if (localPart === brandLower || localPart.startsWith(`${brandLower}-`) || localPart.startsWith(`${brandLower}@`)) {
      return true;
    }
    if (brandLower === 'seyu' && (domain.includes('seyu') || domain.includes('seyuselfies'))) {
      return true;
    }
    if (brandLower === 'cogmap' && (domain.includes('cogmap') || domain.includes('cog-map'))) {
      return true;
    }
    if (brandLower === 'dvsc' && domain.includes('dvsc')) {
      return true;
    }
  }

  // 5. Explicit internal emails passed in (e.g. rep emails from sso_user_access or user connection)
  if (options.internalEmails && options.internalEmails.length > 0) {
    const internalSet = new Set(options.internalEmails.map((e) => e.toLowerCase().trim()));
    if (internalSet.has(normalized)) {
      return true;
    }
  }

  return false;
}

/**
 * Extracts all external participant contacts from an email message's headers and body.
 */
export function extractContactsFromEmailMessage(
  msg: {
    from?: string;
    to?: string[] | string;
    cc?: string[] | string;
    body?: string;
  },
  options: {
    brand?: string;
    internalEmails?: string[];
  } = {}
): NormalizedContact[] {
  const fromParticipants = parseEmailAddressList(msg.from);
  const toParticipants = parseEmailAddressList(msg.to);
  const ccParticipants = parseEmailAddressList(msg.cc);

  const allRaw = [...fromParticipants, ...toParticipants, ...ccParticipants];
  const signature = msg.body ? parseSignatureBlock(msg.body) : null;

  const contactsByEmail = new Map<string, NormalizedContact>();

  for (const p of allRaw) {
    if (isInternalOrSystemEmail(p.email, options)) {
      continue;
    }

    const isFromSender = fromParticipants.some((fp) => fp.email === p.email);
    let contactName = p.name;
    let contactTitle = '';
    let contactPhone = '';

    // If this is the sender and a signature block was detected, enrich with signature fields
    if (isFromSender && signature) {
      if (signature.name) contactName = signature.name;
      if (signature.title) contactTitle = signature.title;
      if (signature.phone) contactPhone = signature.phone;
    }

    const contact = normalizeContact({
      name: contactName,
      email: p.email,
      title: contactTitle,
      phone: contactPhone,
      role: isFromSender ? 'Sender' : 'Participant',
      buyingRole: isFromSender ? 'decision_maker' : 'unknown',
      isDecisionMaker: isFromSender,
      crmStatus: 'lead',
    });

    // If contact already exists in our map, preserve richest fields
    const existing = contactsByEmail.get(contact.email);
    if (existing) {
      contactsByEmail.set(contact.email, {
        ...existing,
        name: existing.name !== 'Valued Contact' ? existing.name : contact.name,
        title: existing.title || contact.title,
        phone: existing.phone || contact.phone,
        isDecisionMaker: existing.isDecisionMaker || contact.isDecisionMaker,
      });
    } else {
      contactsByEmail.set(contact.email, contact);
    }
  }

  return Array.from(contactsByEmail.values());
}

/**
 * Strips HTML tags, CSS style blocks, scripts, and entities to return clean text.
 */
export function cleanHtmlBody(html: string): string {
  if (!html) return '';
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, '')
    .replace(/<xml[^>]*>[\s\S]*?<\/xml>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/@media[^{]*\{[\s\S]*?\}\s*\}/gi, '')
    .replace(/@(?:charset|import|namespace)[^;]*;/gi, '')
    .replace(/\{\{[^}]*\}\}/g, '')
    .replace(/(?:^|\s)[#.a-zA-Z0-9_\-,\s:>+~\[\]="']+\{\s*[^}]*\s*\}/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
}

/**
 * Produces a clean 2-line textual snippet stripped of CSS and tags.
 */
export function cleanMessageSnippet(body: string, maxLength = 140): string {
  if (!body) return '';
  const cleaned = cleanHtmlBody(body).replace(/\s+/g, ' ').trim();
  if (cleaned.length <= maxLength) return cleaned;
  return `${cleaned.slice(0, maxLength).trim()}…`;
}
