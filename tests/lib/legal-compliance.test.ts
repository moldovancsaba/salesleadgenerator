import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const root = process.cwd();

describe('legal compliance documentation and disclosures (issue 286)', () => {
  it('provides a comprehensive Privacy Policy document with Google Limited Use compliance', () => {
    const privacyPath = join(root, 'docs', 'PRIVACY_POLICY.md');
    expect(existsSync(privacyPath)).toBe(true);

    const content = readFileSync(privacyPath, 'utf8');

    // Google API Limited Use compliance
    expect(content).toContain('Google API Services User Data Policy');
    expect(content).toContain('Limited Use');
    expect(content).toContain('No Artificial Intelligence / Machine Learning Model Training');
    expect(content).toContain('No Selling or Commercial Transfer of Data');
    expect(content).toContain('No Advertising Use');
    expect(content).toContain('Human Access Restrictions');

    // Mailbox connection disclosures
    expect(content).toContain('Connecting Your Mailbox (Google / Gmail)');
    expect(content).toContain('https://www.googleapis.com/auth/gmail.send');
    expect(content).toContain('https://www.googleapis.com/auth/gmail.readonly');
    expect(content).toContain('https://www.googleapis.com/auth/userinfo.email');

    // Inbound receive and sync disclosures
    expect(content).toContain('How We Receive & Synchronize Emails');
    expect(content).toContain('Data Minimization Filter');
    expect(content).toContain('INTERNAL_COMPANY_DOMAINS');
    expect(content).toContain('User Mailbox Isolation');

    // Outbound send disclosures
    expect(content).toContain('How We Send Emails via Our Service');
    expect(content).toContain('Gmail REST API');
    expect(content).toContain('RFC 2822');
    expect(content).toContain('Automatic Cadence Cancellation upon Reply');

    // Security & Disconnection
    expect(content).toContain('AES-256-GCM');
    expect(content).toContain('How to Disconnect Your Mailbox');
    expect(content).toContain('Data Retention & Account Deletion');
  });

  it('provides a comprehensive Terms of Service document with anti-spam and mailbox authorization', () => {
    const termsPath = join(root, 'docs', 'TERMS_OF_SERVICE.md');
    expect(existsSync(termsPath)).toBe(true);

    const content = readFileSync(termsPath, 'utf8');

    // Mailbox authorization
    expect(content).toContain('Mailbox Authorization & External Integrations');
    expect(content).toContain('Outbound Sending Authorization');
    expect(content).toContain('Inbound Reply Synchronization');

    // Anti-spam & acceptable use
    expect(content).toContain('Acceptable Use Policy & Anti-Spam Obligations');
    expect(content).toContain('CAN-SPAM Act');
    expect(content).toContain('GDPR');
    expect(content).toContain('Honoring Opt-Outs & Unsubscribes');
    expect(content).toContain('No Purchased or Scraped Bulk Lists');

    // Legal protections
    expect(content).toContain('Disclaimer of Warranties');
    expect(content).toContain('Limitation of Liability');
    expect(content).toContain('Indemnification');
    expect(content).toContain('Governing Law');
  });

  it('exposes public web routes for /privacy and /terms', () => {
    const privacyPagePath = join(root, 'app', 'privacy', 'page.tsx');
    const termsPagePath = join(root, 'app', 'terms', 'page.tsx');

    expect(existsSync(privacyPagePath)).toBe(true);
    expect(existsSync(termsPagePath)).toBe(true);

    const privacyContent = readFileSync(privacyPagePath, 'utf8');
    const termsContent = readFileSync(termsPagePath, 'utf8');

    expect(privacyContent).toContain('Privacy Policy');
    expect(privacyContent).toContain('Google Limited Use Compliance Statement');
    expect(privacyContent).toContain('AES-256-GCM');

    expect(termsContent).toContain('Terms of Service');
    expect(termsContent).toContain('Mailbox Authorization');
    expect(termsContent).toContain('Anti-Spam');
  });

  it('links to Privacy Policy and Terms of Service in user navigation and settings modal', () => {
    const navContent = readFileSync(join(root, 'app', 'components', 'AppNav.tsx'), 'utf8');
    expect(navContent).toContain('href="/privacy"');
    expect(navContent).toContain('href="/terms"');

    const modalContent = readFileSync(join(root, 'app', 'components', 'UserSettingsModal.tsx'), 'utf8');
    expect(modalContent).toContain('href="/privacy"');
    expect(modalContent).toContain('href="/terms"');
  });

  it('indexes legal documents across canonical documentation and checklists', () => {
    const readmeContent = readFileSync(join(root, 'README.md'), 'utf8');
    expect(readmeContent).toContain('docs/PRIVACY_POLICY.md');
    expect(readmeContent).toContain('docs/TERMS_OF_SERVICE.md');

    const indexContent = readFileSync(join(root, 'docs', 'INDEX.md'), 'utf8');
    expect(indexContent).toContain('docs/PRIVACY_POLICY.md');
    expect(indexContent).toContain('docs/TERMS_OF_SERVICE.md');

    const docLintContent = readFileSync(join(root, 'docs', 'DOC_LINT.md'), 'utf8');
    expect(docLintContent).toContain('docs/PRIVACY_POLICY.md');
    expect(docLintContent).toContain('docs/TERMS_OF_SERVICE.md');

    const userGuideContent = readFileSync(join(root, 'docs', 'USER_GUIDE.md'), 'utf8');
    expect(userGuideContent).toContain('Legal, Privacy & Terms of Service');
    expect(userGuideContent).toContain('/privacy');
    expect(userGuideContent).toContain('/terms');

    const emailSpecContent = readFileSync(join(root, 'docs', 'USER_EMAIL_INTEGRATION_SPEC.md'), 'utf8');
    expect(emailSpecContent).toContain('Legal, Regulatory & Google API Limited Use Compliance');
  });

  it('verifies operating entity and compliance contact is Moldován Csaba Kft. (issue 288)', () => {
    const privacyContent = readFileSync(join(root, 'docs', 'PRIVACY_POLICY.md'), 'utf8');
    const termsContent = readFileSync(join(root, 'docs', 'TERMS_OF_SERVICE.md'), 'utf8');
    const privacyPage = readFileSync(join(root, 'app', 'privacy', 'page.tsx'), 'utf8');
    const termsPage = readFileSync(join(root, 'app', 'terms', 'page.tsx'), 'utf8');
    const landingContent = readFileSync(join(root, 'content', 'landing.ts'), 'utf8');

    expect(privacyContent).toContain('Moldován Csaba Kft.');
    expect(privacyContent).toContain('moldovancsaba@gmail.com');
    expect(termsContent).toContain('Moldován Csaba Kft.');
    expect(termsContent).toContain('moldovancsaba@gmail.com');

    expect(privacyPage).toContain('Moldován Csaba Kft.');
    expect(privacyPage).toContain('moldovancsaba@gmail.com');
    expect(termsPage).toContain('Moldován Csaba Kft.');
    expect(termsPage).toContain('moldovancsaba@gmail.com');

    expect(landingContent).toContain('Moldován Csaba Kft.');
  });
});
