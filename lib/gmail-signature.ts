import type { Db } from 'mongodb';
import type { IntegrationConnection } from './integration-connections';
import { getUserConnection, getValidCredential } from '../app/lib/integration-store';

// Issue #241 / #357: Gmail sendAs signature fetching, alias resolution, sanitization, and idempotent MIME formatting

export type GmailSendAsIdentity = {
  email: string;
  displayName?: string;
  signatureHtml: string;
  signatureText: string;
  isPrimary?: boolean;
  isDefault?: boolean;
};

export function sanitizeSignatureHtml(html: string | undefined): string {
  if (!html) return '';
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
    .replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, '')
    .replace(/<embed\b[^<]*(?:(?!<\/embed>)<[^<]*)*<\/embed>/gi, '')
    .replace(/\son\w+\s*=\s*(?:'[^']*'|"[^"]*"|[^\s>]+)/gi, '')
    .trim();
}

export function signatureHtmlToText(html: string | undefined): string {
  if (!html) return '';
  return html
    .replace(/<br\s*[\/]?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function appendSignatureToBody(bodyText: string, signatureText?: string): string {
  if (!signatureText || !signatureText.trim()) return bodyText;
  const sig = signatureText.trim();
  const cleanBody = bodyText.trimEnd();
  // Prevent duplicate signature appending when templates or drafts already carry it
  if (
    cleanBody.endsWith(`-- \n${sig}`) ||
    cleanBody.endsWith(`--\n${sig}`) ||
    cleanBody.endsWith(`\n\n${sig}`) ||
    cleanBody === sig
  ) {
    return cleanBody;
  }
  // Standard RFC 3676 signature delimiter is "-- \n"
  return `${cleanBody}\n\n-- \n${sig}`;
}

export function resolveSignatureForSender(
  connection: Pick<
    IntegrationConnection,
    'userEmail' | 'providerAccountLabel' | 'signatureHtml' | 'signatureText' | 'sendAsSignatures'
  > | null | undefined,
  requestedSenderEmail?: string
): {
  fromEmail?: string;
  displayName?: string;
  signatureHtml: string;
  signatureText: string;
} {
  if (!connection) {
    return { signatureHtml: '', signatureText: '' };
  }
  const normalizedRequested = requestedSenderEmail?.trim().toLowerCase();
  const map = connection.sendAsSignatures || {};

  if (normalizedRequested && map[normalizedRequested]) {
    const entry = map[normalizedRequested];
    return {
      fromEmail: entry.email || normalizedRequested,
      displayName: entry.displayName,
      signatureHtml: entry.signatureHtml || '',
      signatureText: entry.signatureText || '',
    };
  }

  // Case-insensitive lookup in case map keys had mixed casing
  if (normalizedRequested) {
    const matchedKey = Object.keys(map).find((k) => k.toLowerCase() === normalizedRequested);
    if (matchedKey) {
      const entry = map[matchedKey];
      return {
        fromEmail: entry.email || matchedKey,
        displayName: entry.displayName,
        signatureHtml: entry.signatureHtml || '',
        signatureText: entry.signatureText || '',
      };
    }
  }

  return {
    fromEmail: connection.userEmail || connection.providerAccountLabel,
    signatureHtml: connection.signatureHtml || '',
    signatureText: connection.signatureText || '',
  };
}

export async function fetchGmailSignatureFromGoogle(
  accessToken: string,
  userEmail?: string
): Promise<{
  signatureHtml: string;
  signatureText: string;
  identities: GmailSendAsIdentity[];
  byEmail: Record<string, GmailSendAsIdentity>;
} | null> {
  const url = 'https://gmail.googleapis.com/gmail/v1/users/me/settings/sendAs';
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const sendAsList: any[] = data.sendAs || [];
    if (sendAsList.length === 0) return null;

    const identities: GmailSendAsIdentity[] = [];
    const byEmail: Record<string, GmailSendAsIdentity> = {};

    for (const item of sendAsList) {
      const rawEmail = typeof item?.sendAsEmail === 'string' ? item.sendAsEmail.trim().toLowerCase() : '';
      if (!rawEmail) continue;
      const signatureHtml = sanitizeSignatureHtml(item.signature || '');
      const signatureText = signatureHtmlToText(signatureHtml);
      const identity: GmailSendAsIdentity = {
        email: rawEmail,
        ...(typeof item.displayName === 'string' && item.displayName.trim()
          ? { displayName: item.displayName.trim() }
          : {}),
        signatureHtml,
        signatureText,
        isPrimary: Boolean(item.isPrimary),
        isDefault: Boolean(item.isDefault),
      };
      identities.push(identity);
      byEmail[rawEmail] = identity;
    }

    const normUserEmail = userEmail?.trim().toLowerCase();
    const exactMatch = normUserEmail ? identities.find((s) => s.email === normUserEmail) : undefined;
    const defaultWithSig = identities.find((s) => s.isDefault && s.signatureText);
    const chosen =
      (exactMatch && exactMatch.signatureText ? exactMatch : undefined) ||
      defaultWithSig ||
      exactMatch ||
      identities.find((s) => s.isDefault) ||
      identities.find((s) => s.isPrimary) ||
      identities[0];

    return {
      signatureHtml: chosen?.signatureHtml || '',
      signatureText: chosen?.signatureText || '',
      identities,
      byEmail,
    };
  } catch (err) {
    console.error('[gmail-signature] fetch error:', err);
    return null;
  }
}

export async function syncGmailConnectionSignatures(
  db: Db,
  connection: IntegrationConnection,
  accessToken: string,
  requestedEmail?: string
): Promise<{
  ok: boolean;
  signatureText: string;
  signatureSyncedAt: string;
  sendAsSignatures: Record<string, GmailSendAsIdentity>;
}> {
  const fetched = await fetchGmailSignatureFromGoogle(accessToken, requestedEmail || connection.userEmail);
  const now = new Date().toISOString();
  const sendAsSignatures = fetched?.byEmail || {};
  const sendAsAliases = Object.keys(sendAsSignatures);
  const signatureHtml = fetched?.signatureHtml || '';
  const signatureText = fetched?.signatureText || '';

  await db.collection('integration_connections').updateOne(
    { id: connection.id },
    {
      $set: {
        signatureHtml,
        signatureText,
        signatureSyncedAt: now,
        sendAsAliases,
        sendAsSignatures,
        updatedAt: now,
      },
    }
  );

  // Reflect on in-memory connection object so callers in the same turn observe updated signatures
  connection.signatureHtml = signatureHtml;
  connection.signatureText = signatureText;
  connection.signatureSyncedAt = now;
  connection.sendAsAliases = sendAsAliases;
  connection.sendAsSignatures = sendAsSignatures;

  const selected =
    requestedEmail && sendAsSignatures[requestedEmail.trim().toLowerCase()]
      ? sendAsSignatures[requestedEmail.trim().toLowerCase()].signatureText
      : signatureText;

  return {
    ok: true,
    signatureText: selected,
    signatureSyncedAt: now,
    sendAsSignatures,
  };
}

export async function syncUserGmailSignature(
  db: Db,
  userId: string,
  connectionIdOrEmail?: string
): Promise<{
  ok: boolean;
  signatureText?: string;
  signatureSyncedAt?: string;
  sendAsSignatures?: Record<string, GmailSendAsIdentity>;
  error?: string;
}> {
  const connection = await getUserConnection(db, userId, 'gmail', connectionIdOrEmail);
  if (!connection || connection.status !== 'active') {
    return { ok: false, error: 'no_active_connection' };
  }

  let token: string;
  try {
    token = await getValidCredential(db, connection);
  } catch (err: any) {
    return { ok: false, error: err?.message || 'credential_unavailable' };
  }

  const requestedEmail = connectionIdOrEmail?.includes('@') ? connectionIdOrEmail : undefined;
  return syncGmailConnectionSignatures(db, connection, token, requestedEmail);
}
