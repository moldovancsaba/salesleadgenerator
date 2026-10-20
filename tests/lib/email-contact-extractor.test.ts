import { describe, it, expect, vi } from 'vitest';
import {
  parseEmailParticipant,
  parseEmailAddressList,
  inferCompanyFromEmail,
  inferCountryFromDomain,
  isSameEmailDomain,
  isInternalOrSystemEmail,
  extractContactsFromEmailMessage,
  cleanHtmlBody,
  cleanMessageSnippet,
} from '../../lib/email-contact-extractor';
import { mergeContactsIntoLead } from '../../lib/email-contact-merge';
import { normalizeContact } from '../../lib/contacts';

describe('email-contact-extractor', () => {
  describe('parseEmailParticipant', () => {
    it('parses standard RFC 5322 "Display Name <email>" format', () => {
      const res = parseEmailParticipant('"Jane Doe" <jane.doe@acme.com>');
      expect(res).toEqual({ name: 'Jane Doe', email: 'jane.doe@acme.com' });
    });

    it('parses unquoted display name format', () => {
      const res = parseEmailParticipant('John Smith <john.smith@example.org>');
      expect(res).toEqual({ name: 'John Smith', email: 'john.smith@example.org' });
    });

    it('parses bare email and formats local part into name', () => {
      const res = parseEmailParticipant('alex.turner@corp.net');
      expect(res).toEqual({ name: 'Alex Turner', email: 'alex.turner@corp.net' });
    });

    it('handles angle bracket without display name', () => {
      const res = parseEmailParticipant('<sarah_connor@tech.co>');
      expect(res).toEqual({ name: 'Sarah Connor', email: 'sarah_connor@tech.co' });
    });

    it('returns null for empty or invalid input', () => {
      expect(parseEmailParticipant('')).toBeNull();
      expect(parseEmailParticipant('not-an-email')).toBeNull();
    });
  });

  describe('parseEmailAddressList', () => {
    it('parses comma-separated list of addresses', () => {
      const input = '"Alice Wonderland" <alice@example.com>, Bob Builder <bob@example.com>, charlie@example.com';
      const res = parseEmailAddressList(input);
      expect(res).toHaveLength(3);
      expect(res[0]).toEqual({ name: 'Alice Wonderland', email: 'alice@example.com' });
      expect(res[1]).toEqual({ name: 'Bob Builder', email: 'bob@example.com' });
      expect(res[2]).toEqual({ name: 'Charlie', email: 'charlie@example.com' });
    });

    it('deduplicates identical email occurrences in list', () => {
      const input = ['alice@example.com', 'Alice <alice@example.com>'];
      const res = parseEmailAddressList(input);
      expect(res).toHaveLength(1);
      expect(res[0].email).toBe('alice@example.com');
    });
  });

  describe('inferCompanyFromEmail', () => {
    it('infers company name and domain from business email', () => {
      const res = inferCompanyFromEmail('contact@acme-robotics.com');
      expect(res).toEqual({
        domain: 'acme-robotics.com',
        companyName: 'Acme Robotics',
        isPublicProvider: false,
      });
    });

    it('formats short acronyms in uppercase (FRH, IBM, SAP)', () => {
      const res = inferCompanyFromEmail('kitty.erdei@frh.ro');
      expect(res).toEqual({
        domain: 'frh.ro',
        companyName: 'FRH',
        isPublicProvider: false,
      });

      const ibmRes = inferCompanyFromEmail('sales@ibm.com');
      expect(ibmRes?.companyName).toBe('IBM');
    });

    it('handles ccTLD multi-level domains', () => {
      const res = inferCompanyFromEmail('sales@bayern-munich.co.uk');
      expect(res).toEqual({
        domain: 'bayern-munich.co.uk',
        companyName: 'Bayern Munich',
        isPublicProvider: false,
      });
    });

    it('flags common public mail providers and leaves company name empty', () => {
      const res = inferCompanyFromEmail('john.doe@gmail.com');
      expect(res).toEqual({
        domain: 'gmail.com',
        companyName: '',
        isPublicProvider: true,
      });
    });
  });

  describe('isSameEmailDomain', () => {
    it('returns true for emails with identical private company domain', () => {
      expect(isSameEmailDomain('kitty.erdei@frh.ro', 'secretary@frh.ro')).toBe(true);
      expect(isSameEmailDomain('alice@acme.com', 'bob@acme.com')).toBe(true);
    });

    it('returns false for emails with different company domains', () => {
      expect(isSameEmailDomain('kitty.erdei@frh.ro', 'tamas.sebestyen@seyuselfies.com')).toBe(false);
      expect(isSameEmailDomain('user@apple.com', 'user@microsoft.com')).toBe(false);
    });

    it('returns false for public generic mail providers even if identical', () => {
      expect(isSameEmailDomain('user1@gmail.com', 'user2@gmail.com')).toBe(false);
      expect(isSameEmailDomain('user1@yahoo.com', 'user2@yahoo.com')).toBe(false);
    });

    it('returns false for null, undefined, or invalid inputs', () => {
      expect(isSameEmailDomain(null, 'test@example.com')).toBe(false);
      expect(isSameEmailDomain('test@example.com', undefined)).toBe(false);
      expect(isSameEmailDomain('invalid', 'test@example.com')).toBe(false);
    });
  });

  describe('inferCountryFromDomain', () => {
    it('maps ccTLD to country code including RO', () => {
      expect(inferCountryFromDomain('federation.ro')).toBe('RO');
      expect(inferCountryFromDomain('club.de')).toBe('DE');
      expect(inferCountryFromDomain('agency.co.uk')).toBe('GB');
      expect(inferCountryFromDomain('federation.fr')).toBe('FR');
      expect(inferCountryFromDomain('club.hu')).toBe('HU');
      expect(inferCountryFromDomain('company.com')).toBe('US');
    });
  });

  describe('isInternalOrSystemEmail', () => {
    it('identifies system and noreply addresses', () => {
      expect(isInternalOrSystemEmail('noreply@service.com')).toBe(true);
      expect(isInternalOrSystemEmail('no-reply@mailer.com')).toBe(true);
      expect(isInternalOrSystemEmail('bounce@resend.dev')).toBe(true);
    });

    it('identifies brand addresses', () => {
      expect(isInternalOrSystemEmail('cogmap@leads.haho.ai', { brand: 'cogmap' })).toBe(true);
      expect(isInternalOrSystemEmail('seyu-inbound@leads.haho.ai', { brand: 'seyu' })).toBe(true);
    });

    it('identifies explicit internal emails', () => {
      expect(isInternalOrSystemEmail('rep@mycompany.com', { internalEmails: ['rep@mycompany.com'] })).toBe(true);
      expect(isInternalOrSystemEmail('prospect@client.com', { internalEmails: ['rep@mycompany.com'] })).toBe(false);
    });

    it('identifies internal company domains across all brands', () => {
      expect(isInternalOrSystemEmail('david.bozsik@seyuselfies.com')).toBe(true);
      expect(isInternalOrSystemEmail('mate.pecsi@seyuselfies.com')).toBe(true);
      expect(isInternalOrSystemEmail('info@seyu.hu')).toBe(true);
      expect(isInternalOrSystemEmail('rep@cogmap.com')).toBe(true);
      expect(isInternalOrSystemEmail('admin@cog-map.com')).toBe(true);
      expect(isInternalOrSystemEmail('contact@dvsc.hu')).toBe(true);
      expect(isInternalOrSystemEmail('bot@haho.ai')).toBe(true);
      expect(isInternalOrSystemEmail('csaba@doneisbetter.com')).toBe(true);
    });

    it('identifies bot, meeting notetaker, calendar, and task management emails', () => {
      expect(isInternalOrSystemEmail('notification@asana.com')).toBe(true);
      expect(isInternalOrSystemEmail('notes@fyxer.ai')).toBe(true);
      expect(isInternalOrSystemEmail('assistant@notetaker.io')).toBe(true);
      expect(isInternalOrSystemEmail('bot@fireflies.ai')).toBe(true);
      expect(isInternalOrSystemEmail('calendar-notification@google.com')).toBe(true);
      expect(isInternalOrSystemEmail('gemini-summary@workspace.google.com')).toBe(true);
      expect(isInternalOrSystemEmail('mailer-daemon@googlemail.com')).toBe(true);
      expect(isInternalOrSystemEmail('updates@pipedrivemail.com')).toBe(true);
    });
  });

  describe('extractContactsFromEmailMessage', () => {
    it('extracts and enriches contacts from email headers and signature block', () => {
      const bodyWithSignature = `
Hi Team,

Looking forward to meeting tomorrow.

Best regards,
Markus Bauer
VP of Commercial Partnerships
+49 89 12345678
      `.trim();

      const msg = {
        from: '"Markus Bauer" <markus@fc-bavaria.de>',
        to: ['cogmap@leads.haho.ai', 'Claudia Wolf <claudia@fc-bavaria.de>'],
        cc: ['cfo@fc-bavaria.de'],
        body: bodyWithSignature,
      };

      const contacts = extractContactsFromEmailMessage(msg, { brand: 'cogmap' });

      // cogmap@leads.haho.ai should be filtered out
      expect(contacts).toHaveLength(3);

      const markus = contacts.find((c) => c.email === 'markus@fc-bavaria.de');
      expect(markus).toBeDefined();
      expect(markus?.name).toBe('Markus Bauer');
      expect(markus?.title).toBe('VP of Commercial Partnerships');
      expect(markus?.phone).toBe('+498912345678');
      expect(markus?.isDecisionMaker).toBe(true);

      const claudia = contacts.find((c) => c.email === 'claudia@fc-bavaria.de');
      expect(claudia).toBeDefined();
      expect(claudia?.name).toBe('Claudia Wolf');
      expect(claudia?.isDecisionMaker).toBe(false);

      const cfo = contacts.find((c) => c.email === 'cfo@fc-bavaria.de');
      expect(cfo).toBeDefined();
      expect(cfo?.name).toBe('Cfo');
    });
  });

  describe('mergeContactsIntoLead', () => {
    it('appends new contacts and updates lead contactEmails', async () => {
      const existingLead = {
        _id: '507f1f77bcf86cd799439011',
        entity_name: 'FC Bavaria',
        contacts: [
          { name: 'Existing Person', email: 'existing@fc-bavaria.de', title: 'Director' },
        ],
      };

      const mockUpdateOne = vi.fn().mockResolvedValue({ acknowledged: true });
      const mockFindOne = vi.fn().mockResolvedValue(existingLead);

      const mockDb: any = {
        collection: vi.fn().mockReturnValue({
          findOne: mockFindOne,
          updateOne: mockUpdateOne,
        }),
      };

      const candidate = normalizeContact({
        name: 'New Person',
        email: 'new@fc-bavaria.de',
        title: 'Manager',
        phone: '+1234567890',
        buyingRole: 'champion' as const,
        isDecisionMaker: false,
        crmStatus: 'lead' as const,
        role: 'Participant',
      });

      const res = await mergeContactsIntoLead(mockDb, 'cogmap', 'default', '507f1f77bcf86cd799439011', [candidate]);
      expect(res).not.toBeNull();
      expect(res?.added).toBe(1);
      expect(res?.contacts).toHaveLength(2);
      expect(mockUpdateOne).toHaveBeenCalled();
    });

    it('enriches existing contact if candidate has previously missing title/phone', async () => {
      const existingLead = {
        _id: '507f1f77bcf86cd799439011',
        entity_name: 'FC Bavaria',
        contacts: [
          { name: 'Existing Person', email: 'existing@fc-bavaria.de', title: '', phone: '' },
        ],
      };

      const mockUpdateOne = vi.fn().mockResolvedValue({ acknowledged: true });
      const mockFindOne = vi.fn().mockResolvedValue(existingLead);

      const mockDb: any = {
        collection: vi.fn().mockReturnValue({
          findOne: mockFindOne,
          updateOne: mockUpdateOne,
        }),
      };

      const candidate = normalizeContact({
        name: 'Existing Person',
        email: 'existing@fc-bavaria.de',
        title: 'Chief Marketing Officer',
        phone: '+49123456789',
        buyingRole: 'decision_maker' as const,
        isDecisionMaker: true,
        crmStatus: 'lead' as const,
        role: 'Sender',
      });

      const res = await mergeContactsIntoLead(mockDb, 'cogmap', 'default', '507f1f77bcf86cd799439011', [candidate]);
      expect(res?.updated).toBe(1);
      expect(res?.contacts[0].title).toBe('Chief Marketing Officer');
      expect(res?.contacts[0].phone).toBe('+49123456789');
    });

    it('rejects merging internal company contacts into the lead', async () => {
      const existingLead = {
        _id: '507f1f77bcf86cd799439011',
        entity_name: 'PSV Eindhoven',
        contacts: [
          { name: 'Director', email: 'director@psv.nl', title: 'Director' },
        ],
      };

      const mockUpdateOne = vi.fn().mockResolvedValue({ acknowledged: true });
      const mockFindOne = vi.fn().mockResolvedValue(existingLead);

      const mockDb: any = {
        collection: vi.fn().mockReturnValue({
          findOne: mockFindOne,
          updateOne: mockUpdateOne,
        }),
      };

      const internalCandidate = normalizeContact({
        name: 'David Bozsik',
        email: 'david.bozsik@seyuselfies.com',
        title: 'Sales Rep',
        role: 'Participant',
      });

      const res = await mergeContactsIntoLead(mockDb, 'seyu', 'default', '507f1f77bcf86cd799439011', [internalCandidate]);
      expect(res).toBeNull();
      expect(mockUpdateOne).not.toHaveBeenCalled();
    });
  });

  describe('cleanHtmlBody and cleanMessageSnippet', () => {
    it('strips style blocks and raw CSS correctly', () => {
      const html = '<style>* { margin: 0; padding: 0; font-family: sans-serif; }</style><p>Hello <b>Team</b>,</p><p>We would love to partner with you.</p>';
      const cleaned = cleanHtmlBody(html);
      expect(cleaned).not.toContain('margin: 0');
      expect(cleaned).not.toContain('<style>');
      expect(cleaned).toContain('Hello Team');
      expect(cleaned).toContain('We would love to partner with you.');
    });

    it('strips raw un-tagged CSS declarations, media queries, and template variables', () => {
      const html = '{{emailTitle}} #outlook a { padding:0; } body,table,td,p,a,li,blockquote { -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; } @media only screen and (max-width: 480px) { .mobile-hide { display: none !important; } } <p>Good morning David, following up on our meeting yesterday.</p>';
      const snippet = cleanMessageSnippet(html, 100);
      expect(snippet).not.toContain('emailTitle');
      expect(snippet).not.toContain('#outlook');
      expect(snippet).not.toContain('padding:0');
      expect(snippet).not.toContain('text-size-adjust');
      expect(snippet).not.toContain('mobile-hide');
      expect(snippet).toContain('Good morning David, following up on our meeting yesterday.');
    });
  });
});
