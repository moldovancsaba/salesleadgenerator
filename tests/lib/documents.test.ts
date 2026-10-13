import { describe, it, expect, vi } from 'vitest';
import {
  deduplicateDocumentIds,
  sanitizeDocumentFilename,
  validateDocumentMetadata,
  buildDocumentStorageKey,
  canDeleteDocument,
  resolveDocumentAttachmentRefs,
  type DocumentRecord,
  type DocumentReferenceConsumer,
} from '@/lib/documents';

describe('Document Library & Attachment References (issue 243)', () => {
  describe('deduplicateDocumentIds', () => {
    it('returns empty array on undefined or empty input', () => {
      expect(deduplicateDocumentIds(undefined)).toEqual([]);
      expect(deduplicateDocumentIds([])).toEqual([]);
    });

    it('deduplicates repeat occurrences while preserving first order', () => {
      expect(deduplicateDocumentIds(['doc1', 'doc2', 'doc1', 'doc3', 'doc2'])).toEqual([
        'doc1',
        'doc2',
        'doc3',
      ]);
    });

    it('trims whitespace and ignores empty strings', () => {
      expect(deduplicateDocumentIds(['  docA  ', '', '   ', 'docB', 'docA'])).toEqual([
        'docA',
        'docB',
      ]);
    });
  });

  describe('sanitizeDocumentFilename', () => {
    it('strips Unix path traversal components', () => {
      expect(sanitizeDocumentFilename('../../../etc/passwd.pdf')).toBe('passwd.pdf');
      expect(sanitizeDocumentFilename('/var/uploads/contracts/deal.docx')).toBe('deal.docx');
    });

    it('strips Windows path traversal components', () => {
      expect(sanitizeDocumentFilename('..\\..\\Windows\\System32\\calc.png')).toBe('calc.png');
    });

    it('defaults to document when empty or whitespace', () => {
      expect(sanitizeDocumentFilename('')).toBe('document');
      expect(sanitizeDocumentFilename('   ')).toBe('document');
    });
  });

  describe('validateDocumentMetadata', () => {
    it('accepts valid PDF, Word, and Image files', () => {
      expect(
        validateDocumentMetadata({
          filename: 'contract.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 1024 * 500,
        })
      ).toEqual({ valid: true });

      expect(
        validateDocumentMetadata({
          filename: 'deck.pptx',
          mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          sizeBytes: 1024 * 1024 * 5,
        })
      ).toEqual({ valid: true });
    });

    it('rejects disallowed executable or binary mime types', () => {
      const res = validateDocumentMetadata({
        filename: 'malware.exe',
        mimeType: 'application/x-msdownload',
        sizeBytes: 1024,
      });
      expect(res.valid).toBe(false);
      expect(res.error).toContain('not supported');
    });

    it('rejects files larger than 25MB ceiling', () => {
      const res = validateDocumentMetadata({
        filename: 'giant.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 26 * 1024 * 1024,
      });
      expect(res.valid).toBe(false);
      expect(res.error).toContain('25MB maximum limit');
    });

    it('rejects files with zero or negative size', () => {
      const res = validateDocumentMetadata({
        filename: 'empty.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 0,
      });
      expect(res.valid).toBe(false);
      expect(res.error).toContain('must be greater than 0');
    });
  });

  describe('buildDocumentStorageKey', () => {
    it('builds a partitioned, safe storage key', () => {
      const key = buildDocumentStorageKey({
        brand: 'cogmap',
        tenantId: 'default',
        documentId: 'doc_123',
        filename: 'Proposal 2026.pdf',
      });
      expect(key).toBe('documents/cogmap/default/doc_123/Proposal 2026.pdf');
    });
  });

  describe('canDeleteDocument', () => {
    it('permits deletion when no cadences or templates reference the document', () => {
      expect(canDeleteDocument('doc_123', [])).toEqual({ allowed: true });
    });

    it('refuses deletion with document_in_use when active consumers exist', () => {
      const consumers: DocumentReferenceConsumer[] = [
        { kind: 'cadence', id: 'cad_1', name: 'Outbound Enterprise Cadence' },
        { kind: 'template', id: 'tpl_2', name: 'Follow-up with Pitch Deck' },
      ];
      const result = canDeleteDocument('doc_123', consumers);
      expect(result.allowed).toBe(false);
      expect(result.error).toContain('document_in_use');
      expect(result.inUseBy).toEqual(consumers);
    });
  });

  describe('resolveDocumentAttachmentRefs', () => {
    const doc1: DocumentRecord = {
      id: 'doc_1',
      brand: 'cogmap',
      tenantId: 'default',
      filename: 'OnePager.pdf',
      displayName: 'Product One-Pager',
      storageKey: 'documents/cogmap/default/doc_1/OnePager.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024 * 200,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const doc2: DocumentRecord = {
      id: 'doc_2',
      brand: 'cogmap',
      tenantId: 'default',
      filename: 'Pricing.xlsx',
      displayName: 'Pricing Sheet',
      storageKey: 'documents/cogmap/default/doc_2/Pricing.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      sizeBytes: 1024 * 150,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const lookup = new Map<string, DocumentRecord>([
      ['doc_1', doc1],
      ['doc_2', doc2],
    ]);

    it('resolves attachments and deduplicates repeat references', async () => {
      const res = await resolveDocumentAttachmentRefs(['doc_1', 'doc_1', 'doc_2'], lookup);
      expect(res.ok).toBe(true);
      expect(res.attachments?.length).toBe(2);
      expect(res.attachments?.[0].documentId).toBe('doc_1');
      expect(res.attachments?.[1].documentId).toBe('doc_2');
    });

    it('fails closed when a referenced document is not in the lookup catalog', async () => {
      const res = await resolveDocumentAttachmentRefs(['doc_1', 'non_existent_doc'], lookup);
      expect(res.ok).toBe(false);
      expect(res.attachments).toBeUndefined();
      expect(res.missingNames).toContain('document_id_non_existent_doc');
    });

    it('fails closed when document is in catalog but absent from blob storage', async () => {
      const storageHasCheck = vi.fn().mockImplementation(async (key: string) => {
        return key === doc1.storageKey; // doc_2 missing from storage
      });

      const res = await resolveDocumentAttachmentRefs(['doc_1', 'doc_2'], lookup, storageHasCheck);
      expect(res.ok).toBe(false);
      expect(res.missingNames).toContain('Pricing Sheet');
    });
  });
});
