import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..', '..');

describe('Google Contacts Reconnect & Token Expiration Resilience', () => {
  it('provides Reconnect Google Contacts button in GoogleContactsImport modal on token expiry', () => {
    const code = readFileSync(join(root, 'app', 'components', 'GoogleContactsImport.tsx'), 'utf8');
    expect(code).toContain('Reconnect Google Contacts');
    expect(code).toContain('/api/integrations/google_contacts/connect');
    expect(code).toContain('searchError.toLowerCase().includes(\'token\')');
    expect(code).toContain('searchError.toLowerCase().includes(\'expired\')');
    expect(code).toContain('searchError.toLowerCase().includes(\'revoked\')');
  });

  it('provides Reconnect Google Contacts button in GoogleContactsWorkspaceModal on token expiry', () => {
    const code = readFileSync(join(root, 'app', 'components', 'GoogleContactsWorkspaceModal.tsx'), 'utf8');
    expect(code).toContain('Reconnect Google Contacts');
    expect(code).toContain('/api/integrations/google_contacts/connect');
    expect(code).toContain('error.toLowerCase().includes(\'token\')');
    expect(code).toContain('error.toLowerCase().includes(\'expired\')');
    expect(code).toContain('error.toLowerCase().includes(\'revoked\')');
  });

  it('handles token expiration and marks connection error in google-contacts-store.ts', () => {
    const code = readFileSync(join(root, 'app', 'lib', 'google-contacts-store.ts'), 'utf8');
    expect(code).toContain('Google Contacts authorization has expired or been revoked');
    expect(code).toContain('status: \'error\'');
  });
});
