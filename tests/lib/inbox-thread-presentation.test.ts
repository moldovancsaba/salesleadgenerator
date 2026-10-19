import { describe, it, expect, vi } from 'vitest';
import { cleanHtmlBody, cleanMessageSnippet } from '../../lib/email-contact-extractor';
import { listInboxThreads, getInboxThreadDetail } from '../../app/lib/inbox-store';

describe('Inbox Thread Presentation (Issue 260)', () => {
  describe('HTML and CSS sanitization', () => {
    it('strips style blocks and raw CSS declarations from snippet', () => {
      const rawHtml = `
        <style type="text/css">
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: -apple-system, BlinkMacSystemFont; color: darkblue; }
        </style>
        <p>Dear Sales Team,</p>
        <p>We are writing regarding your sponsorship proposal for the upcoming season.</p>
      `;

      const snippet = cleanMessageSnippet(rawHtml, 100);
      expect(snippet).not.toContain('margin: 0');
      expect(snippet).not.toContain('font-family');
      expect(snippet).not.toContain('<style');
      expect(snippet).toContain('Dear Sales Team');
      expect(snippet).toContain('We are writing regarding');
    });

    it('strips script tags and decodes common HTML entities', () => {
      const rawHtml = '<script>alert("test")</script><p>Hello &amp; welcome!&nbsp;Let&#39;s discuss terms.</p>';
      const cleaned = cleanHtmlBody(rawHtml);
      expect(cleaned).not.toContain('alert');
      expect(cleaned).not.toContain('<script>');
      expect(cleaned).toBe("Hello & welcome! Let's discuss terms.");
    });
  });

  describe('Thread Sender Resolution and Availability Badges in listInboxThreads', () => {
    it('resolves sender name and email instead of falling back to System Communications', async () => {
      const mockActivityDocs = [
        {
          _id: '507f1f77bcf86cd799439011',
          threadId: 'thread-ext-101',
          brand: 'cogmap',
          tenantId: 'default',
          type: 'email-inbound',
          direction: 'inbound',
          fromAddress: 'marcus.vance@acme-sports.com',
          toAddresses: ['sales@cogmap.com', 'rep@cogmap.com'],
          ccAddresses: ['boss@acme-sports.com'],
          subject: 'Partnership Inquiry',
          bodyExcerpt: '<style>* { margin: 0; }</style><p>Hello, we are interested in your solution.</p>',
          createdAt: new Date('2026-10-18T10:00:00Z'),
        },
      ];

      const mockDb: any = {
        collection: vi.fn().mockImplementation((name: string) => {
          if (name === 'activityLog') {
            return {
              find: vi.fn().mockReturnValue({
                sort: vi.fn().mockReturnValue({
                  limit: vi.fn().mockReturnValue({
                    toArray: vi.fn().mockResolvedValue(mockActivityDocs),
                  }),
                }),
              }),
            };
          }
          if (name === 'outreach_logs') {
            return {
              find: vi.fn().mockReturnValue({
                sort: vi.fn().mockReturnValue({
                  limit: vi.fn().mockReturnValue({
                    toArray: vi.fn().mockResolvedValue([]),
                  }),
                }),
              }),
            };
          }
          if (name === 'inbox_thread_states') {
            return {
              createIndex: vi.fn().mockResolvedValue(true),
              find: vi.fn().mockReturnValue({
                toArray: vi.fn().mockResolvedValue([]),
              }),
            };
          }
          return {
            createIndex: vi.fn().mockResolvedValue(true),
            find: vi.fn().mockReturnValue({
              toArray: vi.fn().mockResolvedValue([]),
            }),
          };
        }),
      };

      const result = await listInboxThreads(mockDb, 'cogmap', 'default');
      expect(result.threads).toHaveLength(1);
      const thread = result.threads[0];

      // Sender resolution checks
      expect(thread.leadName).not.toBe('System Communications');
      expect(thread.leadName).toBe('Marcus Vance');
      expect(thread.senderDisplayName).toBe('Marcus Vance');
      expect(thread.senderEmail).toBe('marcus.vance@acme-sports.com');
      expect(thread.contactEmail).toBe('marcus.vance@acme-sports.com');

      // Availability flags
      expect(thread.hasLead).toBe(false);
      expect(thread.hasContact).toBe(true);
      expect(thread.hasDeal).toBe(false);

      // Clean snippet checks
      expect(thread.snippet).not.toContain('margin: 0');
      expect(thread.snippet).toContain('Hello, we are interested in your solution.');
    });

    it('populates hasLead, hasContact, hasDeal flags when lead details exist', async () => {
      const mockLeadDoc = {
        _id: '607f1f77bcf86cd799439099',
        id: 'lead-99',
        entity_name: 'FC Bayern Munich',
        kanbanColumn: 'QUALIFIED',
        contacts: [
          { name: 'Karl Fischer', email: 'k.fischer@fcbayern.de', title: 'Director of Sponsorship' },
        ],
        deals: [
          { id: 'deal-1', value: 75000, label: 'LED Signage Package' },
        ],
      };

      const mockActivityDocs = [
        {
          _id: '507f1f77bcf86cd799439022',
          threadId: 'lead:lead-99',
          leadId: 'lead-99',
          brand: 'cogmap',
          tenantId: 'default',
          type: 'email-outbound',
          direction: 'outbound',
          fromAddress: 'outreach@cogmap.com',
          toAddresses: ['k.fischer@fcbayern.de'],
          subject: 'Follow-up regarding LED package',
          bodyExcerpt: 'Following up on our call yesterday.',
          createdAt: new Date('2026-10-18T12:00:00Z'),
        },
      ];

      const mockDb: any = {
        collection: vi.fn().mockImplementation((name: string) => {
          if (name === 'activityLog') {
            return {
              find: vi.fn().mockReturnValue({
                sort: vi.fn().mockReturnValue({
                  limit: vi.fn().mockReturnValue({
                    toArray: vi.fn().mockResolvedValue(mockActivityDocs),
                  }),
                }),
              }),
            };
          }
          if (name === 'outreach_logs') {
            return {
              find: vi.fn().mockReturnValue({
                sort: vi.fn().mockReturnValue({
                  limit: vi.fn().mockReturnValue({
                    toArray: vi.fn().mockResolvedValue([]),
                  }),
                }),
              }),
            };
          }
          if (name === 'leads') {
            return {
              find: vi.fn().mockReturnValue({
                toArray: vi.fn().mockResolvedValue([mockLeadDoc]),
              }),
            };
          }
          return {
            createIndex: vi.fn().mockResolvedValue(true),
            find: vi.fn().mockReturnValue({
              toArray: vi.fn().mockResolvedValue([]),
            }),
          };
        }),
      };

      const result = await listInboxThreads(mockDb, 'cogmap', 'default');
      expect(result.threads).toHaveLength(1);
      const thread = result.threads[0];

      expect(thread.leadName).toBe('FC Bayern Munich');
      expect(thread.hasLead).toBe(true);
      expect(thread.hasContact).toBe(true);
      expect(thread.hasDeal).toBe(true);
      expect(thread.dealsCount).toBe(1);
      expect(thread.contactsCount).toBe(1);
    });
  });

  describe('Full To and Cc preservation in getInboxThreadDetail', () => {
    it('returns all To and Cc addresses in messages', async () => {
      const mockActivityDocs = [
        {
          _id: '507f1f77bcf86cd799439033',
          threadId: 'thread-multi-recipients',
          brand: 'cogmap',
          tenantId: 'default',
          type: 'email-inbound',
          direction: 'inbound',
          fromAddress: 'partner@olympics.org',
          toAddresses: ['user@cogmap.com', 'sales@cogmap.com'],
          ccAddresses: ['cfo@olympics.org', 'assistant@olympics.org'],
          subject: 'Contract Draft Review',
          body: '<style>p { color: red; }</style><p>Please find the draft attached.</p>',
          createdAt: new Date('2026-10-18T14:00:00Z'),
        },
      ];

      const mockDb: any = {
        collection: vi.fn().mockImplementation((name: string) => {
          if (name === 'activityLog') {
            return {
              find: vi.fn().mockReturnValue({
                sort: vi.fn().mockReturnValue({
                  toArray: vi.fn().mockResolvedValue(mockActivityDocs),
                }),
              }),
            };
          }
          if (name === 'outreach_logs') {
            return {
              find: vi.fn().mockReturnValue({
                sort: vi.fn().mockReturnValue({
                  toArray: vi.fn().mockResolvedValue([]),
                }),
              }),
            };
          }
          if (name === 'inbox_thread_states') {
            return {
              findOne: vi.fn().mockResolvedValue(null),
            };
          }
          return {
            findOne: vi.fn().mockResolvedValue(null),
            find: vi.fn().mockReturnValue({
              toArray: vi.fn().mockResolvedValue([]),
            }),
          };
        }),
      };

      const detail = await getInboxThreadDetail(mockDb, 'cogmap', 'default', 'thread-multi-recipients');
      expect(detail.thread).not.toBeNull();
      expect(detail.messages).toHaveLength(1);

      const msg = detail.messages[0];
      expect(msg.to).toEqual(['user@cogmap.com', 'sales@cogmap.com']);
      expect(msg.cc).toEqual(['cfo@olympics.org', 'assistant@olympics.org']);
      expect(msg.body).not.toContain('<style>');
      expect(msg.body).toBe('Please find the draft attached.');
    });
  });
});
