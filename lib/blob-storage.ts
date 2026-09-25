// Quotes: file storage on Vercel Blob (issue #211). A thin, mockable
// wrapper around @vercel/blob's put()/get() — kept as the one place this
// app touches that SDK, so tests never make a real network call against it
// (put()/get() are mocked at the module boundary this file defines).
//
// Verified directly against the installed @vercel/blob@2.8.0 type
// definitions (node_modules/@vercel/blob/dist/*.d.ts), not assumed from
// older docs: this version's BlobAccessType is 'public' | 'private', a
// genuinely newer capability than issue #211's own §11 pseudocode assumed
// (which used access: 'public'). This module deliberately uses 'private'
// instead — the object then requires this app's own BLOB_READ_WRITE_TOKEN
// to read at all, a real defense-in-depth improvement on top of the
// issue's own "never return the raw Blob URL to a client" requirement
// (§17), not a substitute for it — the /view route (app/api/quotes/
// [quoteId]/view/route.ts) still gates exclusively on the random
// shareToken and still never exposes this module's URL/pathname to any
// client, authenticated or not.

import { put, get } from '@vercel/blob';

export function isBlobConfigured(): boolean {
  return !!process.env.BLOB_READ_WRITE_TOKEN;
}

export async function uploadQuotePdf(pathname: string, buffer: Buffer): Promise<{ pathname: string }> {
  const result = await put(pathname, buffer, {
    access: 'private',
    contentType: 'application/pdf',
    addRandomSuffix: false,
  });
  return { pathname: result.pathname };
}

// Returns null when the blob genuinely doesn't exist (get() itself returns
// null) — the caller (app/lib/quotes-store.ts) treats that as a real
// storage-layer failure, never a silent empty response.
export async function fetchQuotePdf(pathname: string): Promise<Buffer | null> {
  const result = await get(pathname, { access: 'private' });
  if (!result || result.statusCode !== 200 || !result.stream) return null;

  const chunks: Uint8Array[] = [];
  const reader = result.stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  return Buffer.concat(chunks);
}
