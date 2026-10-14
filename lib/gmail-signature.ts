import type { Db } from 'mongodb';
import { getUserConnection, getValidCredential } from '../app/lib/integration-store';

// Issue #241: Gmail signature fetching, sanitization, and MIME formatting

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
  const cleanBody = bodyText.trimEnd();
  // Standard RFC 3676 signature delimiter is "-- \n"
  return `${cleanBody}\n\n-- \n${signatureText.trim()}`;
}

export async function fetchGmailSignatureFromGoogle(
  accessToken: string,
  userEmail?: string
): Promise<{ signatureHtml: string; signatureText: string } | null> {
  const url = 'https://gmail.googleapis.com/gmail/v1/users/me/settings/sendAs';
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const sendAsList: any[] = data.sendAs || [];
    if (sendAsList.length === 0) return null;

    const primary =
      (userEmail && sendAsList.find((s) => s.sendAsEmail?.toLowerCase() === userEmail.toLowerCase())) ||
      sendAsList.find((s) => s.isPrimary) ||
      sendAsList.find((s) => s.isDefault) ||
      sendAsList[0];

    const rawSig = primary?.signature || '';
    const signatureHtml = sanitizeSignatureHtml(rawSig);
    const signatureText = signatureHtmlToText(signatureHtml);
    return { signatureHtml, signatureText };
  } catch (err) {
    console.error('[gmail-signature] fetch error:', err);
    return null;
  }
}

export async function syncUserGmailSignature(
  db: Db,
  userId: string
): Promise<{ ok: boolean; signatureText?: string; signatureSyncedAt?: string; error?: string }> {
  const connection = await getUserConnection(db, userId, 'gmail');
  if (!connection || connection.status !== 'active') {
    return { ok: false, error: 'no_active_connection' };
  }

  let token: string;
  try {
    token = await getValidCredential(db, connection);
  } catch (err: any) {
    return { ok: false, error: err?.message || 'credential_unavailable' };
  }

  const fetched = await fetchGmailSignatureFromGoogle(token, connection.userEmail);
  const now = new Date().toISOString();

  if (!fetched || !fetched.signatureText) {
    await db.collection('integration_connections').updateOne(
      { id: connection.id },
      {
        $set: {
          signatureHtml: '',
          signatureText: '',
          signatureSyncedAt: now,
          updatedAt: now,
        },
      }
    );
    return { ok: true, signatureText: '', signatureSyncedAt: now };
  }

  await db.collection('integration_connections').updateOne(
    { id: connection.id },
    {
      $set: {
        signatureHtml: fetched.signatureHtml,
        signatureText: fetched.signatureText,
        signatureSyncedAt: now,
        updatedAt: now,
      },
    }
  );

  return { ok: true, signatureText: fetched.signatureText, signatureSyncedAt: now };
}
