import { describe, it, expect } from 'vitest';
import { formatFileSize } from '../../app/components/DocumentLibraryPickerModal';
import { deduplicateDocumentIds, validateDocumentMetadata } from '../../lib/documents';

describe('Document Library UI Helpers & Logic (Phase 7 UI)', () => {
  describe('formatFileSize', () => {
    it('formats 0 or negative bytes as 0 B', () => {
      expect(formatFileSize(0)).toBe('0 B');
      expect(formatFileSize(-10)).toBe('0 B');
    });

    it('formats bytes, KB, MB correctly', () => {
      expect(formatFileSize(500)).toBe('500.0 B');
      expect(formatFileSize(1024)).toBe('1.0 KB');
      expect(formatFileSize(1536)).toBe('1.5 KB');
      expect(formatFileSize(1024 * 1024)).toBe('1.0 MB');
      expect(formatFileSize(5 * 1024 * 1024)).toBe('5.0 MB');
    });
  });

  describe('Document attachment deduplication and validation', () => {
    it('deduplicates array of document IDs while preserving non-empty strings', () => {
      const raw = ['doc_1', 'doc_2', 'doc_1', '', '  ', 'doc_3'];
      const deduped = deduplicateDocumentIds(raw);
      expect(deduped).toEqual(['doc_1', 'doc_2', 'doc_3']);
    });

    it('validates document metadata within limits', () => {
      const valid = validateDocumentMetadata({
        filename: 'deck.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 5 * 1024 * 1024,
      });
      expect(valid.valid).toBe(true);

      const tooLarge = validateDocumentMetadata({
        filename: 'large.zip',
        mimeType: 'application/zip',
        sizeBytes: 30 * 1024 * 1024, // 30MB exceeds 25MB ceiling
      });
      expect(tooLarge.valid).toBe(false);
      expect(tooLarge.error).toContain('25MB');
    });
  });
});
