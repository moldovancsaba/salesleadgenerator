/**
 * Document library foundation and attachment reference management
 * (Vega CRM Ingestion Phase 7 / Handoff 11).
 *
 * Provides workspace-global documents metadata, attachment reference deduplication,
 * blob storage keys, and deletion safety guards preventing removal of in-use documents.
 */

export const MAX_DOCUMENT_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB max attachment size (standard SMTP ceiling)

export const ALLOWED_DOCUMENT_MIME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'image/jpeg',
  'image/png',
  'image/webp',
  'text/plain',
  'text/csv',
] as const;

export type AllowedDocumentMimeType = typeof ALLOWED_DOCUMENT_MIME_TYPES[number];

export type DocumentRecord = {
  id: string;
  brand: string;
  tenantId: string;
  filename: string;
  displayName: string;
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  uploadedBy?: string;
  createdAt: string;
  updatedAt: string;
};

export type DocumentAttachmentRef = {
  documentId: string;
  filename: string;
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
};

export type DocumentReferenceConsumer = {
  kind: 'cadence' | 'template';
  id: string;
  name: string;
};

/**
 * Deduplicates an array of document IDs, preserving order of first appearance.
 * (Invariant from Handoff 11: multiple attachment references to the same document
 * collapse to one shared attachment key).
 */
export function deduplicateDocumentIds(ids: string[] | undefined | null): string[] {
  if (!Array.isArray(ids)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of ids) {
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

/**
 * Sanitizes a document display name or filename, removing path traversal or unsafe characters.
 */
export function sanitizeDocumentFilename(rawName: string): string {
  if (!rawName || typeof rawName !== 'string') return 'document';
  // Strip path traversal attempts and directory separators
  const base = rawName.replace(/^.*[\\/]/, '').trim();
  // Strip control characters and excessive length
  const clean = base.replace(/[\x00-\x1f\x7f]/g, '').slice(0, 150);
  return clean || 'document';
}

/**
 * Validates document upload metadata.
 */
export function validateDocumentMetadata(file: {
  filename: string;
  mimeType: string;
  sizeBytes: number;
}): { valid: boolean; error?: string } {
  if (!file || typeof file !== 'object') {
    return { valid: false, error: 'Document payload is required' };
  }

  const filename = sanitizeDocumentFilename(file.filename);
  if (!filename || filename === 'document') {
    return { valid: false, error: 'Valid document filename is required' };
  }

  if (typeof file.sizeBytes !== 'number' || file.sizeBytes <= 0) {
    return { valid: false, error: 'Document file size must be greater than 0' };
  }

  if (file.sizeBytes > MAX_DOCUMENT_FILE_SIZE_BYTES) {
    return {
      valid: false,
      error: `Document file size exceeds ${MAX_DOCUMENT_FILE_SIZE_BYTES / (1024 * 1024)}MB maximum limit`,
    };
  }

  if (
    !file.mimeType ||
    !ALLOWED_DOCUMENT_MIME_TYPES.includes(file.mimeType.toLowerCase() as AllowedDocumentMimeType)
  ) {
    return {
      valid: false,
      error: `File type '${file.mimeType}' is not supported. Allowed formats include PDF, Word, Excel, PowerPoint, images, text, and CSV.`,
    };
  }

  return { valid: true };
}

/**
 * Constructs a deterministic, partitioned blob storage key for a document.
 */
export function buildDocumentStorageKey(params: {
  brand: string;
  tenantId: string;
  documentId: string;
  filename: string;
}): string {
  const safeFilename = sanitizeDocumentFilename(params.filename);
  return `documents/${params.brand}/${params.tenantId}/${params.documentId}/${safeFilename}`;
}

/**
 * Evaluates whether a document can be safely deleted.
 * Rejects deletion if the document is actively referenced by any cadence step or outreach template.
 */
export function canDeleteDocument(
  documentId: string,
  consumers: DocumentReferenceConsumer[]
): { allowed: boolean; inUseBy?: DocumentReferenceConsumer[]; error?: string } {
  if (!documentId) {
    return { allowed: false, error: 'Document ID is required' };
  }

  if (!consumers || consumers.length === 0) {
    return { allowed: true };
  }

  return {
    allowed: false,
    inUseBy: consumers,
    error: `document_in_use: cannot delete document because it is actively referenced by ${consumers.length} template(s) or cadence(s)`,
  };
}

/**
 * Resolves and verifies that all requested document IDs exist and have valid storage keys.
 * Fails closed if any document is missing.
 */
export async function resolveDocumentAttachmentRefs(
  documentIds: string[],
  documentsLookup: Map<string, DocumentRecord>,
  storageHasCheck?: (key: string) => Promise<boolean>
): Promise<{ ok: boolean; attachments?: DocumentAttachmentRef[]; missingNames?: string[] }> {
  const dedupedIds = deduplicateDocumentIds(documentIds);
  if (dedupedIds.length === 0) {
    return { ok: true, attachments: [] };
  }

  const missingNames: string[] = [];
  const attachments: DocumentAttachmentRef[] = [];

  for (const id of dedupedIds) {
    const doc = documentsLookup.get(id);
    if (!doc) {
      missingNames.push(`document_id_${id}`);
      continue;
    }

    if (storageHasCheck) {
      const existsInStorage = await storageHasCheck(doc.storageKey);
      if (!existsInStorage) {
        missingNames.push(doc.displayName || doc.filename);
        continue;
      }
    }

    attachments.push({
      documentId: doc.id,
      filename: doc.filename,
      storageKey: doc.storageKey,
      mimeType: doc.mimeType,
      sizeBytes: doc.sizeBytes,
    });
  }

  if (missingNames.length > 0) {
    return { ok: false, missingNames };
  }

  return { ok: true, attachments };
}
