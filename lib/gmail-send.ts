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

export function formatMailbox(person: { name?: string; email: string }): string {
  const email = person.email.trim();
  if (person.name && person.name.trim()) {
    const safeName = person.name.replace(/["\r\n]/g, '').trim();
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

  const headers = [
    `From: ${formatMailbox(params.from)}`,
    `To: ${formatMailbox(params.to)}`,
    `Subject: ${params.subject.replace(/[\r\n]/g, ' ')}`,
    `Date: ${dateStr}`,
    `Message-ID: ${messageId}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 7bit',
  ];

  if (params.inReplyTo) {
    headers.push(`In-Reply-To: ${params.inReplyTo.trim()}`);
  }
  if (params.references) {
    headers.push(`References: ${params.references.trim()}`);
  }

  const messageText = headers.join('\r\n') + '\r\n\r\n' + params.bodyText.replace(/\r?\n/g, '\r\n');
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

  const res = await fetchWithRetry(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      raw,
      ...(params.threadId ? { threadId: params.threadId } : {}),
    }),
  });

  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}));
    const message = errorBody?.error?.message || `Gmail API send failed: ${res.status}`;
    throw new Error(message);
  }

  return res.json();
}
