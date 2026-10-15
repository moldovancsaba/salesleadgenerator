import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  formatReSubject,
  formatRfcMessageId,
  resolveLeadThreadContext,
} from '../../lib/gmail-threading';
import { dispatchOutreachEmail } from '../../lib/outreach-send';
import * as integrationStore from '../../app/lib/integration-store';
import * as gmailSend from '../../lib/gmail-send';

describe('gmail-threading (Issue #243)', () => {
  describe('formatReSubject', () => {
    it('normalizes undefined or empty subject to "Re: "', () => {
      expect(formatReSubject(undefined)).toBe('Re: ');
      expect(formatReSubject('')).toBe('Re: ');
      expect(formatReSubject('   ')).toBe('Re: ');
    });

    it('prepends Re: to a fresh subject', () => {
      expect(formatReSubject('Intro meeting')).toBe('Re: Intro meeting');
    });

    it('avoids duplicating single Re: prefix', () => {
      expect(formatReSubject('Re: Intro meeting')).toBe('Re: Intro meeting');
      expect(formatReSubject('re: Intro meeting')).toBe('Re: Intro meeting');
      expect(formatReSubject('RE:  Intro meeting')).toBe('Re: Intro meeting');
    });

    it('collapses multiple chained Re: / Fwd: prefixes to single Re:', () => {
      expect(formatReSubject('Re: Re: Re: Follow up')).toBe('Re: Follow up');
      expect(formatReSubject('Fwd: Re: Quick question')).toBe('Re: Quick question');
      expect(formatReSubject('FW: RE: Project update')).toBe('Re: Project update');
    });
  });

  describe('formatRfcMessageId', () => {
    it('wraps unbracketed message ID in angle brackets', () => {
      expect(formatRfcMessageId('abc-123@company.com')).toBe('<abc-123@company.com>');
    });

    it('preserves already bracketed message ID', () => {
      expect(formatRfcMessageId('<slg-123-abc@company.com>')).toBe('<slg-123-abc@company.com>');
    });

    it('strips internal gmail: storage prefix', () => {
      expect(formatRfcMessageId('gmail:<msg-999@mail.gmail.com>')).toBe('<msg-999@mail.gmail.com>');
      expect(formatRfcMessageId('gmail:msg-999@mail.gmail.com')).toBe('<msg-999@mail.gmail.com>');
    });

    it('returns undefined for empty input', () => {
      expect(formatRfcMessageId(undefined)).toBeUndefined();
      expect(formatRfcMessageId('')).toBeUndefined();
      expect(formatRfcMessageId('   ')).toBeUndefined();
    });
  });

  describe('resolveLeadThreadContext', () => {
    it('returns null if neither outreach_logs nor activityLog have messages', async () => {
      const mockDb = {
        collection: (name: string) => ({
          find: () => ({
            sort: () => ({
              limit: () => ({
                toArray: async () => [],
              }),
            }),
          }),
        }),
      };

      const result = await resolveLeadThreadContext(mockDb as any, 'lead-empty');
      expect(result).toBeNull();
    });

    it('resolves thread context from outreach_logs when outbound email exists', async () => {
      const pastDate = new Date('2026-10-14T10:00:00Z');
      const mockDb = {
        collection: (name: string) => ({
          find: () => ({
            sort: () => ({
              limit: () => ({
                toArray: async () => {
                  if (name === 'outreach_logs') {
                    return [
                      {
                        leadId: 'lead-1',
                        rfcMessageId: '<msg-parent-123@slg.internal>',
                        gmailThreadId: 'thread-999',
                        subject: 'Initial Outreach',
                        createdAt: pastDate,
                      },
                    ];
                  }
                  return [];
                },
              }),
            }),
          }),
        }),
      };

      const result = await resolveLeadThreadContext(mockDb as any, 'lead-1', 'cogmap', 'default');
      expect(result).not.toBeNull();
      expect(result?.inReplyTo).toBe('<msg-parent-123@slg.internal>');
      expect(result?.threadId).toBe('thread-999');
      expect(result?.subject).toBe('Initial Outreach');
      expect(result?.lastDirection).toBe('outbound');
    });

    it('picks activityLog when inbound prospect reply is newer than outreach_logs', async () => {
      const oldOutboundDate = new Date('2026-10-14T08:00:00Z');
      const newerInboundDate = new Date('2026-10-14T12:00:00Z');

      const mockDb = {
        collection: (name: string) => ({
          find: () => ({
            sort: () => ({
              limit: () => ({
                toArray: async () => {
                  if (name === 'outreach_logs') {
                    return [
                      {
                        leadId: 'lead-2',
                        rfcMessageId: '<msg-old@slg.internal>',
                        gmailThreadId: 'thread-old',
                        subject: 'First pitch',
                        createdAt: oldOutboundDate,
                      },
                    ];
                  }
                  if (name === 'activityLog') {
                    return [
                      {
                        leadId: 'lead-2',
                        externalId: 'gmail:<reply-new@prospect.com>',
                        threadId: 'thread-active-123',
                        subject: 'Re: First pitch',
                        direction: 'inbound',
                        createdAt: newerInboundDate,
                      },
                    ];
                  }
                  return [];
                },
              }),
            }),
          }),
        }),
      };

      const result = await resolveLeadThreadContext(mockDb as any, 'lead-2');
      expect(result).not.toBeNull();
      expect(result?.inReplyTo).toBe('<reply-new@prospect.com>');
      expect(result?.threadId).toBe('thread-active-123');
      expect(result?.subject).toBe('Re: First pitch');
      expect(result?.lastDirection).toBe('inbound');
    });
  });

  describe('dispatchOutreachEmail with threading headers and fallback subject', () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it('auto-fills blank subject with Re: <previous> and passes In-Reply-To and threadId', async () => {
      const insertedLogs: any[] = [];
      const mockDb = {
        insertedLogs,
        collection: (name: string) => {
          if (name === 'outreach_logs') {
            return {
              find: () => ({
                sort: () => ({
                  limit: () => ({
                    toArray: async () => [
                      {
                        leadId: 'lead-thread-1',
                        rfcMessageId: '<root-msg-001@prospect.com>',
                        gmailThreadId: 'thread-xyz-789',
                        subject: 'Meeting request',
                        createdAt: new Date('2026-10-14T10:00:00Z'),
                      },
                    ],
                  }),
                }),
              }),
              insertOne: async (doc: any) => {
                insertedLogs.push(doc);
                return { insertedId: 'outreach-log-1' };
              },
              findOne: async () => null,
            };
          }
          return {
            find: () => ({
              sort: () => ({
                limit: () => ({
                  toArray: async () => [],
                }),
              }),
            }),
            insertOne: async (doc: any) => {
              insertedLogs.push(doc);
              return { insertedId: 'activity-log-1' };
            },
            findOne: async () => null,
            createIndex: async () => 'idx',
          };
        },
      };

      vi.spyOn(integrationStore, 'getUserConnection').mockResolvedValue({
        id: 'conn-1',
        status: 'active',
        userEmail: 'rep@company.com',
      } as any);
      vi.spyOn(integrationStore, 'getValidCredential').mockResolvedValue('token-123');

      let capturedMime = '';
      let capturedThreadId: string | undefined;
      vi.spyOn(gmailSend, 'sendGmailMessage').mockImplementation(async (params) => {
        capturedMime = params.rawMime;
        capturedThreadId = params.threadId;
        return { id: 'gmail-followup-id', threadId: 'thread-xyz-789' };
      });

      const lead = {
        _id: 'lead-thread-1',
        entity_name: 'Target Company',
        contacts: [{ name: 'Pat Lead', email: 'pat@target.com', isDecisionMaker: true }],
      };

      // Template has blank subject, representing "reply in thread"
      const template = {
        id: 'tpl-followup',
        name: 'Follow-up reply',
        channel: 'email' as const,
        industry: '',
        subject: '',
        body: 'Following up on my note below.',
        variables: [],
      };

      const result = await dispatchOutreachEmail(
        mockDb as any,
        lead as any,
        template,
        { brand: 'cogmap', tenantId: 'default' },
        {
          kind: 'manual',
          idempotencyKey: 'followup-idem-1',
          senderUserId: 'rep-user-1',
          replyInThread: true,
        }
      );

      expect(result.sent).toBe(true);
      expect(capturedThreadId).toBe('thread-xyz-789');
      expect(capturedMime).toContain('Subject: Re: Meeting request');
      expect(capturedMime).toContain('In-Reply-To: <root-msg-001@prospect.com>');
      expect(capturedMime).toContain('References: <root-msg-001@prospect.com>');

      // Verify outreach_logs contains threading metadata
      const outreachRecord = insertedLogs.find((l) => l.templateId === 'tpl-followup');
      expect(outreachRecord).toBeDefined();
      expect(outreachRecord.subject).toBe('Re: Meeting request');
      expect(outreachRecord.inReplyTo).toBe('<root-msg-001@prospect.com>');
      expect(outreachRecord.gmailThreadId).toBe('thread-xyz-789');
    });
  });
});
