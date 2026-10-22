import { fetchWithRetry } from './integration-http';

// Issue #248 — RFC 2822 formatting and Gmail API REST transport for sending
// outbound emails directly from a sales rep's authenticated Google account.

export type Rfc2822MessageParams = {
  from: { name?: string; email: string };
  to: { name?: string; email: string };
  subject: string;
  bodyText: string;
  messageId?: string;
  inReplyTo?: string;
  references?: string;
  date?: Date;
};

export function encodeBase64Url(input: string | Buffer): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf.toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Encodes a header string (e.g. Subject or mailbox display name) using RFC 2047 encoded-word syntax
 * (`=?UTF-8?B?<base64>?=`). If the string is pure printable US-ASCII without encoded-word markers,
 * it is returned as-is. Chunks are sized <= 45 UTF-8 bytes to strictly respect RFC 2047's 75-character
 * word length limit.
 */
export function encodeRfc2047(text: string): string {
  if (!text) return '';
  // If pure printable US-ASCII and doesn't contain an encoded-word marker '=?', no encoding needed.
  if (/^[\x20-\x7E]*$/.test(text) && !text.includes('=?')) {
    return text;
  }

  const words: string[] = [];
  let current = '';

  // Iterate over Unicode code points (handles multi-byte and surrogate pairs safely)
  for (const ch of text) {
    if (Buffer.byteLength(current + ch, 'utf8') > 45) {
      words.push(`=?UTF-8?B?${Buffer.from(current, 'utf8').toString('base64')}?=`);
      current = ch;
    } else {
      current += ch;
    }
  }

  if (current.length > 0) {
    words.push(`=?UTF-8?B?${Buffer.from(current, 'utf8').toString('base64')}?=`);
  }

  return words.join(' ');
}

/**
 * Encodes text/plain body into RFC 2045 Quoted-Printable encoding.
 * Ensures UTF-8 multi-byte characters are encoded as =XX hex octets,
 * trailing spaces/tabs on lines are encoded as =20/=09, and lines do not
 * exceed 76 characters using soft line breaks (`=\r\n`).
 */
export function encodeQuotedPrintable(text: string): string {
  if (!text) return '';
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const resultLines: string[] = [];

  for (const line of lines) {
    const bytes = Buffer.from(line, 'utf8');
    let currentLine = '';

    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i];
      let encoded = '';

      if (b === 32 || b === 9) {
        // If this whitespace byte is followed only by other whitespace until line end,
        // it must be encoded as =20 or =09 to comply with RFC 2045 Rule (3).
        let isTrailing = true;
        for (let j = i; j < bytes.length; j++) {
          if (bytes[j] !== 32 && bytes[j] !== 9) {
            isTrailing = false;
            break;
          }
        }
        if (isTrailing) {
          encoded = b === 32 ? '=20' : '=09';
        } else {
          encoded = String.fromCharCode(b);
        }
      } else if (b >= 33 && b <= 126 && b !== 61) {
        // Printable US-ASCII except '=' (61)
        encoded = String.fromCharCode(b);
      } else {
        // Non-ASCII byte or '='
        encoded = '=' + b.toString(16).toUpperCase().padStart(2, '0');
      }

      // RFC 2045 Rule (5): max 76 chars per line (excluding CRLF).
      // If currentLine + encoded would exceed 75 chars, we insert soft break "=".
      if (currentLine.length + encoded.length > 75) {
        resultLines.push(currentLine + '=');
        currentLine = '';
      }
      currentLine += encoded;
    }
    resultLines.push(currentLine);
  }

  return resultLines.join('\r\n');
}

export function formatMailbox(person: { name?: string; email: string }): string {
  const email = person.email.trim();
  if (person.name && person.name.trim()) {
    const rawName = person.name.replace(/[\r\n]/g, '').trim();
    // Non-ASCII characters require RFC 2047 encoded-word format.
    // RFC 2047 Section 5 explicitly prohibits enclosing encoded-words in quotes:
    // "An 'encoded-word' MUST NOT appear within a 'quoted-string'."
    if (/[^\x20-\x7E]/.test(rawName)) {
      const safeName = rawName.replace(/"/g, '');
      return `${encodeRfc2047(safeName)} <${email}>`;
    }
    const safeName = rawName.replace(/"/g, '');
    return `"${safeName}" <${email}>`;
  }
  return email;
}

export function generateMessageId(fromEmail: string): string {
  const domain = fromEmail.split('@')[1] || 'slg.internal';
  return `<slg-${Date.now()}-${Math.random().toString(36).slice(2, 10)}@${domain}>`;
}

export function buildRfc2822Message(params: Rfc2822MessageParams): { messageText: string; messageId: string } {
  const dateStr = (params.date || new Date()).toUTCString();
  const messageId = params.messageId || generateMessageId(params.from.email);

  const cleanSubject = params.subject.replace(/[\r\n]/g, ' ').trim();
  const encodedSubject = encodeRfc2047(cleanSubject);

  const headers = [
    `From: ${formatMailbox(params.from)}`,
    `To: ${formatMailbox(params.to)}`,
    `Subject: ${encodedSubject}`,
    `Date: ${dateStr}`,
    `Message-ID: ${messageId}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: quoted-printable',
  ];

  if (params.inReplyTo) {
    headers.push(`In-Reply-To: ${params.inReplyTo.trim()}`);
  }
  if (params.references) {
    headers.push(`References: ${params.references.trim()}`);
  }

  const encodedBody = encodeQuotedPrintable(params.bodyText);
  const messageText = headers.join('\r\n') + '\r\n\r\n' + encodedBody;
  return { messageText, messageId };
}

export type GmailSendResult = {
  id: string;
  threadId: string;
  labelIds?: string[];
};

export async function sendGmailMessage(params: {
  accessToken: string;
  rawMime: string;
  threadId?: string;
}): Promise<GmailSendResult> {
  const url = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';
  const raw = encodeBase64Url(params.rawMime);

  const payload: Record<string, any> = { raw };
  if (params.threadId) {
    payload.threadId = params.threadId;
  }

  const res = await fetchWithRetry(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}));
    const message = errorBody?.error?.message || `Gmail API send failed: ${res.status}`;

    // If Google rejects with 404 because the provided threadId does not exist in the sender's mailbox
    // (e.g. cross-account reply, foreign thread ID from a colleague, or purged thread), retry without threadId.
    // RFC 2822 In-Reply-To and References headers in rawMime will still properly thread the message in Gmail.
    if (params.threadId && (res.status === 404 || /not found/i.test(message))) {
      console.warn(`[gmail-send] Thread ID ${params.threadId} not found in sender mailbox (404). Retrying without threadId parameter.`);
      return sendGmailMessage({
        accessToken: params.accessToken,
        rawMime: params.rawMime,
      });
    }

    throw new Error(message);
  }

  return res.json();
}
